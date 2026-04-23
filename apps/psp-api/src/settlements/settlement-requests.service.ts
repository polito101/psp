import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SettlementStatus, SettlementRequestStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { SettlementService } from './settlement.service';

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
      data: { status: SettlementRequestStatus.PENDING, reviewedNotes: null },
    });
  }

  async approve(requestId: string, reviewedNotes?: string) {
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
      throw new ConflictException(
        'La solicitud ya no está PENDING; otro operador pudo resolverla o hubo un envío duplicado.',
      );
    }

    const row = await this.prisma.settlementRequest.findUniqueOrThrow({ where: { id: requestId } });

    let payout: Awaited<ReturnType<SettlementService['createPayout']>>;
    try {
      payout = await this.settlements.createPayout({
        merchantId: row.merchantId,
        currency: row.currency,
      });
    } catch (e) {
      await this.revertApprovedToPending(requestId);
      throw e;
    }

    if (!payout) {
      await this.revertApprovedToPending(requestId);
      throw new BadRequestException(
        'No se pudo crear payout: no hay settlements AVAILABLE elegibles (libera PENDING→AVAILABLE primero o espera ventana).',
      );
    }

    const finalized = await this.prisma.settlementRequest.updateMany({
      where: { id: requestId, status: SettlementRequestStatus.APPROVED },
      data: {
        status: SettlementRequestStatus.PAID,
        payoutId: payout.id,
      },
    });

    if (finalized.count === 0) {
      throw new BadRequestException(
        'Payout creado pero no se pudo vincular a la solicitud; requiere revisión operativa.',
      );
    }

    return this.prisma.settlementRequest.findUniqueOrThrow({ where: { id: requestId } });
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
