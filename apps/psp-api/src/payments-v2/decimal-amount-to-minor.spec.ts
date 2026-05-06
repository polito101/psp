import {
  PAYMENT_AMOUNT_MINOR_MAX,
  decimalAmountToMinorUnits,
  isPersistablePrismaIntAmountMinor,
  nonPersistableAmountMinorMessage,
} from './decimal-amount-to-minor';

describe('decimalAmountToMinorUnits / isPersistablePrismaIntAmountMinor', () => {
  it('convierte EUR con dos decimales', () => {
    expect(decimalAmountToMinorUnits(19.99, 'eur')).toBe(1999);
  });

  it('convierte JPY sin decimales', () => {
    expect(decimalAmountToMinorUnits(1500, 'JPY')).toBe(1500);
  });

  it('convierte KWD con tres decimales', () => {
    expect(decimalAmountToMinorUnits(1.234, 'kwd')).toBe(1234);
  });

  it('expone límite alineado con INT32', () => {
    expect(PAYMENT_AMOUNT_MINOR_MAX).toBe(2_147_483_647);
  });

  it('isPersistablePrismaIntAmountMinor rechaza overflow por redondeo en EUR', () => {
    const minor = decimalAmountToMinorUnits(21_474_836.48, 'EUR');
    expect(minor).toBe(2_147_483_648);
    expect(isPersistablePrismaIntAmountMinor(minor)).toBe(false);
  });

  it('isPersistablePrismaIntAmountMinor acepta el máximo menor persistible', () => {
    expect(isPersistablePrismaIntAmountMinor(PAYMENT_AMOUNT_MINOR_MAX)).toBe(true);
    expect(isPersistablePrismaIntAmountMinor(PAYMENT_AMOUNT_MINOR_MAX + 1)).toBe(false);
  });

  it('isPersistablePrismaIntAmountMinor rechaza no enteros y valores no seguros', () => {
    expect(isPersistablePrismaIntAmountMinor(1.5)).toBe(false);
    expect(isPersistablePrismaIntAmountMinor(NaN)).toBe(false);
    expect(isPersistablePrismaIntAmountMinor(Infinity)).toBe(false);
    expect(isPersistablePrismaIntAmountMinor(0)).toBe(false);
  });

  it('nonPersistableAmountMinorMessage distingue demasiado pequeño, overflow e inválido', () => {
    expect(nonPersistableAmountMinorMessage(decimalAmountToMinorUnits(0.001, 'EUR'))).toBe(
      'amount too small after conversion to minor units',
    );
    expect(nonPersistableAmountMinorMessage(PAYMENT_AMOUNT_MINOR_MAX + 1)).toBe(
      'amount exceeds maximum allowed for payment storage after conversion to minor units (INT32)',
    );
    expect(nonPersistableAmountMinorMessage(NaN)).toBe('invalid amount after conversion');
    expect(nonPersistableAmountMinorMessage(1.5)).toBe('invalid amount after conversion');
    expect(nonPersistableAmountMinorMessage(100)).toBe(null);
  });
});
