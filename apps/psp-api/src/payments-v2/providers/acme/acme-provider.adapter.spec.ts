import { ConfigService } from '@nestjs/config';
import { PAYMENT_V2_STATUS } from '../../domain/payment-status';
import { AcmeProviderAdapter } from './acme-provider.adapter';

describe('AcmeProviderAdapter', () => {
  it('con flag desactivado devuelve provider_unavailable', async () => {
    const config = {
      get: jest.fn((key: string) => (key === 'PAYMENTS_ACME_ENABLED' ? 'false' : undefined)),
    };
    const adapter = new AcmeProviderAdapter(config as unknown as ConfigService);
    const result = await adapter.run('create', {
      merchantId: 'm1',
      paymentId: 'p1',
      amountMinor: 100,
      currency: 'EUR',
    });
    expect(result.status).toBe(PAYMENT_V2_STATUS.FAILED);
    if (result.status === PAYMENT_V2_STATUS.FAILED) {
      expect(result.reasonCode).toBe('provider_unavailable');
    }
  });

  it('con flag activado devuelve no implementado (stub)', async () => {
    const config = {
      get: jest.fn((key: string) => (key === 'PAYMENTS_ACME_ENABLED' ? 'true' : undefined)),
    };
    const adapter = new AcmeProviderAdapter(config as unknown as ConfigService);
    const result = await adapter.run('capture', {
      merchantId: 'm1',
      paymentId: 'p1',
      amountMinor: 100,
      currency: 'EUR',
      providerPaymentId: 'acme_1',
    });
    expect(result.status).toBe(PAYMENT_V2_STATUS.FAILED);
    if (result.status === PAYMENT_V2_STATUS.FAILED) {
      expect(result.reasonCode).toBe('provider_unavailable');
      expect(result.reasonMessage).toMatch(/not implemented/);
    }
  });
});
