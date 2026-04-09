import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Comisión en unidades menores (redondeo hacia abajo). */
  static feeAmount(amountMinor: number, feeBps: number): number {
    return Math.floor((amountMinor * feeBps) / 10_000);
  }

  async getBalances(merchantId: string) {
    const rows = await this.prisma.ledgerLine.groupBy({
      by: ['currency'],
      where: { merchantId, entryType: 'available' },
      _sum: { amountMinor: true },
    });
    return rows.map((r) => ({
      currency: r.currency,
      availableMinor: r._sum.amountMinor ?? 0,
    }));
  }

  async recordSuccessfulCapture(
    tx: Prisma.TransactionClient,
    params: {
      merchantId: string;
      paymentId: string;
      amountMinor: number;
      currency: string;
      feeBps: number;
    },
  ) {
    const fee = LedgerService.feeAmount(params.amountMinor, params.feeBps);
    const net = params.amountMinor - fee;

    await tx.ledgerLine.create({
      data: {
        merchantId: params.merchantId,
        paymentId: params.paymentId,
        entryType: 'available',
        amountMinor: net,
        currency: params.currency,
        description: 'Neto tras comisión PSP',
      },
    });
    await tx.ledgerLine.create({
      data: {
        merchantId: params.merchantId,
        paymentId: params.paymentId,
        entryType: 'fee',
        amountMinor: fee,
        currency: params.currency,
        description: `Comisión PSP (${params.feeBps} bps)`,
      },
    });
  }
}
