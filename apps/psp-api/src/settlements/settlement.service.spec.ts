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
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([]) // UPDATE PENDING → AVAILABLE
        .mockResolvedValueOnce([]), // SELECT … FOR UPDATE (ninguno disponible)
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
    const lockedRawRows = [
      {
        id: 'ps_1',
        gross_minor: 1000,
        fee_minor: 50,
        net_minor: 950,
        captured_at: new Date('2026-04-18T10:00:00.000Z'),
        available_at: new Date('2026-04-19T10:00:00.000Z'),
      },
      {
        id: 'ps_2',
        gross_minor: 2000,
        fee_minor: 100,
        net_minor: 1900,
        captured_at: new Date('2026-04-18T11:00:00.000Z'),
        available_at: new Date('2026-04-19T11:00:00.000Z'),
      },
    ];
    const payoutCreate = jest.fn().mockResolvedValue({
      id: 'po_1',
    });
    const claimedRelease = [
      {
        id: 'ps_1',
        merchant_id: 'm_1',
        payment_id: 'pay_1',
        currency: 'EUR',
        net_minor: 950,
      },
      {
        id: 'ps_2',
        merchant_id: 'm_1',
        payment_id: 'pay_2',
        currency: 'EUR',
        net_minor: 1900,
      },
    ];
    const tx: any = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce(claimedRelease) // UPDATE PENDING → AVAILABLE
        .mockResolvedValueOnce(lockedRawRows), // SELECT … FOR UPDATE SKIP LOCKED
      paymentSettlement: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      payout: {
        create: payoutCreate,
        delete: jest.fn(),
      },
      payoutItem: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      ledgerLine: {
        createMany: jest.fn().mockResolvedValue({ count: 5 }),
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
    expect(tx.ledgerLine.createMany).toHaveBeenCalledTimes(2);
    expect(tx.ledgerLine.createMany.mock.calls[0][0].data).toHaveLength(4);
    expect(tx.ledgerLine.createMany.mock.calls[1][0].data).toHaveLength(1);
  });
});
