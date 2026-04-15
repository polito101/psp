import request from 'supertest';
import { INestApplication } from '@nestjs/common/interfaces';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, createMerchantViaHttp, resetIntegrationDb } from './helpers/integration-app';

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

  it('returns ops metrics snapshot with internal secret', async () => {
    const internalSecret = process.env.INTERNAL_API_SECRET ?? 'integration-internal-secret';
    const response = await request(app.getHttpServer())
      .get('/api/v2/payments/ops/metrics')
      .set('X-Internal-Secret', internalSecret)
      .expect(200);

    expect(response.body.payments).toBeDefined();
    expect(response.body.webhooks).toBeDefined();
    expect(response.body.circuitBreakers).toBeDefined();
  });

  it('returns internal transaction monitor list with filters and last attempt', async () => {
    const internalSecret = process.env.INTERNAL_API_SECRET ?? 'integration-internal-secret';
    const merchant = await createMerchantViaHttp(app);

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send({ amountMinor: 1999, currency: 'EUR', provider: 'mock' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send({ amountMinor: 2500, currency: 'EUR', provider: 'mock' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get('/api/v2/payments/ops/transactions')
      .set('X-Internal-Secret', internalSecret)
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

  it('returns null totals when includeTotal=false', async () => {
    const internalSecret = process.env.INTERNAL_API_SECRET ?? 'integration-internal-secret';
    const merchant = await createMerchantViaHttp(app);

    await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send({ amountMinor: 100, currency: 'EUR', provider: 'mock' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get('/api/v2/payments/ops/transactions')
      .set('X-Internal-Secret', internalSecret)
      .query({ merchantId: merchant.id, pageSize: 5, includeTotal: 'false' })
      .expect(200);

    expect(response.body.page.total).toBeNull();
    expect(response.body.page.totalPages).toBeNull();
    expect(response.body.page.hasNextPage).toBe(false);
    expect(Array.isArray(response.body.items)).toBe(true);
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
