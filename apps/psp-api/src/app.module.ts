import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { MerchantsModule } from './merchants/merchants.module';
import { PaymentLinksModule } from './payment-links/payment-links.module';
import { PaymentsModule } from './payments/payments.module';
import { LedgerModule } from './ledger/ledger.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { CheckoutModule } from './checkout/checkout.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    RedisModule,
    MerchantsModule,
    PaymentLinksModule,
    PaymentsModule,
    LedgerModule,
    WebhooksModule,
    CheckoutModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
