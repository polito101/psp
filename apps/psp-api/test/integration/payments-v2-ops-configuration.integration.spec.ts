import request from 'supertest';
import { INestApplication } from '@nestjs/common/interfaces';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, createMerchantViaHttp, resetIntegrationDb } from './helpers/integration-app';

describe('payments-v2 ops configuration integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const internalSecret = () => process.env.INTERNAL_API_SECRET ?? 'integration-internal-secret';

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

  it('rechaza GET /ops/configuration/providers sin X-Internal-Secret', async () => {
    await request(app.getHttpServer())
      .get('/api/v2/payments/ops/configuration/providers')
      .expect(401);
  });

  it('rechaza GET /ops/configuration/providers con secreto pero sin X-Backoffice-Role', async () => {
    await request(app.getHttpServer())
      .get('/api/v2/payments/ops/configuration/providers')
      .set('X-Internal-Secret', internalSecret())
      .expect(403);
  });

  it('rechaza GET /ops/configuration/providers con rol merchant (solo admin)', async () => {
    await request(app.getHttpServer())
      .get('/api/v2/payments/ops/configuration/providers')
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'merchant')
      .set('X-Backoffice-Merchant-Id', 'm1')
      .expect(403);
  });

  it('lista proveedores vacío y permite alta con admin', async () => {
    const empty = await request(app.getHttpServer())
      .get('/api/v2/payments/ops/configuration/providers')
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .expect(200);

    expect(Array.isArray(empty.body)).toBe(true);
    expect(empty.body).toHaveLength(0);

    const created = await request(app.getHttpServer())
      .post('/api/v2/payments/ops/configuration/providers')
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .send({
        name: 'Integration ACME',
        description: 'test',
        integrationBaseUrl: 'https://psp-acme.example',
        initPaymentResource: '/v1/payments/start',
        isConfigured: false,
        isActive: true,
        isPublished: false,
      })
      .expect(201);

    expect(created.body.id).toBeDefined();
    expect(created.body.name).toBe('Integration ACME');
    expect(created.body.integrationBaseUrl).toBe('https://psp-acme.example');
    expect(created.body.isConfigured).toBe(false);

    const list = await request(app.getHttpServer())
      .get('/api/v2/payments/ops/configuration/providers')
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .expect(200);

    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(created.body.id);
  });

  it('crea ruta, lista con filtro y actualiza peso', async () => {
    const prov = await request(app.getHttpServer())
      .post('/api/v2/payments/ops/configuration/providers')
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .send({
        name: 'Prov routes',
        integrationBaseUrl: 'https://x.example',
        initPaymentResource: '/init',
      })
      .expect(201);

    const route = await request(app.getHttpServer())
      .post('/api/v2/payments/ops/configuration/routes')
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .send({
        providerId: prov.body.id,
        methodCode: 'card',
        methodName: 'Card MX',
        countryCode: 'MX',
        channel: 'ONLINE',
        integrationMode: 'REDIRECTION',
        requestTemplate: 'REDIRECT_SIMPLE',
        weight: 10,
        currencies: [
          { currency: 'MXN', minAmount: 1, maxAmount: 100000, isDefault: true },
        ],
      })
      .expect(201);

    expect(route.body.id).toBeDefined();
    expect(route.body.weight).toBe(10);
    expect(route.body.currencies).toHaveLength(1);
    expect(route.body.currencies[0].currency).toBe('MXN');

    const filtered = await request(app.getHttpServer())
      .get('/api/v2/payments/ops/configuration/routes')
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .query({ countryCode: 'MX', providerId: prov.body.id })
      .expect(200);

    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].id).toBe(route.body.id);

    const weighted = await request(app.getHttpServer())
      .patch(`/api/v2/payments/ops/configuration/routes/${encodeURIComponent(route.body.id)}/weight`)
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .send({ weight: 42 })
      .expect(200);

    expect(weighted.body.weight).toBe(42);
  });

  it('PATCH ruta con currencies: null vacía monedas sin error', async () => {
    const prov = await request(app.getHttpServer())
      .post('/api/v2/payments/ops/configuration/providers')
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .send({
        name: 'Prov patch currencies null',
        integrationBaseUrl: 'https://y.example',
        initPaymentResource: '/init',
      })
      .expect(201);

    const route = await request(app.getHttpServer())
      .post('/api/v2/payments/ops/configuration/routes')
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .send({
        providerId: prov.body.id,
        methodCode: 'spei',
        methodName: 'SPEI',
        countryCode: 'MX',
        channel: 'ONLINE',
        integrationMode: 'REDIRECTION',
        requestTemplate: 'SPEI_BANK_TRANSFER',
        weight: 5,
        currencies: [{ currency: 'MXN', minAmount: 1, maxAmount: 999999, isDefault: true }],
      })
      .expect(201);

    expect(route.body.currencies).toHaveLength(1);

    const patched = await request(app.getHttpServer())
      .patch(`/api/v2/payments/ops/configuration/routes/${encodeURIComponent(route.body.id)}`)
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .send({ currencies: null })
      .expect(200);

    expect(Array.isArray(patched.body.currencies)).toBe(true);
    expect(patched.body.currencies).toHaveLength(0);
  });

  it('upsert provider-rates por merchant con admin', async () => {
    const merchant = await createMerchantViaHttp(app);
    const prov = await request(app.getHttpServer())
      .post('/api/v2/payments/ops/configuration/providers')
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .send({
        name: 'Prov rates',
        integrationBaseUrl: 'https://r.example',
        initPaymentResource: '/i',
      })
      .expect(201);

    const upsert = await request(app.getHttpServer())
      .post(
        `/api/v2/payments/ops/configuration/merchants/${encodeURIComponent(merchant.id)}/provider-rates`,
      )
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .send({
        providerId: prov.body.id,
        countryCode: 'es',
        percentage: 2.5,
        fixed: 0,
      })
      .expect(201);

    expect(upsert.body.merchantId).toBe(merchant.id);
    expect(upsert.body.countryCode).toBe('ES');
    expect(upsert.body.percentage).toBe('2.5');

    const listed = await request(app.getHttpServer())
      .get(
        `/api/v2/payments/ops/configuration/merchants/${encodeURIComponent(merchant.id)}/provider-rates`,
      )
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .expect(200);

    expect(Array.isArray(listed.body)).toBe(true);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].provider?.name).toBe('Prov rates');
  });

  it('POST ruta rechaza currencies con minAmount no numérico (400)', async () => {
    const prov = await request(app.getHttpServer())
      .post('/api/v2/payments/ops/configuration/providers')
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .send({
        name: 'Prov invalid currency amounts',
        integrationBaseUrl: 'https://inv.example',
        initPaymentResource: '/init',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v2/payments/ops/configuration/routes')
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .send({
        providerId: prov.body.id,
        methodCode: 'bad',
        methodName: 'Bad',
        countryCode: 'MX',
        channel: 'ONLINE',
        integrationMode: 'REDIRECTION',
        requestTemplate: 'REDIRECT_SIMPLE',
        currencies: [{ currency: 'MXN', minAmount: 'abc', maxAmount: 100 }],
      })
      .expect(400);
  });

  it('PATCH ruta rechaza currencies con minAmount > maxAmount (400)', async () => {
    const prov = await request(app.getHttpServer())
      .post('/api/v2/payments/ops/configuration/providers')
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .send({
        name: 'Prov patch range',
        integrationBaseUrl: 'https://pr.example',
        initPaymentResource: '/init',
      })
      .expect(201);

    const route = await request(app.getHttpServer())
      .post('/api/v2/payments/ops/configuration/routes')
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .send({
        providerId: prov.body.id,
        methodCode: 'ok',
        methodName: 'OK',
        countryCode: 'MX',
        channel: 'ONLINE',
        integrationMode: 'REDIRECTION',
        requestTemplate: 'REDIRECT_SIMPLE',
        currencies: [{ currency: 'MXN', minAmount: 1, maxAmount: 100 }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v2/payments/ops/configuration/routes/${encodeURIComponent(route.body.id)}`)
      .set('X-Internal-Secret', internalSecret())
      .set('X-Backoffice-Role', 'admin')
      .send({ currencies: [{ currency: 'MXN', minAmount: 500, maxAmount: 10 }] })
      .expect(400);
  });
});
