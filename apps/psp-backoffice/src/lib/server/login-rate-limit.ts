const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export type LoginRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number };

/**
 * Límite best-effort en proceso por clave (p. ej. IP). No sustituye WAF/edge en multi-instancia.
 */
export function checkLoginRateLimit(key: string, now = Date.now()): LoginRateLimitResult {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }

  current.count += 1;
  if (current.count <= MAX_ATTEMPTS) return { allowed: true };
  return { allowed: false, retryAfterSec: Math.ceil((current.resetAt - now) / 1000) };
}

/** Solo tests. */
export function resetLoginRateLimitForTests(): void {
  buckets.clear();
}
