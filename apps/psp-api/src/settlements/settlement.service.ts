import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PayoutScheduleType, SettlementStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

type ClaimedSettlementRow = {
  id: string;
  merchant_id: string;
  payment_id: string;
  currency: string;
  net_minor: number;
};

/** Fila devuelta por SELECT ... FOR UPDATE SKIP LOCKED (nombres en snake_case). */
type LockedAvailableSettlementRow = {
  id: string;
  gross_minor: number;
  fee_minor: number;
  net_minor: number;
  captured_at: Date;
  available_at: Date;
};

function isPrismaUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code: string }).code === 'P2002'
  );
}

/** Dos líneas de ledger por settlement liberado (PENDING → AVAILABLE); una sola tanda `createMany`. */
function buildReleaseLedgerEntries(claimed: ClaimedSettlementRow[]) {
  const ledgerEntries: Prisma.LedgerLineCreateManyInput[] = [];
  for (const row of claimed) {
    ledgerEntries.push(
      {
        merchantId: row.merchant_id,
        paymentId: row.payment_id,
        entryType: 'merchant_pending',
        amountMinor: -row.net_minor,
        currency: row.currency,
        description: 'Settlement release to available',
      },
      {
        merchantId: row.merchant_id,
        paymentId: row.payment_id,
        entryType: 'merchant_available',
        amountMinor: row.net_minor,
        currency: row.currency,
        description: 'Settlement released and available',
      },
    );
  }
  return ledgerEntries;
}

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
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<ClaimedSettlementRow[]>(Prisma.sql`
        UPDATE "PaymentSettlement"
        SET
          status = 'AVAILABLE'::"SettlementStatus",
          "updated_at" = CURRENT_TIMESTAMP
        WHERE
          status = 'PENDING'::"SettlementStatus"
          AND "available_at" <= ${now}
        RETURNING id, merchant_id, payment_id, currency, net_minor
      `);

      if (claimed.length === 0) {
        return 0;
      }

      const ledgerEntries = buildReleaseLedgerEntries(claimed);
      await tx.ledgerLine.createMany({ data: ledgerEntries });

      return claimed.length;
    });
  }

  async createPayout(params: { merchantId: string; currency: string; now?: Date }) {
    const now = params.now ?? new Date();
    return this.prisma.$transaction(async (tx) => {
      const claimedRelease = await tx.$queryRaw<ClaimedSettlementRow[]>(Prisma.sql`
        UPDATE "PaymentSettlement"
        SET
          status = 'AVAILABLE'::"SettlementStatus",
          "updated_at" = CURRENT_TIMESTAMP
        WHERE
          merchant_id = ${params.merchantId}
          AND currency = ${params.currency}
          AND status = 'PENDING'::"SettlementStatus"
          AND "available_at" <= ${now}
        RETURNING id, merchant_id, payment_id, currency, net_minor
      `);

      const releaseLedgerEntries = buildReleaseLedgerEntries(claimedRelease);

      const lockedRaw = await tx.$queryRaw<LockedAvailableSettlementRow[]>(Prisma.sql`
        SELECT
          ps.id,
          ps.gross_minor,
          ps.fee_minor,
          ps.net_minor,
          ps.captured_at,
          ps.available_at
        FROM "PaymentSettlement" ps
        WHERE
          ps.merchant_id = ${params.merchantId}
          AND ps.currency = ${params.currency}
          AND ps.status = 'AVAILABLE'::"SettlementStatus"
          AND ps.payout_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "PayoutItem" pi WHERE pi.payment_settlement_id = ps.id
          )
        FOR UPDATE OF ps SKIP LOCKED
      `);

      if (lockedRaw.length === 0) {
        if (releaseLedgerEntries.length > 0) {
          await tx.ledgerLine.createMany({ data: releaseLedgerEntries });
        }
        return null;
      }

      const rows = lockedRaw.map((row) => ({
        id: row.id,
        grossMinor: row.gross_minor,
        feeMinor: row.fee_minor,
        netMinor: row.net_minor,
        capturedAt: row.captured_at,
        availableAt: row.available_at,
      }));

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

      try {
        await tx.payoutItem.createMany({
          data: rows.map((row) => ({
            payoutId: payout.id,
            paymentSettlementId: row.id,
            grossMinor: row.grossMinor,
            feeMinor: row.feeMinor,
            netMinor: row.netMinor,
          })),
        });
      } catch (e) {
        if (isPrismaUniqueViolation(e)) {
          if (releaseLedgerEntries.length > 0) {
            await tx.ledgerLine.createMany({ data: releaseLedgerEntries });
          }
          await tx.payout.delete({ where: { id: payout.id } });
          return null;
        }
        throw e;
      }

      await tx.paymentSettlement.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: {
          status: SettlementStatus.PAID,
          payoutId: payout.id,
          paidAt: now,
        },
      });

      const ledgerEntries: Prisma.LedgerLineCreateManyInput[] = [
        ...releaseLedgerEntries,
        {
          merchantId: params.merchantId,
          paymentId: null,
          entryType: 'merchant_available',
          amountMinor: -netMinor,
          currency: params.currency,
          description: `Payout ${payout.id} created`,
        },
      ];
      await tx.ledgerLine.createMany({ data: ledgerEntries });

      return {
        id: payout.id,
        settlementsCount: rows.length,
        netMinor,
      };
    });
  }
}
