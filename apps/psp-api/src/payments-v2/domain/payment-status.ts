export const PAYMENT_V2_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  REQUIRES_ACTION: 'requires_action',
  AUTHORIZED: 'authorized',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELED: 'canceled',
  REFUNDED: 'refunded',
} as const;

export type PaymentV2Status = (typeof PAYMENT_V2_STATUS)[keyof typeof PAYMENT_V2_STATUS];

export type PaymentOperation = 'create' | 'capture' | 'cancel' | 'refund';

export type PaymentProviderName = 'mock' | 'stripe';

export type PaymentReasonCode =
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'provider_declined'
  | 'provider_validation_error'
  | 'provider_error'
  | 'already_finalized'
  | 'not_capturable'
  | 'not_cancelable'
  | 'not_refundable';
