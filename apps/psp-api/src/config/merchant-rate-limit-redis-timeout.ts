/**
 * Timeout de comando ioredis (`commandTimeout`) para el INCR de cuota merchant (Payments V2).
 * Mismo rango y default que `PaymentsV2MerchantRateLimitService` (una sola fuente de verdad).
 */
export function parseMerchantRateLimitRedisCommandTimeoutMs(raw: string | undefined): number {
  const defaultMs = 150;
  const minMs = 50;
  const maxMs = 2_000;
  if (raw === undefined || String(raw).trim() === '') {
    return defaultMs;
  }
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) {
    return defaultMs;
  }
  const v = Math.trunc(n);
  if (v < minMs) return minMs;
  if (v > maxMs) return maxMs;
  return v;
}
