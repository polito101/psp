import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentLinksService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    merchantId: string,
    dto: {
      amountMinor: number;
      currency?: string;
      ttlSeconds?: number;
      metadata?: Record<string, unknown>;
    },
    publicBaseUrl: string,
  ) {
    const slug = randomBytes(16).toString('base64url');
    const expiresAt =
      dto.ttlSeconds != null
        ? new Date(Date.now() + dto.ttlSeconds * 1000)
        : null;

    const link = await this.prisma.paymentLink.create({
      data: {
        merchantId,
        slug,
        amountMinor: dto.amountMinor,
        currency: dto.currency ?? 'EUR',
        expiresAt,
        metadata:
          dto.metadata === undefined
            ? undefined
            : (dto.metadata as Prisma.InputJsonValue),
      },
    });

    const url = `${publicBaseUrl.replace(/\/$/, '')}/api/v1/pay/${link.slug}`;
    return {
      id: link.id,
      slug: link.slug,
      amountMinor: link.amountMinor,
      currency: link.currency,
      expiresAt: link.expiresAt,
      status: link.status,
      url,
    };
  }

  async findForMerchant(merchantId: string, id: string) {
    const link = await this.prisma.paymentLink.findFirst({
      where: { id, merchantId },
    });
    if (!link) {
      throw new NotFoundException('Payment link not found');
    }
    return link;
  }

  async findBySlug(slug: string) {
    const link = await this.prisma.paymentLink.findUnique({
      where: { slug },
      include: { merchant: { select: { id: true, name: true } } },
    });
    if (!link) {
      throw new NotFoundException('Link not found or expired');
    }
    if (link.status !== 'active') {
      throw new NotFoundException('Link is no longer active');
    }
    if (link.expiresAt && link.expiresAt < new Date()) {
      throw new NotFoundException('Link has expired');
    }
    return link;
  }
}
