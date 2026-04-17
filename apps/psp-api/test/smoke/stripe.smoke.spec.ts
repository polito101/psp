import { randomUUID } from 'crypto';
import {
  createSmokeMerchant,
  normalizeBaseUrl,
  parsePositiveInt,
  requestJson,
} from './smoke.helpers';

const baseUrl = normalizeBaseUrl(process.env.SMOKE_BASE_URL ?? 'http://localhost:3000');
const smokeApiKey = process.env.SMOKE_API_KEY?.trim();
const stripeEnabled =
  process.env.SMOKE_STRIPE_ENABLED === 'true' || process.env.SMOKE_PROVIDER?.trim() === 'stripe';
const stripePaymentMethodIdRaw = process.env.SMOKE_STRIPE_PAYMENT_METHOD_ID?.trim();
// Permite que el usuario configure "default" en CI/local sin romper el validador del API.
const stripePaymentMethodId =
  !stripePaymentMethodIdRaw || stripePaymentMethodIdRaw.toLowerCase() === 'default'
    ? 'pm_card_visa'
    : stripePaymentMethodIdRaw;
const stripeCreateAmountMinor = parsePositiveInt(
  process.env.SMOKE_STRIPE_CREATE_AMOUNT_MINOR,
  1999,
  'SMOKE_STRIPE_CREATE_AMOUNT_MINOR',
);
const stripeConfirmAmountMinor = parsePositiveInt(
  process.env.SMOKE_STRIPE_CONFIRM_AMOUNT_MINOR,
  2101,
  'SMOKE_STRIPE_CONFIRM_AMOUNT_MINOR',
);

const maybeDescribe = stripeEnabled ? describe : describe.skip;

maybeDescribe('sandbox smoke flow (stripe)', () => {
  it(
    'runs create (automatic pm) -> idempotent replay',
    async () => {
      const apiKey = smokeApiKey ?? (await createSmokeMerchant(baseUrl)).apiKey;
      const idempotencyKey = randomUUID();
      const payload = {
        amountMinor: stripeCreateAmountMinor,
        currency: 'EUR',
      };

      const first = await requestJson<{
        payment: { id: string; status: string };
        nextAction: { type: string; clientSecret?: string } | null;
      }>(baseUrl, 'POST', '/api/v2/payments', {
        headers: {
          'X-API-Key': apiKey,
          'Idempotency-Key': idempotencyKey,
        },
        body: payload,
      });
      expect(typeof first.payment.id).toBe('string');
      expect(['pending', 'requires_action', 'processing']).toContain(first.payment.status);
      expect(first.nextAction).not.toBeNull();
      expect(first.nextAction?.type).toBe('confirm_with_stripe_js');
      expect(typeof first.nextAction?.clientSecret).toBe('string');

      const replay = await requestJson<{
        payment: { id: string; status: string };
        nextAction: { type: string; clientSecret?: string } | null;
      }>(baseUrl, 'POST', '/api/v2/payments', {
        headers: {
          'X-API-Key': apiKey,
          'Idempotency-Key': idempotencyKey,
        },
        body: payload,
      });

      expect(replay.payment.id).toBe(first.payment.id);
      expect(['pending', 'requires_action', 'processing']).toContain(replay.payment.status);
      expect(replay.nextAction).not.toBeNull();
      expect(replay.nextAction?.type).toBe('confirm_with_stripe_js');
      expect(typeof replay.nextAction?.clientSecret).toBe('string');
    },
    45_000,
  );

  it(
    'runs create+confirm (payment method) -> capture',
    async () => {
      const apiKey = smokeApiKey ?? (await createSmokeMerchant(baseUrl)).apiKey;
      const created = await requestJson<{
        payment: { id: string; status: string };
      }>(baseUrl, 'POST', '/api/v2/payments', {
        headers: {
          'X-API-Key': apiKey,
          'Idempotency-Key': randomUUID(),
        },
        body: {
          amountMinor: stripeConfirmAmountMinor,
          currency: 'EUR',
          stripePaymentMethodId,
        },
      });

      expect(created.payment.status).toBe('authorized');

      const captured = await requestJson<{ payment: { id: string; status: string } }>(
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

      expect(captured.payment.id).toBe(created.payment.id);
      expect(captured.payment.status).toBe('succeeded');
    },
    45_000,
  );
});
