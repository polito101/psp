import { INestApplication } from '@nestjs/common/interfaces';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SettlementMode, SettlementStatus } from '../../src/generated/prisma/enums';
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

  it('createPayout drena backlog grande (múltiples tandas) antes de crear el payout', async () => {
    const merchant = await createMerchantViaHttp(app);

    const currency = 'EUR';
    const now = new Date('2026-04-20T12:00:00.000Z');
    const capturedAt = new Date('2026-04-19T10:00:00.000Z');
    const availableAt = new Date('2026-04-20T11:00:00.000Z'); // <= now, por tanto elegible

    const total = 520; // > RELEASE_PENDING_BATCH_SIZE (500)
    const payments = Array.from({ length: total }, (_, idx) => ({
      id: `pay_settle_backlog_${idx + 1}`,
      merchantId: merchant.id,
      amountMinor: 1_000,
      currency,
      status: 'captured',
    }));
    await prisma.payment.createMany({ data: payments });

    const settlementsData = Array.from({ length: total }, (_, idx) => ({
      paymentId: payments[idx].id,
      merchantId: merchant.id,
      currency,
      provider: 'stripe',
      settlementMode: SettlementMode.NET,
      status: SettlementStatus.PENDING,
      grossMinor: 1_000,
      feeMinor: 50,
      netMinor: 950,
      capturedAt,
      availableAt,
    }));
    await prisma.paymentSettlement.createMany({ data: settlementsData });

    const payout = await settlements.createPayout({ merchantId: merchant.id, currency, now });
    expect(payout).not.toBeNull();
    expect(payout?.settlementsCount).toBe(total);

    const pendingOrAvailable = await prisma.paymentSettlement.count({
      where: {
        merchantId: merchant.id,
        currency,
        status: { in: [SettlementStatus.PENDING, SettlementStatus.AVAILABLE] },
        payoutId: null,
      },
    });
    expect(pendingOrAvailable).toBe(0);

    const paidCount = await prisma.paymentSettlement.count({
      where: {
        merchantId: merchant.id,
        currency,
        status: SettlementStatus.PAID,
        payoutId: payout!.id,
      },
    });
    expect(paidCount).toBe(total);
  });
});
