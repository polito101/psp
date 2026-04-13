import { Injectable } from '@nestjs/common';
import { PAYMENT_V2_STATUS, PaymentOperation } from '../domain/payment-status';
import { PaymentProvider, ProviderContext, ProviderResult } from './payment-provider.interface';

@Injectable()
export class StripeProviderAdapter implements PaymentProvider {
  readonly name = 'stripe' as const;
  private readonly apiBaseUrl = process.env.STRIPE_API_BASE_URL ?? 'https://api.stripe.com/v1';
  private readonly secretKey = process.env.STRIPE_SECRET_KEY;
  private readonly timeoutMs = Number(process.env.PAYMENTS_PROVIDER_TIMEOUT_MS ?? 8_000);

  async run(operation: PaymentOperation, context: ProviderContext): Promise<ProviderResult> {
    if (!this.secretKey) {
      return {
        status: PAYMENT_V2_STATUS.FAILED,
        reasonCode: 'provider_unavailable',
        reasonMessage: 'Stripe secret key is not configured',
      };
    }
    switch (operation) {
      case 'create':
        return this.createIntent(context);
      case 'capture':
        return this.captureIntent(context);
      case 'cancel':
        return this.cancelIntent(context);
      case 'refund':
        return this.refundIntent(context);
      default:
        return {
          status: PAYMENT_V2_STATUS.FAILED,
          reasonCode: 'provider_validation_error',
          reasonMessage: `Unsupported stripe operation: ${operation}`,
        };
    }
  }

  private async createIntent(context: ProviderContext): Promise<ProviderResult> {
    const params = new URLSearchParams();
    params.set('amount', String(context.amountMinor));
    params.set('currency', context.currency.toLowerCase());
    params.set('capture_method', 'manual');
    params.set('confirm', 'false');

    const response = await this.requestStripe('/payment_intents', params);
    if (!response.ok) {
      return this.mapFailure(response.body);
    }
    const status = this.mapIntentStatus(response.body.status);
    return {
      status,
      providerPaymentId: this.getString(response.body.id),
      raw: response.body,
      nextAction: status === PAYMENT_V2_STATUS.REQUIRES_ACTION ? { type: '3ds' } : { type: 'none' },
    };
  }

  private async captureIntent(context: ProviderContext): Promise<ProviderResult> {
    if (!context.providerPaymentId) {
      return {
        status: PAYMENT_V2_STATUS.FAILED,
        reasonCode: 'provider_validation_error',
        reasonMessage: 'Missing provider payment id for capture',
      };
    }
    const response = await this.requestStripe(`/payment_intents/${context.providerPaymentId}/capture`);
    if (!response.ok) {
      return this.mapFailure(response.body);
    }
    return {
      status: this.mapIntentStatus(response.body.status),
      providerPaymentId: this.getString(response.body.id),
      raw: response.body,
    };
  }

  private async cancelIntent(context: ProviderContext): Promise<ProviderResult> {
    if (!context.providerPaymentId) {
      return {
        status: PAYMENT_V2_STATUS.FAILED,
        reasonCode: 'provider_validation_error',
        reasonMessage: 'Missing provider payment id for cancel',
      };
    }
    const response = await this.requestStripe(`/payment_intents/${context.providerPaymentId}/cancel`);
    if (!response.ok) {
      return this.mapFailure(response.body);
    }
    return {
      status: PAYMENT_V2_STATUS.CANCELED,
      providerPaymentId: this.getString(response.body.id),
      raw: response.body,
    };
  }

  private async refundIntent(context: ProviderContext): Promise<ProviderResult> {
    if (!context.providerPaymentId) {
      return {
        status: PAYMENT_V2_STATUS.FAILED,
        reasonCode: 'provider_validation_error',
        reasonMessage: 'Missing provider payment id for refund',
      };
    }
    const params = new URLSearchParams();
    params.set('payment_intent', context.providerPaymentId);
    params.set('amount', String(context.amountMinor));
    const response = await this.requestStripe('/refunds', params);
    if (!response.ok) {
      return this.mapFailure(response.body);
    }
    return {
      status: PAYMENT_V2_STATUS.REFUNDED,
      providerPaymentId: context.providerPaymentId,
      raw: response.body,
    };
  }

  private async requestStripe(
    path: string,
    body?: URLSearchParams,
  ): Promise<{ ok: boolean; body: Record<string, unknown> }> {
    try {
      const res = await fetch(`${this.apiBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const parsed = (await res.json()) as Record<string, unknown>;
      return { ok: res.ok, body: parsed };
    } catch (error) {
      return {
        ok: false,
        body: {
          error: {
            code: 'timeout',
            message: error instanceof Error ? error.message : String(error),
            type: 'api_connection_error',
          },
        },
      };
    }
  }

  private mapIntentStatus(statusRaw: unknown) {
    const status = this.getString(statusRaw);
    if (status === 'requires_action') return PAYMENT_V2_STATUS.REQUIRES_ACTION;
    if (status === 'requires_capture') return PAYMENT_V2_STATUS.AUTHORIZED;
    if (status === 'succeeded') return PAYMENT_V2_STATUS.SUCCEEDED;
    if (status === 'canceled') return PAYMENT_V2_STATUS.CANCELED;
    return PAYMENT_V2_STATUS.FAILED;
  }

  private mapFailure(body: Record<string, unknown>): ProviderResult {
    const error = this.getObject(body.error);
    const code = this.getString(error?.code) ?? 'provider_error';
    const type = this.getString(error?.type) ?? '';
    return {
      status: PAYMENT_V2_STATUS.FAILED,
      reasonCode: code === 'timeout' ? 'provider_timeout' : 'provider_error',
      reasonMessage: this.getString(error?.message) ?? 'Stripe request failed',
      transientError:
        code === 'timeout' ||
        type === 'api_connection_error' ||
        type === 'rate_limit_error' ||
        type === 'api_error',
      raw: body,
    };
  }

  private getObject(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private getString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }
}
