import { Injectable, NotFoundException } from '@nestjs/common';
import type { MerchantRateTable } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentProviderName } from '../payments-v2/domain/payment-provider-names';

export type FeeInput = {
  amountMinor: number;
  percentageBps: number;
  fixedMinor: number;
  minimumMinor: number;
};

export type FeeQuote = {
  grossMinor: number;
  feeMinor: number;
  netMinor: number;
  percentageMinor: number;
};

@Injectable()
export class FeeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Comisión antes de topear al bruto (`amountMinor`). Útil para validar captura antes del PSP
   * y para detectar cuando `calculate` aplica tope.
   */
  static uncappedFeeMinor(input: FeeInput): number {
    const percentageMinor = Math.floor((input.amountMinor * input.percentageBps) / 10_000);
    const rawFee = percentageMinor + input.fixedMinor;
    return Math.max(rawFee, input.minimumMinor);
  }

  static calculate(input: FeeInput): FeeQuote {
    const percentageMinor = Math.floor((input.amountMinor * input.percentageBps) / 10_000);
    const rawFee = percentageMinor + input.fixedMinor;
    const uncapped = Math.max(rawFee, input.minimumMinor);
    const feeMinor = Math.min(uncapped, input.amountMinor);
    const netMinor = input.amountMinor - feeMinor;
    return {
      grossMinor: input.amountMinor,
      feeMinor,
      netMinor,
      percentageMinor,
    };
  }

  async findActiveRateTable(
    merchantId: string,
    currency: string,
    provider: PaymentProviderName,
  ): Promise<MerchantRateTable | null> {
    return this.prisma.merchantRateTable.findFirst({
      where: {
        merchantId,
        currency,
        provider,
        activeTo: null,
      },
      orderBy: { activeFrom: 'desc' },
    });
  }

  /**
   * Verifica que exista al menos una tarifa activa para la divisa en alguno de los proveedores del orden de ruteo.
   * Evita crear intents que no podrían liquidarse en captura por falta de configuración.
   */
  async hasActiveRateTableForAnyProvider(
    merchantId: string,
    currency: string,
    providers: readonly PaymentProviderName[],
  ): Promise<boolean> {
    if (providers.length === 0) {
      return false;
    }
    const row = await this.prisma.merchantRateTable.findFirst({
      where: {
        merchantId,
        currency,
        provider: { in: [...providers] },
        activeTo: null,
      },
      orderBy: { activeFrom: 'desc' },
    });
    return row !== null;
  }

  async resolveActiveRateTable(merchantId: string, currency: string, provider: PaymentProviderName) {
    const row = await this.findActiveRateTable(merchantId, currency, provider);
    if (!row) {
      throw new NotFoundException(`No active rate table for ${merchantId}/${currency}/${provider}`);
    }
    return row;
  }
}
