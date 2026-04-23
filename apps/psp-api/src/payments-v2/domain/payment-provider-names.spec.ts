import {
  isPaymentProviderName,
  unsupportedPersistedProviderLifecycleMessage,
} from './payment-provider-names';

describe('payment-provider-names', () => {
  it('isPaymentProviderName reconoce solo proveedores actuales', () => {
    expect(isPaymentProviderName('mock')).toBe(true);
    expect(isPaymentProviderName('acme')).toBe(true);
    expect(isPaymentProviderName('stripe')).toBe(false);
    expect(isPaymentProviderName('unknown')).toBe(false);
  });

  it('unsupportedPersistedProviderLifecycleMessage incluye operación y valor persistido', () => {
    const msg = unsupportedPersistedProviderLifecycleMessage('capture', 'stripe');
    expect(msg).toContain('capture refused');
    expect(msg).toContain('"stripe"');
    expect(msg).toContain('sanitize-stripe-provider-to-mock.sql');
  });
});
