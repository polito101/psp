import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import { FxRatesService } from './fx-rates.service';
import { FxProviderClient } from './fx-provider.client';

describe('FxRatesService', () => {
  it('convertMinorToUsdSnapshot returns USD passthrough', async () => {
    const prisma = {
      fxRateSnapshot: {
        findFirst: jest.fn(),
      },
    } as unknown as PrismaService;
    const config = {
      get: (k: string) => (k === 'FX_ENABLED' ? 'true' : undefined),
    } as unknown as ConfigService;
    const client = {} as FxProviderClient;
    const svc = new FxRatesService(prisma, config, client);
    const r = await svc.convertMinorToUsdSnapshot({
      amountMinor: 500,
      currency: 'usd',
      at: new Date(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.usdMinor).toBe(500);
      expect(r.snapshotId).toBe('n/a-usd');
    }
  });

  it('convertMinorToUsdSnapshot uses snapshot rate', async () => {
    const prisma = {
      fxRateSnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'snap1',
          rateDecimal: { toString: () => '1.25' },
        }),
      },
    } as unknown as PrismaService;
    const config = {
      get: (k: string) => (k === 'FX_ENABLED' ? 'true' : undefined),
    } as unknown as ConfigService;
    const client = {} as FxProviderClient;
    const svc = new FxRatesService(prisma, config, client);
    const r = await svc.convertMinorToUsdSnapshot({
      amountMinor: 100,
      currency: 'EUR',
      at: new Date(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.usdMinor).toBe(125);
      expect(r.snapshotId).toBe('snap1');
    }
  });

  it('getUsdSnapshotsAtOrBeforeForBases no consulta si solo USD', async () => {
    const queryRaw = jest.fn();
    const prisma = {
      fxRateSnapshot: { findFirst: jest.fn() },
      $queryRaw: queryRaw,
    } as unknown as PrismaService;
    const config = {} as unknown as ConfigService;
    const client = {} as FxProviderClient;
    const svc = new FxRatesService(prisma, config, client);
    const m = await svc.getUsdSnapshotsAtOrBeforeForBases(['USD', 'usd'], new Date());
    expect(m.size).toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('convertMinorToUsdWithPreloadedUsdSnapshots usa el mapa sin I/O', () => {
    const prisma = { fxRateSnapshot: { findFirst: jest.fn() }, $queryRaw: jest.fn() } as unknown as PrismaService;
    const config = {} as unknown as ConfigService;
    const client = {} as FxProviderClient;
    const svc = new FxRatesService(prisma, config, client);
    const at = new Date('2026-01-01T00:00:00.000Z');
    const usdSnapshotsByBase = new Map([
      ['EUR', { id: 's1', rateDecimal: { toString: () => '2' } as never }],
    ]);
    const r = svc.convertMinorToUsdWithPreloadedUsdSnapshots({
      amountMinor: 50,
      currency: 'eur',
      at,
      usdSnapshotsByBase,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.usdMinor).toBe(100);
  });

  it('convertMinorToUsdSnapshot JPY (exponent 0): mayor→mayor × minor units', async () => {
    const prisma = {
      fxRateSnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'snap-jpy',
          rateDecimal: { toString: () => '0.0065' },
        }),
      },
    } as unknown as PrismaService;
    const config = {} as unknown as ConfigService;
    const client = {} as FxProviderClient;
    const svc = new FxRatesService(prisma, config, client);
    const r = await svc.convertMinorToUsdSnapshot({
      amountMinor: 10_000,
      currency: 'JPY',
      at: new Date(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 10000 yen major × 0.0065 USD/yen = 65 USD major → 6500 USD minor (cents)
      expect(r.usdMinor).toBe(6500);
    }
  });

  it('convertMinorToUsdSnapshot KWD (exponent 3): escala fils antes de aplicar el rate', async () => {
    const prisma = {
      fxRateSnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'snap-kwd',
          rateDecimal: { toString: () => '3.26' },
        }),
      },
    } as unknown as PrismaService;
    const config = {} as unknown as ConfigService;
    const client = {} as FxProviderClient;
    const svc = new FxRatesService(prisma, config, client);
    const r = await svc.convertMinorToUsdSnapshot({
      amountMinor: 3410,
      currency: 'KWD',
      at: new Date(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 3410 fils = 3.41 KWD major × 3.26 = 11.1166 USD major → 1112 USD minor (redondeo)
      expect(r.usdMinor).toBe(1112);
    }
  });
});
