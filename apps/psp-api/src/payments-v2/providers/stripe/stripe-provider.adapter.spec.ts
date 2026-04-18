import { ConfigService } from '@nestjs/config';
import { PAYMENT_V2_STATUS } from '../../domain/payment-status';
import { StripeProviderAdapter } from './stripe-provider.adapter';

describe('StripeProviderAdapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function adapterWithKey() {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'STRIPE_SECRET_KEY') return 'sk_test_x';
        if (key === 'STRIPE_API_BASE_URL') return 'https://api.stripe.com/v1';
        if (key === 'PAYMENTS_PROVIDER_TIMEOUT_MS') return '8000';
        return undefined;
      }),
    };
    return new StripeProviderAdapter(config as unknown as ConfigService);
  }

  it('create sin PM usa automatic_payment_methods y no envía confirm=false explícito', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return {
        ok: true,
        json: async () => ({
          id: 'pi_1',
          object: 'payment_intent',
          status: 'requires_payment_method',
          client_secret: 'pi_1_secret',
        }),
      } as Response;
    });

    const adapter = adapterWithKey();
    const result = await adapter.run('create', {
      merchantId: 'm_1',
      paymentId: 'pay_1',
      amountMinor: 1000,
      currency: 'EUR',
    });

    expect(result.status).toBe(PAYMENT_V2_STATUS.PENDING);
    if (result.status !== PAYMENT_V2_STATUS.FAILED) {
      expect(result.nextAction).toMatchObject({
        type: 'confirm_with_stripe_js',
        clientSecret: 'pi_1_secret',
      });
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/payment_intents');
    expect(calls[0].init.method).toBe('POST');
    const body = calls[0].init.body as URLSearchParams;
    expect(body.get('automatic_payment_methods[enabled]')).toBe('true');
    expect(body.get('confirm')).toBeNull();
  });

  it('create incluye metadata psp_correlation_id cuando viene en el contexto', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return {
        ok: true,
        json: async () => ({
          id: 'pi_corr',
          object: 'payment_intent',
          status: 'requires_payment_method',
          client_secret: 'sec',
        }),
      } as Response;
    });

    const adapter = adapterWithKey();
    await adapter.run('create', {
      merchantId: 'm_1',
      paymentId: 'pay_1',
      amountMinor: 500,
      currency: 'EUR',
      correlationId: 'corr-from-merchant-request',
    });

    const body = calls[0].init.body as URLSearchParams;
    expect(body.get('metadata[psp_correlation_id]')).toBe('corr-from-merchant-request');
  });

  it('create con payment_method confirma en servidor', async () => {
    const calls: URLSearchParams[] = [];
    global.fetch = jest.fn(async (_url: string | URL, init?: RequestInit) => {
      calls.push(init?.body as URLSearchParams);
      return {
        ok: true,
        json: async () => ({
          id: 'pi_2',
          object: 'payment_intent',
          status: 'requires_capture',
          client_secret: 'pi_2_secret',
        }),
      } as Response;
    });

    const adapter = adapterWithKey();
    const result = await adapter.run('create', {
      merchantId: 'm_1',
      paymentId: 'pay_1',
      amountMinor: 1000,
      currency: 'EUR',
      stripePaymentMethodId: 'pm_card_visa',
      stripeReturnUrl: 'https://example.com/return',
    });

    expect(result.status).toBe(PAYMENT_V2_STATUS.AUTHORIZED);
    expect(calls[0].get('payment_method')).toBe('pm_card_visa');
    expect(calls[0].get('confirm')).toBe('true');
    expect(calls[0].get('return_url')).toBe('https://example.com/return');
  });

  it('retrievePaymentIntent usa GET', async () => {
    const calls: { method: string }[] = [];
    global.fetch = jest.fn(async (_url: string | URL, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET' });
      return {
        ok: true,
        json: async () => ({
          id: 'pi_3',
          status: 'requires_action',
          client_secret: 'sec',
          next_action: { type: 'use_stripe_sdk' },
        }),
      } as Response;
    });

    const adapter = adapterWithKey();
    const result = await adapter.retrievePaymentIntent('pi_3');

    expect(calls[0].method).toBe('GET');
    expect(result.status).toBe(PAYMENT_V2_STATUS.REQUIRES_ACTION);
    if (result.status !== PAYMENT_V2_STATUS.FAILED) {
      expect(result.nextAction).toMatchObject({
        type: 'confirm_with_stripe_js',
        clientSecret: 'sec',
      });
    }
  });
});
