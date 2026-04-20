import { INestApplication } from '@nestjs/common/interfaces';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SettlementService } from '../../src/settlements/settlement.service';
import { createIntegrationApp, createMerchantViaHttp, resetIntegrationDb } from './helpers/integration-app';

/** `createPayout({ now })` exige `now >= available_at` del settlement (T+N conserva hora del capture). */
async function payoutEligibleNow(
  prisma: PrismaService,
  merchantId: string,
  currency: string,
): Promise<Date> {
  const settlement = await prisma.paymentSettlement.findFirst({
    where: { merchantId, currency },
    orderBy: { id: 'desc' },
    select: { availableAt: true },
  });
  if (!settlement) {
    throw new Error('Se esperaba un PaymentSettlement tras el capture');
  }
  return new Date(settlement.availableAt.getTime() + 60_000);
}

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

    const now = await payoutEligibleNow(prisma, merchant.id, 'EUR');
    const first = await settlements.createPayout({
      merchantId: merchant.id,
      currency: 'EUR',
      now,
    });
    const second = await settlements.createPayout({
      merchantId: merchant.id,
      currency: 'EUR',
      now,
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('createPayout en paralelo no lanza y solo uno consume settlements', async () => {
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

    const now = await payoutEligibleNow(prisma, merchant.id, 'EUR');
    const params = { merchantId: merchant.id, currency: 'EUR', now };
    const [a, b] = await Promise.all([settlements.createPayout(params), settlements.createPayout(params)]);

    const winners = [a, b].filter((x) => x !== null);
    expect(winners).toHaveLength(1);
    expect([a, b].filter((x) => x === null)).toHaveLength(1);
  });
});
