export const PAYMENT_V2_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  REQUIRES_ACTION: 'requires_action',
  AUTHORIZED: 'authorized',
  SUCCEEDED: 'succeeded',
  /** Contracargo abierto vía eventos externos del proveedor. */
  DISPUTED: 'disputed',
  /** Disputa cerrada en contra del comercio. */
  DISPUTE_LOST: 'dispute_lost',
  FAILED: 'failed',
  CANCELED: 'canceled',
  REFUNDED: 'refunded',
} as const;

export type PaymentV2Status = (typeof PAYMENT_V2_STATUS)[keyof typeof PAYMENT_V2_STATUS];

export type PaymentOperation = 'create' | 'capture' | 'cancel' | 'refund';

export type { PaymentProviderName } from './payment-provider-names';
export {
  isPaymentProviderName,
  LEGACY_STRIPE_DB_PROVIDER,
  PAYMENT_PROVIDER_NAMES,
  paymentProviderNamesLabel,
  unsupportedPersistedProviderLifecycleMessage,
} from './payment-provider-names';

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
