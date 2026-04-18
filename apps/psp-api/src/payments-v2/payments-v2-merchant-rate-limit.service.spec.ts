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
    const redis = { getClient: jest.fn(), incrWithExpireOnFirstForMerchantRateLimit: jest.fn() };
    const svc = new PaymentsV2MerchantRateLimitService(
      makeConfig({ PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'false' }),
      redis as unknown as RedisService,
    );
    await svc.consumeIfNeeded('m1', 'create');
    expect(redis.getClient).not.toHaveBeenCalled();
  });

  it('si Redis falla tras INCRs previos exitosos, el fallback en memoria aun puede 429 en la misma peticion', async () => {
    const redis = {
      getClient: jest.fn().mockReturnValue({}),
      incrWithExpireOnFirstForMerchantRateLimit: jest
        .fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2)
        .mockRejectedValueOnce(new Error('ECONNRESET')),
    };
    const env = {
      PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'true',
      PAYMENTS_V2_MERCHANT_CREATE_LIMIT: '2',
      PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC: '60',
      PAYMENTS_V2_MERCHANT_RL_FAIL_OPEN_BACKOFF_MS: '60000',
    };
    const svc = new PaymentsV2MerchantRateLimitService(makeConfig(env), redis as unknown as RedisService);
    await svc.consumeIfNeeded('m1', 'create');
    await svc.consumeIfNeeded('m1', 'create');
    try {
      await svc.consumeIfNeeded('m1', 'create');
      throw new Error('expected HttpException');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
    expect(redis.incrWithExpireOnFirstForMerchantRateLimit).toHaveBeenCalledTimes(3);
  });

  it('lanza 429 cuando el contador supera el limite', async () => {
    const redis = {
      getClient: jest.fn().mockReturnValue({}),
      incrWithExpireOnFirstForMerchantRateLimit: jest
        .fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(3),
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
    expect(redis.incrWithExpireOnFirstForMerchantRateLimit).toHaveBeenCalledTimes(3);
  });

  it('un fallo Redis en un merchant no abre el circuito de backoff de otro merchant', async () => {
    const redis = {
      getClient: jest.fn().mockReturnValue({}),
      incrWithExpireOnFirstForMerchantRateLimit: jest
        .fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2),
    };
    const env = {
      PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'true',
      PAYMENTS_V2_MERCHANT_CREATE_LIMIT: '10',
      PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC: '60',
      PAYMENTS_V2_MERCHANT_RL_FAIL_OPEN_BACKOFF_MS: '60000',
    };
    const svc = new PaymentsV2MerchantRateLimitService(makeConfig(env), redis as unknown as RedisService);
    await expect(svc.consumeIfNeeded('m1', 'create')).resolves.toBeUndefined();
    expect(redis.incrWithExpireOnFirstForMerchantRateLimit).toHaveBeenCalledTimes(1);

    await expect(svc.consumeIfNeeded('m2', 'create')).resolves.toBeUndefined();
    expect(redis.incrWithExpireOnFirstForMerchantRateLimit).toHaveBeenCalledTimes(2);

    await expect(svc.consumeIfNeeded('m2', 'create')).resolves.toBeUndefined();
    expect(redis.incrWithExpireOnFirstForMerchantRateLimit).toHaveBeenCalledTimes(3);
  });

  it('fail-open si Redis lanza (no propaga 429)', async () => {
    const redis = {
      getClient: jest.fn().mockReturnValue({}),
      incrWithExpireOnFirstForMerchantRateLimit: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
    };
    const env = {
      PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'true',
      PAYMENTS_V2_MERCHANT_CREATE_LIMIT: '1',
      PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC: '60',
    };
    const svc = new PaymentsV2MerchantRateLimitService(makeConfig(env), redis as unknown as RedisService);
    await expect(svc.consumeIfNeeded('m1', 'create')).resolves.toBeUndefined();
  });

  it('durante fail-open aplica cuota en memoria por merchant y puede devolver 429', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_717_243_200_000);
    const redis = {
      getClient: jest.fn().mockReturnValue({}),
      incrWithExpireOnFirstForMerchantRateLimit: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
    };
    const env = {
      PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'true',
      PAYMENTS_V2_MERCHANT_CREATE_LIMIT: '2',
      PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC: '60',
      PAYMENTS_V2_MERCHANT_RL_FAIL_OPEN_BACKOFF_MS: '10000',
    };
    const svc = new PaymentsV2MerchantRateLimitService(makeConfig(env), redis as unknown as RedisService);
    await expect(svc.consumeIfNeeded('m1', 'create')).resolves.toBeUndefined();
    await expect(svc.consumeIfNeeded('m1', 'create')).resolves.toBeUndefined();
    try {
      await svc.consumeIfNeeded('m1', 'create');
      throw new Error('expected HttpException');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
    expect(redis.incrWithExpireOnFirstForMerchantRateLimit).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('tras fail-open por Redis no vuelve a llamar INCR hasta pasar el backoff (circuito local)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_717_243_200_000);
    const redis = {
      getClient: jest.fn().mockReturnValue({}),
      incrWithExpireOnFirstForMerchantRateLimit: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
    };
    const env = {
      PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'true',
      PAYMENTS_V2_MERCHANT_CREATE_LIMIT: '10',
      PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC: '60',
      PAYMENTS_V2_MERCHANT_RL_FAIL_OPEN_BACKOFF_MS: '10000',
    };
    const svc = new PaymentsV2MerchantRateLimitService(makeConfig(env), redis as unknown as RedisService);
    await expect(svc.consumeIfNeeded('m1', 'create')).resolves.toBeUndefined();
    expect(redis.incrWithExpireOnFirstForMerchantRateLimit).toHaveBeenCalledTimes(1);

    await expect(svc.consumeIfNeeded('m1', 'create')).resolves.toBeUndefined();
    expect(redis.incrWithExpireOnFirstForMerchantRateLimit).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(9_999);
    await expect(svc.consumeIfNeeded('m1', 'create')).resolves.toBeUndefined();
    expect(redis.incrWithExpireOnFirstForMerchantRateLimit).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    await expect(svc.consumeIfNeeded('m1', 'create')).resolves.toBeUndefined();
    expect(redis.incrWithExpireOnFirstForMerchantRateLimit).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('fail-open si ioredis corta el INCR por command timeout', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_717_243_200_000);
    const redis = {
      getClient: jest.fn().mockReturnValue({}),
      incrWithExpireOnFirstForMerchantRateLimit: jest.fn().mockRejectedValue(new Error('Command timed out')),
    };
    const env = {
      PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'true',
      PAYMENTS_V2_MERCHANT_CREATE_LIMIT: '10',
      PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC: '60',
      PAYMENTS_V2_MERCHANT_RL_FAIL_OPEN_BACKOFF_MS: '60000',
    };
    const svc = new PaymentsV2MerchantRateLimitService(makeConfig(env), redis as unknown as RedisService);
    await expect(svc.consumeIfNeeded('m1', 'create')).resolves.toBeUndefined();
    expect(redis.incrWithExpireOnFirstForMerchantRateLimit).toHaveBeenCalledTimes(1);

    await expect(svc.consumeIfNeeded('m1', 'create')).resolves.toBeUndefined();
    expect(redis.incrWithExpireOnFirstForMerchantRateLimit).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  it('fail-open sin cliente Redis', async () => {
    const redis = {
      getClient: jest.fn().mockReturnValue(null),
      incrWithExpireOnFirstForMerchantRateLimit: jest.fn(),
    };
    const env = {
      PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'true',
      PAYMENTS_V2_MERCHANT_CREATE_LIMIT: '1',
      PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC: '60',
    };
    const svc = new PaymentsV2MerchantRateLimitService(makeConfig(env), redis as unknown as RedisService);
    await expect(svc.consumeIfNeeded('m1', 'create')).resolves.toBeUndefined();
    expect(redis.incrWithExpireOnFirstForMerchantRateLimit).not.toHaveBeenCalled();
  });

  it('purga estado huérfano por TTL sin que el mismo merchant+op vuelva a ejecutarse', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000_000);
    const redis = {
      getClient: jest.fn().mockReturnValue({}),
      incrWithExpireOnFirstForMerchantRateLimit: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
    };
    const env = {
      PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'true',
      PAYMENTS_V2_MERCHANT_CREATE_LIMIT: '10',
      PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC: '2',
      /** 1000 queda por debajo del mínimo del servicio (5000ms); purge ≈ T + 5000 + 2000ms */
      PAYMENTS_V2_MERCHANT_RL_FAIL_OPEN_BACKOFF_MS: '1000',
      PAYMENTS_V2_MERCHANT_RL_STATE_MAX_TTL_MS: '120000',
    };
    const svc = new PaymentsV2MerchantRateLimitService(makeConfig(env), redis as unknown as RedisService);

    await expect(svc.consumeIfNeeded('m-orphan', 'create')).resolves.toBeUndefined();
    expect(redis.incrWithExpireOnFirstForMerchantRateLimit).toHaveBeenCalledTimes(1);

    jest.setSystemTime(1_000_000_000 + 8_000);
    redis.incrWithExpireOnFirstForMerchantRateLimit.mockResolvedValueOnce(1);
    await expect(svc.consumeIfNeeded('m-other', 'create')).resolves.toBeUndefined();
    expect(redis.incrWithExpireOnFirstForMerchantRateLimit).toHaveBeenCalledTimes(2);

    const circuitMap = (svc as unknown as { circuitByMerchantOp: Map<string, unknown> }).circuitByMerchantOp;
    expect(circuitMap.has('m-orphan:create')).toBe(false);

    await expect(svc.consumeIfNeeded('m-orphan', 'create')).resolves.toBeUndefined();
    expect(redis.incrWithExpireOnFirstForMerchantRateLimit).toHaveBeenCalledTimes(3);

    jest.useRealTimers();
  });

  it('no aplica capture si no hay par opcional configurado', async () => {
    const redis = {
      getClient: jest.fn().mockReturnValue({}),
      incrWithExpireOnFirstForMerchantRateLimit: jest.fn(),
    };
    const env = {
      PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'true',
      PAYMENTS_V2_MERCHANT_CREATE_LIMIT: '5',
      PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC: '60',
    };
    const svc = new PaymentsV2MerchantRateLimitService(makeConfig(env), redis as unknown as RedisService);
    await svc.consumeIfNeeded('m1', 'capture');
    expect(redis.incrWithExpireOnFirstForMerchantRateLimit).not.toHaveBeenCalled();
  });
});
