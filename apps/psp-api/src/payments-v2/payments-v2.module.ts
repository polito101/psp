import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeesModule } from '../fees/fees.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentLinksModule } from '../payment-links/payment-links.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PaymentsV2Controller } from './payments-v2.controller';
import { PaymentsV2InternalController } from './payments-v2-internal.controller';
import { PaymentsV2MerchantRateLimitService } from './payments-v2-merchant-rate-limit.service';
import { PaymentsV2ObservabilityService } from './payments-v2-observability.service';
import { CorrelationContextService } from '../common/correlation/correlation-context.service';
import { CorrelationIdMiddleware } from '../common/correlation/correlation-id.middleware';
import { PaymentsV2Service } from './payments-v2.service';
import { AcmeProviderAdapter } from './providers/acme/acme-provider.adapter';
import { MockProviderAdapter } from './providers/mock-provider.adapter';
import { PaymentProvider } from './providers/payment-provider.interface';
import { PAYMENT_PROVIDERS } from './providers/payment-providers.token';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { StripeProviderAdapter } from './providers/stripe-provider.adapter';
import { StripeWebhookController } from './stripe-webhook.controller';

@Module({
  imports: [LedgerModule, WebhooksModule, PaymentLinksModule, FeesModule],
  controllers: [PaymentsV2Controller, PaymentsV2InternalController, StripeWebhookController],
  providers: [
    CorrelationContextService,
    CorrelationIdMiddleware,
    PaymentsV2Service,
    PaymentsV2MerchantRateLimitService,
    PaymentsV2ObservabilityService,
    MockProviderAdapter,
    StripeProviderAdapter,
    AcmeProviderAdapter,
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (
        stripe: StripeProviderAdapter,
        mock: MockProviderAdapter,
        acme: AcmeProviderAdapter,
        config: ConfigService,
      ): PaymentProvider[] => {
        const list: PaymentProvider[] = [stripe, mock];
        if ((config.get<string>('PAYMENTS_ACME_ENABLED') ?? 'false').toLowerCase() === 'true') {
          list.push(acme);
        }
        return list;
      },
      inject: [StripeProviderAdapter, MockProviderAdapter, AcmeProviderAdapter, ConfigService],
    },
    ProviderRegistryService,
  ],
})
export class PaymentsV2Module implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes(PaymentsV2Controller, PaymentsV2InternalController, StripeWebhookController);
  }
}
