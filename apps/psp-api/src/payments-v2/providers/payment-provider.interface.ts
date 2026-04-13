import { PAYMENT_V2_STATUS, PaymentOperation, PaymentProviderName, PaymentV2Status } from '../domain/payment-status';

type ProviderNextAction = {
  type: 'redirect' | '3ds' | 'none';
  url?: string;
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
};

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  run(operation: PaymentOperation, context: ProviderContext): Promise<ProviderResult>;
}
