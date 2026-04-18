import { SettlementService } from './settlement.service';

describe('SettlementService', () => {
  it('computeAvailableAt T+1 mueve 1 día', () => {
    const capturedAt = new Date('2026-04-18T10:00:00.000Z');
    const availableAt = SettlementService.computeAvailableAt(capturedAt, 'T_PLUS_N', 1);
    expect(availableAt.toISOString()).toBe('2026-04-19T10:00:00.000Z');
  });

  it('computeAvailableAt WEEKLY calcula siguiente día de semana configurado', () => {
    // 2026-04-18 es sábado (6); configuramos lunes (1).
    const capturedAt = new Date('2026-04-18T10:00:00.000Z');
    const availableAt = SettlementService.computeAvailableAt(capturedAt, 'WEEKLY', 1);
    expect(availableAt.toISOString()).toBe('2026-04-20T10:00:00.000Z');
  });

  it('createPayout devuelve null cuando no hay settlements disponibles', async () => {
    const tx: any = {
      paymentSettlement: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const prisma: any = {
      ...tx,
      $transaction: jest.fn(async (fn: (trx: unknown) => Promise<unknown>) => fn(tx)),
    };
    const service = new SettlementService(prisma as never);

    const result = await service.createPayout({
      merchantId: 'm_1',
      currency: 'EUR',
      now: new Date('2026-04-20T00:00:00.000Z'),
    });

    expect(result).toBeNull();
  });

  it('createPayout agrupa disponibles y marca settlements como PAID', async () => {
    const settlements = [
      {
        id: 'ps_1',
        merchantId: 'm_1',
        currency: 'EUR',
        grossMinor: 1000,
        feeMinor: 50,
        netMinor: 950,
        capturedAt: new Date('2026-04-18T10:00:00.000Z'),
        availableAt: new Date('2026-04-19T10:00:00.000Z'),
      },
      {
        id: 'ps_2',
        merchantId: 'm_1',
        currency: 'EUR',
        grossMinor: 2000,
        feeMinor: 100,
        netMinor: 1900,
        capturedAt: new Date('2026-04-18T11:00:00.000Z'),
        availableAt: new Date('2026-04-19T11:00:00.000Z'),
      },
    ];
    const payoutCreate = jest.fn().mockResolvedValue({
      id: 'po_1',
    });
    const tx: any = {
      paymentSettlement: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue(settlements),
      },
      payout: {
        create: payoutCreate,
      },
      payoutItem: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      ledgerLine: {
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
    };
    const prisma: any = {
      ...tx,
      $transaction: jest.fn(async (fn: (trx: unknown) => Promise<unknown>) => fn(tx)),
    };
    const service = new SettlementService(prisma as never);

    const result = await service.createPayout({
      merchantId: 'm_1',
      currency: 'EUR',
      now: new Date('2026-04-20T00:00:00.000Z'),
    });

    expect(payoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          merchantId: 'm_1',
          currency: 'EUR',
          grossMinor: 3000,
          feeMinor: 150,
          netMinor: 2850,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'po_1',
        settlementsCount: 2,
        netMinor: 2850,
      }),
    );
  });
});
