import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '../generated/prisma/client';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentLinksService } from '../payment-links/payment-links.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import {
  PAYMENT_V2_STATUS,
  PaymentOperation,
  PaymentProviderName,
  PaymentReasonCode,
} from './domain/payment-status';
import { PaymentsV2ObservabilityService } from './payments-v2-observability.service';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { ProviderContext, ProviderResult } from './providers/payment-provider.interface';

type OperationResult = {
  payment: {
    id: string;
    merchantId: string;
    status: string;
    amountMinor: number;
    currency: string;
    selectedProvider: string | null;
    providerRef: string | null;
    statusReason: string | null;
    paymentLinkId: string | null;
  };
  nextAction: ProviderResult['nextAction'] | null;
};

type CircuitBreakerState = {
  failures: number;
  openedUntil: number;
};

@Injectable()
export class PaymentsV2Service {
  private readonly log = new Logger(PaymentsV2Service.name);
  private readonly cbState = new Map<PaymentProviderName, CircuitBreakerState>();
  private readonly maxRetries = Number(process.env.PAYMENTS_PROVIDER_MAX_RETRIES ?? 2);
  private readonly cbFailures = Number(process.env.PAYMENTS_PROVIDER_CB_FAILURES ?? 3);
  private readonly cbCooldownMs = Number(process.env.PAYMENTS_PROVIDER_CB_COOLDOWN_MS ?? 60_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly links: PaymentLinksService,
    private readonly redis: RedisService,
    private readonly ledger: LedgerService,
    private readonly webhooks: WebhooksService,
    private readonly registry: ProviderRegistryService,
    private readonly observability: PaymentsV2ObservabilityService,
  ) {}

  async createIntent(
    merchantId: string,
    dto: CreatePaymentIntentDto,
    idempotencyKey?: string,
  ): Promise<OperationResult> {
    this.assertMerchantEnabled(merchantId);
    await this.assertPaymentLinkConsistency(merchantId, dto.paymentLinkId, dto.amountMinor, dto.currency);

    if (idempotencyKey) {
      const existing = await this.resolveIdempotentPayment(merchantId, idempotencyKey, dto);
      if (existing) {
        return { payment: existing, nextAction: null };
      }
    }

    const providerOrder = this.registry.orderedProviders(dto.provider);
    const selectedProvider = providerOrder[0];
    let payment: OperationResult['payment'];
    try {
      payment = await this.prisma.payment.create({
        data: {
          merchantId,
          paymentLinkId: dto.paymentLinkId ?? null,
          idempotencyKey: idempotencyKey ?? null,
          amountMinor: dto.amountMinor,
          currency: dto.currency.toUpperCase(),
          status: PAYMENT_V2_STATUS.PROCESSING,
          rail: 'fiat',
          selectedProvider,
        },
        select: {
          id: true,
          merchantId: true,
          status: true,
          amountMinor: true,
          currency: true,
          selectedProvider: true,
          providerRef: true,
          statusReason: true,
          paymentLinkId: true,
        },
      });
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : '';
      if (code === 'P2002' && idempotencyKey) {
        const existing = await this.resolveIdempotentPayment(merchantId, idempotencyKey, dto);
        if (existing) {
          this.log.log(
            JSON.stringify({
              event: 'payments_v2.create_intent.idempotent_race',
              merchantId,
              paymentId: existing.id,
            }),
          );
          return { payment: existing, nextAction: null };
        }
      }
      throw error;
    }

    if (idempotencyKey) {
      await this.safeSetIdempotency(merchantId, idempotencyKey, payment.id);
    }

    return this.executeProviderOperation(payment, 'create', dto.amountMinor, providerOrder);
  }

  async getPayment(merchantId: string, paymentId: string) {
    this.assertMerchantEnabled(merchantId);
    const payment = await this.findMerchantPayment(merchantId, paymentId);
    const attempts = await this.prisma.paymentAttempt.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        operation: true,
        provider: true,
        attemptNo: true,
        status: true,
        errorCode: true,
        errorMessage: true,
        latencyMs: true,
        createdAt: true,
      },
    });
    return { ...payment, attempts };
  }

  async capture(merchantId: string, paymentId: string): Promise<OperationResult> {
    this.assertMerchantEnabled(merchantId);
    const payment = await this.findMerchantPayment(merchantId, paymentId);
    if (payment.status === PAYMENT_V2_STATUS.SUCCEEDED) {
      return { payment, nextAction: null };
    }
    if (
      payment.status !== PAYMENT_V2_STATUS.AUTHORIZED &&
      payment.status !== PAYMENT_V2_STATUS.REQUIRES_ACTION &&
      payment.status !== PAYMENT_V2_STATUS.PENDING
    ) {
      throw new ConflictException('Payment is not capturable in current state');
    }
    const providerOrder = this.registry.orderedProviders(this.toProviderName(payment.selectedProvider));
    return this.executeProviderOperation(payment, 'capture', payment.amountMinor, providerOrder);
  }

  async cancel(merchantId: string, paymentId: string): Promise<OperationResult> {
    this.assertMerchantEnabled(merchantId);
    const payment = await this.findMerchantPayment(merchantId, paymentId);
    if (
      payment.status === PAYMENT_V2_STATUS.CANCELED ||
      payment.status === PAYMENT_V2_STATUS.FAILED ||
      payment.status === PAYMENT_V2_STATUS.REFUNDED
    ) {
      return { payment, nextAction: null };
    }
    if (payment.status === PAYMENT_V2_STATUS.SUCCEEDED) {
      throw new ConflictException('Succeeded payment must be refunded, not canceled');
    }
    const providerOrder = this.registry.orderedProviders(this.toProviderName(payment.selectedProvider));
    return this.executeProviderOperation(payment, 'cancel', payment.amountMinor, providerOrder);
  }

  async refund(merchantId: string, paymentId: string, amountMinor?: number): Promise<OperationResult> {
    this.assertMerchantEnabled(merchantId);
    const payment = await this.findMerchantPayment(merchantId, paymentId);
    if (payment.status !== PAYMENT_V2_STATUS.SUCCEEDED) {
      throw new ConflictException('Only succeeded payments can be refunded');
    }
    const refundAmount = amountMinor ?? payment.amountMinor;
    if (refundAmount <= 0 || refundAmount > payment.amountMinor) {
      throw new BadRequestException('Invalid refund amount');
    }
    const providerOrder = this.registry.orderedProviders(this.toProviderName(payment.selectedProvider));
    return this.executeProviderOperation(payment, 'refund', refundAmount, providerOrder);
  }

  getMetricsSnapshot() {
    return this.observability.snapshot();
  }

  private async executeProviderOperation(
    payment: OperationResult['payment'],
    operation: PaymentOperation,
    amountMinor: number,
    providerOrder: PaymentProviderName[],
  ): Promise<OperationResult> {
    for (const providerName of providerOrder) {
      if (this.isCircuitOpen(providerName)) {
        await this.createAttempt(payment, operation, providerName, {
          status: PAYMENT_V2_STATUS.FAILED,
          reasonCode: 'provider_unavailable',
          reasonMessage: 'Provider circuit breaker is open',
        }, 0);
        continue;
      }
      const result = await this.runWithRetry(providerName, operation, payment, amountMinor);
      const updated = await this.applyPaymentState(payment, operation, providerName, result, amountMinor);
      if (
        result.status !== PAYMENT_V2_STATUS.FAILED ||
        result.reasonCode !== 'provider_unavailable'
      ) {
        return { payment: updated, nextAction: result.nextAction ?? null };
      }
    }
    const failed = await this.markPaymentFailed(payment.id, 'provider_unavailable');
    return { payment: failed, nextAction: null };
  }

  private async runWithRetry(
    providerName: PaymentProviderName,
    operation: PaymentOperation,
    payment: OperationResult['payment'],
    amountMinor: number,
  ): Promise<ProviderResult> {
    let retries = 0;
    let finalResult: ProviderResult = {
      status: PAYMENT_V2_STATUS.FAILED,
      reasonCode: 'provider_error',
      reasonMessage: 'Provider call was not executed',
    };

    while (retries <= this.maxRetries) {
      const start = Date.now();
      const adapter = this.registry.getProvider(providerName);
      const context: ProviderContext = {
        merchantId: payment.merchantId,
        paymentId: payment.id,
        amountMinor,
        currency: payment.currency,
        providerPaymentId: payment.providerRef,
      };
      const result = await adapter.run(operation, context);
      const latencyMs = Date.now() - start;
      await this.createAttempt(payment, operation, providerName, result, latencyMs);
      this.observability.registerAttempt({
        provider: providerName,
        operation,
        success: result.status !== PAYMENT_V2_STATUS.FAILED,
        retried: retries > 0,
        latencyMs,
      });
      this.observability.logProviderEvent({
        paymentId: payment.id,
        operation,
        provider: providerName,
        status: result.status,
        reasonCode: result.reasonCode ?? null,
        latencyMs,
        retryNo: retries,
      });
      finalResult = result;
      if (result.status === PAYMENT_V2_STATUS.FAILED && result.transientError && retries < this.maxRetries) {
        retries += 1;
        continue;
      }
      break;
    }

    if (finalResult.status === PAYMENT_V2_STATUS.FAILED) {
      this.registerProviderFailure(providerName);
    } else {
      this.resetProviderFailure(providerName);
    }
    return finalResult;
  }

  private async createAttempt(
    payment: OperationResult['payment'],
    operation: PaymentOperation,
    provider: PaymentProviderName,
    result: ProviderResult,
    latencyMs: number,
  ) {
    const currentCount = await this.prisma.paymentAttempt.count({
      where: { paymentId: payment.id, operation },
    });
    await this.prisma.paymentAttempt.create({
      data: {
        paymentId: payment.id,
        merchantId: payment.merchantId,
        operation,
        provider,
        attemptNo: currentCount + 1,
        status: result.status,
        providerPaymentId: result.providerPaymentId ?? null,
        errorCode: result.reasonCode ?? null,
        errorMessage: result.reasonMessage ?? null,
        latencyMs,
        responsePayload: result.raw ? (result.raw as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  private async applyPaymentState(
    payment: OperationResult['payment'],
    operation: PaymentOperation,
    providerName: PaymentProviderName,
    result: ProviderResult,
    amountMinor: number,
  ): Promise<OperationResult['payment']> {
    if (operation === 'capture' && result.status === PAYMENT_V2_STATUS.SUCCEEDED) {
      return this.captureSucceeded(payment, providerName, result);
    }

    if (operation === 'refund' && result.status === PAYMENT_V2_STATUS.REFUNDED) {
      return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const updated = await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PAYMENT_V2_STATUS.REFUNDED,
            selectedProvider: providerName,
            statusReason: null,
            providerRef: result.providerPaymentId ?? payment.providerRef,
            lastAttemptAt: new Date(),
          },
          select: {
            id: true,
            merchantId: true,
            status: true,
            amountMinor: true,
            currency: true,
            selectedProvider: true,
            providerRef: true,
            statusReason: true,
            paymentLinkId: true,
          },
        });
        await this.ledger.recordSuccessfulRefund(tx, {
          merchantId: payment.merchantId,
          paymentId: payment.id,
          amountMinor,
          currency: payment.currency,
        });
        return updated;
      });
    }

    if (operation === 'cancel' && result.status === PAYMENT_V2_STATUS.CANCELED) {
      return this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PAYMENT_V2_STATUS.CANCELED,
          canceledAt: new Date(),
          selectedProvider: providerName,
          statusReason: null,
          providerRef: result.providerPaymentId ?? payment.providerRef,
          lastAttemptAt: new Date(),
        },
        select: {
          id: true,
          merchantId: true,
          status: true,
          amountMinor: true,
          currency: true,
          selectedProvider: true,
          providerRef: true,
          statusReason: true,
          paymentLinkId: true,
        },
      });
    }

    const nextStatus = result.status;
    if (nextStatus === PAYMENT_V2_STATUS.FAILED) {
      return this.markPaymentFailed(payment.id, this.toReasonCode(result.reasonCode));
    }

    return this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: nextStatus,
        selectedProvider: providerName,
        providerRef: result.providerPaymentId ?? payment.providerRef ?? `prov_${randomBytes(6).toString('hex')}`,
        statusReason: null,
        lastAttemptAt: new Date(),
      },
      select: {
        id: true,
        merchantId: true,
        status: true,
        amountMinor: true,
        currency: true,
        selectedProvider: true,
        providerRef: true,
        statusReason: true,
        paymentLinkId: true,
      },
    });
  }

  private async captureSucceeded(
    payment: OperationResult['payment'],
    providerName: PaymentProviderName,
    result: ProviderResult,
  ): Promise<OperationResult['payment']> {
    const merchant = await this.prisma.merchant.findUniqueOrThrow({
      where: { id: payment.merchantId },
      select: { feeBps: true },
    });
    const updated = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const next = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PAYMENT_V2_STATUS.SUCCEEDED,
          selectedProvider: providerName,
          providerRef: result.providerPaymentId ?? payment.providerRef,
          statusReason: null,
          lastAttemptAt: new Date(),
          succeededAt: new Date(),
        },
        select: {
          id: true,
          merchantId: true,
          status: true,
          amountMinor: true,
          currency: true,
          selectedProvider: true,
          providerRef: true,
          statusReason: true,
          paymentLinkId: true,
        },
      });
      await this.ledger.recordSuccessfulCapture(tx, {
        merchantId: payment.merchantId,
        paymentId: payment.id,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        feeBps: merchant.feeBps,
      });
      if (payment.paymentLinkId) {
        await tx.paymentLink.updateMany({
          where: { id: payment.paymentLinkId, merchantId: payment.merchantId },
          data: { status: 'used' },
        });
      }
      return next;
    });
    await this.webhooks.deliver(payment.merchantId, 'payment.succeeded', {
      payment_id: payment.id,
      amount_minor: payment.amountMinor,
      currency: payment.currency,
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      provider: providerName,
    });
    return updated;
  }

  private async resolveIdempotentPayment(
    merchantId: string,
    idempotencyKey: string,
    dto: CreatePaymentIntentDto,
  ): Promise<OperationResult['payment'] | null> {
    const cacheKey = `payv2:${merchantId}:${idempotencyKey}`;
    let cachedId: string | null = null;
    try {
      cachedId = await this.redis.getIdempotency(cacheKey);
    } catch {
      cachedId = null;
    }
    if (!cachedId) {
      const existing = await this.prisma.payment.findUnique({
        where: { merchantId_idempotencyKey: { merchantId, idempotencyKey } },
        select: {
          id: true,
          merchantId: true,
          status: true,
          amountMinor: true,
          currency: true,
          selectedProvider: true,
          providerRef: true,
          statusReason: true,
          paymentLinkId: true,
        },
      });
      if (!existing) return null;
      this.assertIdempotencyPayloadMatch(existing, dto);
      return existing;
    }
    const existing = await this.prisma.payment.findFirst({
      where: { id: cachedId, merchantId },
      select: {
        id: true,
        merchantId: true,
        status: true,
        amountMinor: true,
        currency: true,
        selectedProvider: true,
        providerRef: true,
        statusReason: true,
        paymentLinkId: true,
      },
    });
    if (!existing) return null;
    this.assertIdempotencyPayloadMatch(existing, dto);
    return existing;
  }

  private assertIdempotencyPayloadMatch(
    existing: { amountMinor: number; currency: string; paymentLinkId: string | null },
    incoming: CreatePaymentIntentDto,
  ) {
    const same =
      existing.amountMinor === incoming.amountMinor &&
      existing.currency === incoming.currency.toUpperCase() &&
      existing.paymentLinkId === (incoming.paymentLinkId ?? null);
    if (!same) {
      throw new ConflictException('Idempotency key already used with a different payment intent');
    }
  }

  private async safeSetIdempotency(merchantId: string, idempotencyKey: string, paymentId: string) {
    try {
      await this.redis.setIdempotency(`payv2:${merchantId}:${idempotencyKey}`, paymentId, 24 * 3600);
    } catch (error) {
      this.log.warn(
        JSON.stringify({
          event: 'payments_v2.idempotency_cache_set_failed',
          merchantId,
          paymentId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  private async assertPaymentLinkConsistency(
    merchantId: string,
    paymentLinkId: string | undefined,
    amountMinor: number,
    currency: string,
  ) {
    if (!paymentLinkId) return;
    const link = await this.links.findForMerchant(merchantId, paymentLinkId);
    if (link.amountMinor !== amountMinor || link.currency !== currency.toUpperCase()) {
      throw new BadRequestException('Amount/currency must match payment link');
    }
  }

  private assertMerchantEnabled(merchantId: string) {
    const allowListRaw = process.env.PAYMENTS_V2_ENABLED_MERCHANTS ?? '';
    const entries = allowListRaw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (entries.length === 0) {
      throw new ForbiddenException('Payments v2 is disabled');
    }
    if (!entries.includes('*') && !entries.includes(merchantId)) {
      throw new ForbiddenException('Merchant is not enabled for payments v2');
    }
  }

  private async findMerchantPayment(merchantId: string, paymentId: string): Promise<OperationResult['payment']> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, merchantId },
      select: {
        id: true,
        merchantId: true,
        status: true,
        amountMinor: true,
        currency: true,
        selectedProvider: true,
        providerRef: true,
        statusReason: true,
        paymentLinkId: true,
      },
    });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    return payment;
  }

  private toProviderName(value: string | null): PaymentProviderName | undefined {
    if (value === 'stripe' || value === 'mock') return value;
    return undefined;
  }

  private toReasonCode(value: string | undefined): PaymentReasonCode {
    const valid: PaymentReasonCode[] = [
      'provider_unavailable',
      'provider_timeout',
      'provider_declined',
      'provider_validation_error',
      'provider_error',
      'already_finalized',
      'not_capturable',
      'not_cancelable',
      'not_refundable',
    ];
    if (value && valid.includes(value as PaymentReasonCode)) {
      return value as PaymentReasonCode;
    }
    return 'provider_error';
  }

  private isCircuitOpen(providerName: PaymentProviderName): boolean {
    const state = this.cbState.get(providerName);
    if (!state) return false;
    return state.openedUntil > Date.now();
  }

  private registerProviderFailure(providerName: PaymentProviderName) {
    const current = this.cbState.get(providerName) ?? { failures: 0, openedUntil: 0 };
    current.failures += 1;
    if (current.failures >= this.cbFailures) {
      current.openedUntil = Date.now() + this.cbCooldownMs;
      this.log.warn(
        JSON.stringify({
          event: 'payments_v2.circuit_opened',
          provider: providerName,
          openedUntil: current.openedUntil,
        }),
      );
    }
    this.cbState.set(providerName, current);
  }

  private resetProviderFailure(providerName: PaymentProviderName) {
    this.cbState.set(providerName, { failures: 0, openedUntil: 0 });
  }

  private async markPaymentFailed(paymentId: string, reason: PaymentReasonCode): Promise<OperationResult['payment']> {
    return this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PAYMENT_V2_STATUS.FAILED,
        statusReason: reason,
        failedAt: new Date(),
        lastAttemptAt: new Date(),
      },
      select: {
        id: true,
        merchantId: true,
        status: true,
        amountMinor: true,
        currency: true,
        selectedProvider: true,
        providerRef: true,
        statusReason: true,
        paymentLinkId: true,
      },
    });
  }
}
