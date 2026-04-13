import { PAYMENT_V2_STATUS } from '../domain/payment-status';
import { MockProviderAdapter } from './mock-provider.adapter';

describe('MockProviderAdapter', () => {
  const provider = new MockProviderAdapter();

  it('marca decline determinístico en creación cuando amount es múltiplo de 13', async () => {
    const result = await provider.run('create', {
      merchantId: 'm_1',
      paymentId: 'pay_1',
      amountMinor: 1300,
      currency: 'EUR',
    });
    expect(result.status).toBe(PAYMENT_V2_STATUS.FAILED);
    expect(result.reasonCode).toBe('provider_declined');
  });

  it('autoriza creación para amount normal', async () => {
    const result = await provider.run('create', {
      merchantId: 'm_1',
      paymentId: 'pay_2',
      amountMinor: 1200,
      currency: 'EUR',
    });
    expect(result.status).toBe(PAYMENT_V2_STATUS.AUTHORIZED);
    expect(result.providerPaymentId).toContain('mock_pi_');
  });
});
