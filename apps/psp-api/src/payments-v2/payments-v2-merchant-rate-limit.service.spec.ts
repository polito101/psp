import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { PaymentsV2MerchantRateLimitService } from './payments-v2-merchant-rate-limit.service';

describe('PaymentsV2MerchantRateLimitService', () => {
  const makeConfig = (env: Record<string, string>) =>
    ({
      get: (k: string) => env[k],
    }) as unknown as ConfigService;

  it('no llama a Redis cuando el flag esta desactivado', async () => {
    const redis = { getClient: jest.fn(), incrWithExpireOnFirst: jest.fn() };
    const svc = new PaymentsV2MerchantRateLimitService(
      makeConfig({ PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'false' }),
      redis as unknown as RedisService,
    );
    await svc.consumeIfNeeded('m1', 'create');
    expect(redis.getClient).not.toHaveBeenCalled();
  });

  it('lanza 429 cuando el contador supera el limite', async () => {
    const redis = {
      getClient: jest.fn().mockReturnValue({}),
      incrWithExpireOnFirst: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3),
    };
    const env = {
      PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'true',
      PAYMENTS_V2_MERCHANT_CREATE_LIMIT: '2',
      PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC: '60',
    };
    const svc = new PaymentsV2MerchantRateLimitService(makeConfig(env), redis as unknown as RedisService);
    await svc.consumeIfNeeded('m1', 'create');
    await svc.consumeIfNeeded('m1', 'create');
    try {
      await svc.consumeIfNeeded('m1', 'create');
      throw new Error('expected HttpException');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      const ex = e as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(ex.getResponse()).toMatchObject({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Merchant rate limit exceeded',
        retryAfter: expect.any(Number),
      });
    }
    expect(redis.incrWithExpireOnFirst).toHaveBeenCalledTimes(3);
  });

  it('fail-open si Redis lanza (no propaga 429)', async () => {
    const redis = {
      getClient: jest.fn().mockReturnValue({}),
      incrWithExpireOnFirst: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
    };
    const env = {
      PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'true',
      PAYMENTS_V2_MERCHANT_CREATE_LIMIT: '1',
      PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC: '60',
    };
    const svc = new PaymentsV2MerchantRateLimitService(makeConfig(env), redis as unknown as RedisService);
    await expect(svc.consumeIfNeeded('m1', 'create')).resolves.toBeUndefined();
  });

  it('fail-open sin cliente Redis', async () => {
    const redis = {
      getClient: jest.fn().mockReturnValue(null),
      incrWithExpireOnFirst: jest.fn(),
    };
    const env = {
      PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'true',
      PAYMENTS_V2_MERCHANT_CREATE_LIMIT: '1',
      PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC: '60',
    };
    const svc = new PaymentsV2MerchantRateLimitService(makeConfig(env), redis as unknown as RedisService);
    await expect(svc.consumeIfNeeded('m1', 'create')).resolves.toBeUndefined();
    expect(redis.incrWithExpireOnFirst).not.toHaveBeenCalled();
  });

  it('no aplica capture si no hay par opcional configurado', async () => {
    const redis = {
      getClient: jest.fn().mockReturnValue({}),
      incrWithExpireOnFirst: jest.fn(),
    };
    const env = {
      PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'true',
      PAYMENTS_V2_MERCHANT_CREATE_LIMIT: '5',
      PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC: '60',
    };
    const svc = new PaymentsV2MerchantRateLimitService(makeConfig(env), redis as unknown as RedisService);
    await svc.consumeIfNeeded('m1', 'capture');
    expect(redis.incrWithExpireOnFirst).not.toHaveBeenCalled();
  });

});
