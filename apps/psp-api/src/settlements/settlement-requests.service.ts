import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SettlementStatus, SettlementRequestStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { APPROVE_MAX_CREATE_PAYOUT_ITERATIONS, SettlementService } from './settlement.service';

const INT32_MAX = 2_147_483_647;
const PAYOUT_LINK_BATCH = 500;

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

@Injectable()
export class SettlementRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlements: SettlementService,
  ) {}

  async getAvailableNetMinor(merchantId: string, currency: string): Promise<{ availableNetMinor: number }> {
    const cur = currency.toUpperCase();
    const agg = await this.prisma.paymentSettlement.aggregate({
      where: {
        merchantId,
        currency: cur,
        status: SettlementStatus.AVAILABLE,
        payoutId: null,
      },
      _sum: { netMinor: true },
    });
    return { availableNetMinor: agg._sum.netMinor ?? 0 };
  }

  async createRequest(params: {
    merchantId: string;
    currency: string;
    notes?: string;
    requestedByRole: string;
  }) {
    const { availableNetMinor } = await this.getAvailableNetMinor(params.merchantId, params.currency);
    if (availableNetMinor <= 0) {
      throw new BadRequestException('No hay saldo AVAILABLE para solicitar liquidación en esta divisa');
    }
    return this.prisma.settlementRequest.create({
      data: {
        merchantId: params.merchantId,
        currency: params.currency.toUpperCase(),
        requestedNetMinor: availableNetMinor,
        status: SettlementRequestStatus.PENDING,
        notes: params.notes ?? null,
        requestedByRole: params.requestedByRole,
      },
    });
  }

  async listForMerchant(merchantId: string) {
    return this.prisma.settlementRequest.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async listInbox(status: SettlementRequestStatus = SettlementRequestStatus.PENDING) {
    return this.prisma.settlementRequest.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  /**
   * Vuelve APPROVED → PENDING si el payout no pudo completarse (reintento admin).
   */
  private async revertApprovedToPending(requestId: string) {
    await this.prisma.settlementRequest.updateMany({
      where: { id: requestId, status: SettlementRequestStatus.APPROVED },
      data: {
        status: SettlementRequestStatus.PENDING,
        reviewedNotes: null,
        paidNetMinor: null,
        settledAllAvailable: true,
      },
    });
  }

  /**
   * Recuperación conservadora: payout ya commiteado sin `SettlementRequest` asociada,
   * mismo comercio/divisa, mismo neto que la solicitud y creado después de abrir la solicitud.
   * Si hay más de un candidato, no enlaza (evita vínculo ambiguo).
   */
  private async tryLinkOrphanPayoutAndFinalize(row: {
    id: string;
    merchantId: string;
    currency: string;
    requestedNetMinor: number;
    createdAt: Date;
  }) {
    const orphans = await this.prisma.payout.findMany({
      where: {
        merchantId: row.merchantId,
        currency: row.currency,
        settlementRequestAnchor: { is: null },
        settlementRequestId: null,
        netMinor: row.requestedNetMinor,
        createdAt: { gte: row.createdAt },
      },
      orderBy: { createdAt: 'asc' },
      take: 2,
      select: { id: true },
    });

    if (orphans.length !== 1) {
      return null;
    }

    const orphanId = orphans[0].id;

    const finalized = await this.prisma.settlementRequest.updateMany({
      where: {
        id: row.id,
        status: SettlementRequestStatus.APPROVED,
        payoutId: null,
      },
      data: {
        status: SettlementRequestStatus.PAID,
        payoutId: orphanId,
        paidNetMinor: row.requestedNetMinor,
        settledAllAvailable: true,
      },
    });

    if (finalized.count === 0) {
      return null;
    }

    await this.prisma.payout.update({
      where: { id: orphanId },
      data: { settlementRequestId: row.id },
    });

    return this.prisma.settlementRequest.findUniqueOrThrow({ where: { id: row.id } });
  }

  /**
   * Repite `createPayout` hasta vaciar el AVAILABLE elegible (o tope defensivo), enlaza payouts
   * a la solicitud y marca PAID con metadatos de cobertura.
   */
  private async runApprovedPayoutPlan(
    requestId: string,
    row: { merchantId: string; currency: string; reviewedNotes: string | null },
  ) {
    const payouts: NonNullable<Awaited<ReturnType<SettlementService['createPayout']>>>[] = [];

    try {
      let iterations = 0;
      for (;;) {
        if (++iterations > APPROVE_MAX_CREATE_PAYOUT_ITERATIONS) {
          break;
        }
        const p = await this.settlements.createPayout({
          merchantId: row.merchantId,
          currency: row.currency,
        });
        if (!p) {
          break;
        }
        payouts.push(p);
      }
    } catch (e) {
      if (payouts.length === 0) {
        await this.revertApprovedToPending(requestId);
      }
      throw e;
    }

    if (payouts.length === 0) {
      await this.revertApprovedToPending(requestId);
      throw new BadRequestException(
        'No se pudo crear payout: no hay settlements AVAILABLE elegibles (libera PENDING→AVAILABLE primero o espera ventana).',
      );
    }

    const payoutIds = payouts.map((p) => p.id);
    for (const batch of chunkArray(payoutIds, PAYOUT_LINK_BATCH)) {
      await this.prisma.payout.updateMany({
        where: { id: { in: batch } },
        data: { settlementRequestId: requestId },
      });
    }

    let paidNetAcc = 0n;
    for (const p of payouts) {
      paidNetAcc += BigInt(p.netMinor);
    }
    if (paidNetAcc > BigInt(INT32_MAX)) {
      throw new BadRequestException(
        'Suma de net minor de payouts supera int32; requiere revisión de ingeniería antes de continuar.',
      );
    }
    const paidNetMinor = Number(paidNetAcc);

    const { availableNetMinor: remainingAvailable } = await this.getAvailableNetMinor(
      row.merchantId,
      row.currency,
    );
    const settledAllAvailable = remainingAvailable === 0;

    const partialSuffix = !settledAllAvailable
      ? '\n[Liquidación parcial: sigue saldo AVAILABLE en esta divisa; puede crear otra solicitud.]'
      : '';
    const mergedReviewedNotes = settledAllAvailable
      ? row.reviewedNotes
      : row.reviewedNotes
        ? `${row.reviewedNotes}${partialSuffix}`
        : partialSuffix.trim();

    const anchorPayoutId = payoutIds[payoutIds.length - 1];

    const finalized = await this.prisma.settlementRequest.updateMany({
      where: { id: requestId, status: SettlementRequestStatus.APPROVED },
      data: {
        status: SettlementRequestStatus.PAID,
        payoutId: anchorPayoutId,
        paidNetMinor,
        settledAllAvailable,
        ...(mergedReviewedNotes !== row.reviewedNotes ? { reviewedNotes: mergedReviewedNotes } : {}),
      },
    });

    if (finalized.count === 0) {
      throw new BadRequestException(
        'Payout(s) creado(s) pero no se pudo vincular la solicitud; requiere revisión operativa.',
      );
    }

    return this.prisma.settlementRequest.findUniqueOrThrow({ where: { id: requestId } });
  }

  async approve(requestId: string, reviewedNotes?: string) {
    const existing = await this.prisma.settlementRequest.findUnique({ where: { id: requestId } });
    if (!existing) {
      throw new NotFoundException('Settlement request not found');
    }

    if (existing.status === SettlementRequestStatus.PAID) {
      return existing;
    }

    if (existing.status === SettlementRequestStatus.APPROVED && existing.payoutId != null) {
      await this.prisma.settlementRequest.updateMany({
        where: { id: requestId, status: SettlementRequestStatus.APPROVED },
        data: { status: SettlementRequestStatus.PAID },
      });
      return this.prisma.settlementRequest.findUniqueOrThrow({ where: { id: requestId } });
    }

    if (existing.status === SettlementRequestStatus.APPROVED && existing.payoutId == null) {
      const recovered = await this.tryLinkOrphanPayoutAndFinalize({
        id: existing.id,
        merchantId: existing.merchantId,
        currency: existing.currency,
        requestedNetMinor: existing.requestedNetMinor,
        createdAt: existing.createdAt,
      });
      if (recovered) {
        return recovered;
      }

      return this.runApprovedPayoutPlan(requestId, {
        merchantId: existing.merchantId,
        currency: existing.currency,
        reviewedNotes: existing.reviewedNotes,
      });
    }

    const reserved = await this.prisma.settlementRequest.updateMany({
      where: { id: requestId, status: SettlementRequestStatus.PENDING },
      data: {
        status: SettlementRequestStatus.APPROVED,
        reviewedNotes: reviewedNotes ?? null,
      },
    });

    if (reserved.count === 0) {
      const row = await this.prisma.settlementRequest.findUnique({ where: { id: requestId } });
      if (!row) {
        throw new NotFoundException('Settlement request not found');
      }
      if (row.status === SettlementRequestStatus.PAID) {
        return row;
      }
      throw new ConflictException(
        'La solicitud ya no está PENDING; otro operador pudo resolverla o hubo un envío duplicado.',
      );
    }

    const row = await this.prisma.settlementRequest.findUniqueOrThrow({ where: { id: requestId } });

    return this.runApprovedPayoutPlan(requestId, {
      merchantId: row.merchantId,
      currency: row.currency,
      reviewedNotes: row.reviewedNotes,
    });
  }

  async reject(requestId: string, reviewedNotes?: string) {
    const updated = await this.prisma.settlementRequest.updateMany({
      where: { id: requestId, status: SettlementRequestStatus.PENDING },
      data: {
        status: SettlementRequestStatus.REJECTED,
        reviewedNotes: reviewedNotes ?? null,
      },
    });

    if (updated.count === 0) {
      const row = await this.prisma.settlementRequest.findUnique({ where: { id: requestId } });
      if (!row) {
        throw new NotFoundException('Settlement request not found');
      }
      throw new ConflictException(
        'La solicitud no está en PENDING; no se puede rechazar (p. ej. aprobación o pago en curso).',
      );
    }

    return this.prisma.settlementRequest.findUniqueOrThrow({ where: { id: requestId } });
  }
}
