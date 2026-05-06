import request from 'supertest';
import { INestApplication } from '@nestjs/common/interfaces';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, createMerchantViaHttp, resetIntegrationDb } from './helpers/integration-app';
import { v2PaymentIntentBody } from './helpers/v2-payment-intent-body';

describe('ledger integration', () => {
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

  it('exposes pending and available balances after successful capture', async () => {
    const merchant = await createMerchantViaHttp(app);

    const created = await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send(v2PaymentIntentBody({ amount: 19.99, currency: 'EUR' }))
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v2/payments/${created.body.payment.id}/capture`)
      .set('X-API-Key', merchant.apiKey)
      .expect(201);

    const balance = await request(app.getHttpServer())
      .get('/api/v1/balance')
      .set('X-API-Key', merchant.apiKey)
      .expect(200);

    expect(Array.isArray(balance.body)).toBe(true);
    expect(balance.body.length).toBeGreaterThan(0);
    expect(balance.body[0].currency).toBe('EUR');
    expect(typeof balance.body[0].pendingMinor).toBe('number');
    expect(typeof balance.body[0].availableMinor).toBe('number');
    expect(balance.body[0].pendingMinor).toBeGreaterThan(0);
  });
});
