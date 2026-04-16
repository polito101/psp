import { randomUUID } from 'crypto';

type JsonBody = Record<string, unknown>;

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('SMOKE_BASE_URL cannot be empty');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid SMOKE_BASE_URL: ${trimmed}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Invalid SMOKE_BASE_URL protocol: ${url.protocol}`);
  }
  return url.origin;
}

export function parsePositiveInt(raw: string | undefined, fallback: number, envName: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer`);
  }
  return parsed;
}

export function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeStatuses(expectedStatus?: number | number[]): number[] {
  if (expectedStatus === undefined) return [];
  return Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
}

export async function requestJson<T>(
  baseUrl: string,
  method: 'GET' | 'POST',
  path: string,
  options?: {
    headers?: Record<string, string>;
    body?: JsonBody;
    expectedStatus?: number | number[];
  },
): Promise<T> {
  const url = `${baseUrl}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(options?.headers ?? {}),
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      [
        `Fetch failed ${method} ${url}: ${message}`,
        'Set SMOKE_BASE_URL to your sandbox URL (e.g. https://<sandbox-host>) or start the API locally on http://localhost:3000.',
      ].join('\n'),
    );
  }

  const text = await response.text();
  const expectedStatuses = normalizeStatuses(options?.expectedStatus);
  const isExpectedStatus = expectedStatuses.includes(response.status);
  const isUnexpectedStatus = expectedStatuses.length > 0 ? !isExpectedStatus : !response.ok;

  if (isUnexpectedStatus) {
    throw new Error(`Request failed ${method} ${path} -> ${response.status}: ${text}`);
  }

  if (text.length === 0) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON response ${method} ${path} -> ${response.status}: ${text}`);
  }
}

export async function waitFor<T>(
  producer: () => Promise<T>,
  predicate: (value: T) => boolean,
  options?: {
    timeoutMs?: number;
    intervalMs?: number;
    debugLabel?: string;
  },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 45_000;
  const intervalMs = options?.intervalMs ?? 1_000;
  const startedAt = Date.now();
  let lastValue: T | undefined;

  while (Date.now() - startedAt <= timeoutMs) {
    lastValue = await producer();
    if (predicate(lastValue)) {
      return lastValue;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const debugSuffix = options?.debugLabel ? ` (${options.debugLabel})` : '';
  throw new Error(`waitFor timeout after ${timeoutMs}ms${debugSuffix}: ${JSON.stringify(lastValue)}`);
}

/** Base `.../v1` para llamadas directas a Stripe desde smoke (test mode). */
export function stripeApiV1BaseUrl(): string {
  const raw = process.env.STRIPE_API_BASE_URL?.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      return `${u.origin}/v1`;
    } catch {
      // caer al default
    }
  }
  return 'https://api.stripe.com/v1';
}

/**
 * GET PaymentIntent con `expand` (p. ej. para leer `latest_charge.dispute` en test mode).
 */
export async function stripeGetPaymentIntent(opts: {
  secretKey: string;
  paymentIntentId: string;
  expand?: string[];
}): Promise<Record<string, unknown>> {
  const id = encodeURIComponent(opts.paymentIntentId);
  const expands = opts.expand ?? ['latest_charge.dispute'];
  const qs = expands.map((e) => `expand[]=${encodeURIComponent(e)}`).join('&');
  const url = `${stripeApiV1BaseUrl()}/payment_intents/${id}?${qs}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${opts.secretKey}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Stripe GET payment_intents failed ${res.status}: ${text}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

/** Devuelve el id `du_...` si Stripe ya materializó la disputa en el cargo del PI. */
export function stripeDisputeIdFromPaymentIntent(pi: Record<string, unknown>): string | undefined {
  const lc = pi.latest_charge;
  if (!lc || typeof lc !== 'object') return undefined;
  const charge = lc as Record<string, unknown>;
  const d = charge.dispute;
  if (typeof d === 'string' && d.startsWith('du_')) return d;
  if (d && typeof d === 'object' && typeof (d as Record<string, unknown>).id === 'string') {
    const id = (d as Record<string, unknown>).id;
    return typeof id === 'string' && id.startsWith('du_') ? id : undefined;
  }
  return undefined;
}

export async function createSmokeMerchant(
  baseUrl: string,
  opts?: { keyTtlDays?: number },
): Promise<{ id: string; apiKey: string }> {
  const internalSecret = process.env.SMOKE_INTERNAL_API_SECRET ?? mustEnv('INTERNAL_API_SECRET');
  const merchant = await requestJson<{ id: string; apiKey: string }>(baseUrl, 'POST', '/api/v1/merchants', {
    headers: {
      'X-Internal-Secret': internalSecret,
    },
    body: {
      name: `Sandbox Smoke ${Date.now()}-${randomUUID().slice(0, 8)}`,
      ...(opts?.keyTtlDays ? { keyTtlDays: opts.keyTtlDays } : {}),
    },
  });
  expect(typeof merchant.id).toBe('string');
  expect(typeof merchant.apiKey).toBe('string');
  return merchant;
}
