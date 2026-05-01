import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { MerchantsModule } from './merchants/merchants.module';
import { PaymentLinksModule } from './payment-links/payment-links.module';
import { LedgerModule } from './ledger/ledger.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { FeesModule } from './fees/fees.module';
import { SettlementsModule } from './settlements/settlements.module';
import { validateEnv } from './config/env.validation';
import { HttpLoggingInterceptor } from './common/interceptors/http-logging.interceptor';
import { PaymentsV2Module } from './payments-v2/payments-v2.module';
import { FxModule } from './fx/fx.module';
import { MerchantOnboardingModule } from './merchant-onboarding/merchant-onboarding.module';

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
    LedgerModule,
    WebhooksModule,
    HealthModule,
    FeesModule,
    SettlementsModule,
    PaymentsV2Module,
    FxModule,
    MerchantOnboardingModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpLoggingInterceptor,
    },
  ],
})
export class AppModule {}
