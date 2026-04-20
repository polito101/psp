/**
 * SSOT de códigos de proveedor Payments V2 (alineado con `selectedProvider` en DB como string).
 * Al añadir un PSP: extender esta lista, registrar el adapter en `PaymentsV2Module` y reflejar el nombre en `PAYMENTS_PROVIDER_ORDER`.
 */
export const PAYMENT_PROVIDER_NAMES = ['mock', 'acme'] as const;

export type PaymentProviderName = (typeof PAYMENT_PROVIDER_NAMES)[number];

const NAME_SET = new Set<string>(PAYMENT_PROVIDER_NAMES);

export function isPaymentProviderName(value: string): value is PaymentProviderName {
  return NAME_SET.has(value);
}

export function paymentProviderNamesLabel(): string {
  return PAYMENT_PROVIDER_NAMES.join(',');
}
