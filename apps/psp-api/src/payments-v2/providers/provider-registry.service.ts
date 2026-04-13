import { Injectable } from '@nestjs/common';
import { PaymentProviderName } from '../domain/payment-status';
import { MockProviderAdapter } from './mock-provider.adapter';
import { PaymentProvider } from './payment-provider.interface';
import { StripeProviderAdapter } from './stripe-provider.adapter';

@Injectable()
export class ProviderRegistryService {
  private readonly providers: Record<PaymentProviderName, PaymentProvider>;

  constructor(
    private readonly stripe: StripeProviderAdapter,
    private readonly mock: MockProviderAdapter,
  ) {
    this.providers = {
      stripe: this.stripe,
      mock: this.mock,
    };
  }

  getProvider(name: PaymentProviderName): PaymentProvider {
    return this.providers[name];
  }

  orderedProviders(preferred?: PaymentProviderName): PaymentProviderName[] {
    if (preferred) return [preferred];
    const configured = (process.env.PAYMENTS_PROVIDER_ORDER ?? 'stripe,mock')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry): entry is PaymentProviderName => entry === 'stripe' || entry === 'mock');
    return configured.length > 0 ? configured : ['mock'];
  }
}
