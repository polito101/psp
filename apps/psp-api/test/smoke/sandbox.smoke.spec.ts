import { randomUUID } from 'crypto';
import {
  createSmokeMerchant,
  normalizeBaseUrl,
  parsePositiveInt,
  requestJson,
} from './smoke.helpers';

const baseUrl = normalizeBaseUrl(process.env.SMOKE_BASE_URL ?? 'http://localhost:3000');
const smokeApiKey = process.env.SMOKE_API_KEY?.trim();
const smokeAmountMinor = parsePositiveInt(
  process.env.SMOKE_PAYMENT_AMOUNT_MINOR,
  1999,
  'SMOKE_PAYMENT_AMOUNT_MINOR',
);
const requiresActionAmountMinor = parsePositiveInt(
  process.env.SMOKE_REQUIRES_ACTION_AMOUNT_MINOR,
  2002,
  'SMOKE_REQUIRES_ACTION_AMOUNT_MINOR',
);

describe('sandbox smoke flow', () => {
  it(
    'runs health -> auth guard -> idempotent create -> capture -> refund -> balance',
    async () => {
      const health = await requestJson<{
        status: string;
        checks: { db: { status: string }; redis: { status: string } };
      }>(baseUrl, 'GET', '/health');
      expect(health.status).toBe('ok');
      expect(health.checks.db.status).toBe('ok');
      expect(health.checks.redis.status).toBe('ok');

      const apiKey = smokeApiKey ?? (await createSmokeMerchant(baseUrl)).apiKey;
      expect(typeof apiKey).toBe('string');
      expect(apiKey.length).toBeGreaterThan(0);

      await requestJson<{ statusCode: number; message: string }>(baseUrl, 'GET', '/api/v1/balance', {
        headers: {
          'X-API-Key': 'psp.invalid.invalid',
        },
        expectedStatus: 401,
      });

      const idempotencyKey = randomUUID();
      const paymentPayload = {
        amountMinor: smokeAmountMinor,
        currency: 'EUR',
        provider: 'mock',
      };

      const paymentIntent = await requestJson<{ payment: { id: string; status: string } }>(
        baseUrl,
        'POST',
        '/api/v2/payments',
        {
          headers: {
            'X-API-Key': apiKey,
            'Idempotency-Key': idempotencyKey,
          },
          body: paymentPayload,
        },
      );
      expect(paymentIntent.payment.status).toBe('authorized');

      const replayIntent = await requestJson<{ payment: { id: string; status: string } }>(
        baseUrl,
        'POST',
        '/api/v2/payments',
        {
          headers: {
            'X-API-Key': apiKey,
            'Idempotency-Key': idempotencyKey,
          },
          body: paymentPayload,
        },
      );
      expect(replayIntent.payment.id).toBe(paymentIntent.payment.id);
      expect(replayIntent.payment.status).toBe(paymentIntent.payment.status);

      const captured = await requestJson<{ payment: { status: string } }>(
        baseUrl,
        'POST',
        `/api/v2/payments/${paymentIntent.payment.id}/capture`,
        {
          headers: {
            'X-API-Key': apiKey,
          },
        },
      );
      expect(captured.payment.status).toBe('succeeded');

      const refunded = await requestJson<{ payment: { status: string } }>(
        baseUrl,
        'POST',
        `/api/v2/payments/${paymentIntent.payment.id}/refund`,
        {
          headers: {
            'X-API-Key': apiKey,
          },
          body: {},
        },
      );
      expect(refunded.payment.status).toBe('refunded');

      const finalPayment = await requestJson<{ status: string }>(
        baseUrl,
        'GET',
        `/api/v2/payments/${paymentIntent.payment.id}`,
        {
          headers: {
            'X-API-Key': apiKey,
          },
        },
      );
      expect(finalPayment.status).toBe('refunded');

      const balance = await requestJson<Array<{ currency: string; availableMinor: number }>>(
        baseUrl,
        'GET',
        '/api/v1/balance',
        {
          headers: {
            'X-API-Key': apiKey,
          },
        },
      );
      expect(Array.isArray(balance)).toBe(true);
      expect(balance.length).toBeGreaterThan(0);
      expect(typeof balance[0].currency).toBe('string');
      expect(typeof balance[0].availableMinor).toBe('number');
    },
    60_000,
  );

  it(
    'rejects idempotency-key replay with different payload',
    async () => {
      const apiKey = smokeApiKey ?? (await createSmokeMerchant(baseUrl)).apiKey;
      const idempotencyKey = randomUUID();

      const first = await requestJson<{ payment: { id: string } }>(baseUrl, 'POST', '/api/v2/payments', {
        headers: {
          'X-API-Key': apiKey,
          'Idempotency-Key': idempotencyKey,
        },
        body: {
          amountMinor: smokeAmountMinor,
          currency: 'EUR',
          provider: 'mock',
        },
      });
      expect(typeof first.payment.id).toBe('string');

      const conflict = await requestJson<{ statusCode: number; message: string }>(
        baseUrl,
        'POST',
        '/api/v2/payments',
        {
          headers: {
            'X-API-Key': apiKey,
            'Idempotency-Key': idempotencyKey,
          },
          body: {
            amountMinor: smokeAmountMinor + 1,
            currency: 'EUR',
            provider: 'mock',
          },
          expectedStatus: 409,
        },
      );
      expect(conflict.statusCode).toBe(409);
      expect(conflict.message).toContain('Idempotency key');
    },
    30_000,
  );

  it(
    'runs create authorized -> cancel -> get canceled',
    async () => {
      const apiKey = smokeApiKey ?? (await createSmokeMerchant(baseUrl)).apiKey;
      const created = await requestJson<{ payment: { id: string; status: string } }>(
        baseUrl,
        'POST',
        '/api/v2/payments',
        {
          headers: { 'X-API-Key': apiKey },
          body: {
            amountMinor: smokeAmountMinor,
            currency: 'EUR',
            provider: 'mock',
          },
        },
      );
      expect(created.payment.status).toBe('authorized');

      const canceled = await requestJson<{ payment: { id: string; status: string } }>(
        baseUrl,
        'POST',
        `/api/v2/payments/${created.payment.id}/cancel`,
        {
          headers: { 'X-API-Key': apiKey },
        },
      );
      expect(canceled.payment.id).toBe(created.payment.id);
      expect(canceled.payment.status).toBe('canceled');

      const final = await requestJson<{ id: string; status: string }>(
        baseUrl,
        'GET',
        `/api/v2/payments/${created.payment.id}`,
        {
          headers: { 'X-API-Key': apiKey },
        },
      );
      expect(final.id).toBe(created.payment.id);
      expect(final.status).toBe('canceled');
    },
    30_000,
  );

  it(
    'runs create requires_action path (mock 3ds trigger)',
    async () => {
      const apiKey = smokeApiKey ?? (await createSmokeMerchant(baseUrl)).apiKey;
      const result = await requestJson<{
        payment: { id: string; status: string };
        nextAction: { type: string } | null;
      }>(baseUrl, 'POST', '/api/v2/payments', {
        headers: { 'X-API-Key': apiKey },
        body: {
          amountMinor: requiresActionAmountMinor,
          currency: 'EUR',
          provider: 'mock',
        },
      });

      expect(result.payment.status).toBe('requires_action');
      expect(result.nextAction).not.toBeNull();
      expect(result.nextAction?.type).toBe('3ds');
    },
    30_000,
  );
});
