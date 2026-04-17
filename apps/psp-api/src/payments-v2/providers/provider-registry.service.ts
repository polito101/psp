import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProviderName } from '../domain/payment-status';
import { MockProviderAdapter } from './mock-provider.adapter';
import { PaymentProvider } from './payment-provider.interface';
import { StripeProviderAdapter } from './stripe-provider.adapter';

@Injectable()
export class ProviderRegistryService {
  private readonly providers: Record<PaymentProviderName, PaymentProvider>;
  /** Orden deduplicado y validado una vez desde `PAYMENTS_PROVIDER_ORDER` al arranque. */
  private readonly cachedOrder: PaymentProviderName[];

  constructor(
    private readonly config: ConfigService,
    private readonly stripe: StripeProviderAdapter,
    private readonly mock: MockProviderAdapter,
  ) {
    this.providers = {
      stripe: this.stripe,
      mock: this.mock,
    };
    this.cachedOrder = this.resolveConfiguredProviderOrder();
  }

  getProvider(name: PaymentProviderName): PaymentProvider {
    return this.providers[name];
  }

  /**
   * Orden de intento para operaciones de pago.
   * Sin argumento: orden en caché desde `PAYMENTS_PROVIDER_ORDER` (ruteo del PSP, no preferencia del merchant).
   * Con argumento: solo el proveedor ya ligado al pago (p. ej. `capture` sobre `selectedProvider`), no implica elección del comercio.
   */
  orderedProviders(preferred?: PaymentProviderName): PaymentProviderName[] {
    if (preferred) return [preferred];
    return this.cachedOrder;
  }

  private resolveConfiguredProviderOrder(): PaymentProviderName[] {
    const raw = this.config.get<string>('PAYMENTS_PROVIDER_ORDER') ?? 'stripe';
    const entries = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const seen = new Set<PaymentProviderName>();
    const configured: PaymentProviderName[] = [];
    for (const entry of entries) {
      if (entry !== 'stripe' && entry !== 'mock') {
        throw new Error(
          `PAYMENTS_PROVIDER_ORDER contains an invalid provider: "${entry}" (allowed: stripe,mock)`,
        );
      }
      const name = entry as PaymentProviderName;
      if (!seen.has(name)) {
        seen.add(name);
        configured.push(name);
      }
    }

    if (configured.length === 0) {
      throw new Error(
        'PAYMENTS_PROVIDER_ORDER resolved to an empty provider list (expected: stripe or mock)',
      );
    }
    return configured;
  }
}
