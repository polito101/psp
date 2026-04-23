import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

  async approve(requestId: string, reviewedNotes?: string) {
    const row = await this.prisma.settlementRequest.findUnique({ where: { id: requestId } });
    if (!row) {
      throw new NotFoundException('Settlement request not found');
    }
    if (row.status !== SettlementRequestStatus.PENDING) {
      throw new BadRequestException('La solicitud no está en estado PENDING');
    }
    const payout = await this.settlements.createPayout({
      merchantId: row.merchantId,
      currency: row.currency,
    });
    if (!payout) {
      throw new BadRequestException(
        'No se pudo crear payout: no hay settlements AVAILABLE elegibles (libera PENDING→AVAILABLE primero o espera ventana).',
      );
    }
    return this.prisma.settlementRequest.update({
      where: { id: requestId },
      data: {
        status: SettlementRequestStatus.PAID,
        payoutId: payout.id,
        reviewedNotes: reviewedNotes ?? null,
      },
    });
  }

  async reject(requestId: string, reviewedNotes?: string) {
    const row = await this.prisma.settlementRequest.findUnique({ where: { id: requestId } });
    if (!row) {
      throw new NotFoundException('Settlement request not found');
    }
    if (row.status !== SettlementRequestStatus.PENDING) {
      throw new BadRequestException('La solicitud no está en estado PENDING');
    }
    return this.prisma.settlementRequest.update({
      where: { id: requestId },
      data: {
        status: SettlementRequestStatus.REJECTED,
        reviewedNotes: reviewedNotes ?? null,
      },
    });
  }
}
