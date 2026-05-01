/**
 * Rate limit best-effort en proceso para `POST /api/merchant-onboarding/applications`.
 * Alineado con el throttler global de `psp-api` (120 req / 60 s por identificador).
 */

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 120;

const DEFAULT_MAX_BUCKETS = 10_000;
const DEFAULT_SWEEP_INTERVAL_MS = 30_000;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

let maxBuckets = DEFAULT_MAX_BUCKETS;
let sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS;
let lastSweepAt = 0;

export type MerchantOnboardingRateLimitResult =
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

type BucketPreview = {
  key: string;
  next: Bucket;
  wasInWindow: boolean;
};

/**
 * Igual semántica que `checkLoginRateLimit` en backoffice: varias claves; si alguna superaría
 * el límite tras este intento, no muta y devuelve 429.
 */
export function checkMerchantOnboardingPublicRateLimit(
  keys: string[],
  now = Date.now(),
): MerchantOnboardingRateLimitResult {
  const uniqueKeys = [...new Set(keys.filter((k) => k.length > 0))];
  if (uniqueKeys.length === 0) {
    return { allowed: true };
  }

  maybeSweep(now);

  const previews: BucketPreview[] = [];
  let maxRetryAfterSec = 0;

  for (const key of uniqueKeys) {
    const existing = buckets.get(key);
    if (existing && existing.resetAt > now) {
      const nextCount = existing.count + 1;
      const next: Bucket = { count: nextCount, resetAt: existing.resetAt };
      previews.push({ key, next, wasInWindow: true });
      if (nextCount > MAX_ATTEMPTS) {
        maxRetryAfterSec = Math.max(maxRetryAfterSec, Math.ceil((existing.resetAt - now) / 1000));
      }
    } else {
      previews.push({
        key,
        next: { count: 1, resetAt: now + WINDOW_MS },
        wasInWindow: false,
      });
    }
  }

  if (previews.some((p) => p.next.count > MAX_ATTEMPTS)) {
    return { allowed: false, retryAfterSec: maxRetryAfterSec };
  }

  for (const { key, next, wasInWindow } of previews) {
    buckets.delete(key);
    if (!wasInWindow) {
      evictUntilUnderCap();
    }
    buckets.set(key, next);
  }

  return { allowed: true };
}

/** Solo tests. */
export function setMerchantOnboardingRateLimitTestOptions(options: {
  maxBuckets?: number;
  sweepIntervalMs?: number;
}): void {
  if (options.maxBuckets !== undefined) maxBuckets = options.maxBuckets;
  if (options.sweepIntervalMs !== undefined) sweepIntervalMs = options.sweepIntervalMs;
}

/** Solo tests. */
export function resetMerchantOnboardingRateLimitForTests(): void {
  buckets.clear();
  maxBuckets = DEFAULT_MAX_BUCKETS;
  sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS;
  lastSweepAt = 0;
}
