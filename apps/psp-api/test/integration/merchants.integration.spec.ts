import request from 'supertest';
import { INestApplication } from '@nestjs/common/interfaces';
import { PrismaService } from '../../src/prisma/prisma.service';
import { MerchantsService } from '../../src/merchants/merchants.service';
import { createIntegrationApp, createMerchantViaHttp, resetIntegrationDb } from './helpers/integration-app';

describe('merchants integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let merchantsService: MerchantsService;

  beforeAll(async () => {
    const setup = await createIntegrationApp();
    app = setup.app;
    prisma = setup.prisma;
    merchantsService = setup.merchants;
  });

  beforeEach(async () => {
    await resetIntegrationDb(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires internal secret to create merchants', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/merchants')
      .send({ name: 'Unauthorized Merchant' })
      .expect(401);
  });

  it('creates merchants and allows API key to call protected route', async () => {
    const merchant = await createMerchantViaHttp(app, { keyTtlDays: 30 });

    expect(merchant.id).toBeDefined();
    expect(merchant.apiKey.startsWith('psp.')).toBe(true);
    expect(merchant.apiKeyExpiresAt).not.toBeNull();

    const balance = await request(app.getHttpServer())
      .get('/api/v1/balance')
      .set('X-API-Key', merchant.apiKey)
      .expect(200);

    expect(Array.isArray(balance.body)).toBe(true);
  });

  it('revokes old key and rotates to a valid new key', async () => {
    const merchant = await createMerchantViaHttp(app);

    await merchantsService.revokeApiKey(merchant.id);

    await request(app.getHttpServer())
      .get('/api/v1/balance')
      .set('X-API-Key', merchant.apiKey)
      .expect(401);

    const rotated = await merchantsService.rotateApiKey(merchant.id, 7);

    expect(rotated.apiKey.startsWith('psp.')).toBe(true);
    expect(rotated.apiKey).not.toBe(merchant.apiKey);
    expect(rotated.apiKeyExpiresAt).not.toBeNull();

    await request(app.getHttpServer())
      .get('/api/v1/balance')
      .set('X-API-Key', rotated.apiKey)
      .expect(200);
  });
});
