import { INestApplication } from '@nestjs/common/interfaces';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SettlementService } from '../../src/settlements/settlement.service';
import { createIntegrationApp, createMerchantViaHttp, resetIntegrationDb } from './helpers/integration-app';

describe('settlements integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let settlements: SettlementService;

  beforeAll(async () => {
    const setup = await createIntegrationApp();
    app = setup.app;
    prisma = setup.prisma;
    settlements = app.get(SettlementService);
  });

  beforeEach(async () => {
    await resetIntegrationDb(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('crea payout una sola vez para los mismos settlements (idempotencia operativa)', async () => {
    const merchant = await createMerchantViaHttp(app);

    const created = await request(app.getHttpServer())
      .post('/api/v2/payments')
      .set('X-API-Key', merchant.apiKey)
      .send({ amountMinor: 1_999, currency: 'EUR' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v2/payments/${created.body.payment.id}/capture`)
      .set('X-API-Key', merchant.apiKey)
      .expect(201);

    const first = await settlements.createPayout({
      merchantId: merchant.id,
      currency: 'EUR',
      now: new Date('2026-04-20T00:00:00.000Z'),
    });
    const second = await settlements.createPayout({
      merchantId: merchant.id,
      currency: 'EUR',
      now: new Date('2026-04-20T00:00:00.000Z'),
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
