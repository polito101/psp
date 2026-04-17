import {
  paymentsV2MerchantRateLimitBucket,
  paymentsV2MerchantRateLimitKey,
  paymentsV2MerchantRateLimitRetryAfterSec,
} from './payments-v2-merchant-rate-limit';

describe('payments-v2-merchant-rate-limit helpers', () => {
  it('bucket fijo alinea ventanas por windowSec', () => {
    expect(paymentsV2MerchantRateLimitBucket(0, 60)).toBe(0);
    expect(paymentsV2MerchantRateLimitBucket(59, 60)).toBe(0);
    expect(paymentsV2MerchantRateLimitBucket(60, 60)).toBe(1);
    expect(paymentsV2MerchantRateLimitBucket(119, 60)).toBe(1);
  });

  it('clave Redis usa prefijo payv2:rl y bucket', () => {
    expect(paymentsV2MerchantRateLimitKey('m1', 'create', 7)).toBe('payv2:rl:m1:create:7');
  });

  it('retryAfter es segundos hasta fin de bucket (minimo 1)', () => {
    expect(paymentsV2MerchantRateLimitRetryAfterSec(0, 60)).toBe(60);
    expect(paymentsV2MerchantRateLimitRetryAfterSec(59, 60)).toBe(1);
    expect(paymentsV2MerchantRateLimitRetryAfterSec(60, 60)).toBe(60);
  });
});
