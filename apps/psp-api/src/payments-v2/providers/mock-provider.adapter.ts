import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PAYMENT_V2_STATUS, PaymentOperation } from '../domain/payment-status';
import { PaymentProvider, ProviderContext, ProviderResult } from './payment-provider.interface';

@Injectable()
export class MockProviderAdapter implements PaymentProvider {
  readonly name = 'mock' as const;

  async run(operation: PaymentOperation, context: ProviderContext): Promise<ProviderResult> {
    switch (operation) {
      case 'create':
        return this.createIntent(context);
      case 'capture':
        return this.capture(context);
      case 'cancel':
        return this.cancel(context);
      case 'refund':
        return this.refund(context);
      default:
        return {
          status: PAYMENT_V2_STATUS.FAILED,
          reasonCode: 'provider_validation_error',
          reasonMessage: `Unsupported mock operation: ${operation}`,
        };
    }
  }

  private async createIntent(context: ProviderContext): Promise<ProviderResult> {
    const fingerprint = this.hash(`${context.paymentId}:${context.amountMinor}:${context.currency}`);
    if (context.amountMinor % 13 === 0) {
      return {
        status: PAYMENT_V2_STATUS.FAILED,
        reasonCode: 'provider_declined',
        reasonMessage: 'Mock decline policy',
        providerPaymentId: `mock_pi_${fingerprint}`,
      };
    }
    if (context.amountMinor % 7 === 0) {
      return {
        status: PAYMENT_V2_STATUS.REQUIRES_ACTION,
        providerPaymentId: `mock_pi_${fingerprint}`,
        nextAction: {
          type: '3ds',
        },
      };
    }
    return {
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      providerPaymentId: `mock_pi_${fingerprint}`,
      nextAction: { type: 'none' },
    };
  }

  private async capture(context: ProviderContext): Promise<ProviderResult> {
    if (context.amountMinor % 17 === 0) {
      return {
        status: PAYMENT_V2_STATUS.FAILED,
        reasonCode: 'provider_declined',
        reasonMessage: 'Mock insufficient funds',
        providerPaymentId: context.providerPaymentId ?? `mock_pi_${this.hash(context.paymentId)}`,
      };
    }
    return {
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      providerPaymentId: context.providerPaymentId ?? `mock_pi_${this.hash(context.paymentId)}`,
    };
  }

  private async cancel(context: ProviderContext): Promise<ProviderResult> {
    return {
      status: PAYMENT_V2_STATUS.CANCELED,
      providerPaymentId: context.providerPaymentId ?? `mock_pi_${this.hash(context.paymentId)}`,
    };
  }

  private async refund(context: ProviderContext): Promise<ProviderResult> {
    return {
      status: PAYMENT_V2_STATUS.REFUNDED,
      providerPaymentId: context.providerPaymentId ?? `mock_pi_${this.hash(context.paymentId)}`,
    };
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }
}
