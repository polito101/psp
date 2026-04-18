import { randomUUID } from 'crypto';
import request from 'supertest';
import { INestApplication } from '@nestjs/common/interfaces';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, createMerchantViaHttp, resetIntegrationDb } from './helpers/integration-app';

describe('payments-v2 integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const setup = await createIntegrationApp();
    app = setup.app;
    prisma = setup.prisma;
  });

  beforeEach(async () => {
    await resetIntegrationDb(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('devuelve X-Request-Id de entrada en la respuesta', async () => {
    const merchant = await createMerchantViaHttp(app);
    const customId = 'integration-corr-req-xyz';
    const res = await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .set('X-Request-Id', customId)
      .send({ amountMinor: 1999, currency: 'EUR' })
      .expect(201);
    expect(res.headers['x-request-id']).toBe(customId);
  });

  it('prefiere X-Request-Id sobre X-Correlation-Id cuando ambas vienen', async () => {
    const merchant = await createMerchantViaHttp(app);
    const res = await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .set('X-Request-Id', 'primary-req')
      .set('X-Correlation-Id', 'secondary-corr')
      .send({ amountMinor: 1999, currency: 'EUR' })
      .expect(201);
    expect(res.headers['x-request-id']).toBe('primary-req');
  });

  it('genera X-Request-Id cuando no hay cabeceras de correlación', async () => {
    const merchant = await createMerchantViaHttp(app);
    const res = await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send({ amountMinor: 1999, currency: 'EUR' })
      .expect(201);
    const id = res.headers['x-request-id'] as string;
    expect(id).toBeTruthy();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('creates payment and replays idempotent request with same payment id', async () => {
    const merchant = await createMerchantViaHttp(app);
    const idempotencyKey = randomUUID();
    const payload = { amountMinor: 1999, currency: 'EUR' };

    const first = await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    const replay = await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    expect(replay.body.payment.id).toBe(first.body.payment.id);
    expect(replay.body.payment.status).toBe(first.body.payment.status);
  });

  it('rejects idempotency replay with different payload', async () => {
    const merchant = await createMerchantViaHttp(app);
    const idempotencyKey = randomUUID();

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .set('Idempotency-Key', idempotencyKey)
      .send({ amountMinor: 1999, currency: 'EUR' })
      .expect(201);

    const conflict = await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .set('Idempotency-Key', idempotencyKey)
      .send({ amountMinor: 2000, currency: 'EUR' })
      .expect(409);

    expect(conflict.body.message).toContain('Idempotency key');
  });

  it('rejects idempotency replay when only stripePaymentMethodId differs', async () => {
    const merchant = await createMerchantViaHttp(app);
    const idempotencyKey = randomUUID();
    const base = {
      amountMinor: 1999,
      currency: 'EUR',
      stripePaymentMethodId: 'pm_card_visa',
      stripeReturnUrl: 'https://example.com/return',
    };

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .set('Idempotency-Key', idempotencyKey)
      .send(base)
      .expect(201);

    const conflict = await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .set('Idempotency-Key', idempotencyKey)
      .send({ ...base, stripePaymentMethodId: 'pm_card_mastercard' })
      .expect(409);

    expect(conflict.body.message).toContain('Idempotency key');
  });

  it('rejects create intent when payment link is not active', async () => {
    const merchant = await createMerchantViaHttp(app);
    const link = await prisma.paymentLink.create({
      data: {
        merchantId: merchant.id,
        slug: `lnk-used-${Date.now()}`,
        amountMinor: 1999,
        currency: 'EUR',
        status: 'used',
      },
    });

    const response = await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send({ amountMinor: 1999, currency: 'EUR', paymentLinkId: link.id })
      .expect(400);

    expect(response.body.message).toContain('Payment link is not active');
  });

  it('rejects create intent when payment link is expired', async () => {
    const merchant = await createMerchantViaHttp(app);
    const link = await prisma.paymentLink.create({
      data: {
        merchantId: merchant.id,
        slug: `lnk-expired-${Date.now()}`,
        amountMinor: 1999,
        currency: 'EUR',
        status: 'active',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const response = await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send({ amountMinor: 1999, currency: 'EUR', paymentLinkId: link.id })
      .expect(400);

    expect(response.body.message).toContain('Payment link has expired');
  });

  it('runs create -> capture -> refund and persists final status', async () => {
    const merchant = await createMerchantViaHttp(app);
    const created = await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send({ amountMinor: 1999, currency: 'EUR' })
      .expect(201);

    expect(created.body.payment.status).toBe('authorized');

    const captured = await request(app.getHttpServer())
      .post(`/api/v2/payments/${created.body.payment.id}/capture`)
      .set('X-API-Key', merchant.apiKey)
      .expect(201);
    expect(captured.body.payment.status).toBe('succeeded');

    const refunded = await request(app.getHttpServer())
      .post(`/api/v2/payments/${created.body.payment.id}/refund`)
      .set('X-API-Key', merchant.apiKey)
      .send({})
      .expect(201);
    expect(refunded.body.payment.status).toBe('refunded');

    const found = await request(app.getHttpServer())
      .get(`/api/v2/payments/${created.body.payment.id}`)
      .set('X-API-Key', merchant.apiKey)
      .expect(200);

    expect(found.body.status).toBe('refunded');
    expect(Array.isArray(found.body.attempts)).toBe(true);
    expect(found.body.attempts.length).toBeGreaterThanOrEqual(3);
  });

  it('returns hourly succeeded volume series for UTC today vs yesterday (internal)', async () => {
    const internalSecret = process.env.INTERNAL_API_SECRET ?? 'integration-internal-secret';
    const merchant = await createMerchantViaHttp(app);
    const created = await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send({ amountMinor: 1500, currency: 'EUR' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v2/payments/${created.body.payment.id}/capture`)
      .set('X-API-Key', merchant.apiKey)
      .expect(201);

    const n = new Date();
    const utcH = n.getUTCHours();
    const bucketH = utcH > 0 ? utcH - 1 : 0;
    const t0 = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), bucketH, 15, 0, 0));
    await prisma.payment.update({
      where: { id: created.body.payment.id },
      data: { succeededAt: t0 },
    });

    const vol = await request(app.getHttpServer())
      .get('/api/v2/payments/ops/transactions/volume-hourly')
      .set('X-Internal-Secret', internalSecret)
      .expect(200);

    expect(vol.body.dayBoundary).toBe('UTC');
    expect(vol.body.currency).toBe('EUR');
    expect(vol.body.todayCumulativeVolumeMinor[bucketH]).toBe('1500');
    expect(typeof vol.body.totals.todayVolumeMinor).toBe('string');
    expect(typeof vol.body.totals.yesterdayVolumeMinor).toBe('string');
    expect(
      vol.body.yesterdayCumulativeVolumeMinor.every((x: unknown) => typeof x === 'string'),
    ).toBe(true);
    expect(BigInt(vol.body.totals.todayVolumeMinor)).toBeGreaterThanOrEqual(1500n);
    expect(vol.body.yesterdayCumulativeVolumeMinor).toHaveLength(24);
  });

  it('runs create -> cancel and keeps canceled state', async () => {
    const merchant = await createMerchantViaHttp(app);
    const created = await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send({ amountMinor: 1999, currency: 'EUR' })
      .expect(201);

    const canceled = await request(app.getHttpServer())
      .post(`/api/v2/payments/${created.body.payment.id}/cancel`)
      .set('X-API-Key', merchant.apiKey)
      .expect(201);

    expect(canceled.body.payment.status).toBe('canceled');

    const found = await request(app.getHttpServer())
      .get(`/api/v2/payments/${created.body.payment.id}`)
      .set('X-API-Key', merchant.apiKey)
      .expect(200);
    expect(found.body.status).toBe('canceled');
  });
});
