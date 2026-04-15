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
