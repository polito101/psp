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
    const configured = (process.env.PAYMENTS_PROVIDER_ORDER ?? 'stripe')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0) as PaymentProviderName[];
    if (configured.length === 0) {
      throw new Error('PAYMENTS_PROVIDER_ORDER resolved to an empty provider list');
    }
    return configured;
  }
}
