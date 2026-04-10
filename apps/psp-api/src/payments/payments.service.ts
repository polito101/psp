import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { RedisService } from '../redis/redis.service';
import { PaymentLinksService } from '../payment-links/payment-links.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly webhooks: WebhooksService,
    private readonly redis: RedisService,
    private readonly links: PaymentLinksService,
  ) {}

  /**
   * En reintentos idempotentes, la misma key debe referenciar exactamente
   * la misma intención de pago para evitar colisiones silenciosas.
   */
  private assertIdempotencyPayloadMatch(
    existing: {
      amountMinor: number;
      currency: string;
      paymentLinkId: string | null;
      rail: string;
    },
    incoming: {
      amountMinor: number;
      currency: string;
      paymentLinkId?: string;
      rail?: string;
    },
  ): void {
    const incomingPaymentLinkId = incoming.paymentLinkId ?? null;
    const incomingRail = incoming.rail ?? 'fiat';
    const isSameIntent =
      existing.amountMinor === incoming.amountMinor &&
      existing.currency === incoming.currency &&
      existing.paymentLinkId === incomingPaymentLinkId &&
      existing.rail === incomingRail;

    if (!isSameIntent) {
      throw new ConflictException('Idempotency-Key already used with different payload');
    }
  }

  async create(
    merchantId: string,
    dto: {
      amountMinor: number;
      currency: string;
      paymentLinkId?: string;
      rail?: string;
      idempotencyKey?: string;
    },
  ) {
    if (dto.idempotencyKey) {
      const cached = await this.redis.getIdempotency(
        `pay:${merchantId}:${dto.idempotencyKey}`,
      );
      if (cached) {
        const existing = await this.prisma.payment.findUnique({
          where: {
            merchantId_idempotencyKey: {
              merchantId,
              idempotencyKey: dto.idempotencyKey,
            },
          },
        });
        if (existing) {
          this.assertIdempotencyPayloadMatch(existing, dto);
          return existing;
        }
      }
    }

    if (dto.paymentLinkId) {
      const link = await this.links.findForMerchant(merchantId, dto.paymentLinkId);
      if (link.amountMinor !== dto.amountMinor || link.currency !== dto.currency) {
        throw new BadRequestException('Amount/currency must match payment link');
      }
    }

    try {
      const payment = await this.prisma.payment.create({
        data: {
          merchantId,
          paymentLinkId: dto.paymentLinkId ?? null,
          idempotencyKey: dto.idempotencyKey ?? null,
          amountMinor: dto.amountMinor,
          currency: dto.currency,
          status: 'pending',
          rail: dto.rail ?? 'fiat',
          providerRef: `sim_${randomBytes(8).toString('hex')}`,
        },
      });

      if (dto.idempotencyKey) {
        await this.redis.setIdempotency(
          `pay:${merchantId}:${dto.idempotencyKey}`,
          payment.id,
          24 * 3600,
        );
      }

      return payment;
    } catch (e: unknown) {
      const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : '';
      if (code === 'P2002' && dto.idempotencyKey) {
        const existing = await this.prisma.payment.findUnique({
          where: {
            merchantId_idempotencyKey: {
              merchantId,
              idempotencyKey: dto.idempotencyKey,
            },
          },
        });
        if (existing) {
          this.assertIdempotencyPayloadMatch(existing, dto);
          return existing;
        }
      }
      throw e;
    }
  }

  async findOne(merchantId: string, id: string) {
    const p = await this.prisma.payment.findFirst({
      where: { id, merchantId },
    });
    if (!p) {
      throw new NotFoundException('Payment not found');
    }
    return p;
  }

  /**
   * Flujo público Pay-by-link: crea pago y captura en una transacción (sandbox).
   */
  async completePayByLinkSlug(slug: string) {
    const link = await this.links.findBySlug(slug);
    const merchantId = link.merchantId;

    const payment = await this.prisma.payment.create({
      data: {
        merchantId,
        paymentLinkId: link.id,
        amountMinor: link.amountMinor,
        currency: link.currency,
        status: 'pending',
        rail: 'fiat',
        providerRef: `link_${randomBytes(6).toString('hex')}`,
      },
    });

    return this.capture(merchantId, payment.id);
  }

  async capture(merchantId: string, paymentId: string) {
    const payment = await this.findOne(merchantId, paymentId);
    if (payment.status === 'succeeded') {
      return payment;
    }
    if (payment.status !== 'pending') {
      throw new ConflictException(`Payment not capturable: ${payment.status}`);
    }

    const merchant = await this.prisma.merchant.findUniqueOrThrow({
      where: { id: merchantId },
      select: { feeBps: true },
    });

    const updated = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const p = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'succeeded',
          providerRef: payment.providerRef ?? `cap_${randomBytes(6).toString('hex')}`,
        },
      });

      await this.ledger.recordSuccessfulCapture(tx, {
        merchantId,
        paymentId,
        amountMinor: p.amountMinor,
        currency: p.currency,
        feeBps: merchant.feeBps,
      });

      if (p.paymentLinkId) {
        await tx.paymentLink.updateMany({
          where: { id: p.paymentLinkId, merchantId },
          data: { status: 'used' },
        });
      }

      return p;
    });

    await this.webhooks.deliver(merchantId, 'payment.succeeded', {
      payment_id: updated.id,
      amount_minor: updated.amountMinor,
      currency: updated.currency,
      status: updated.status,
    });

    return updated;
  }
}
