const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

const DEFAULT_MAX_BUCKETS = 10_000;
const DEFAULT_SWEEP_INTERVAL_MS = 30_000;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

let maxBuckets = DEFAULT_MAX_BUCKETS;
let sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS;
let lastSweepAt = 0;

export type LoginRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number };

function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function maybeSweep(now: number): void {
  if (sweepIntervalMs > 0 && now - lastSweepAt < sweepIntervalMs) return;
  lastSweepAt = now;
  sweepExpired(now);
}

function evictUntilUnderCap(): void {
  while (buckets.size >= maxBuckets) {
    const first = buckets.keys().next().value;
    if (first === undefined) break;
    buckets.delete(first);
  }
}

/**
 * Límite best-effort en proceso por clave (p. ej. IP). No sustituye WAF/edge en multi-instancia.
 * Limpia buckets expirados periódicamente y acota memoria con un máximo de entradas (evicción FIFO).
 */
export function checkLoginRateLimit(key: string, now = Date.now()): LoginRateLimitResult {
  maybeSweep(now);

  const existing = buckets.get(key);

  if (existing && existing.resetAt > now) {
    buckets.delete(key);
    existing.count += 1;
    if (existing.count <= MAX_ATTEMPTS) {
      buckets.set(key, existing);
      return { allowed: true };
    }
    buckets.set(key, existing);
    return { allowed: false, retryAfterSec: Math.ceil((existing.resetAt - now) / 1000) };
  }

  buckets.delete(key);
  evictUntilUnderCap();
  buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
  return { allowed: true };
}

/** Solo tests: opciones de tamaño del map e intervalo de barrido. */
export function setLoginRateLimitTestOptions(options: {
  maxBuckets?: number;
  sweepIntervalMs?: number;
}): void {
  if (options.maxBuckets !== undefined) maxBuckets = options.maxBuckets;
  if (options.sweepIntervalMs !== undefined) sweepIntervalMs = options.sweepIntervalMs;
}

/** Solo tests: número de buckets tras barridos manuales implícitos en `checkLoginRateLimit`. */
export function getLoginRateLimitBucketCountForTests(): number {
  return buckets.size;
}

/** Solo tests: barrido explícito (p. ej. con timers falsos). */
export function sweepLoginRateLimitBucketsForTests(now: number): number {
  const before = buckets.size;
  sweepExpired(now);
  return before - buckets.size;
}

/** Solo tests. */
export function resetLoginRateLimitForTests(): void {
  buckets.clear();
  maxBuckets = DEFAULT_MAX_BUCKETS;
  sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS;
  lastSweepAt = 0;
}
