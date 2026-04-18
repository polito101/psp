import { Injectable } from '@nestjs/common';
import { PayoutScheduleType, SettlementStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettlementService {
  constructor(private readonly prisma: PrismaService) {}

  static computeAvailableAt(
    capturedAt: Date,
    payoutScheduleType: PayoutScheduleType,
    payoutScheduleParam: number,
  ): Date {
    if (payoutScheduleType === 'T_PLUS_N') {
      const next = new Date(capturedAt);
      next.setUTCDate(next.getUTCDate() + Math.max(0, payoutScheduleParam));
      return next;
    }
    const targetDay = Math.min(6, Math.max(0, payoutScheduleParam));
    const currentDay = capturedAt.getUTCDay();
    let delta = (targetDay - currentDay + 7) % 7;
    if (delta === 0) {
      delta = 7;
    }
    const next = new Date(capturedAt);
    next.setUTCDate(next.getUTCDate() + delta);
    return next;
  }

  async releasePendingToAvailable(now: Date): Promise<number> {
    const pending = await this.prisma.paymentSettlement.findMany({
      where: {
        status: SettlementStatus.PENDING,
        availableAt: { lte: now },
      },
      select: {
        id: true,
        merchantId: true,
        paymentId: true,
        currency: true,
        netMinor: true,
      },
    });

    if (pending.length === 0) {
      return 0;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const settlement of pending) {
        await tx.ledgerLine.createMany({
          data: [
            {
              merchantId: settlement.merchantId,
              paymentId: settlement.paymentId,
              entryType: 'merchant_pending',
              amountMinor: -settlement.netMinor,
              currency: settlement.currency,
              description: 'Settlement release to available',
            },
            {
              merchantId: settlement.merchantId,
              paymentId: settlement.paymentId,
              entryType: 'merchant_available',
              amountMinor: settlement.netMinor,
              currency: settlement.currency,
              description: 'Settlement released and available',
            },
          ],
        });
      }
      await tx.paymentSettlement.updateMany({
        where: { id: { in: pending.map((row) => row.id) } },
        data: { status: SettlementStatus.AVAILABLE },
      });
    });

    return pending.length;
  }

  async createPayout(params: { merchantId: string; currency: string; now?: Date }) {
    const now = params.now ?? new Date();
    return this.prisma.$transaction(async (tx) => {
      const releasable = await tx.paymentSettlement.findMany({
        where: {
          merchantId: params.merchantId,
          currency: params.currency,
          status: SettlementStatus.PENDING,
          availableAt: { lte: now },
        },
        select: {
          id: true,
          merchantId: true,
          paymentId: true,
          currency: true,
          netMinor: true,
        },
      });
      if (releasable.length > 0) {
        for (const settlement of releasable) {
          await tx.ledgerLine.createMany({
            data: [
              {
                merchantId: settlement.merchantId,
                paymentId: settlement.paymentId,
                entryType: 'merchant_pending',
                amountMinor: -settlement.netMinor,
                currency: settlement.currency,
                description: 'Settlement release to available',
              },
              {
                merchantId: settlement.merchantId,
                paymentId: settlement.paymentId,
                entryType: 'merchant_available',
                amountMinor: settlement.netMinor,
                currency: settlement.currency,
                description: 'Settlement released and available',
              },
            ],
          });
        }
        await tx.paymentSettlement.updateMany({
          where: { id: { in: releasable.map((row) => row.id) } },
          data: { status: SettlementStatus.AVAILABLE },
        });
      }

      const rows = await tx.paymentSettlement.findMany({
        where: {
          merchantId: params.merchantId,
          currency: params.currency,
          status: SettlementStatus.AVAILABLE,
          payoutItem: null,
        },
        select: {
          id: true,
          grossMinor: true,
          feeMinor: true,
          netMinor: true,
          capturedAt: true,
          availableAt: true,
        },
      });
      if (rows.length === 0) {
        return null;
      }

      const grossMinor = rows.reduce((acc, row) => acc + row.grossMinor, 0);
      const feeMinor = rows.reduce((acc, row) => acc + row.feeMinor, 0);
      const netMinor = rows.reduce((acc, row) => acc + row.netMinor, 0);
      const windowStartAt = new Date(Math.min(...rows.map((row) => row.capturedAt.getTime())));
      const windowEndAt = new Date(Math.max(...rows.map((row) => row.availableAt.getTime())));

      const payout = await tx.payout.create({
        data: {
          merchantId: params.merchantId,
          currency: params.currency,
          status: 'CREATED',
          windowStartAt,
          windowEndAt,
          grossMinor,
          feeMinor,
          netMinor,
        },
        select: { id: true },
      });

      await tx.payoutItem.createMany({
        data: rows.map((row) => ({
          payoutId: payout.id,
          paymentSettlementId: row.id,
          grossMinor: row.grossMinor,
          feeMinor: row.feeMinor,
          netMinor: row.netMinor,
        })),
      });

      await tx.paymentSettlement.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: {
          status: SettlementStatus.PAID,
          payoutId: payout.id,
          paidAt: now,
        },
      });

      await tx.ledgerLine.createMany({
        data: [
          {
            merchantId: params.merchantId,
            paymentId: null,
            entryType: 'merchant_available',
            amountMinor: -netMinor,
            currency: params.currency,
            description: `Payout ${payout.id} created`,
          },
        ],
      });

      return {
        id: payout.id,
        settlementsCount: rows.length,
        netMinor,
      };
    });
  }
}
