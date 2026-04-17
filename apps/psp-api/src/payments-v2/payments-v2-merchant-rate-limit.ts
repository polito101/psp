/**
 * Cuota fija por ventana temporal (bucket = floor(nowSec / windowSec)).
 * Clave Redis: `payv2:rl:{merchantId}:{operation}:{bucket}` (prefijo alineado con `payv2:*`).
 * Sin hash-tag `{merchantId}`: operación single-key (INCR); si en el futuro hubiera multi-key por merchant,
 * convendría `payv2:rl:{${merchantId}}:...` para cluster Redis.
 */
export const PAYMENTS_V2_MERCHANT_RL_KEY_PREFIX = 'payv2:rl';

export type PaymentsV2MerchantRateLimitOperation = 'create' | 'capture' | 'refund';

export function paymentsV2MerchantRateLimitBucket(nowSec: number, windowSec: number): number {
  return Math.floor(nowSec / windowSec);
}

export function paymentsV2MerchantRateLimitKey(
  merchantId: string,
  operation: PaymentsV2MerchantRateLimitOperation,
  bucket: number,
): string {
  return `${PAYMENTS_V2_MERCHANT_RL_KEY_PREFIX}:${merchantId}:${operation}:${bucket}`;
}

/** Segundos hasta el fin del bucket fijo actual (mínimo 1). */
export function paymentsV2MerchantRateLimitRetryAfterSec(nowSec: number, windowSec: number): number {
  const bucketEndSec = (Math.floor(nowSec / windowSec) + 1) * windowSec;
  return Math.max(1, bucketEndSec - nowSec);
}
