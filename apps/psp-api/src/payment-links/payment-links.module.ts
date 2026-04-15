import { Module } from '@nestjs/common';
import { PaymentLinksService } from './payment-links.service';

@Module({
  providers: [PaymentLinksService],
  exports: [PaymentLinksService],
})
export class PaymentLinksModule {}
