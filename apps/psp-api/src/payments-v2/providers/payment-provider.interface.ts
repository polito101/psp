import { PaymentOperation, PaymentProviderName, PaymentV2Status } from '../domain/payment-status';

export type ProviderResult = {
  status: PaymentV2Status;
  providerPaymentId?: string;
  reasonCode?: string;
  reasonMessage?: string;
  transientError?: boolean;
  nextAction?: {
    type: 'redirect' | '3ds' | 'none';
    url?: string;
  };
  raw?: Record<string, unknown>;
};

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
