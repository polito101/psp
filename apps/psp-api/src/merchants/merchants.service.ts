import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { encryptUtf8 } from '../crypto/secret-box';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentProviderName } from '../payments-v2/domain/payment-provider-names';
import { PAYMENT_PROVIDER_NAMES } from '../payments-v2/domain/payment-provider-names';
import { PayoutScheduleType, SettlementMode } from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';

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
   * Inserta tarifas por defecto solo en **EUR** para todos los proveedores; otras divisas requieren
   * altas manuales en `MerchantRateTable` antes de poder crear intents en esa moneda.
   * @param dto.keyTtlDays - Días de validez de la key. Sin valor, no expira.
   * @returns id, name, apiKey (mostrar solo una vez), webhookSecret (mostrar solo una vez).
   */
  async create(dto: { name: string; webhookUrl?: string; keyTtlDays?: number }) {
    const webhookSecretPlain = `whsec_${randomBytes(24).toString('base64url')}`;
    const webhookSecretCiphertext = encryptUtf8(webhookSecretPlain);
    const placeholderHash = await bcrypt.hash(randomBytes(16).toString('hex'), 12);
    const apiKeyExpiresAt = dto.keyTtlDays
      ? new Date(Date.now() + dto.keyTtlDays * 86_400_000)
      : null;

    const { merchant, apiKeyPlain } = await this.prisma.$transaction(async (tx) => {
      const merchant = await tx.merchant.create({
        data: {
          name: dto.name,
          apiKeyHash: placeholderHash,
          webhookUrl: dto.webhookUrl ?? null,
          webhookSecretCiphertext,
        },
      });

      const apiKeyPlain = `psp.${merchant.id}.${randomBytes(32).toString('base64url')}`;
      const apiKeyHash = await bcrypt.hash(apiKeyPlain, 12);

      await tx.merchant.update({
        where: { id: merchant.id },
        data: { apiKeyHash, apiKeyExpiresAt },
      });

      await tx.merchantRateTable.createMany({
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

      await this.ensureMockPaymentMethodsForMerchant(tx, merchant.id);

      return { merchant, apiKeyPlain };
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

  async listOpsDirectory() {
    return this.prisma.merchant.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        deactivatedAt: true,
        apiKeyExpiresAt: true,
        apiKeyRevokedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async setMerchantActive(merchantId: string, isActive: boolean) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }
    return this.prisma.merchant.update({
      where: { id: merchantId },
      data: {
        isActive,
        deactivatedAt: isActive ? null : new Date(),
      },
      select: {
        id: true,
        name: true,
        isActive: true,
        deactivatedAt: true,
      },
    });
  }

  async getOpsDetail(merchantId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: {
        id: true,
        name: true,
        isActive: true,
        deactivatedAt: true,
        apiKeyExpiresAt: true,
        apiKeyRevokedAt: true,
        createdAt: true,
      },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }
    const [recentPayments, settlementRequests, paymentMethods] = await Promise.all([
      this.prisma.payment.findMany({
        where: { merchantId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          amountMinor: true,
          currency: true,
          createdAt: true,
        },
      }),
      this.prisma.settlementRequest.findMany({
        where: { merchantId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.merchantPaymentMethod.findMany({
        where: { merchantId },
        include: { definition: true },
      }),
    ]);
    return { merchant, recentPayments, settlementRequests, paymentMethods };
  }

  async listMerchantPaymentMethods(merchantId: string) {
    return this.prisma.merchantPaymentMethod.findMany({
      where: { merchantId },
      include: { definition: true },
    });
  }

  async patchMerchantPaymentMethod(
    merchantId: string,
    mpmId: string,
    patch: {
      merchantEnabled?: boolean;
      adminEnabled?: boolean;
      minAmountMinor?: number | null;
      maxAmountMinor?: number | null;
      visibleToMerchant?: boolean;
      lastChangedBy?: string;
    },
  ) {
    const row = await this.prisma.merchantPaymentMethod.findFirst({
      where: { id: mpmId, merchantId },
    });
    if (!row) {
      throw new NotFoundException('Merchant payment method not found');
    }
    return this.prisma.merchantPaymentMethod.update({
      where: { id: mpmId },
      data: {
        ...(patch.merchantEnabled !== undefined ? { merchantEnabled: patch.merchantEnabled } : {}),
        ...(patch.adminEnabled !== undefined ? { adminEnabled: patch.adminEnabled } : {}),
        ...(patch.minAmountMinor !== undefined ? { minAmountMinor: patch.minAmountMinor } : {}),
        ...(patch.maxAmountMinor !== undefined ? { maxAmountMinor: patch.maxAmountMinor } : {}),
        ...(patch.visibleToMerchant !== undefined ? { visibleToMerchant: patch.visibleToMerchant } : {}),
        ...(patch.lastChangedBy !== undefined ? { lastChangedBy: patch.lastChangedBy } : {}),
      },
      include: { definition: true },
    });
  }

  private async ensureMockPaymentMethodsForMerchant(tx: Prisma.TransactionClient, merchantId: string) {
    const seeds: Array<{
      id: string;
      code: string;
      label: string;
      provider: string;
      category: string;
    }> = [
      {
        id: 'pmdef_mock_card',
        code: 'mock_card',
        label: 'Mock Tarjeta',
        provider: 'mock',
        category: 'card',
      },
      {
        id: 'pmdef_mock_transfer',
        code: 'mock_transfer',
        label: 'Mock Transferencia',
        provider: 'mock',
        category: 'transfer',
      },
    ];
    for (const d of seeds) {
      await tx.paymentMethodDefinition.upsert({
        where: { code: d.code },
        create: {
          id: d.id,
          code: d.code,
          label: d.label,
          provider: d.provider,
          category: d.category,
          active: true,
        },
        update: { label: d.label, active: true, provider: d.provider, category: d.category },
      });
    }
    const defs = await tx.paymentMethodDefinition.findMany({
      where: { code: { in: seeds.map((s) => s.code) } },
      select: { id: true },
    });
    for (const def of defs) {
      await tx.merchantPaymentMethod.upsert({
        where: {
          merchantId_definitionId: { merchantId, definitionId: def.id },
        },
        create: {
          merchantId,
          definitionId: def.id,
          merchantEnabled: true,
          adminEnabled: true,
          visibleToMerchant: true,
        },
        update: {},
      });
    }
  }
}
