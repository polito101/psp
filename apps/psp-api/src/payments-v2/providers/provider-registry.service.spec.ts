import { ConfigService } from '@nestjs/config';
import { AcmeProviderAdapter } from './acme/acme-provider.adapter';
import { MockProviderAdapter } from './mock-provider.adapter';
import { PaymentProvider } from './payment-provider.interface';
import { ProviderRegistryService } from './provider-registry.service';

describe('ProviderRegistryService', () => {
  const mock = new MockProviderAdapter();
  const acme = { name: 'acme' as const, run: jest.fn() } as unknown as AcmeProviderAdapter;

  const configWithOrder = (order: string) =>
    ({
      get: (key: string) => (key === 'PAYMENTS_PROVIDER_ORDER' ? order : undefined),
    }) as unknown as ConfigService;

  it('construye orden y resuelve getProvider', () => {
    const registry = new ProviderRegistryService(configWithOrder('mock,acme'), [mock, acme]);
    expect(registry.orderedProviders()).toEqual(['mock', 'acme']);
    expect(registry.getProvider('acme')).toBe(acme);
    expect(registry.getRegisteredProviderNames()).toEqual(['mock', 'acme']);
  });

  it('getProvider falla si el nombre no está registrado', () => {
    const registry = new ProviderRegistryService(configWithOrder('mock'), [mock]);
    expect(() => registry.getProvider('acme')).toThrow(/Unknown payment provider/);
  });

  it('falla al arrancar si el orden incluye un proveedor no registrado', () => {
    expect(() => new ProviderRegistryService(configWithOrder('acme,mock'), [mock])).toThrow(
      /not registered/,
    );
  });

  it('orderedProviders(preferred) acepta proveedor registrado aunque no esté en PAYMENTS_PROVIDER_ORDER', () => {
    const registry = new ProviderRegistryService(configWithOrder('mock'), [mock, acme]);
    expect(registry.orderedProviders('acme')).toEqual(['acme']);
    expect(registry.orderedProviders()).toEqual(['mock']);
    expect(registry.orderedProviders('mock')).toEqual(['mock']);
  });

  it('orderedProviders(preferred) falla si el proveedor no está registrado', () => {
    const registry = new ProviderRegistryService(configWithOrder('mock'), [mock]);
    expect(() => registry.orderedProviders('acme')).toThrow(/Unknown payment provider/);
  });

  it('rechaza nombres desconocidos en PAYMENTS_PROVIDER_ORDER', () => {
    expect(() => new ProviderRegistryService(configWithOrder('nope'), [mock, acme])).toThrow(
      /invalid provider/,
    );
  });

  it('rechaza registro duplicado por nombre', () => {
    const dup = { name: 'mock' as const, run: jest.fn() } as unknown as PaymentProvider;
    expect(() => new ProviderRegistryService(configWithOrder('mock'), [mock, dup])).toThrow(/Duplicate/);
  });
});
