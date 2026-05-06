/**
 * Convierte importe decimal de la API pública a unidades menores (p. ej. EUR/USD → céntimos).
 * Cubre divisas sin decimales y 3 decimales habituales; el resto usa 2 decimales.
 */

/** Límite superior alineado con `Payment.amountMinor` (Prisma `Int` / Postgres INTEGER). */
export const PAYMENT_AMOUNT_MINOR_MAX = 2_147_483_647;

const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'UYI',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

/**
 * Indica si `amountMinor` puede persistirse en columnas INTEGER del esquema (positivo, sin overflow).
 */
export function isPersistablePrismaIntAmountMinor(amountMinor: number): boolean {
  return (
    Number.isFinite(amountMinor) &&
    Number.isSafeInteger(amountMinor) &&
    amountMinor >= 1 &&
    amountMinor <= PAYMENT_AMOUNT_MINOR_MAX
  );
}

const MSG_AMOUNT_TOO_SMALL = 'amount too small after conversion to minor units';
const MSG_AMOUNT_INVALID = 'invalid amount after conversion';
const MSG_AMOUNT_OVERFLOW =
  'amount exceeds maximum allowed for payment storage after conversion to minor units (INT32)';

/**
 * Si `amountMinor` no puede persistirse, devuelve un mensaje de error HTTP 400 acorde al motivo;
 * si es persistible, `null`.
 */
export function nonPersistableAmountMinorMessage(amountMinor: number): string | null {
  if (isPersistablePrismaIntAmountMinor(amountMinor)) {
    return null;
  }
  if (!Number.isFinite(amountMinor) || !Number.isSafeInteger(amountMinor)) {
    return MSG_AMOUNT_INVALID;
  }
  if (amountMinor < 1) {
    return MSG_AMOUNT_TOO_SMALL;
  }
  return MSG_AMOUNT_OVERFLOW;
}

/**
 * Convierte importe mayor a unidades menores. El resultado debe comprobarse con
 * {@link isPersistablePrismaIntAmountMinor} o {@link nonPersistableAmountMinorMessage} antes de persistir.
 */
export function decimalAmountToMinorUnits(amount: number, currency: string): number {
  const code = currency.trim().toUpperCase();
  if (THREE_DECIMAL.has(code)) {
    return Math.round(amount * 1000);
  }
  if (ZERO_DECIMAL.has(code)) {
    return Math.round(amount);
  }
  return Math.round(amount * 100);
}
