/**
 * Convierte importe decimal de la API pública a unidades menores (p. ej. EUR/USD → céntimos).
 * Cubre divisas sin decimales y 3 decimales habituales; el resto usa 2 decimales.
 */
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
