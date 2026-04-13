import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  private readonly maxRetries: number;
  private readonly cbFailures: number;
  private readonly cbCooldownMs: number;
  private readonly attemptWriteMaxRetries = 5;
  private readonly operationLockStaleMs: number;
  private readonly persistAttemptPayload: boolean;
  private readonly tolerateAttemptPersistFailure: boolean;
  private readonly paymentsV2EnabledMerchantsRaw: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly links: PaymentLinksService,
    private readonly redis: RedisService,
    private readonly ledger: LedgerService,
    private readonly webhooks: WebhooksService,
    private readonly registry: ProviderRegistryService,
    private readonly observability: PaymentsV2ObservabilityService,
  ) {
    this.maxRetries = this.getNumber('PAYMENTS_PROVIDER_MAX_RETRIES', 2);
    this.cbFailures = this.getNumber('PAYMENTS_PROVIDER_CB_FAILURES', 3);
    this.cbCooldownMs = this.getNumber('PAYMENTS_PROVIDER_CB_COOLDOWN_MS', 60_000);
    this.persistAttemptPayload =
      (this.config.get<string>('PAYMENTS_V2_PERSIST_PROVIDER_RAW') ?? 'true').toLowerCase() === 'true';
    this.tolerateAttemptPersistFailure =
      (this.config.get<string>('PAYMENTS_V2_TOLERATE_ATTEMPT_PERSIST_FAILURE') ?? 'true').toLowerCase() === 'true';
    this.paymentsV2EnabledMerchantsRaw = this.config.get<string>('PAYMENTS_V2_ENABLED_MERCHANTS') ?? '';

    const raw = this.config.get<string>('PAYMENTS_V2_OPERATION_LOCK_STALE_MS');
    const parsed = raw === undefined || raw.trim() === '' ? 30_000 : Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.operationLockStaleMs = 30_000;
      this.log.warn(
        JSON.stringify({
          event: 'payments_v2.operation_lock_stale_ms_invalid',
          raw: raw ?? null,
          applied: this.operationLockStaleMs,
        }),
      );
    } else {
      this.operationLockStaleMs = parsed;
    }
  }

  private getNumber(key: string, defaultValue: number): number {
    const raw = this.config.get<string>(key);
    if (raw === undefined || raw.trim() === '') return defaultValue;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

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
        return { payment: existing, nextAction: this.nextActionFromPersistedPayment(existing) };
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
          return { payment: existing, nextAction: this.nextActionFromPersistedPayment(existing) };
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

  async capture(merchantId: string, paymentId: string, idempotencyKey?: string): Promise<OperationResult> {
    this.assertMerchantEnabled(merchantId);

    if (idempotencyKey) {
      const duplicate = await this.tryAcquireOperationIdempotency({
        merchantId,
        paymentId,
        operation: 'capture',
        idempotencyKey,
        payloadHash: 'v=1',
      });
      if (duplicate) {
        const current = await this.findMerchantPayment(merchantId, paymentId);
        return { payment: current, nextAction: null };
      }
    }

    const claim = await this.claimPaymentOperation({
      merchantId,
      paymentId,
      operation: 'capture',
      payloadHash: 'v=1',
    });
    if (!claim.proceed) {
      return { payment: claim.payment, nextAction: null };
    }

    try {
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
      return await this.executeProviderOperation(payment, 'capture', payment.amountMinor, providerOrder);
    } finally {
      await this.completePaymentOperation(paymentId, 'capture', '');
    }
  }

  async cancel(merchantId: string, paymentId: string, idempotencyKey?: string): Promise<OperationResult> {
    this.assertMerchantEnabled(merchantId);

    if (idempotencyKey) {
      const duplicate = await this.tryAcquireOperationIdempotency({
        merchantId,
        paymentId,
        operation: 'cancel',
        idempotencyKey,
        payloadHash: 'v=1',
      });
      if (duplicate) {
        const current = await this.findMerchantPayment(merchantId, paymentId);
        return { payment: current, nextAction: null };
      }
    }

    const claim = await this.claimPaymentOperation({
      merchantId,
      paymentId,
      operation: 'cancel',
      payloadHash: 'v=1',
    });
    if (!claim.proceed) {
      return { payment: claim.payment, nextAction: null };
    }

    try {
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
      return await this.executeProviderOperation(payment, 'cancel', payment.amountMinor, providerOrder);
    } finally {
      await this.completePaymentOperation(paymentId, 'cancel', '');
    }
  }

  async refund(
    merchantId: string,
    paymentId: string,
    amountMinor?: number,
    idempotencyKey?: string,
  ): Promise<OperationResult> {
    this.assertMerchantEnabled(merchantId);
    const payment = await this.findMerchantPayment(merchantId, paymentId);
    if (payment.status === PAYMENT_V2_STATUS.REFUNDED) {
      return { payment, nextAction: null };
    }
    if (payment.status !== PAYMENT_V2_STATUS.SUCCEEDED) {
      throw new ConflictException('Only succeeded payments can be refunded');
    }
    const refundAmount = amountMinor ?? payment.amountMinor;
    if (refundAmount <= 0 || refundAmount > payment.amountMinor) {
      throw new BadRequestException('Invalid refund amount');
    }

    const refundPayloadHash = `amount=${refundAmount}`;
    if (idempotencyKey) {
      const duplicate = await this.tryAcquireOperationIdempotency({
        merchantId,
        paymentId,
        operation: 'refund',
        idempotencyKey,
        payloadHash: refundPayloadHash,
      });
      if (duplicate) {
        const current = await this.findMerchantPayment(merchantId, paymentId);
        return { payment: current, nextAction: null };
      }
    }

    const claim = await this.claimPaymentOperation({
      merchantId,
      paymentId,
      operation: 'refund',
      payloadHash: refundPayloadHash,
    });
    if (!claim.proceed) {
      return { payment: claim.payment, nextAction: null };
    }

    try {
      const providerOrder = this.registry.orderedProviders(this.toProviderName(payment.selectedProvider));
      return await this.executeProviderOperation(payment, 'refund', refundAmount, providerOrder);
    } finally {
      await this.completePaymentOperation(paymentId, 'refund', '');
    }
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
    let lastProviderAttempted: PaymentProviderName | null = null;
    for (let providerIndex = 0; providerIndex < providerOrder.length; providerIndex += 1) {
      const providerName = providerOrder[providerIndex];
      lastProviderAttempted = providerName;
      const isLastProvider = providerIndex === providerOrder.length - 1;
      if (this.isCircuitOpen(providerName)) {
        await this.safeCreateAttempt(payment, operation, providerName, {
          status: PAYMENT_V2_STATUS.FAILED,
          reasonCode: 'provider_unavailable',
          reasonMessage: 'Provider circuit breaker is open',
        }, 0);
        continue;
      }
      const result = await this.runWithRetry(providerName, operation, payment, amountMinor);
      const shouldFallbackToNextProvider =
        result.status === PAYMENT_V2_STATUS.FAILED &&
        result.reasonCode === 'provider_unavailable' &&
        !isLastProvider;

      if (shouldFallbackToNextProvider) {
        // No marcamos el pago como FAILED si hay proveedores alternativos; solo registramos el intento.
        payment = await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            selectedProvider: providerName,
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
        continue;
      }

      payment = await this.applyPaymentState(payment, operation, providerName, result, amountMinor);
      return { payment, nextAction: result.nextAction ?? null };
    }
    const failed = await this.markPaymentFailed(
      payment.id,
      'provider_unavailable',
      lastProviderAttempted ?? providerOrder[providerOrder.length - 1] ?? this.toProviderName(payment.selectedProvider),
    );
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
      let result: ProviderResult;
      try {
        const adapter = this.registry.getProvider(providerName);
        const context: ProviderContext = {
          merchantId: payment.merchantId,
          paymentId: payment.id,
          amountMinor,
          currency: payment.currency,
          providerPaymentId: payment.providerRef,
        };
        result = await adapter.run(operation, context);
      } catch (caught) {
        result = this.providerRunFailureFromThrow(caught);
      }
      const latencyMs = Date.now() - start;
      await this.safeCreateAttempt(payment, operation, providerName, result, latencyMs);
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

    const shouldCountFailureForCircuitBreaker =
      finalResult.status === PAYMENT_V2_STATUS.FAILED &&
      finalResult.reasonCode !== 'provider_declined' &&
      finalResult.reasonCode !== 'provider_validation_error' &&
      (finalResult.transientError === true ||
        finalResult.reasonCode === 'provider_unavailable' ||
        finalResult.reasonCode === 'provider_timeout');

    if (shouldCountFailureForCircuitBreaker) {
      this.registerProviderFailure(providerName);
    } else {
      this.resetProviderFailure(providerName);
    }
    return finalResult;
  }

  /**
   * Normaliza throws inesperados del adapter (o de `getProvider`) a un {@link ProviderResult} FAILED
   * para persistir intentos, métricas y circuit breaker igual que un fallo explícito del proveedor.
   */
  private providerRunFailureFromThrow(caught: unknown): ProviderResult {
    const name = caught instanceof Error ? caught.name : 'NonError';
    const msg = caught instanceof Error ? caught.message : String(caught);
    return {
      status: PAYMENT_V2_STATUS.FAILED,
      reasonCode: 'provider_error',
      reasonMessage: msg ? `${name}: ${msg}` : name,
      transientError: this.isTransientProviderRunThrow(caught),
    };
  }

  /**
   * Heurística: errores de programación típicos no se reintentan; ECONNRESET/ETIMEDOUT/etc. sí.
   */
  private isTransientProviderRunThrow(caught: unknown): boolean {
    if (
      caught instanceof TypeError ||
      caught instanceof SyntaxError ||
      caught instanceof ReferenceError ||
      caught instanceof EvalError
    ) {
      return false;
    }
    if (caught instanceof Error && typeof (caught as NodeJS.ErrnoException).code === 'string') {
      const code = (caught as NodeJS.ErrnoException).code;
      if (
        code === 'ECONNRESET' ||
        code === 'ETIMEDOUT' ||
        code === 'ECONNREFUSED' ||
        code === 'ENOTFOUND' ||
        code === 'EPIPE' ||
        code === 'ECANCELED'
      ) {
        return true;
      }
    }
    return true;
  }

  private async safeCreateAttempt(
    payment: OperationResult['payment'],
    operation: PaymentOperation,
    provider: PaymentProviderName,
    result: ProviderResult,
    latencyMs: number,
  ): Promise<void> {
    try {
      await this.createAttempt(payment, operation, provider, result, latencyMs);
    } catch (error) {
      this.observability.registerAttemptPersistFailure({ provider, operation });
      const payload = {
        event: 'payments_v2.attempt_persist_failed',
        paymentId: payment.id,
        merchantId: payment.merchantId,
        operation,
        provider,
        providerStatus: result.status,
        providerReasonCode: result.reasonCode ?? null,
        error: error instanceof Error ? error.message : String(error),
      };
      if (!this.tolerateAttemptPersistFailure) {
        this.log.error(JSON.stringify({ ...payload, fatal: true }));
        throw error;
      }
      this.log.error(JSON.stringify({ ...payload, tolerated: true }));
    }
  }

  private async createAttempt(
    payment: OperationResult['payment'],
    operation: PaymentOperation,
    provider: PaymentProviderName,
    result: ProviderResult,
    latencyMs: number,
  ) {
    const sanitizedRaw = this.persistAttemptPayload
      ? this.sanitizeProviderRaw(provider, result.raw ?? null)
      : null;

    for (let retryNo = 0; retryNo < this.attemptWriteMaxRetries; retryNo += 1) {
      try {
        await this.prisma.$transaction(
          async (tx: Prisma.TransactionClient) => {
            const maxAttempt = await tx.paymentAttempt.aggregate({
              where: { paymentId: payment.id, operation },
              _max: { attemptNo: true },
            });
            const nextAttemptNo = (maxAttempt._max.attemptNo ?? 0) + 1;
            await tx.paymentAttempt.create({
              data: {
                paymentId: payment.id,
                merchantId: payment.merchantId,
                operation,
                provider,
                attemptNo: nextAttemptNo,
                status: result.status,
                providerPaymentId: result.providerPaymentId ?? null,
                errorCode: result.reasonCode ?? null,
                errorMessage: result.reasonMessage ?? null,
                latencyMs,
                responsePayload: sanitizedRaw ? (sanitizedRaw as Prisma.InputJsonValue) : undefined,
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return;
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : '';
        const retryable = code === 'P2002' || code === 'P2034';
        const lastRetry = retryNo >= this.attemptWriteMaxRetries - 1;
        if (!retryable || lastRetry) {
          throw error;
        }
        this.log.warn(
          JSON.stringify({
            event: 'payments_v2.create_attempt_retry',
            paymentId: payment.id,
            operation,
            provider,
            retryNo: retryNo + 1,
            code,
          }),
        );
      }
    }
  }

  private sanitizeProviderRaw(provider: PaymentProviderName, raw: Record<string, unknown> | null) {
    if (!raw) return null;

    if (provider === 'stripe') {
      const safe: Record<string, unknown> = {
        id: this.safeGetString(raw.id),
        object: this.safeGetString(raw.object),
        status: this.safeGetString(raw.status),
        request_id: this.safeGetString(raw.request_id) ?? this.safeGetString(raw.requestId),
      };

      const error = this.safeGetObject(raw.error);
      if (error) {
        safe.error = {
          code: this.safeGetString(error.code),
          type: this.safeGetString(error.type),
          message: this.truncate(this.safeGetString(error.message), 500),
          decline_code: this.safeGetString(error.decline_code),
          param: this.safeGetString(error.param),
        };
      }

      // Elimina campos undefined/null para mantener payloads compactos
      Object.keys(safe).forEach((k) => {
        if (safe[k] === undefined || safe[k] === null) delete safe[k];
      });
      if (safe.error && typeof safe.error === 'object') {
        Object.keys(safe.error as Record<string, unknown>).forEach((k) => {
          const obj = safe.error as Record<string, unknown>;
          if (obj[k] === undefined || obj[k] === null) delete obj[k];
        });
        if (Object.keys(safe.error as Record<string, unknown>).length === 0) delete safe.error;
      }

      return safe;
    }

    // Default: no persistimos raws desconocidos por seguridad.
    return null;
  }

  private safeGetObject(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private safeGetString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private truncate(value: string | undefined, maxLen: number): string | undefined {
    if (!value) return value;
    if (value.length <= maxLen) return value;
    return value.slice(0, maxLen);
  }

  private async applyPaymentState(
    payment: OperationResult['payment'],
    operation: PaymentOperation,
    providerName: PaymentProviderName,
    result: ProviderResult,
    amountMinor: number,
  ): Promise<OperationResult['payment']> {
    const hasNonEmptyProviderId = (value: string | undefined | null): value is string =>
      typeof value === 'string' && value.trim().length > 0;

    if (
      result.status !== PAYMENT_V2_STATUS.FAILED &&
      !hasNonEmptyProviderId(result.providerPaymentId) &&
      payment.providerRef === null
    ) {
      this.log.error(
        JSON.stringify({
          event: 'payments_v2.provider_success_missing_id',
          paymentId: payment.id,
          merchantId: payment.merchantId,
          operation,
          provider: providerName,
          providerStatus: result.status,
        }),
      );
      return this.markPaymentFailed(payment.id, 'provider_error', providerName);
    }

    if (operation === 'capture' && result.status === PAYMENT_V2_STATUS.SUCCEEDED) {
      return this.captureSucceeded(payment, providerName, result);
    }

    if (operation === 'refund' && result.status === PAYMENT_V2_STATUS.REFUNDED) {
      return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const cas = await tx.payment.updateMany({
          where: { id: payment.id, status: PAYMENT_V2_STATUS.SUCCEEDED },
          data: {
            status: PAYMENT_V2_STATUS.REFUNDED,
            selectedProvider: providerName,
            statusReason: null,
            failedAt: null,
            providerRef: result.providerPaymentId ?? payment.providerRef,
            lastAttemptAt: new Date(),
          },
        });

        const current = await tx.payment.findUniqueOrThrow({
          where: { id: payment.id },
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

        if (cas.count === 0) {
          return current;
        }

        await this.ledger.recordSuccessfulRefund(tx, {
          merchantId: payment.merchantId,
          paymentId: payment.id,
          amountMinor,
          currency: payment.currency,
        });
        return current;
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
          failedAt: null,
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
      return this.markPaymentFailed(payment.id, this.toReasonCode(result.reasonCode), providerName);
    }

    return this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: nextStatus,
        selectedProvider: providerName,
        providerRef: result.providerPaymentId ?? payment.providerRef,
        statusReason: null,
        failedAt: null,
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
    const { updated, transitioned } = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const cas = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: { in: [PAYMENT_V2_STATUS.AUTHORIZED, PAYMENT_V2_STATUS.REQUIRES_ACTION, PAYMENT_V2_STATUS.PENDING] },
        },
        data: {
          status: PAYMENT_V2_STATUS.SUCCEEDED,
          selectedProvider: providerName,
          providerRef: result.providerPaymentId ?? payment.providerRef,
          statusReason: null,
          failedAt: null,
          lastAttemptAt: new Date(),
          succeededAt: new Date(),
        },
      });

      const next = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
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

      if (cas.count === 0) {
        return { updated: next, transitioned: false as const };
      }

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
      return { updated: next, transitioned: true as const };
    });

    if (transitioned) {
      await this.webhooks.deliver(payment.merchantId, 'payment.succeeded', {
        payment_id: payment.id,
        amount_minor: payment.amountMinor,
        currency: payment.currency,
        status: PAYMENT_V2_STATUS.SUCCEEDED,
        provider: providerName,
      });
    }

    return updated;
  }

  private async tryAcquireOperationIdempotency(params: {
    merchantId: string;
    paymentId: string;
    operation: PaymentOperation;
    idempotencyKey: string;
    payloadHash: string;
  }): Promise<boolean> {
    const { merchantId, paymentId, operation, idempotencyKey, payloadHash } = params;
    const key = `payv2op:${merchantId}:${paymentId}:${operation}:${idempotencyKey}`;
    const value = `${paymentId}:${payloadHash}`;

    try {
      const ok = await this.redis.setIdempotency(key, value, 24 * 3600);
      if (ok) return false;
      const existing = await this.redis.getIdempotency(key);
      if (existing && existing !== value) {
        throw new ConflictException('Idempotency key already used with a different payload');
      }
      return true;
    } catch (error) {
      // Si Redis falla, degradamos a CAS por estado (evita duplicar efectos DB/webhooks).
      this.log.warn(
        JSON.stringify({
          event: 'payments_v2.operation_idempotency_unavailable',
          merchantId,
          paymentId,
          operation,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return false;
    }
  }

  private async claimPaymentOperation(params: {
    merchantId: string;
    paymentId: string;
    operation: PaymentOperation;
    payloadHash: string;
  }): Promise<{ proceed: true } | { proceed: false; payment: OperationResult['payment'] }> {
    const { merchantId, paymentId, operation, payloadHash } = params;
    const now = new Date();
    const staleBefore = new Date(now.getTime() - this.operationLockStaleMs);

    const decision = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const read = async () =>
        tx.paymentOperation.findUnique({
          where: { paymentId_operation: { paymentId, operation } },
          select: { status: true, payloadHash: true, processingAt: true },
        });

      let existing = await read();

      if (!existing) {
        try {
          await tx.paymentOperation.create({
            data: {
              paymentId,
              merchantId,
              operation,
              payloadHash,
              status: 'processing',
              processingAt: now,
            },
          });
          return { proceed: true as const };
        } catch (error) {
          const code =
            error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : '';
          if (code !== 'P2002') throw error;
          // Carrera: otra transacción creó el lock (paymentId+operation) entre el read y el create.
          existing = await read();
          if (!existing) throw error;
        }
      }

      if (existing.status === 'done') {
        if (existing.payloadHash !== payloadHash) {
          throw new ConflictException('Operation already completed with a different payload');
        }
        return { proceed: false as const };
      }

      const stale = existing.processingAt < staleBefore;
      if (!stale) {
        return { proceed: false as const };
      }

      await tx.paymentOperation.update({
        where: { paymentId_operation: { paymentId, operation } },
        data: {
          payloadHash,
          status: 'processing',
          processingAt: now,
          completedAt: null,
        },
      });
      return { proceed: true as const };
    });

    if (decision.proceed) return decision;

    const payment = await this.findMerchantPayment(merchantId, paymentId);
    return { proceed: false, payment };
  }

  private async completePaymentOperation(paymentId: string, operation: PaymentOperation, finalStatus: string) {
    try {
      await this.prisma.paymentOperation.updateMany({
        where: { paymentId, operation, status: 'processing' },
        data: { status: 'done', completedAt: new Date() },
      });
    } catch (error) {
      this.log.warn(
        JSON.stringify({
          event: 'payments_v2.operation_lock_complete_failed',
          paymentId,
          operation,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
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

  private nextActionFromPersistedPayment(
    payment: Pick<OperationResult['payment'], 'status'>,
  ): ProviderResult['nextAction'] | null {
    if (payment.status === PAYMENT_V2_STATUS.REQUIRES_ACTION) {
      return { type: '3ds' };
    }
    return null;
  }

  private assertIdempotencyPayloadMatch(
    existing: {
      amountMinor: number;
      currency: string;
      paymentLinkId: string | null;
      selectedProvider: string | null;
    },
    incoming: CreatePaymentIntentDto,
  ) {
    const same =
      existing.amountMinor === incoming.amountMinor &&
      existing.currency === incoming.currency.toUpperCase() &&
      existing.paymentLinkId === (incoming.paymentLinkId ?? null);
    if (!same) {
      throw new ConflictException('Idempotency key already used with a different payment intent');
    }

    if (incoming.provider) {
      const providerOrder = this.registry.orderedProviders(incoming.provider);
      const expectedSelectedProvider = providerOrder[0] ?? null;
      if (existing.selectedProvider !== expectedSelectedProvider) {
        throw new ConflictException('Idempotency key already used with a different payment intent');
      }
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
    const entries = this.paymentsV2EnabledMerchantsRaw
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

  private async markPaymentFailed(
    paymentId: string,
    reason: PaymentReasonCode,
    providerName: PaymentProviderName,
  ): Promise<OperationResult['payment']> {
    return this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PAYMENT_V2_STATUS.FAILED,
        selectedProvider: providerName,
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
