import { PAYMENT_V2_STATUS, PaymentOperation, PaymentProviderName, PaymentV2Status } from '../domain/payment-status';

type ProviderNextAction = {
  type: 'redirect' | '3ds' | 'none' | 'confirm_with_stripe_js';
  url?: string;
  /** Stripe PaymentIntent `client_secret` (Stripe.js: confirmCardPayment / handleNextAction). */
  clientSecret?: string;
  /** Valor de `payment_intent.next_action.type` cuando aplica. */
  stripeNextActionType?: string;
};

type ProviderResultCommon = {
  reasonCode?: string;
  reasonMessage?: string;
  transientError?: boolean;
  nextAction?: ProviderNextAction;
  raw?: Record<string, unknown>;
};

export type ProviderResultFailed = ProviderResultCommon & {
  status: typeof PAYMENT_V2_STATUS.FAILED;
  providerPaymentId?: string;
};

export type ProviderResultNonFailed = ProviderResultCommon & {
  status: Exclude<PaymentV2Status, typeof PAYMENT_V2_STATUS.FAILED>;
  providerPaymentId: string;
};

export type ProviderResult = ProviderResultFailed | ProviderResultNonFailed;

export type ProviderContext = {
  merchantId: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  providerPaymentId?: string | null;
  /** Solo operación `create` + adapter Stripe: confirmación server-side. */
  stripePaymentMethodId?: string;
  /** URL de retorno si el método de pago requiere redirect tras `confirm`. */
  stripeReturnUrl?: string;
};

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  run(operation: PaymentOperation, context: ProviderContext): Promise<ProviderResult>;
}
