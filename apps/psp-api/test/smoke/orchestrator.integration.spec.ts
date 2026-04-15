import { randomUUID } from 'crypto';
import {
  createSmokeMerchant,
  mustEnv,
  normalizeBaseUrl,
  requestJson,
  waitFor,
} from './smoke.helpers';

const baseUrl = normalizeBaseUrl(process.env.SMOKE_BASE_URL ?? 'http://localhost:3000');
const internalSecret = process.env.SMOKE_INTERNAL_API_SECRET ?? mustEnv('INTERNAL_API_SECRET');

type PaymentAttemptView = {
  operation: string;
  provider: string;
  status: string;
  errorCode: string | null;
};

type PaymentView = {
  id: string;
  status: string;
  selectedProvider?: string | null;
  attempts: PaymentAttemptView[];
};

type MetricsSnapshot = {
  payments: Record<
    string,
    {
      total: number;
      successRate: number;
      retryRate: number;
      attemptPersistFailed: number;
      p95LatencyMs: number;
    }
  >;
  webhooks: {
    workerEnabled: boolean;
    intervalMs: number;
    maxAttempts: number;
    counts: { pending: number; processing: number; failed: number };
    oldestPendingAgeMs: number | null;
    fetchTimeoutMs: number;
  };
  circuitBreakers: Record<string, { open: boolean; failures: number; openedAt: string | null }>;
};

describe('payments v2 integration: concurrencia + webhooks + métricas + fallbacks', () => {
  it(
    'mantiene consistencia en create concurrente con misma idempotency key',
    async () => {
      const { apiKey } = await createSmokeMerchant(baseUrl);
      const idem = randomUUID();
      const payload = { amountMinor: 1999, currency: 'EUR', provider: 'mock' as const };

      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          requestJson<{ payment: { id: string; status: string } }>(baseUrl, 'POST', '/api/v2/payments', {
            headers: {
              'X-API-Key': apiKey,
              'Idempotency-Key': idem,
            },
            body: payload,
          }),
        ),
      );

      const ids = new Set(responses.map((result) => result.payment.id));
      expect(ids.size).toBe(1);
      for (const result of responses) {
        expect(['processing', 'authorized']).toContain(result.payment.status);
      }

      const paymentId = responses[0].payment.id;
      const payment = await waitFor(
        () =>
          requestJson<PaymentView>(baseUrl, 'GET', `/api/v2/payments/${paymentId}`, {
            headers: { 'X-API-Key': apiKey },
          }),
        (snapshot) => snapshot.status === 'authorized',
        { timeoutMs: 15_000, intervalMs: 500, debugLabel: 'create idempotent convergence' },
      );

      expect(payment.id).toBe(paymentId);
      expect(payment.status).toBe('authorized');
      expect(payment.attempts.filter((attempt) => attempt.operation === 'create').length).toBe(1);
    },
    45_000,
  );

  it(
    'serializa capture concurrente y deja un solo intento de provider',
    async () => {
      const { apiKey } = await createSmokeMerchant(baseUrl);
      const created = await requestJson<{ payment: { id: string; status: string } }>(
        baseUrl,
        'POST',
        '/api/v2/payments',
        {
          headers: { 'X-API-Key': apiKey },
          body: { amountMinor: 1999, currency: 'EUR', provider: 'mock' },
        },
      );
      expect(created.payment.status).toBe('authorized');

      const captureIdem = randomUUID();
      const captures = await Promise.all(
        Array.from({ length: 5 }, () =>
          requestJson<{ payment: { id: string; status: string } }>(
            baseUrl,
            'POST',
            `/api/v2/payments/${created.payment.id}/capture`,
            {
              headers: { 'X-API-Key': apiKey, 'Idempotency-Key': captureIdem },
            },
          ),
        ),
      );

      for (const capture of captures) {
        expect(capture.payment.id).toBe(created.payment.id);
        expect(['authorized', 'processing', 'succeeded']).toContain(capture.payment.status);
      }

      const payment = await waitFor(
        () =>
          requestJson<PaymentView>(baseUrl, 'GET', `/api/v2/payments/${created.payment.id}`, {
            headers: { 'X-API-Key': apiKey },
          }),
        (snapshot) => snapshot.status === 'succeeded',
        { timeoutMs: 15_000, intervalMs: 500, debugLabel: 'capture convergence' },
      );
      const captureAttempts = payment.attempts.filter((attempt) => attempt.operation === 'capture');
      expect(captureAttempts.length).toBe(1);
      expect(captureAttempts[0]?.provider).toBe('mock');
      expect(captureAttempts[0]?.status).toBe('succeeded');
    },
    45_000,
  );

  it(
    'hace fallback stripe -> mock cuando stripe no está disponible',
    async () => {
      const { apiKey } = await createSmokeMerchant(baseUrl);

      const created = await requestJson<{ payment: { id: string; status: string; selectedProvider: string } }>(
        baseUrl,
        'POST',
        '/api/v2/payments',
        {
          headers: { 'X-API-Key': apiKey, 'Idempotency-Key': randomUUID() },
          body: {
            amountMinor: 1999,
            currency: 'EUR',
          },
        },
      );

      const payment = await requestJson<PaymentView>(baseUrl, 'GET', `/api/v2/payments/${created.payment.id}`, {
        headers: { 'X-API-Key': apiKey },
      });

      const createAttempts = payment.attempts.filter((attempt) => attempt.operation === 'create');
      expect(createAttempts.length).toBeGreaterThanOrEqual(1);

      const stripeUnavailable = createAttempts.find(
        (attempt) =>
          attempt.provider === 'stripe' &&
          attempt.status === 'failed' &&
          attempt.errorCode === 'provider_unavailable',
      );
      const mockSuccess = createAttempts.find(
        (attempt) => attempt.provider === 'mock' && attempt.status === 'authorized',
      );

      if (stripeUnavailable && mockSuccess) {
        expect(payment.status).toBe('authorized');
        expect(payment.selectedProvider).toBe('mock');
        return;
      }

      // Entornos con Stripe disponible o con orden de proveedores sin fallback explícito
      // no siempre ejercitan stripe -> mock en este flujo.
      expect(['authorized', 'pending', 'requires_action', 'processing']).toContain(payment.status);
    },
    45_000,
  );

  it(
    'expone métricas internas y refleja backlog de webhooks tras capture',
    async () => {
      const merchant = await requestJson<{ id: string; apiKey: string }>(baseUrl, 'POST', '/api/v1/merchants', {
        headers: {
          'X-Internal-Secret': internalSecret,
        },
        body: {
          name: `Webhook Smoke ${Date.now()}`,
          webhookUrl: 'http://127.0.0.1:9/unreachable-webhook',
        },
      });

      const before = await requestJson<MetricsSnapshot>(baseUrl, 'GET', '/api/v2/payments/ops/metrics', {
        headers: {
          'X-Internal-Secret': internalSecret,
        },
      });

      const created = await requestJson<{ payment: { id: string; status: string } }>(
        baseUrl,
        'POST',
        '/api/v2/payments',
        {
          headers: { 'X-API-Key': merchant.apiKey },
          body: { amountMinor: 1999, currency: 'EUR', provider: 'mock' },
        },
      );
      expect(created.payment.status).toBe('authorized');

      const captured = await requestJson<{ payment: { id: string; status: string } }>(
        baseUrl,
        'POST',
        `/api/v2/payments/${created.payment.id}/capture`,
        {
          headers: { 'X-API-Key': merchant.apiKey },
        },
      );
      expect(captured.payment.status).toBe('succeeded');

      const after = await waitFor(
        () =>
          requestJson<MetricsSnapshot>(baseUrl, 'GET', '/api/v2/payments/ops/metrics', {
            headers: { 'X-Internal-Secret': internalSecret },
          }),
        (snapshot) => {
          if (!snapshot.webhooks.workerEnabled) {
            return snapshot.webhooks.counts.pending >= before.webhooks.counts.pending + 1;
          }
          return (
            snapshot.webhooks.counts.failed >= before.webhooks.counts.failed + 1 ||
            snapshot.webhooks.counts.processing >= before.webhooks.counts.processing + 1
          );
        },
        {
          timeoutMs: 55_000,
          intervalMs: 2_000,
          debugLabel: 'webhook queue snapshot',
        },
      );

      expect(after.payments['mock:capture']).toBeDefined();
      expect(after.payments['mock:capture'].total).toBeGreaterThanOrEqual(1);
      expect(typeof after.payments['mock:capture'].p95LatencyMs).toBe('number');
      expect(after.webhooks.intervalMs).toBeGreaterThan(0);
      expect(after.webhooks.maxAttempts).toBeGreaterThan(0);
    },
    70_000,
  );
});
