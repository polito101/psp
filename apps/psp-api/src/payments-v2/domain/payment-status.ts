export const PAYMENT_V2_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  REQUIRES_ACTION: 'requires_action',
  AUTHORIZED: 'authorized',
  SUCCEEDED: 'succeeded',
  /** Contracargo abierto vía webhooks `charge.dispute.*` de Stripe. */
  DISPUTED: 'disputed',
  /** Disputa cerrada en contra (p. ej. evidencia `losing_evidence` en Stripe). */
  DISPUTE_LOST: 'dispute_lost',
  FAILED: 'failed',
  CANCELED: 'canceled',
  REFUNDED: 'refunded',
} as const;

export type PaymentV2Status = (typeof PAYMENT_V2_STATUS)[keyof typeof PAYMENT_V2_STATUS];

export type PaymentOperation = 'create' | 'capture' | 'cancel' | 'refund';

export type { PaymentProviderName } from './payment-provider-names';
export { isPaymentProviderName, PAYMENT_PROVIDER_NAMES, paymentProviderNamesLabel } from './payment-provider-names';

export type PaymentReasonCode =
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'provider_declined'
  | 'provider_validation_error'
  | 'provider_error'
  | 'fee_configuration_missing'
  /** Tarifa activa implicaría comisión bruta mayor que el importe capturado (solo captura API; ledger usa tope vía FeeService). */
  | 'fee_exceeds_gross'
  | 'already_finalized'
  | 'not_capturable'
  | 'not_cancelable'
  | 'not_refundable';
