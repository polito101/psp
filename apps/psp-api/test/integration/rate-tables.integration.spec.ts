import request from 'supertest';
import { INestApplication } from '@nestjs/common/interfaces';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, createMerchantViaHttp, resetIntegrationDb } from './helpers/integration-app';

describe('merchant rate tables integration', () => {
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

  it('requires internal secret to create rate table', async () => {
    const merchant = await createMerchantViaHttp(app);

    await request(app.getHttpServer())
      .post(`/api/v1/merchants/${merchant.id}/rate-tables`)
      .send({
        provider: 'mock',
        currency: 'EUR',
        percentageBps: 150,
        fixedMinor: 25,
        minimumMinor: 50,
        settlementMode: 'NET',
        payoutScheduleType: 'T_PLUS_N',
        payoutScheduleParam: 1,
      })
      .expect(401);
  });

  it('creates and lists rate tables for merchant/provider', async () => {
    const merchant = await createMerchantViaHttp(app);
    const internalSecret = process.env.INTERNAL_API_SECRET ?? 'integration-internal-secret';

    const created = await request(app.getHttpServer())
      .post(`/api/v1/merchants/${merchant.id}/rate-tables`)
      .set('X-Internal-Secret', internalSecret)
      .send({
        provider: 'mock',
        currency: 'EUR',
        percentageBps: 150,
        fixedMinor: 25,
        minimumMinor: 50,
        settlementMode: 'NET',
        payoutScheduleType: 'T_PLUS_N',
        payoutScheduleParam: 1,
      });

    expect(created.status).toBe(201);

    const listed = await request(app.getHttpServer())
      .get(`/api/v1/merchants/${merchant.id}/rate-tables`)
      .set('X-Internal-Secret', internalSecret)
      .expect(200);

    expect(Array.isArray(listed.body)).toBe(true);
    expect(listed.body[0]).toMatchObject({
      merchantId: merchant.id,
      provider: 'mock',
      currency: 'EUR',
      percentageBps: 150,
    });
  });
});
