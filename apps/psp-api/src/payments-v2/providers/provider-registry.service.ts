import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PAYMENT_PROVIDER_NAMES,
  PaymentProviderName,
  isPaymentProviderName,
  paymentProviderNamesLabel,
} from '../domain/payment-provider-names';
import { PaymentProvider } from './payment-provider.interface';
import { PAYMENT_PROVIDERS } from './payment-providers.token';

@Injectable()
export class ProviderRegistryService {
  private readonly providersByName = new Map<PaymentProviderName, PaymentProvider>();
  /** Orden deduplicado y validado una vez desde `PAYMENTS_PROVIDER_ORDER` al arranque. */
  private readonly cachedOrder: PaymentProviderName[];

  constructor(
    private readonly config: ConfigService,
    @Inject(PAYMENT_PROVIDERS) providers: PaymentProvider[],
  ) {
    const seenNames = new Set<PaymentProviderName>();
    for (const p of providers) {
      if (seenNames.has(p.name)) {
        throw new Error(`Duplicate payment provider registration for name "${p.name}"`);
      }
      seenNames.add(p.name);
      this.providersByName.set(p.name, p);
    }
    this.cachedOrder = this.resolveConfiguredProviderOrder();
  }

  /** Nombres registrados en orden estable (para CB/métricas), intersección con `PAYMENT_PROVIDER_NAMES`. */
  getRegisteredProviderNames(): PaymentProviderName[] {
    return PAYMENT_PROVIDER_NAMES.filter((n) => this.providersByName.has(n));
  }

  getProvider(name: PaymentProviderName): PaymentProvider {
    const p = this.providersByName.get(name);
    if (!p) {
      const registered = this.getRegisteredProviderNames().join(',') || '(none)';
      throw new Error(`Unknown payment provider "${name}". Registered providers: ${registered}`);
    }
    return p;
  }

  /**
   * Orden de intento para operaciones de pago.
   * Sin argumento: orden en caché desde `PAYMENTS_PROVIDER_ORDER` (ruteo del PSP, no preferencia del merchant).
   * Con argumento: solo el proveedor ya ligado al pago (p. ej. `capture` sobre `selectedProvider`), no implica elección del comercio.
   * Basta con que el adapter esté registrado; no tiene que figurar en el orden de ruteo de nuevos pagos.
   */
  orderedProviders(preferred?: PaymentProviderName): PaymentProviderName[] {
    if (!preferred) {
      return [...this.cachedOrder];
    }
    this.getProvider(preferred);
    return [preferred];
  }

  private resolveConfiguredProviderOrder(): PaymentProviderName[] {
    const raw = this.config.get<string>('PAYMENTS_PROVIDER_ORDER') ?? 'mock';
    const entries = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const seen = new Set<PaymentProviderName>();
    const configured: PaymentProviderName[] = [];
    for (const entry of entries) {
      if (!isPaymentProviderName(entry)) {
        throw new Error(
          `PAYMENTS_PROVIDER_ORDER contains an invalid provider: "${entry}" (allowed: ${paymentProviderNamesLabel()})`,
        );
      }
      const name = entry;
      if (!this.providersByName.has(name)) {
        throw new Error(
          `PAYMENTS_PROVIDER_ORDER includes "${name}" but that provider is not registered. ` +
            `Registered: ${this.getRegisteredProviderNames().join(',') || '(none)'}. ` +
            `Enable the adapter in PaymentsV2Module (e.g. PAYMENTS_ACME_ENABLED for acme).`,
        );
      }
      if (!seen.has(name)) {
        seen.add(name);
        configured.push(name);
      }
    }

    if (configured.length === 0) {
      throw new Error(
        `PAYMENTS_PROVIDER_ORDER resolved to an empty provider list (expected at least one of: ${paymentProviderNamesLabel()})`,
      );
    }
    return configured;
  }
}
