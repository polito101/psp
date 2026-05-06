import { hashCreatePaymentIntentPayload } from './create-payment-intent-payload-hash';
import type { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';

function baseV2Payload(): CreatePaymentIntentDto {
  return {
    amount: 19.99,
    currency: 'eur',
    channel: 'ONLINE',
    language: 'en',
    orderId: 'ord-1',
    description: 'Test',
    notificationUrl: 'https://example.com/n',
    returnUrl: 'https://example.com/r',
    cancelUrl: 'https://example.com/c',
    customer: {
      firstName: 'Ana',
      lastName: 'López',
      email: 'Ana@Example.com',
      country: 'es',
      address: {
        line1: 'Calle 1',
        city: 'Madrid',
      },
    },
  };
}

describe('hashCreatePaymentIntentPayload', () => {
  it('v2: mismo hash si el cliente envía `customer` con distinto orden de claves', () => {
    const a: CreatePaymentIntentDto = {
      ...baseV2Payload(),
      customer: {
        email: 'ana@example.com',
        country: 'ES',
        lastName: 'López',
        firstName: 'Ana',
        address: {
          city: 'Madrid',
          line1: 'Calle 1',
        },
      },
    };
    const b: CreatePaymentIntentDto = {
      ...baseV2Payload(),
      customer: {
        firstName: 'Ana',
        lastName: 'López',
        email: 'ana@example.com',
        country: 'ES',
        address: {
          line1: 'Calle 1',
          city: 'Madrid',
        },
      },
    };
    expect(hashCreatePaymentIntentPayload(a)).toBe(hashCreatePaymentIntentPayload(b));
  });

  it('v2: URLs y textos se normalizan con trim; email en minúsculas', () => {
    const trimmed: CreatePaymentIntentDto = {
      ...baseV2Payload(),
      notificationUrl: 'https://example.com/n',
      returnUrl: 'https://example.com/r',
      cancelUrl: 'https://example.com/c',
      orderId: 'ord-1',
      description: 'Test',
    };
    const spaced: CreatePaymentIntentDto = {
      ...baseV2Payload(),
      notificationUrl: '  https://example.com/n  ',
      returnUrl: '\thttps://example.com/r\n',
      cancelUrl: ' https://example.com/c ',
      orderId: '  ord-1  ',
      description: '  Test  ',
    };
    expect(hashCreatePaymentIntentPayload(spaced)).toBe(hashCreatePaymentIntentPayload(trimmed));
  });

  it('v2: paymentLinkId se normaliza con trim', () => {
    const a: CreatePaymentIntentDto = {
      ...baseV2Payload(),
      paymentLinkId: '  plink  ',
    };
    const b: CreatePaymentIntentDto = {
      ...baseV2Payload(),
      paymentLinkId: 'plink',
    };
    expect(hashCreatePaymentIntentPayload(a)).toBe(hashCreatePaymentIntentPayload(b));
  });
});
