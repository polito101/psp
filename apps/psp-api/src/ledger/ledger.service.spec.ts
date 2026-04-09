import { LedgerService } from './ledger.service';

describe('LedgerService', () => {
  it('feeAmount floors bps correctly', () => {
    expect(LedgerService.feeAmount(10_000, 290)).toBe(290);
    expect(LedgerService.feeAmount(199, 290)).toBe(5);
    expect(LedgerService.feeAmount(100, 1)).toBe(0);
  });
});
