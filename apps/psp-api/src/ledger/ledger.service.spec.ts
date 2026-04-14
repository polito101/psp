import { LedgerService } from './ledger.service';

describe('LedgerService', () => {
  it('feeAmount floors bps correctly', () => {
    expect(LedgerService.feeAmount(10_000, 290)).toBe(290);
    expect(LedgerService.feeAmount(199, 290)).toBe(5);
    expect(LedgerService.feeAmount(100, 1)).toBe(0);
  });

  it('recordSuccessfulRefund crea asiento disponible negativo', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const service = new LedgerService({} as never);

    await service.recordSuccessfulRefund(
      { ledgerLine: { create } } as never,
      {
        merchantId: 'm_1',
        paymentId: 'pay_1',
        amountMinor: 400,
        currency: 'EUR',
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: 'm_1',
        paymentId: 'pay_1',
        entryType: 'available',
        amountMinor: -400,
        currency: 'EUR',
      }),
    });
  });
});
