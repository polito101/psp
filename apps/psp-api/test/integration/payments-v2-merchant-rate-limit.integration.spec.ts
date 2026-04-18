import { randomUUID } from 'crypto';
import request from 'supertest';
import { INestApplication } from '@nestjs/common/interfaces';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, createMerchantViaHttp, resetIntegrationDb } from './helpers/integration-app';

describe('payments-v2 merchant rate limit (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    saved.PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED = process.env.PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED;
    saved.PAYMENTS_V2_MERCHANT_CREATE_LIMIT = process.env.PAYMENTS_V2_MERCHANT_CREATE_LIMIT;
    saved.PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC = process.env.PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC;

    process.env.PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED = 'true';
    process.env.PAYMENTS_V2_MERCHANT_CREATE_LIMIT = '2';
    process.env.PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC = '600';

    const setup = await createIntegrationApp();
    app = setup.app;
    prisma = setup.prisma;
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
    const base = { currency: 'EUR' as const };

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send({ ...base, amountMinor: 101 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send({ ...base, amountMinor: 102 })
      .expect(201);

    const limited = await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send({ ...base, amountMinor: 103 })
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
    const base = { amountMinor: 200, currency: 'EUR' as const };

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .set('Idempotency-Key', idem)
      .send(base)
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .set('Idempotency-Key', idem)
      .send(base)
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send({ ...base, amountMinor: 201 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send({ ...base, amountMinor: 202 })
      .expect(429);
  });
});
