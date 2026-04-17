import { ConfigService } from '@nestjs/config';
import { PAYMENT_V2_STATUS } from '../domain/payment-status';
import { MockProviderAdapter } from './mock-provider.adapter';
import { PaymentProvider } from './payment-provider.interface';
import { ProviderRegistryService } from './provider-registry.service';
import { StripeProviderAdapter } from './stripe-provider.adapter';

describe('ProviderRegistryService', () => {
  const stripe = { name: 'stripe' as const, run: jest.fn() } as unknown as StripeProviderAdapter;
  const mock = new MockProviderAdapter();

  const configWithOrder = (order: string) =>
    ({
      get: (key: string) => (key === 'PAYMENTS_PROVIDER_ORDER' ? order : undefined),
    }) as unknown as ConfigService;

  it('construye orden y resuelve getProvider', () => {
    const registry = new ProviderRegistryService(configWithOrder('mock,stripe'), [stripe, mock]);
    expect(registry.orderedProviders()).toEqual(['mock', 'stripe']);
    expect(registry.getProvider('stripe')).toBe(stripe);
    expect(registry.getRegisteredProviderNames()).toEqual(['stripe', 'mock']);
  });

  it('getProvider falla si el nombre no está registrado', () => {
    const registry = new ProviderRegistryService(configWithOrder('mock'), [mock]);
    expect(() => registry.getProvider('stripe')).toThrow(/Unknown payment provider/);
  });

  it('falla al arrancar si el orden incluye un proveedor no registrado', () => {
    expect(() => new ProviderRegistryService(configWithOrder('stripe,mock'), [mock])).toThrow(
      /not registered/,
    );
  });

  it('orderedProviders(preferred) exige el proveedor en PAYMENTS_PROVIDER_ORDER', () => {
    const registry = new ProviderRegistryService(configWithOrder('stripe'), [stripe, mock]);
    expect(() => registry.orderedProviders('mock')).toThrow(/not listed in PAYMENTS_PROVIDER_ORDER/);
    expect(registry.orderedProviders('stripe')).toEqual(['stripe']);
  });

  it('rechaza nombres desconocidos en PAYMENTS_PROVIDER_ORDER', () => {
    expect(() => new ProviderRegistryService(configWithOrder('nope'), [stripe, mock])).toThrow(
      /invalid provider/,
    );
  });

  it('rechaza registro duplicado por nombre', () => {
    const dup = { name: 'mock' as const, run: jest.fn() } as unknown as PaymentProvider;
    expect(() => new ProviderRegistryService(configWithOrder('mock'), [mock, dup])).toThrow(/Duplicate/);
  });
});
