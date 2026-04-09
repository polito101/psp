import { Module } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { PaymentLinksModule } from '../payment-links/payment-links.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentLinksModule, PaymentsModule],
  controllers: [CheckoutController],
})
export class CheckoutModule {}
