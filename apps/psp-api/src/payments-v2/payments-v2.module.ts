import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentLinksModule } from '../payment-links/payment-links.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PaymentsV2Controller } from './payments-v2.controller';
import { PaymentsV2ObservabilityService } from './payments-v2-observability.service';
import { PaymentsV2Service } from './payments-v2.service';
import { MockProviderAdapter } from './providers/mock-provider.adapter';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { StripeProviderAdapter } from './providers/stripe-provider.adapter';

@Module({
  imports: [LedgerModule, WebhooksModule, PaymentLinksModule],
  controllers: [PaymentsV2Controller],
  providers: [
    PaymentsV2Service,
    PaymentsV2ObservabilityService,
    ProviderRegistryService,
    MockProviderAdapter,
    StripeProviderAdapter,
  ],
})
export class PaymentsV2Module {}
