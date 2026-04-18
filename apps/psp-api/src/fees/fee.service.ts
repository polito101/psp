import { Injectable, NotFoundException } from '@nestjs/common';
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

  static calculate(input: FeeInput): FeeQuote {
    const percentageMinor = Math.floor((input.amountMinor * input.percentageBps) / 10_000);
    const rawFee = percentageMinor + input.fixedMinor;
    const feeMinor = Math.max(rawFee, input.minimumMinor);
    const netMinor = input.amountMinor - feeMinor;
    return {
      grossMinor: input.amountMinor,
      feeMinor,
      netMinor,
      percentageMinor,
    };
  }

  async resolveActiveRateTable(merchantId: string, currency: string, provider: PaymentProviderName) {
    const row = await this.prisma.merchantRateTable.findFirst({
      where: {
        merchantId,
        currency,
        provider,
        activeTo: null,
      },
      orderBy: { activeFrom: 'desc' },
    });
    if (!row) {
      throw new NotFoundException(`No active rate table for ${merchantId}/${currency}/${provider}`);
    }
    return row;
  }
}
