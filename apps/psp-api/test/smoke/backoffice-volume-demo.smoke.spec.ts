import { randomUUID } from 'crypto';
import {
  createSmokeMerchant,
  normalizeBaseUrl,
  parsePositiveInt,
  requestJson,
} from './smoke.helpers';

/**
 * Rellena la base del deploy con pagos v2 (contrato `amount` decimal + `customer`) para verlos en el backoffice (`/transactions`).
 * No corre en `npm run test:smoke:sandbox`: solo cuando el lifecycle es `test:smoke:backoffice-demo`
 * o `SMOKE_BACKOFFICE_VOLUME_DEMO=1`.
 *
 * Requisitos en el servidor: `PAYMENTS_PROVIDER_ORDER` con `mock` primero, `PAYMENTS_V2_ENABLED_MERCHANTS`,
 * tarifas activas para **EUR** (seed por defecto al crear merchant vía `POST /api/v1/merchants` — usar `currency: EUR` en el body v2).
 *
 * Por defecto no hay espera entre `POST /api/v2/payments` y la siguiente petición (`SMOKE_BACKOFFICE_DEMO_CREATE_GAP_MS` vacío).
 * Si el deploy aplica `@Throttle` de creación v2 muy estricto o recibes `429`, sube ese valor (p. ej. `2100`).
 */

function parseAmountEur(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseFloat(raw.trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
  return n;
}

function buildSmokeV2Body(amount: number, orderId: string): Record<string, unknown> {
  return {
    amount,
    currency: 'EUR',
    channel: 'ONLINE',
    language: 'EN',
    orderId,
    description: 'Smoke payment',
    notificationUrl: 'https://example.com/webhook',
    returnUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/failure',
    customer: {
      firstName: 'Smoke',
      lastName: 'Tester',
      email: 'smoke@example.com',
      country: 'ES',
    },
  };
}

const baseUrl = normalizeBaseUrl(
  (process.env.DEMO_API_BASE_URL ?? process.env.SMOKE_BASE_URL ?? 'http://localhost:3000').trim(),
);
const smokeApiKey = process.env.SMOKE_API_KEY?.trim();
const smokePaymentAmount = parseAmountEur(process.env.SMOKE_PAYMENT_AMOUNT, 19.99, 'SMOKE_PAYMENT_AMOUNT');
const requiresActionAmount = parseAmountEur(
  process.env.SMOKE_REQUIRES_ACTION_AMOUNT,
  20.02,
  'SMOKE_REQUIRES_ACTION_AMOUNT',
);

const lifecycle = process.env.npm_lifecycle_event ?? '';
const volumeDemoEnabled =
  lifecycle === 'test:smoke:backoffice-demo' ||
  process.env.SMOKE_BACKOFFICE_VOLUME_DEMO === 'true' ||
  process.env.SMOKE_BACKOFFICE_VOLUME_DEMO === '1';

function parseDemoCount(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  return parsePositiveInt(raw, fallback, name);
}

function parseGapMs(): number {
  const raw = process.env.SMOKE_BACKOFFICE_DEMO_GAP_MS;
  if (raw === undefined || raw.trim() === '') return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('SMOKE_BACKOFFICE_DEMO_GAP_MS must be a non-negative integer');
  }
  return parsed;
}

/** Opcional tras cada create si hace falta espaciar frente al throttle `@Throttle({ limit: 30, ttl: 60_000 })` del controller v2. */
function parseCreateGapMs(): number {
  const raw = process.env.SMOKE_BACKOFFICE_DEMO_CREATE_GAP_MS;
  if (raw === undefined || raw.trim() === '') return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('SMOKE_BACKOFFICE_DEMO_CREATE_GAP_MS must be a non-negative integer');
  }
  return parsed;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

function internalSecret(): string {
  const v = process.env.SMOKE_INTERNAL_API_SECRET ?? process.env.INTERNAL_API_SECRET;
  if (!v?.trim()) {
    throw new Error('Missing INTERNAL_API_SECRET or SMOKE_INTERNAL_API_SECRET');
  }
  return v.trim();
}

async function fetchOpsCounts(merchantId: string): Promise<{ total: number; byStatus: Record<string, number> }> {
  const q = new URLSearchParams({ merchantId });
  return requestJson<{ total: number; byStatus: Record<string, number> }>(
    baseUrl,
    'GET',
    `/api/v2/payments/ops/transactions/counts?${q.toString()}`,
    {
      headers: {
        'X-Internal-Secret': internalSecret(),
        'X-Backoffice-Role': 'admin',
      },
    },
  );
}

(volumeDemoEnabled ? describe : describe.skip)('backoffice volume demo (deploy / sandbox)', () => {
  jest.setTimeout(900_000);

  const gapMs = parseGapMs();
  const createGapMs = parseCreateGapMs();
  const wantSucceeded = Math.max(
    60,
    parseDemoCount(process.env.SMOKE_BACKOFFICE_DEMO_SUCCEEDED, 60, 'SMOKE_BACKOFFICE_DEMO_SUCCEEDED'),
  );
  const wantCanceled = parseDemoCount(process.env.SMOKE_BACKOFFICE_DEMO_CANCELED, 4, 'SMOKE_BACKOFFICE_DEMO_CANCELED');
  const wantRefunded = parseDemoCount(process.env.SMOKE_BACKOFFICE_DEMO_REFUNDED, 4, 'SMOKE_BACKOFFICE_DEMO_REFUNDED');
  const wantRequiresAction = parseDemoCount(
    process.env.SMOKE_BACKOFFICE_DEMO_REQUIRES_ACTION,
    4,
    'SMOKE_BACKOFFICE_DEMO_REQUIRES_ACTION',
  );
  const wantAuthorized = parseDemoCount(
    process.env.SMOKE_BACKOFFICE_DEMO_AUTHORIZED,
    4,
    'SMOKE_BACKOFFICE_DEMO_AUTHORIZED',
  );

  it(
    'crea >=60 succeeded y muestras en otros estados; verifica conteos ops del merchant',
    async () => {
      const health = await requestJson<{ status: string }>(baseUrl, 'GET', '/health');
      expect(health.status).toBe('ok');

      let merchantIdForOps: string;
      let apiKey: string;

      if (smokeApiKey) {
        apiKey = smokeApiKey;
        const probe = await requestJson<{ payment: { id: string } }>(baseUrl, 'POST', '/api/v2/payments', {
          headers: { 'X-API-Key': apiKey, 'Idempotency-Key': randomUUID() },
          body: buildSmokeV2Body(smokePaymentAmount, `probe-${randomUUID().slice(0, 8)}`),
        });
        await sleep(createGapMs);
        await sleep(gapMs);
        const detail = await requestJson<{ merchantId: string }>(
          baseUrl,
          'GET',
          `/api/v2/payments/${probe.payment.id}`,
          {
            headers: { 'X-API-Key': apiKey },
          },
        );
        merchantIdForOps = detail.merchantId;
      } else {
        const m = await createSmokeMerchant(baseUrl);
        merchantIdForOps = m.id;
        apiKey = m.apiKey;
      }

      const post = async (path: string, body?: Record<string, unknown>, extraHeaders: Record<string, string> = {}) => {
        await sleep(gapMs);
        const res = await requestJson<unknown>(baseUrl, 'POST', path, {
          headers: { 'X-API-Key': apiKey, ...extraHeaders },
          ...(body !== undefined ? { body } : {}),
        });
        if (path === '/api/v2/payments') {
          await sleep(createGapMs);
        }
        return res;
      };

      for (let i = 0; i < wantSucceeded; i += 1) {
        const created = (await post(
          '/api/v2/payments',
          buildSmokeV2Body(smokePaymentAmount, `ok-${randomUUID().slice(0, 8)}`),
          { 'Idempotency-Key': randomUUID() },
        )) as { payment: { id: string } };
        await post(`/api/v2/payments/${created.payment.id}/capture`);
      }

      for (let i = 0; i < wantCanceled; i += 1) {
        const created = (await post(
          '/api/v2/payments',
          buildSmokeV2Body(smokePaymentAmount, `can-${randomUUID().slice(0, 8)}`),
        )) as { payment: { id: string } };
        await post(`/api/v2/payments/${created.payment.id}/cancel`);
      }

      for (let i = 0; i < wantRefunded; i += 1) {
        const created = (await post(
          '/api/v2/payments',
          buildSmokeV2Body(smokePaymentAmount, `ref-${randomUUID().slice(0, 8)}`),
        )) as { payment: { id: string } };
        await post(`/api/v2/payments/${created.payment.id}/capture`);
        await post(`/api/v2/payments/${created.payment.id}/refund`, {});
      }

      for (let i = 0; i < wantRequiresAction; i += 1) {
        const created = (await post(
          '/api/v2/payments',
          buildSmokeV2Body(requiresActionAmount, `3ds-${randomUUID().slice(0, 8)}`),
        )) as { payment: { status: string } };
        expect(created.payment.status).toBe('requires_action');
      }

      for (let i = 0; i < wantAuthorized; i += 1) {
        const created = (await post(
          '/api/v2/payments',
          buildSmokeV2Body(smokePaymentAmount, `auth-${randomUUID().slice(0, 8)}`),
        )) as { payment: { status: string } };
        expect(created.payment.status).toBe('authorized');
      }

      await sleep(gapMs);
      const counts = await fetchOpsCounts(merchantIdForOps);

      const minAuthorized = wantAuthorized + (smokeApiKey ? 1 : 0);

      expect(counts.byStatus.succeeded ?? 0).toBeGreaterThanOrEqual(wantSucceeded);
      expect(counts.byStatus.canceled ?? 0).toBeGreaterThanOrEqual(wantCanceled);
      expect(counts.byStatus.refunded ?? 0).toBeGreaterThanOrEqual(wantRefunded);
      expect(counts.byStatus.requires_action ?? 0).toBeGreaterThanOrEqual(wantRequiresAction);
      expect(counts.byStatus.authorized ?? 0).toBeGreaterThanOrEqual(minAuthorized);

      // eslint-disable-next-line no-console
      console.log(
        `[backoffice-volume-demo] merchantId=${merchantIdForOps} counts=${JSON.stringify(counts.byStatus)} total=${counts.total}`,
      );
    },
    900_000,
  );
});
