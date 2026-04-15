import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentLinksService {
  constructor(private readonly prisma: PrismaService) {}

  async findForMerchant(merchantId: string, id: string) {
    const link = await this.prisma.paymentLink.findFirst({
      where: { id, merchantId },
    });
    if (!link) {
      throw new NotFoundException('Payment link not found');
    }
    return link;
  }
}
