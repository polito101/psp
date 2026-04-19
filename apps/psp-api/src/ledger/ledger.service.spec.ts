import { LedgerService } from './ledger.service';

describe('LedgerService', () => {
  it('feeAmount floors bps correctly', () => {
    expect(LedgerService.feeAmount(10_000, 290)).toBe(290);
    expect(LedgerService.feeAmount(199, 290)).toBe(5);
    expect(LedgerService.feeAmount(100, 1)).toBe(0);
  });

  it('recordSuccessfulRefund usa merchant_pending cuando el pago ya tiene asientos pending', async () => {
    const findFirst = jest.fn().mockResolvedValue({ entryType: 'merchant_pending' });
    const create = jest.fn().mockResolvedValue(undefined);
    const service = new LedgerService({} as never);

    await service.recordSuccessfulRefund(
      { ledgerLine: { findFirst, create } } as never,
      {
        merchantId: 'm_1',
        paymentId: 'pay_1',
        amountMinor: 400,
        currency: 'EUR',
      },
    );

    expect(findFirst).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: 'm_1',
        paymentId: 'pay_1',
        entryType: 'merchant_pending',
        amountMinor: -400,
        currency: 'EUR',
      }),
    });
  });

  it('recordSuccessfulRefund mantiene available para pagos legacy sin asientos pending', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const create = jest.fn().mockResolvedValue(undefined);
    const service = new LedgerService({} as never);

    await service.recordSuccessfulRefund(
      { ledgerLine: { findFirst, create } } as never,
      {
        merchantId: 'm_1',
        paymentId: 'pay_legacy',
        amountMinor: 300,
        currency: 'EUR',
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentId: 'pay_legacy',
        entryType: 'available',
        amountMinor: -300,
      }),
    });
  });

  it('rechaza asiento de captura si net != gross - fee', async () => {
    const service = new LedgerService({} as never);

    await expect(
      service.recordSuccessfulCapture({} as never, {
        merchantId: 'm_1',
        paymentId: 'pay_1',
        grossMinor: 10_000,
        feeMinor: 120,
        netMinor: 9_900,
        currency: 'EUR',
      }),
    ).rejects.toThrow('Invalid fee breakdown');
  });

  it('getBalances devuelve pendingMinor y availableMinor por divisa', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValueOnce([
        { currency: 'EUR', entryType: 'merchant_pending', _sum: { amountMinor: 9880 } },
        { currency: 'EUR', entryType: 'merchant_available', _sum: { amountMinor: 120 } },
      ]);
    const service = new LedgerService({ ledgerLine: { groupBy } } as never);

    const balances = await service.getBalances('m_1');

    expect(groupBy).toHaveBeenCalledWith({
      by: ['currency', 'entryType'],
      where: {
        merchantId: 'm_1',
        entryType: { in: ['merchant_pending', 'merchant_available', 'available'] },
      },
      _sum: { amountMinor: true },
    });
    expect(balances).toEqual([
      {
        currency: 'EUR',
        pendingMinor: 9880,
        availableMinor: 120,
      },
    ]);
  });

  it('getBalances suma available legacy dentro de availableMinor', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { currency: 'EUR', entryType: 'available', _sum: { amountMinor: 500 } },
      { currency: 'EUR', entryType: 'merchant_available', _sum: { amountMinor: 200 } },
    ]);
    const service = new LedgerService({ ledgerLine: { groupBy } } as never);

    const balances = await service.getBalances('m_1');

    expect(balances).toEqual([
      {
        currency: 'EUR',
        pendingMinor: 0,
        availableMinor: 700,
      },
    ]);
  });
});
