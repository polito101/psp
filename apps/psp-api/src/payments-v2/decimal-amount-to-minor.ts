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

/**
 * Convierte importe mayor a unidades menores. El resultado debe comprobarse con
 * {@link isPersistablePrismaIntAmountMinor} antes de persistir.
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
