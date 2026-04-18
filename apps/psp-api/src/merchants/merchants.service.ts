import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { encryptUtf8 } from '../crypto/secret-box';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentProviderName } from '../payments-v2/domain/payment-provider-names';
import { PAYMENT_PROVIDER_NAMES } from '../payments-v2/domain/payment-provider-names';
import { PayoutScheduleType, SettlementMode } from '../generated/prisma/enums';

type CreateRateTableInput = {
  provider: PaymentProviderName;
  currency: string;
  percentageBps: number;
  fixedMinor: number;
  minimumMinor: number;
  settlementMode: SettlementMode;
  payoutScheduleType: PayoutScheduleType;
  payoutScheduleParam: number;
  contractRef?: string;
};

@Injectable()
export class MerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea un merchant con su API key y secreto de webhook.
   * @param dto.keyTtlDays - Días de validez de la key. Sin valor, no expira.
   * @returns id, name, apiKey (mostrar solo una vez), webhookSecret (mostrar solo una vez).
   */
  async create(dto: { name: string; webhookUrl?: string; keyTtlDays?: number }) {
    const webhookSecretPlain = `whsec_${randomBytes(24).toString('base64url')}`;
    const webhookSecretCiphertext = encryptUtf8(webhookSecretPlain);
    const placeholderHash = await bcrypt.hash(randomBytes(16).toString('hex'), 12);

    const merchant = await this.prisma.merchant.create({
      data: {
        name: dto.name,
        apiKeyHash: placeholderHash,
        webhookUrl: dto.webhookUrl ?? null,
        webhookSecretCiphertext,
      },
    });

    const apiKeyPlain = `psp.${merchant.id}.${randomBytes(32).toString('base64url')}`;
    const apiKeyHash = await bcrypt.hash(apiKeyPlain, 12);
    const apiKeyExpiresAt = dto.keyTtlDays
      ? new Date(Date.now() + dto.keyTtlDays * 86_400_000)
      : null;

    await this.prisma.merchant.update({
      where: { id: merchant.id },
      data: { apiKeyHash, apiKeyExpiresAt },
    });

    await this.prisma.merchantRateTable.createMany({
      data: PAYMENT_PROVIDER_NAMES.map((provider) => ({
        merchantId: merchant.id,
        currency: 'EUR',
        provider,
        percentageBps: merchant.feeBps,
        fixedMinor: 0,
        minimumMinor: 0,
        settlementMode: SettlementMode.NET,
        payoutScheduleType: PayoutScheduleType.T_PLUS_N,
        payoutScheduleParam: 1,
      })),
    });

    return {
      id: merchant.id,
      name: merchant.name,
      apiKey: apiKeyPlain,
      apiKeyExpiresAt,
      webhookSecret: webhookSecretPlain,
      message: 'Guarda apiKey y webhookSecret de forma segura; no se volverán a mostrar.',
    };
  }

  /**
   * Genera una nueva API key para el merchant e invalida la anterior.
   * Si se especifica keyTtlDays, la nueva key tendrá esa validez.
   * @returns La nueva apiKey en texto plano (mostrar solo una vez).
   */
  async rotateApiKey(merchantId: string, keyTtlDays?: number) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, name: true },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    const newApiKeyPlain = `psp.${merchant.id}.${randomBytes(32).toString('base64url')}`;
    const newApiKeyHash = await bcrypt.hash(newApiKeyPlain, 12);
    const apiKeyExpiresAt = keyTtlDays
      ? new Date(Date.now() + keyTtlDays * 86_400_000)
      : null;

    await this.prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        apiKeyHash: newApiKeyHash,
        apiKeyExpiresAt,
        apiKeyRevokedAt: null,
      },
    });

    return {
      id: merchant.id,
      apiKey: newApiKeyPlain,
      apiKeyExpiresAt,
      message: 'API key rotada correctamente. La key anterior ya no es válida.',
    };
  }

  /**
   * Revoca la API key activa del merchant de forma inmediata.
   * Tras revocar, todos los requests con la key anterior reciben 401.
   */
  async revokeApiKey(merchantId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    await this.prisma.merchant.update({
      where: { id: merchant.id },
      data: { apiKeyRevokedAt: new Date() },
    });

    return {
      id: merchant.id,
      revokedAt: new Date().toISOString(),
      message: 'API key revocada. Usa rotate-key para emitir una nueva.',
    };
  }

  async createRateTable(merchantId: string, dto: CreateRateTableInput) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.merchantRateTable.updateMany({
        where: {
          merchantId,
          currency: dto.currency,
          provider: dto.provider,
          activeTo: null,
        },
        data: { activeTo: new Date() },
      });
      return tx.merchantRateTable.create({
        data: {
          merchantId,
          provider: dto.provider,
          currency: dto.currency,
          percentageBps: dto.percentageBps,
          fixedMinor: dto.fixedMinor,
          minimumMinor: dto.minimumMinor,
          settlementMode: dto.settlementMode,
          payoutScheduleType: dto.payoutScheduleType,
          payoutScheduleParam: dto.payoutScheduleParam,
          contractRef: dto.contractRef ?? null,
        },
      });
    });
  }

  async listRateTables(merchantId: string) {
    return this.prisma.merchantRateTable.findMany({
      where: { merchantId },
      orderBy: { activeFrom: 'desc' },
    });
  }
}
