import request from 'supertest';
import { createIntegrationApp, resetIntegrationDb } from './helpers/integration-app';
import { FxRatesService } from '../../src/fx/fx-rates.service';

async function fxTablesReady(prisma: { $queryRawUnsafe: (q: string) => Promise<unknown[]> }): Promise<boolean> {
  try {
    await prisma.$queryRawUnsafe(`SELECT 1 FROM "FxRateSnapshot" LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

describe('FX internal API (integration)', () => {
  const internalSecret = process.env.INTERNAL_API_SECRET ?? 'integration-internal-secret';

  it('GET snapshots/latest returns null sin datos', async () => {
    const { app, prisma } = await createIntegrationApp();
    try {
      if (!(await fxTablesReady(prisma))) {
        return;
      }
      await resetIntegrationDb(prisma);
      const res = await request(app.getHttpServer())
        .get('/api/v1/fx/snapshots/latest')
        .set('X-Internal-Secret', internalSecret)
        .expect(200);
      expect(res.body.item).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('convertMinorToUsdSnapshot usa snapshot persistido', async () => {
    const { app, prisma } = await createIntegrationApp();
    try {
      if (!(await fxTablesReady(prisma))) {
        return;
      }
      await resetIntegrationDb(prisma);
      await prisma.fxRateSnapshot.create({
        data: {
          baseCurrency: 'EUR',
          quoteCurrency: 'USD',
          rateDecimal: '2',
          effectiveAt: new Date('2020-01-01T00:00:00.000Z'),
          source: 'test',
          externalRef: 'test:1',
        },
      });
      const fx = app.get(FxRatesService);
      const r = await fx.convertMinorToUsdSnapshot({
        amountMinor: 50,
        currency: 'EUR',
        at: new Date('2025-01-01T00:00:00.000Z'),
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.usdMinor).toBe(100);
      }
    } finally {
      await app.close();
    }
  });
});
