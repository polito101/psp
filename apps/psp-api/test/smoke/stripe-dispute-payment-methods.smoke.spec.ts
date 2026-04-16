import { randomUUID } from 'crypto';
import {
  createSmokeMerchant,
  normalizeBaseUrl,
  parsePositiveInt,
  requestJson,
  stripeDisputeIdFromPaymentIntent,
  stripeGetPaymentIntent,
  waitFor,
} from './smoke.helpers';

/**
 * Matriz de PaymentMethods de disputa (Stripe test mode).
 * @see https://docs.stripe.com/testing#disputes
 */
const STRIPE_DISPUTE_PAYMENT_METHOD_SCENARIOS = [
  {
    key: 'fraudulent',
    paymentMethodId: 'pm_card_createDispute',
    expectStripeDispute: true as const,
  },
  {
    key: 'product_not_received',
    paymentMethodId: 'pm_card_createDisputeProductNotReceived',
    expectStripeDispute: true as const,
  },
  {
    key: 'inquiry',
    paymentMethodId: 'pm_card_createDisputeInquiry',
    expectStripeDispute: true as const,
  },
  {
    key: 'early_fraud_warning',
    paymentMethodId: 'pm_card_createIssuerFraudRecord',
    expectStripeDispute: false as const,
  },
  {
    key: 'multiple_disputes',
    paymentMethodId: 'pm_card_createMultipleDisputes',
    expectStripeDispute: true as const,
  },
  {
    key: 'visa_ce3_eligible',
    paymentMethodId: 'pm_card_createCe3EligibleDispute',
    expectStripeDispute: true as const,
  },
  {
    key: 'visa_compliance',
    paymentMethodId: 'pm_card_createComplianceDispute',
    expectStripeDispute: true as const,
  },
] as const;

const baseUrl = normalizeBaseUrl(process.env.SMOKE_BASE_URL ?? 'http://localhost:3000');
const smokeApiKey = process.env.SMOKE_API_KEY?.trim();
const stripeEnabled =
  process.env.SMOKE_STRIPE_ENABLED === 'true' || process.env.SMOKE_PROVIDER?.trim() === 'stripe';
const disputeMatrixEnabled = process.env.SMOKE_STRIPE_DISPUTE_PM_MATRIX === 'true';

const stripeSecretKey =
  process.env.SMOKE_STRIPE_SECRET_KEY?.trim() || process.env.STRIPE_SECRET_KEY?.trim() || '';

const disputeAmountMinor = parsePositiveInt(
  process.env.SMOKE_STRIPE_DISPUTE_AMOUNT_MINOR,
  5000,
  'SMOKE_STRIPE_DISPUTE_AMOUNT_MINOR',
);

const runDescribe = stripeEnabled && disputeMatrixEnabled ? describe : describe.skip;

runDescribe('stripe dispute payment methods matrix (smoke)', () => {
  jest.setTimeout(120_000);

  let apiKey: string;

  beforeAll(async () => {
    apiKey = smokeApiKey ?? (await createSmokeMerchant(baseUrl)).apiKey;
  }, 60_000);

  test.each([...STRIPE_DISPUTE_PAYMENT_METHOD_SCENARIOS])(
    'create+confirm+capture — $key ($paymentMethodId)',
    async (scenario) => {
      const created = await requestJson<{
        payment: { id: string; status: string; providerRef?: string | null };
      }>(baseUrl, 'POST', '/api/v2/payments', {
        headers: {
          'X-API-Key': apiKey,
          'Idempotency-Key': randomUUID(),
        },
        body: {
          amountMinor: disputeAmountMinor,
          currency: 'EUR',
          provider: 'stripe',
          stripePaymentMethodId: scenario.paymentMethodId,
        },
      });

      expect(created.payment.status).toBe('authorized');
      expect(created.payment.providerRef ?? '').toMatch(/^pi_/);

      const captured = await requestJson<{ payment: { id: string; status: string; providerRef?: string | null } }>(
        baseUrl,
        'POST',
        `/api/v2/payments/${created.payment.id}/capture`,
        {
          headers: {
            'X-API-Key': apiKey,
            'Idempotency-Key': randomUUID(),
          },
        },
      );

      expect(captured.payment.status).toBe('succeeded');
      const providerRef = captured.payment.providerRef ?? created.payment.providerRef;
      expect(providerRef).toMatch(/^pi_/);

      if (!stripeSecretKey) {
        // Sin clave en el runner solo validamos el flujo PSP + Stripe hasta succeeded.
        return;
      }

      if (scenario.expectStripeDispute) {
        const pi = await waitFor(
          () => stripeGetPaymentIntent({ secretKey: stripeSecretKey, paymentIntentId: providerRef as string }),
          (doc) => !!stripeDisputeIdFromPaymentIntent(doc),
          { timeoutMs: 90_000, intervalMs: 2_500, debugLabel: `stripe dispute ${scenario.key}` },
        );
        expect(stripeDisputeIdFromPaymentIntent(pi)).toMatch(/^du_/);
      } else {
        await new Promise((r) => setTimeout(r, 12_000));
        const pi = await stripeGetPaymentIntent({
          secretKey: stripeSecretKey,
          paymentIntentId: providerRef as string,
        });
        expect(stripeDisputeIdFromPaymentIntent(pi)).toBeUndefined();
      }

      if (process.env.SMOKE_STRIPE_AWAIT_PSP_DISPUTED === 'true') {
        const disputed = await waitFor(
          () =>
            requestJson<{ payment: { status: string } }>(baseUrl, 'GET', `/api/v2/payments/${created.payment.id}`, {
              headers: { 'X-API-Key': apiKey },
            }),
          (body) => body.payment.status === 'disputed',
          { timeoutMs: 90_000, intervalMs: 2_000, debugLabel: `PSP disputed ${scenario.key}` },
        );
        expect(disputed.payment.status).toBe('disputed');
      }
    },
  );
});
