import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PAYMENT_V2_STATUS, PaymentOperation } from '../domain/payment-status';
import { PaymentProvider, ProviderContext, ProviderResult } from './payment-provider.interface';

@Injectable()
export class StripeProviderAdapter implements PaymentProvider {
  readonly name = 'stripe' as const;
  private readonly apiBaseUrl: string;
  private readonly secretKey: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.apiBaseUrl = (this.config.get<string>('STRIPE_API_BASE_URL') ?? 'https://api.stripe.com/v1').replace(
      /\/+$/,
      '',
    );
    this.secretKey = this.config.get<string>('STRIPE_SECRET_KEY') ?? '';
    this.timeoutMs = Number(this.config.get<string>('PAYMENTS_PROVIDER_TIMEOUT_MS') ?? 8_000);
  }

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
    const providerPaymentId = this.getString(response.body.id);
    if (!providerPaymentId) {
      return {
        status: PAYMENT_V2_STATUS.FAILED,
        reasonCode: 'provider_error',
        reasonMessage: 'Stripe response missing payment intent id',
        raw: response.body,
      };
    }
    return {
      status,
      providerPaymentId,
      raw: response.body,
      nextAction: this.mapNextAction(status, response.body),
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
    const providerPaymentId = this.getString(response.body.id);
    if (!providerPaymentId) {
      return {
        status: PAYMENT_V2_STATUS.FAILED,
        reasonCode: 'provider_error',
        reasonMessage: 'Stripe response missing payment intent id on capture',
        raw: response.body,
      };
    }
    return {
      status: this.mapIntentStatus(response.body.status),
      providerPaymentId,
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
    const providerPaymentId = this.getString(response.body.id);
    if (!providerPaymentId) {
      return {
        status: PAYMENT_V2_STATUS.FAILED,
        reasonCode: 'provider_error',
        reasonMessage: 'Stripe response missing payment intent id on cancel',
        raw: response.body,
      };
    }
    return {
      status: PAYMENT_V2_STATUS.CANCELED,
      providerPaymentId,
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
      const safePath = path.startsWith('/') ? path : `/${path}`;
      const res = await fetch(`${this.apiBaseUrl}${safePath}`, {
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
    if (!status) return PAYMENT_V2_STATUS.PROCESSING;
    if (status === 'requires_action') return PAYMENT_V2_STATUS.REQUIRES_ACTION;
    if (status === 'requires_capture') return PAYMENT_V2_STATUS.AUTHORIZED;
    if (status === 'succeeded') return PAYMENT_V2_STATUS.SUCCEEDED;
    if (status === 'canceled') return PAYMENT_V2_STATUS.CANCELED;

    // Estados no finales de Stripe (no debemos traducirlos a "failed" de negocio).
    // https://docs.stripe.com/api/payment_intents/object#payment_intent_object-status
    if (status === 'processing') return PAYMENT_V2_STATUS.PROCESSING;
    if (status === 'requires_payment_method') return PAYMENT_V2_STATUS.PENDING;
    if (status === 'requires_confirmation') return PAYMENT_V2_STATUS.PENDING;

    // Estado desconocido: conservador -> no-final.
    return PAYMENT_V2_STATUS.PROCESSING;
  }

  private mapNextAction(status: ProviderResult['status'], body: Record<string, unknown>) {
    if (status !== PAYMENT_V2_STATUS.REQUIRES_ACTION) return { type: 'none' as const };
    const nextAction = this.getObject(body.next_action);
    const type = this.getString(nextAction?.type);
    if (type === 'redirect_to_url') {
      const redirect = this.getObject(nextAction?.redirect_to_url);
      const url = this.getString(redirect?.url);
      if (url) return { type: 'redirect' as const, url };
    }
    return { type: '3ds' as const };
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
