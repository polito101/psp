import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type FindForMerchantOptions = {
  requireUsable?: boolean;
  now?: Date;
};

@Injectable()
export class PaymentLinksService {
  constructor(private readonly prisma: PrismaService) {}

  async findForMerchant(merchantId: string, id: string, options?: FindForMerchantOptions) {
    const link = await this.prisma.paymentLink.findFirst({
      where: { id, merchantId },
    });
    if (!link) {
      throw new NotFoundException('Payment link not found');
    }
    if (options?.requireUsable) {
      const now = options.now ?? new Date();
      if (link.status !== 'active') {
        throw new BadRequestException('Payment link is not active');
      }
      if (link.expiresAt && link.expiresAt <= now) {
        throw new BadRequestException('Payment link has expired');
      }
    }
    return link;
  }
}
