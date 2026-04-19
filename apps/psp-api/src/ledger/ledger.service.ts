import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
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
      by: ['currency', 'entryType'],
      where: {
        merchantId,
        entryType: { in: ['merchant_pending', 'merchant_available', 'available'] },
      },
      _sum: { amountMinor: true },
    });
    const byCurrency = new Map<string, { pendingMinor: number; availableMinor: number }>();
    for (const row of rows) {
      const current = byCurrency.get(row.currency) ?? { pendingMinor: 0, availableMinor: 0 };
      const value = row._sum.amountMinor ?? 0;
      if (row.entryType === 'merchant_pending') {
        current.pendingMinor += value;
      }
      if (row.entryType === 'merchant_available') {
        current.availableMinor += value;
      }
      if (row.entryType === 'available') {
        current.availableMinor += value;
      }
      byCurrency.set(row.currency, current);
    }
    return [...byCurrency.entries()].map(([currency, totals]) => ({
      currency,
      pendingMinor: totals.pendingMinor,
      availableMinor: totals.availableMinor,
    }));
  }

  async recordSuccessfulCapture(
    tx: Prisma.TransactionClient,
    params: {
      merchantId: string;
      paymentId: string;
      currency: string;
    } & (
      | {
          amountMinor: number;
          feeBps: number;
        }
      | {
          grossMinor: number;
          feeMinor: number;
          netMinor: number;
        }
    ),
  ) {
    const gross = 'grossMinor' in params ? params.grossMinor : params.amountMinor;
    const fee = 'feeMinor' in params ? params.feeMinor : LedgerService.feeAmount(params.amountMinor, params.feeBps);
    const net = 'netMinor' in params ? params.netMinor : params.amountMinor - fee;
    if (net !== gross - fee) {
      throw new Error('Invalid fee breakdown: net must equal gross - fee');
    }

    await tx.ledgerLine.createMany({
      data: [
        {
          merchantId: params.merchantId,
          paymentId: params.paymentId,
          entryType: 'merchant_pending',
          amountMinor: gross,
          currency: params.currency,
          description: 'Gross captured (pending settlement)',
        },
        {
          merchantId: params.merchantId,
          paymentId: params.paymentId,
          entryType: 'merchant_pending',
          amountMinor: -fee,
          currency: params.currency,
          description: 'Fee charged to merchant (pending)',
        },
        {
          merchantId: params.merchantId,
          paymentId: params.paymentId,
          entryType: 'platform_fee_revenue',
          amountMinor: fee,
          currency: params.currency,
          description: 'Platform fee revenue',
        },
      ],
    });
  }

  async recordSuccessfulRefund(
    tx: Prisma.TransactionClient,
    params: {
      merchantId: string;
      paymentId: string;
      amountMinor: number;
      currency: string;
    },
  ) {
    const pendingEntry = await tx.ledgerLine.findFirst({
      where: {
        merchantId: params.merchantId,
        paymentId: params.paymentId,
        entryType: 'merchant_pending',
      },
      select: { id: true },
    });

    await tx.ledgerLine.create({
      data: {
        merchantId: params.merchantId,
        paymentId: params.paymentId,
        entryType: pendingEntry ? 'merchant_pending' : 'available',
        amountMinor: -params.amountMinor,
        currency: params.currency,
        description: 'Reversa por reembolso',
      },
    });
  }
}
