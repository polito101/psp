import request from 'supertest';
import { INestApplication } from '@nestjs/common/interfaces';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, createMerchantViaHttp, resetIntegrationDb } from './helpers/integration-app';
import { v2PaymentIntentBody } from './helpers/v2-payment-intent-body';

describe('internal/webhooks integration', () => {
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

  it('protects ops metrics with internal secret', async () => {
    await request(app.getHttpServer()).get('/api/v2/payments/ops/metrics').expect(401);
  });

  it('rejects ops metrics with secret but without X-Backoffice-Role', async () => {
    const internalSecret = process.env.INTERNAL_API_SECRET ?? 'integration-internal-secret';
    await request(app.getHttpServer())
      .get('/api/v2/payments/ops/metrics')
      .set('X-Internal-Secret', internalSecret)
      .expect(403);
  });

  it('returns ops metrics snapshot with internal secret', async () => {
    const internalSecret = process.env.INTERNAL_API_SECRET ?? 'integration-internal-secret';
    const response = await request(app.getHttpServer())
      .get('/api/v2/payments/ops/metrics')
      .set('X-Internal-Secret', internalSecret)
      .set('X-Backoffice-Role', 'admin')
      .expect(200);

    expect(response.body.payments).toBeDefined();
    expect(response.body.merchantIsActiveFresh).toBeDefined();
    expect(response.body.webhooks).toBeDefined();
    expect(response.body.circuitBreakers).toBeDefined();
  });

  it('returns internal transaction monitor list with filters and last attempt', async () => {
    const internalSecret = process.env.INTERNAL_API_SECRET ?? 'integration-internal-secret';
    const merchant = await createMerchantViaHttp(app);

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send(v2PaymentIntentBody({ amount: 19.99, currency: 'EUR' }))
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send(v2PaymentIntentBody({ amount: 25, currency: 'EUR' }))
      .expect(201);

    const response = await request(app.getHttpServer())
      .get('/api/v2/payments/ops/transactions')
      .set('X-Internal-Secret', internalSecret)
      .set('X-Backoffice-Role', 'admin')
      .query({ merchantId: merchant.id, pageSize: 5, provider: 'mock' })
      .expect(200);

    expect(Array.isArray(response.body.items)).toBe(true);
    expect(response.body.items.length).toBeGreaterThanOrEqual(2);
    expect(response.body.page.total).toBeGreaterThanOrEqual(2);
    expect(response.body.items[0].merchantId).toBe(merchant.id);
    expect(response.body.items[0].lastAttempt).toBeDefined();
    expect(response.body.items[0].selectedProvider).toBe('mock');
    expect(response.body.cursors).toBeDefined();
  });

  it('returns grouped status counts in one response for ops transactions', async () => {
    const internalSecret = process.env.INTERNAL_API_SECRET ?? 'integration-internal-secret';
    const merchant = await createMerchantViaHttp(app);

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send(v2PaymentIntentBody({ amount: 1, currency: 'EUR' }))
      .expect(201);

    const response = await request(app.getHttpServer())
      .get('/api/v2/payments/ops/transactions/counts')
      .set('X-Internal-Secret', internalSecret)
      .set('X-Backoffice-Role', 'admin')
      .query({ merchantId: merchant.id })
      .expect(200);

    expect(typeof response.body.total).toBe('number');
    expect(response.body.total).toBeGreaterThanOrEqual(1);
    expect(response.body.byStatus).toBeDefined();
    const sum = Object.values(response.body.byStatus as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(sum).toBe(response.body.total);
  });

  it('returns null totals when includeTotal=false', async () => {
    const internalSecret = process.env.INTERNAL_API_SECRET ?? 'integration-internal-secret';
    const merchant = await createMerchantViaHttp(app);

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send(v2PaymentIntentBody({ amount: 1, currency: 'EUR' }))
      .expect(201);

    const response = await request(app.getHttpServer())
      .get('/api/v2/payments/ops/transactions')
      .set('X-Internal-Secret', internalSecret)
      .set('X-Backoffice-Role', 'admin')
      .query({ merchantId: merchant.id, pageSize: 5, includeTotal: 'false' })
      .expect(200);

    expect(response.body.page.total).toBeNull();
    expect(response.body.page.totalPages).toBeNull();
    expect(response.body.page.hasNextPage).toBe(false);
    expect(Array.isArray(response.body.items)).toBe(true);
  });

  it('filters ops transactions by paymentId substring on internal id', async () => {
    const internalSecret = process.env.INTERNAL_API_SECRET ?? 'integration-internal-secret';
    const merchant = await createMerchantViaHttp(app);

    const first = await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send(v2PaymentIntentBody({ amount: 1, currency: 'EUR' }))
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send(v2PaymentIntentBody({ amount: 2, currency: 'EUR' }))
      .expect(201);

    const paymentId = first.body.payment.id as string;
    const prefix = paymentId.slice(0, 8);

    const response = await request(app.getHttpServer())
      .get('/api/v2/payments/ops/transactions')
      .set('X-Internal-Secret', internalSecret)
      .set('X-Backoffice-Role', 'admin')
      .query({ merchantId: merchant.id, paymentId: prefix, pageSize: 10, provider: 'mock' })
      .expect(200);

    const items = response.body.items as Array<{ id: string }>;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.every((row) => row.id.toLowerCase().includes(prefix.toLowerCase()))).toBe(true);
    expect(items.some((row) => row.id === paymentId)).toBe(true);
  });

  it('requeues failed webhook deliveries from internal endpoint', async () => {
    const internalSecret = process.env.INTERNAL_API_SECRET ?? 'integration-internal-secret';
    const merchant = await createMerchantViaHttp(app);
    const failed = await prisma.webhookDelivery.create({
      data: {
        merchantId: merchant.id,
        eventType: 'payment.captured',
        payload: { paymentId: 'pay_test' },
        status: 'failed',
        attempts: 3,
        lastError: 'HTTP 500',
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/webhooks/deliveries/${failed.id}/retry`)
      .set('X-Internal-Secret', internalSecret)
      .expect(201);

    expect(response.body.status).toBe('pending');

    const updated = await prisma.webhookDelivery.findUnique({
      where: { id: failed.id },
      select: { status: true, attempts: true, lastError: true },
    });
    expect(updated?.status).toBe('pending');
    expect(updated?.attempts).toBe(0);
    expect(updated?.lastError).toBeNull();
  });
});
