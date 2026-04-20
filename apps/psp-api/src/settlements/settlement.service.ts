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

/** Filas reclamadas por tanda; evita UPDATE sin límite y arrays enormes en memoria. */
const RELEASE_PENDING_BATCH_SIZE = 500;
/** Tope defensivo por invocación para evitar monopolizar el proceso bajo backlog continuo. */
const RELEASE_PENDING_MAX_BATCHES_PER_PAYOUT = 100;
/**
 * Tope de settlements por payout (por invocación de `createPayout`).
 * Protege de OOM y de transacciones enormes bajo backlog grande.
 */
const PAYOUT_MAX_SETTLEMENTS_PER_RUN = 1000;
/** Batch defensivo para `createMany` / `updateMany` cuando hay muchos ids. */
const PAYOUT_WRITE_BATCH_SIZE = 500;

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) {
    throw new Error('chunkSize must be > 0');
  }
  if (items.length === 0) {
    return [];
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    out.push(items.slice(i, i + chunkSize));
  }
  return out;
}

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

  /**
   * Una tanda: UPDATE PENDING→AVAILABLE con `FOR UPDATE SKIP LOCKED` y postings de ledger.
   * @returns filas liberadas en esta tanda (0 si no había candidatos).
   */
  private async releasePendingToAvailableBatch(
    tx: Prisma.TransactionClient,
    filters: { merchantId: string; currency: string } | undefined,
    now: Date,
  ): Promise<number> {
    const claimed = await tx.$queryRaw<ClaimedSettlementRow[]>(Prisma.sql`
      UPDATE "PaymentSettlement" ps
      SET
        status = 'AVAILABLE'::"SettlementStatus",
        "updated_at" = CURRENT_TIMESTAMP
      FROM (
        SELECT id
        FROM "PaymentSettlement"
        WHERE
          ${filters != null ? Prisma.sql`merchant_id = ${filters.merchantId} AND currency = ${filters.currency} AND ` : Prisma.empty}
          status = 'PENDING'::"SettlementStatus"
          AND "available_at" <= ${now}
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT ${RELEASE_PENDING_BATCH_SIZE}
      ) AS sub
      WHERE ps.id = sub.id
      RETURNING ps.id, ps.merchant_id, ps.payment_id, ps.currency, ps.net_minor
    `);

    if (claimed.length === 0) {
      return 0;
    }

    await tx.ledgerLine.createMany({
      data: buildReleaseLedgerEntries(claimed),
    });

    return claimed.length;
  }

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
    let total = 0;
    for (;;) {
      const n = await this.prisma.$transaction(async (tx) =>
        this.releasePendingToAvailableBatch(tx, undefined, now),
      );

      if (n === 0) {
        break;
      }
      total += n;
      if (n < RELEASE_PENDING_BATCH_SIZE) {
        break;
      }
    }
    return total;
  }

  async createPayout(params: { merchantId: string; currency: string; now?: Date }) {
    const now = params.now ?? new Date();

    // Drena backlog elegible por tandas, cada una en su transacción corta.
    let drainedBatches = 0;
    for (;;) {
      const n = await this.prisma.$transaction((tx) =>
        this.releasePendingToAvailableBatch(
          tx,
          { merchantId: params.merchantId, currency: params.currency },
          now,
        ),
      );
      drainedBatches += 1;

      if (n === 0 || n < RELEASE_PENDING_BATCH_SIZE) {
        break;
      }
      if (drainedBatches >= RELEASE_PENDING_MAX_BATCHES_PER_PAYOUT) {
        break;
      }
    }

    return this.prisma.$transaction(async (tx) => {
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
        ORDER BY ps.id
        FOR UPDATE OF ps SKIP LOCKED
        LIMIT ${PAYOUT_MAX_SETTLEMENTS_PER_RUN}
      `);

      if (lockedRaw.length === 0) {
        return null;
      }

      const rows: Array<{
        id: string;
        grossMinor: number;
        feeMinor: number;
        netMinor: number;
        capturedAt: Date;
        availableAt: Date;
      }> = [];

      let grossMinor = 0;
      let feeMinor = 0;
      let netMinor = 0;
      let minCapturedAtMs = Number.POSITIVE_INFINITY;
      let maxAvailableAtMs = 0;

      for (const row of lockedRaw) {
        rows.push({
          id: row.id,
          grossMinor: row.gross_minor,
          feeMinor: row.fee_minor,
          netMinor: row.net_minor,
          capturedAt: row.captured_at,
          availableAt: row.available_at,
        });
        grossMinor += row.gross_minor;
        feeMinor += row.fee_minor;
        netMinor += row.net_minor;
        minCapturedAtMs = Math.min(minCapturedAtMs, row.captured_at.getTime());
        maxAvailableAtMs = Math.max(maxAvailableAtMs, row.available_at.getTime());
      }

      const windowStartAt = new Date(minCapturedAtMs);
      const windowEndAt = new Date(maxAvailableAtMs);

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
        for (const batch of chunkArray(rows, PAYOUT_WRITE_BATCH_SIZE)) {
          await tx.payoutItem.createMany({
            data: batch.map((row) => ({
              payoutId: payout.id,
              paymentSettlementId: row.id,
              grossMinor: row.grossMinor,
              feeMinor: row.feeMinor,
              netMinor: row.netMinor,
            })),
          });
        }
      } catch (e) {
        if (isPrismaUniqueViolation(e)) {
          await tx.payout.delete({ where: { id: payout.id } });
          return null;
        }
        throw e;
      }

      for (const batch of chunkArray(
        rows.map((row) => row.id),
        PAYOUT_WRITE_BATCH_SIZE,
      )) {
        await tx.paymentSettlement.updateMany({
          where: { id: { in: batch } },
          data: {
            status: SettlementStatus.PAID,
            payoutId: payout.id,
            paidAt: now,
          },
        });
      }

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
