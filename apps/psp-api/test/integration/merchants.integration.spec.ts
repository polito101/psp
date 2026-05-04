import request from 'supertest';
import { INestApplication } from '@nestjs/common/interfaces';
import { PrismaService } from '../../src/prisma/prisma.service';
import { MerchantsService } from '../../src/merchants/merchants.service';
import { createIntegrationApp, createMerchantViaHttp, resetIntegrationDb } from './helpers/integration-app';

function internalOpsHeaders(): Record<string, string> {
  const internalSecret = process.env.INTERNAL_API_SECRET ?? 'integration-internal-secret';
  return {
    'X-Internal-Secret': internalSecret,
    'X-Backoffice-Role': 'admin',
  };
}

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

  it('GET ops detail returns merchant shape and empty onboarding for bootstrap merchant', async () => {
    const created = await createMerchantViaHttp(app);
    const merchantId = created.id;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/merchants/ops/${merchantId}/detail`)
      .set(internalOpsHeaders())
      .expect(200);

    expect(res.body.merchant).toEqual(
      expect.objectContaining({
        id: merchantId,
        mid: expect.stringMatching(/^\d{6}$/),
        name: expect.any(String),
        registrationStatus: 'LEAD',
        industry: 'OTHER',
      }),
    );
    expect(res.body).toEqual(
      expect.objectContaining({
        latestOnboardingApplication: null,
        onboardingEvents: [],
        paymentMethods: expect.any(Array),
      }),
    );
  });

  it('PATCH ops account succeeds with normalized email and expected fields', async () => {
    const created = await createMerchantViaHttp(app);

    const patch = {
      name: 'Levels Ltd',
      email: 'Support@LevelsSocials.com',
      contactName: 'Support Team',
      contactPhone: '+34600000000',
      websiteUrl: 'https://levelssocials.com',
      isActive: true,
      registrationStatus: 'LEAD',
      registrationNumber: '2024-00069',
      industry: 'FOREX',
    };

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/merchants/ops/${created.id}/account`)
      .set(internalOpsHeaders())
      .send(patch)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        name: 'Levels Ltd',
        email: 'support@levelssocials.com',
        contactName: 'Support Team',
        contactPhone: '+34600000000',
        websiteUrl: 'https://levelssocials.com',
        isActive: true,
        registrationStatus: 'LEAD',
        registrationNumber: '2024-00069',
        industry: 'FOREX',
      }),
    );
    expect(res.body.mid).toMatch(/^\d{6}$/);
  });

  it('PATCH ops account returns 409 when email duplicates another merchant', async () => {
    const a = await createMerchantViaHttp(app);
    const b = await createMerchantViaHttp(app);

    await request(app.getHttpServer())
      .patch(`/api/v1/merchants/ops/${a.id}/account`)
      .set(internalOpsHeaders())
      .send({ email: 'dupe@example.com' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/merchants/ops/${b.id}/account`)
      .set(internalOpsHeaders())
      .send({ email: 'dupe@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.message).toBeDefined();
  });
});
