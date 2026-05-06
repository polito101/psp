import { randomUUID } from 'crypto';
import request from 'supertest';
import { INestApplication } from '@nestjs/common/interfaces';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { PaymentsV2MerchantRateLimitService } from '../../src/payments-v2/payments-v2-merchant-rate-limit.service';
import { createIntegrationApp, createMerchantViaHttp, resetIntegrationDb } from './helpers/integration-app';
import { v2PaymentIntentBody } from './helpers/v2-payment-intent-body';

describe('payments-v2 merchant rate limit (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    saved.PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED = process.env.PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED;
    saved.PAYMENTS_V2_MERCHANT_CREATE_LIMIT = process.env.PAYMENTS_V2_MERCHANT_CREATE_LIMIT;
    saved.PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC = process.env.PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC;
    saved.PAYMENTS_V2_MERCHANT_RL_REDIS_OP_TIMEOUT_MS = process.env.PAYMENTS_V2_MERCHANT_RL_REDIS_OP_TIMEOUT_MS;
    saved.PAYMENTS_V2_MERCHANT_RL_FAIL_OPEN_BACKOFF_MS = process.env.PAYMENTS_V2_MERCHANT_RL_FAIL_OPEN_BACKOFF_MS;

    process.env.PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED = 'true';
    process.env.PAYMENTS_V2_MERCHANT_CREATE_LIMIT = '2';
    process.env.PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC = '600';
    /**
     * El límite merchant hace fail-open si Redis falla o si ioredis corta el INCR (`commandTimeout`, default 150 ms).
     * Con lazyConnect, el primer comando en CI puede superar 150 ms → circuito fail-open → nunca 429.
     */
    process.env.PAYMENTS_V2_MERCHANT_RL_REDIS_OP_TIMEOUT_MS = '5000';
    process.env.PAYMENTS_V2_MERCHANT_RL_FAIL_OPEN_BACKOFF_MS = '5000';

    const setup = await createIntegrationApp();
    app = setup.app;
    prisma = setup.prisma;

    const redis = app.get(RedisService).getClient();
    if (!redis) {
      throw new Error(
        'REDIS_URL debe estar definido para estos tests: sin cliente Redis el rate limit hace fail-open y no se devuelve 429.',
      );
    }
    try {
      await redis.ping();
    } catch (e) {
      const urlHint = (process.env.REDIS_URL ?? '').replace(/:[^:@/]+@/, ':****@');
      throw new Error(
        `Redis no responde en REDIS_URL=${urlHint || '(vacío)'}. ` +
          'Arranca Redis (p. ej. en la raíz del repo: `docker compose up -d`) y vuelve a ejecutar los tests. ' +
          `Causa: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const cfg = app.get(ConfigService);
    const rl = app.get(PaymentsV2MerchantRateLimitService) as unknown as {
      enabled: boolean;
      createRule: { limit: number; windowSec: number } | null;
    };
    expect(cfg.get<string>('PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED')).toBe('true');
    expect(cfg.get<string>('PAYMENTS_V2_MERCHANT_CREATE_LIMIT')).toBe('2');
    expect(rl.enabled).toBe(true);
    expect(rl.createRule?.limit).toBe(2);
  });

  beforeEach(async () => {
    await resetIntegrationDb(prisma);
  });

  afterAll(async () => {
    await app.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('429 tras superar el tope de create por merchant; cuerpo con retryAfter', async () => {
    const merchant = await createMerchantViaHttp(app);

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send(v2PaymentIntentBody({ amount: 1.01, currency: 'EUR' }))
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send(v2PaymentIntentBody({ amount: 1.02, currency: 'EUR' }))
      .expect(201);

    const limited = await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send(v2PaymentIntentBody({ amount: 1.03, currency: 'EUR' }))
      .expect(429);

    expect(limited.body.message).toBe('Merchant rate limit exceeded');
    expect(typeof limited.body.retryAfter).toBe('number');
    expect(limited.body.retryAfter).toBeGreaterThanOrEqual(1);
  });

  /**
   * Con limite 2: primer create consume 1; replay idempotente no incrementa;
   * tercer create (nueva clave) consume 2; el cuarto debe 429.
   */
  it('replays idempotentes de create no consumen cupo extra', async () => {
    const merchant = await createMerchantViaHttp(app);
    const idem = randomUUID();

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .set('Idempotency-Key', idem)
      .send(v2PaymentIntentBody({ amount: 2, currency: 'EUR' }))
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .set('Idempotency-Key', idem)
      .send(v2PaymentIntentBody({ amount: 2, currency: 'EUR' }))
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send(v2PaymentIntentBody({ amount: 2.01, currency: 'EUR' }))
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send(v2PaymentIntentBody({ amount: 2.02, currency: 'EUR' }))
      .expect(429);
  });
});
