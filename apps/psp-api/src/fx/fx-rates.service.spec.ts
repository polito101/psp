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
});
