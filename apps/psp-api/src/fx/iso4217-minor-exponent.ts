/**
 * Exponente de unidades menores ISO 4217: importe mayor = amountMinor / 10^exponent.
 * Frankfurter (y este servicio) modelan el tipo como 1 unidad mayor base → rate unidades mayor quote (USD).
 *
 * La mayoría de divisas activas usan 2 decimales; aquí solo listamos excepciones (≠ 2).
 * Cualquier código ISO de 3 letras no listado se trata como exponent 2 (convención habitual ISO).
 *
 * @see https://www.iso.org/iso-4217-currency-codes.html
 */
export const USD_MINOR_EXPONENT = 2;

/** Divisas con 0 decimales en la unidad menor (1 minor = 1 mayor). */
const EXPONENT_ZERO = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'LAK',
  'PYG',
  'RWF',
  'UGX',
  'UYI',
  'VND',
  'VUV',
  'XAF',
  'XAG',
  'XAU',
  'XBA',
  'XBB',
  'XBC',
  'XBD',
  'XDR',
  'XOF',
  'XPD',
  'XPF',
  'XPT',
  'XSU',
  'XUA',
]);

const EXPONENT_THREE = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

const EXPONENT_FOUR = new Set(['CLF']);

/**
 * Devuelve el exponente de minor units para `currency` (ISO 4217 alpha-3, mayúsculas recomendadas).
 */
export function getIso4217MinorExponent(currencyCode: string): number {
  const c = currencyCode.toUpperCase();
  if (EXPONENT_ZERO.has(c)) return 0;
  if (EXPONENT_THREE.has(c)) return 3;
  if (EXPONENT_FOUR.has(c)) return 4;
  return 2;
}
