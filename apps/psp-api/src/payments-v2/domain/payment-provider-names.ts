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

/**
 * Valor histórico frecuente en columnas `selected_provider` / `provider` tras retirar adapters.
 * El arranque estricto (`PAYMENTS_V2_ASSERT_NO_LEGACY_STRIPE_ROWS`) y el SQL de saneamiento lo usan como referencia.
 */
export const LEGACY_STRIPE_DB_PROVIDER = 'stripe' as const;

/**
 * Mensaje estable para `409 Conflict` cuando `Payment.selectedProvider` está persistido pero ya no es un `PaymentProviderName`.
 * No aplicar con `null`/cadena vacía: en ese caso el orquestador sigue el orden `PAYMENTS_PROVIDER_ORDER`.
 */
export function unsupportedPersistedProviderLifecycleMessage(
  operation: 'capture' | 'cancel' | 'refund',
  persistedValue: string,
): string {
  return (
    `${operation} refused: payment.selectedProvider "${persistedValue}" is not a supported provider in this deployment. ` +
    `Sanitize legacy provider values in the database before retrying ` +
    `(SQL: apps/psp-api/scripts/ops/sanitize-stripe-provider-to-mock.sql).`
  );
}
