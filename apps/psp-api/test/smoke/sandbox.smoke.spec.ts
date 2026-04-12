import { randomUUID } from 'crypto';

type JsonBody = Record<string, unknown>;

const baseUrl = mustEnv('SMOKE_BASE_URL');
const internalSecret = process.env.SMOKE_INTERNAL_API_SECRET ?? mustEnv('INTERNAL_API_SECRET');

describe('sandbox smoke flow', () => {
  it(
    'runs merchant -> payment link -> payment -> capture -> balance',
    async () => {
      const health = await requestJson<{ status: string }>('GET', '/health');
      expect(['ok', 'degraded']).toContain(health.status);

      const merchant = await requestJson<{ id: string; apiKey: string }>('POST', '/api/v1/merchants', {
        headers: {
          'X-Internal-Secret': internalSecret,
        },
        body: {
          name: `Sandbox Smoke ${Date.now()}`,
        },
      });
      expect(typeof merchant.id).toBe('string');
      expect(typeof merchant.apiKey).toBe('string');
      const apiKey = String(merchant.apiKey);

      const paymentLink = await requestJson<{ id: string }>('POST', '/api/v1/payment-links', {
        headers: {
          'X-API-Key': apiKey,
        },
        body: {
          amountMinor: 1999,
          currency: 'EUR',
        },
      });
      expect(typeof paymentLink.id).toBe('string');

      const payment = await requestJson<{ id: string; status: string }>('POST', '/api/v1/payments', {
        headers: {
          'X-API-Key': apiKey,
          'Idempotency-Key': randomUUID(),
        },
        body: {
          amountMinor: 1999,
          currency: 'EUR',
          paymentLinkId: paymentLink.id,
          rail: 'fiat',
        },
      });
      expect(payment.status).toBe('pending');

      const captured = await requestJson<{ status: string }>('POST', `/api/v1/payments/${payment.id}/capture`, {
        headers: {
          'X-API-Key': apiKey,
        },
      });
      expect(captured.status).toBe('succeeded');

      const finalPayment = await requestJson<{ status: string }>('GET', `/api/v1/payments/${payment.id}`, {
        headers: {
          'X-API-Key': apiKey,
        },
      });
      expect(finalPayment.status).toBe('succeeded');

      const balance = await requestJson<unknown[]>('GET', '/api/v1/balance', {
        headers: {
          'X-API-Key': apiKey,
        },
      });
      expect(Array.isArray(balance)).toBe(true);
      expect(balance.length).toBeGreaterThan(0);
    },
    60_000,
  );
});

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function requestJson<T>(
  method: 'GET' | 'POST',
  path: string,
  options?: {
    headers?: Record<string, string>;
    body?: JsonBody;
  },
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(options?.headers ?? {}),
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const parsed = text.length > 0 ? (JSON.parse(text) as T) : ({} as T);
  if (!response.ok) {
    throw new Error(`Request failed ${method} ${path} -> ${response.status}: ${text}`);
  }
  return parsed;
}
