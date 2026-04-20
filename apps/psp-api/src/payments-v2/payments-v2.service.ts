import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { Prisma } from '../generated/prisma/client';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentLinksService } from '../payment-links/payment-links.service';
import { CorrelationContextService } from '../common/correlation/correlation-context.service';
import { FeeService } from '../fees/fee.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SettlementService } from '../settlements/settlement.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { hashCreatePaymentIntentPayload } from './create-payment-intent-payload-hash';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { ListOpsTransactionsDto } from './dto/list-ops-transactions.dto';
import { OpsMerchantFinancePayoutsQueryDto } from './dto/ops-merchant-finance-payouts-query.dto';
import { OpsMerchantFinanceSummaryQueryDto } from './dto/ops-merchant-finance-summary-query.dto';
import { OpsMerchantFinanceTransactionsQueryDto } from './dto/ops-merchant-finance-transactions-query.dto';
import { OpsTransactionCountsQueryDto } from './dto/ops-transaction-counts-query.dto';
import { OpsVolumeHourlyQueryDto } from './dto/ops-volume-hourly-query.dto';
import {
  PAYMENT_V2_STATUS,
  PaymentOperation,
  PaymentProviderName,
  PaymentReasonCode,
  isPaymentProviderName,
} from './domain/payment-status';
import { PaymentsV2MerchantRateLimitService } from './payments-v2-merchant-rate-limit.service';
import { PaymentsV2ObservabilityService } from './payments-v2-observability.service';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { ProviderContext, ProviderResult } from './providers/payment-provider.interface';

/** Máximo de `PaymentAttempt` en detalle ops: los más recientes, en orden ascendente en la respuesta. */
const OPS_PAYMENT_DETAIL_ATTEMPTS_MAX = 200;

const opsPaymentDetailAttemptSelectBase = {
  id: true,
  operation: true,
  provider: true,
  attemptNo: true,
  status: true,
  errorCode: true,
  errorMessage: true,
  latencyMs: true,
  providerPaymentId: true,
  createdAt: true,
} satisfies Prisma.PaymentAttemptSelect;

function opsPaymentDetailAttemptSelect(includePayload: boolean): Prisma.PaymentAttemptSelect {
  if (!includePayload) {
    return { ...opsPaymentDetailAttemptSelectBase };
  }
  return { ...opsPaymentDetailAttemptSelectBase, responsePayload: true };
}

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

type OpsTransactionsItem = {
  id: string;
  merchantId: string;
  merchantName: string;
  status: string;
  statusReason: string | null;
  amountMinor: number;
  currency: string;
  selectedProvider: string | null;
  providerRef: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastAttemptAt: Date | null;
  succeededAt: Date | null;
  failedAt: Date | null;
  canceledAt: Date | null;
  routingReasonCode: string | null;
  lastAttempt: {
    id: string;
    operation: string;
    provider: string;
    attemptNo: number;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
    latencyMs: number | null;
    createdAt: Date;
  } | null;
};

/**
 * Fallo del proveedor en refund: el pago sigue `succeeded`; el servicio lo mapea a `ConflictException` al caller.
 * Permite liberar lock/idempotencia y reintentar.
 */
class RefundProviderFailedError extends Error {
  override readonly name = 'RefundProviderFailedError';
  constructor(
    readonly paymentId: string,
    readonly reasonCode: string,
  ) {
    super(`Refund provider failed (${reasonCode})`);
  }
}

type CircuitBreakerState = {
  failures: number;
  openedUntil: number;
};

/** Una sola advertencia por proceso Node si el CB v2 cae a estado en memoria (sin Redis). */
let paymentsV2CircuitBreakerRedisFallbackWarned = false;

@Injectable()
export class PaymentsV2Service {
  /** Longitud máxima del valor persistido en `Payment.idempotencyKey` y validado en cabecera. */
  private static readonly IDEMPOTENCY_KEY_MAX_LEN = 256;
  private static readonly IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

  private readonly log = new Logger(PaymentsV2Service.name);
  /**
   * Estado de circuit breaker en proceso: sin cliente Redis, o degradación cuando Redis
   * está configurado pero las llamadas al CB fallan (timeout/corte).
   */
  private readonly cbStateFallback = new Map<PaymentProviderName, CircuitBreakerState>();
  private readonly cbRedisEnabled: boolean;
  /** Half-open (sonda única tras cooldown) solo con Redis; desactivado por defecto. */
  private readonly cbHalfOpenEnabled: boolean;
  private readonly maxRetries: number;
  private readonly cbFailures: number;
  private readonly cbCooldownMs: number;
  private readonly providerTimeoutMs: number;
  /** Espera base (ms) entre reintentos internos del adapter ante `transientError`; 0 desactiva la espera. */
  private readonly retryBackoffBaseMs: number;
  /** Tope (ms) del backoff exponencial con jitter entre reintentos del proveedor. */
  private readonly retryBackoffMaxMs: number;
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
    private readonly fee: FeeService,
    private readonly merchantRateLimit: PaymentsV2MerchantRateLimitService,
    private readonly correlationContext: CorrelationContextService,
  ) {
    this.cbRedisEnabled = Boolean(this.redis.getClient?.());
    this.cbHalfOpenEnabled =
      (this.config.get<string>('PAYMENTS_PROVIDER_CB_HALF_OPEN') ?? 'false').toLowerCase() === 'true';
    this.maxRetries = this.getNumber('PAYMENTS_PROVIDER_MAX_RETRIES', 2);
    this.cbFailures = this.getNumber('PAYMENTS_PROVIDER_CB_FAILURES', 3);
    this.cbCooldownMs = this.getNumber('PAYMENTS_PROVIDER_CB_COOLDOWN_MS', 60_000);
    this.providerTimeoutMs = this.getNumber('PAYMENTS_PROVIDER_TIMEOUT_MS', 8_000);
    let retryBackoffBaseMs = this.getNumber('PAYMENTS_PROVIDER_RETRY_BASE_MS', 100);
    let retryBackoffMaxMs = this.getNumber('PAYMENTS_PROVIDER_RETRY_MAX_MS', 3000);
    if (retryBackoffMaxMs < retryBackoffBaseMs) {
      this.log.warn(
        this.correlationLogJson({
          event: 'payments_v2.retry_backoff_max_clamped',
          baseMs: retryBackoffBaseMs,
          configuredMaxMs: retryBackoffMaxMs,
          appliedMaxMs: retryBackoffBaseMs,
        }),
      );
      retryBackoffMaxMs = retryBackoffBaseMs;
    }
    this.retryBackoffBaseMs = retryBackoffBaseMs;
    this.retryBackoffMaxMs = retryBackoffMaxMs;
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
        this.correlationLogJson({
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

  private correlationFields(): Record<string, string> {
    const id = this.correlationContext.getId();
    return id ? { correlationId: id } : {};
  }

  private correlationLogJson(payload: Record<string, unknown>): string {
    return JSON.stringify({ ...payload, ...this.correlationFields() });
  }

  /**
   * Normaliza la cabecera `Idempotency-Key` (incl. duplicados → primera entrada) y valida tamaño/charset.
   *
   * @returns `undefined` si no hay clave usable; lanza `BadRequestException` si el valor es inválido.
   */
  private parseOptionalIdempotencyKey(raw: string | string[] | undefined): string | undefined {
    if (raw === undefined) return undefined;
    const first = Array.isArray(raw) ? raw[0] : raw;
    if (first === undefined || first === null) return undefined;
    if (typeof first !== 'string') return undefined;
    const trimmed = first.trim();
    if (trimmed === '') return undefined;
    if (trimmed.length > PaymentsV2Service.IDEMPOTENCY_KEY_MAX_LEN) {
      throw new BadRequestException('Invalid Idempotency-Key');
    }
    if (!PaymentsV2Service.IDEMPOTENCY_KEY_PATTERN.test(trimmed)) {
      throw new BadRequestException('Invalid Idempotency-Key');
    }
    return trimmed;
  }

  /** Huella fija para claves Redis; el valor canónico sigue en BD y en comparaciones de payload. */
  private idempotencyKeyRedisTag(idempotencyKey: string): string {
    return createHash('sha256').update(idempotencyKey, 'utf8').digest('hex');
  }

  async createIntent(
    merchantId: string,
    dto: CreatePaymentIntentDto,
    idempotencyKey?: string | string[],
  ): Promise<OperationResult> {
    idempotencyKey = this.parseOptionalIdempotencyKey(idempotencyKey);
    this.assertMerchantEnabled(merchantId);
    await this.assertPaymentLinkConsistency(merchantId, dto.paymentLinkId, dto.amountMinor, dto.currency);

    if (idempotencyKey) {
      const existing = await this.resolveIdempotentPayment(merchantId, idempotencyKey, dto);
      if (existing) {
        const nextAction = await this.resolveCreateNextActionForExisting(existing);
        return { payment: existing, nextAction };
      }
    }

    await this.merchantRateLimit.consumeIfNeeded(merchantId, 'create');

    const providerOrder = this.registry.orderedProviders();
    const currencyUpper = dto.currency.toUpperCase();
    const canSettleFees = await this.fee.hasActiveRateTableForAnyProvider(
      merchantId,
      currencyUpper,
      providerOrder,
    );
    if (!canSettleFees) {
      throw new ConflictException(
        'No hay tarifas configuradas (MerchantRateTable activa) para esta divisa con ningún proveedor. Configura tarifas o usa una divisa soportada.',
      );
    }

    const selectedProvider = providerOrder[0];
    let payment: OperationResult['payment'];
    try {
      payment = await this.prisma.payment.create({
        data: {
          merchantId,
          paymentLinkId: dto.paymentLinkId ?? null,
          idempotencyKey: idempotencyKey ?? null,
          createPayloadHash: hashCreatePaymentIntentPayload(dto),
          amountMinor: dto.amountMinor,
          currency: currencyUpper,
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
            this.correlationLogJson({
              event: 'payments_v2.create_intent.idempotent_race',
              merchantId,
              paymentId: existing.id,
            }),
          );
          const nextAction = await this.resolveCreateNextActionForExisting(existing);
          return { payment: existing, nextAction };
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

  async capture(
    merchantId: string,
    paymentId: string,
    idempotencyKey?: string | string[],
  ): Promise<OperationResult> {
    idempotencyKey = this.parseOptionalIdempotencyKey(idempotencyKey);
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

    await this.merchantRateLimit.consumeIfNeeded(merchantId, 'capture');

    const payment = await this.findMerchantPayment(merchantId, paymentId);
    if (payment.status === PAYMENT_V2_STATUS.SUCCEEDED) {
      return { payment, nextAction: null };
    }
    if (payment.status === PAYMENT_V2_STATUS.DISPUTED) {
      throw new ConflictException('Payment is in dispute; capture is not applicable until the dispute is resolved.');
    }
    if (payment.status !== PAYMENT_V2_STATUS.AUTHORIZED) {
      throw new ConflictException(
        'Payment is not capturable: status must be authorized.',
      );
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
      const providerOrder = this.registry.orderedProviders(this.toProviderName(payment.selectedProvider));
      const result = await this.executeProviderOperation(payment, 'capture', payment.amountMinor, providerOrder);
      await this.completePaymentOperation({ merchantId, paymentId, operation: 'capture', finalStatus: '' });
      return result;
    } catch (error) {
      await this.releasePaymentOperationLockForRetry({
        merchantId,
        paymentId,
        operation: 'capture',
        idempotencyKey,
      });
      this.log.warn(
        this.correlationLogJson({
          event: 'payments_v2.operation_lock_released_after_error',
          paymentId,
          operation: 'capture',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw error;
    }
  }

  async cancel(
    merchantId: string,
    paymentId: string,
    idempotencyKey?: string | string[],
  ): Promise<OperationResult> {
    idempotencyKey = this.parseOptionalIdempotencyKey(idempotencyKey);
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

    const payment = await this.findMerchantPayment(merchantId, paymentId);
    if (
      payment.status === PAYMENT_V2_STATUS.CANCELED ||
      payment.status === PAYMENT_V2_STATUS.FAILED ||
      payment.status === PAYMENT_V2_STATUS.REFUNDED ||
      payment.status === PAYMENT_V2_STATUS.DISPUTE_LOST
    ) {
      return { payment, nextAction: null };
    }
    if (payment.status === PAYMENT_V2_STATUS.SUCCEEDED) {
      throw new ConflictException('Succeeded payment must be refunded, not canceled');
    }
    if (payment.status === PAYMENT_V2_STATUS.DISPUTED) {
      throw new ConflictException('Payment is in dispute; cancel is not applicable until the dispute is resolved.');
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
      const providerOrder = this.registry.orderedProviders(this.toProviderName(payment.selectedProvider));
      const result = await this.executeProviderOperation(payment, 'cancel', payment.amountMinor, providerOrder);
      await this.completePaymentOperation({ merchantId, paymentId, operation: 'cancel', finalStatus: '' });
      return result;
    } catch (error) {
      await this.releasePaymentOperationLockForRetry({
        merchantId,
        paymentId,
        operation: 'cancel',
        idempotencyKey,
      });
      this.log.warn(
        this.correlationLogJson({
          event: 'payments_v2.operation_lock_released_after_error',
          paymentId,
          operation: 'cancel',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw error;
    }
  }

  async refund(
    merchantId: string,
    paymentId: string,
    amountMinor?: number,
    idempotencyKey?: string | string[],
  ): Promise<OperationResult> {
    idempotencyKey = this.parseOptionalIdempotencyKey(idempotencyKey);
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

    await this.merchantRateLimit.consumeIfNeeded(merchantId, 'refund');

    const claim = await this.claimPaymentOperation({
      merchantId,
      paymentId,
      operation: 'refund',
      payloadHash: refundPayloadHash,
    });
    if (!claim.proceed) {
      return { payment: claim.payment, nextAction: null };
    }

    let refundLockOutcome: 'complete' | 'release' = 'complete';
    try {
      const providerOrder = this.registry.orderedProviders(this.toProviderName(payment.selectedProvider));
      return await this.executeProviderOperation(payment, 'refund', refundAmount, providerOrder);
    } catch (error) {
      if (error instanceof RefundProviderFailedError) {
        refundLockOutcome = 'release';
        throw new ConflictException({
          message: 'Refund failed; payment remains succeeded and can be retried',
          paymentId: error.paymentId,
          reasonCode: error.reasonCode,
        });
      }
      refundLockOutcome = 'release';
      throw error;
    } finally {
      if (refundLockOutcome === 'complete') {
        await this.completePaymentOperation({ merchantId, paymentId, operation: 'refund', finalStatus: '' });
      } else {
        await this.releasePaymentOperationLockForRetry({
          merchantId,
          paymentId,
          operation: 'refund',
          idempotencyKey,
        });
      }
    }
  }

  async getMetricsSnapshot() {
    return {
      payments: this.observability.snapshot(),
      circuitBreakers: await this.getCircuitBreakerSnapshot(),
      webhooks: await this.webhooks.getQueueSnapshot(),
    };
  }

  /**
   * Construye el `where` de Prisma para listados y agregados ops sobre `Payment`.
   *
   * `paymentId`: subcadena case-insensitive sobre `Payment.id` (id persistido). Restaurado para alinearlo con el uso histórico del panel ops; las búsquedas por subcadena pueden ser más costosas en tablas muy grandes.
   *
   * @param params.status - Si se omite, el conjunto no se restringe por estado (p. ej. conteos agrupados).
   */
  private buildOpsPaymentListWhere(params: {
    merchantId?: string;
    paymentId?: string;
    status?: string;
    provider?: PaymentProviderName;
    createdFrom?: string;
    createdTo?: string;
  }): Prisma.PaymentWhereInput {
    const createdAt: Prisma.DateTimeFilter = {};
    if (params.createdFrom) {
      createdAt.gte = new Date(params.createdFrom);
    }
    if (params.createdTo) {
      createdAt.lte = new Date(params.createdTo);
    }

    const paymentId = params.paymentId?.trim();
    return {
      ...(params.merchantId ? { merchantId: params.merchantId } : {}),
      ...(paymentId ? { id: { contains: paymentId, mode: 'insensitive' } } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.provider ? { selectedProvider: params.provider } : {}),
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
    };
  }

  private buildOpsMerchantFinanceFeeQuoteWhere(
    merchantId: string,
    query: {
      provider?: string;
      currency?: string;
      paymentId?: string;
      status?: string;
      createdFrom?: string;
      createdTo?: string;
    },
  ): Prisma.PaymentFeeQuoteWhereInput {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.createdFrom) {
      createdAt.gte = new Date(query.createdFrom);
    }
    if (query.createdTo) {
      createdAt.lte = new Date(query.createdTo);
    }

    const paymentId = query.paymentId?.trim();

    return {
      merchantId,
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.currency ? { currency: query.currency.toUpperCase() } : {}),
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
      ...(paymentId ? { paymentId: { startsWith: paymentId } } : {}),
      ...(query.status ? { payment: { status: query.status } } : {}),
    };
  }

  /** Rechaza rangos de fecha invertidos (misma semántica en summary, transacciones y payouts). */
  private assertMerchantFinanceDateOrder(createdFrom?: string, createdTo?: string): void {
    if (!createdFrom?.trim() || !createdTo?.trim()) {
      return;
    }
    const from = new Date(createdFrom);
    const to = new Date(createdTo);
    if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf())) {
      return;
    }
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('createdFrom must be before or equal to createdTo');
    }
  }

  /**
   * Pagos liquidados (`succeeded` / `refunded`) sin fila `PaymentFeeQuote` (datos legacy o huecos de ingesta).
   * Se suman al resumen como gross=net=`amountMinor`, fee=0, para no infraestimar ingresos en el panel.
   */
  private buildMerchantFinanceOrphanPaymentWhere(
    merchantId: string,
    query: Pick<OpsMerchantFinanceSummaryQueryDto, 'provider' | 'currency' | 'createdFrom' | 'createdTo'>,
  ): Prisma.PaymentWhereInput {
    const succeededAt: Prisma.DateTimeFilter = {};
    if (query.createdFrom) {
      succeededAt.gte = new Date(query.createdFrom);
    }
    if (query.createdTo) {
      succeededAt.lte = new Date(query.createdTo);
    }

    return {
      merchantId,
      feeQuote: null,
      status: { in: [PAYMENT_V2_STATUS.SUCCEEDED, PAYMENT_V2_STATUS.REFUNDED] },
      succeededAt: { not: null, ...succeededAt },
      ...(query.currency ? { currency: query.currency.toUpperCase() } : {}),
      ...(query.provider ? { selectedProvider: query.provider } : {}),
    };
  }

  /**
   * Totales de `PaymentFeeQuote` con la misma semántica que `buildOpsMerchantFinanceFeeQuoteWhere`.
   * `SUM` en SQL y resultado `::text` para no perder precisión vía `number` del driver (cf. `getOpsVolumeHourlySeries`).
   */
  private async sumOpsMerchantFinanceFeeQuotesSql(
    merchantId: string,
    query: Parameters<PaymentsV2Service['buildOpsMerchantFinanceFeeQuoteWhere']>[1],
  ): Promise<{ gross: bigint; fee: bigint; net: bigint }> {
    const createdFrom = query.createdFrom ? new Date(query.createdFrom) : null;
    const createdTo = query.createdTo ? new Date(query.createdTo) : null;
    const paymentIdPrefix = query.paymentId?.trim();
    const currency = query.currency?.toUpperCase();
    const provider = query.provider;
    const status = query.status;

    const joinSql = status
      ? Prisma.sql`INNER JOIN "Payment" p ON p.id = fq.payment_id`
      : Prisma.empty;
    const providerSql = provider ? Prisma.sql`AND fq.provider = ${provider}` : Prisma.empty;
    const currencySql = currency ? Prisma.sql`AND fq.currency = ${currency}` : Prisma.empty;
    const createdFromSql = createdFrom ? Prisma.sql`AND fq.created_at >= ${createdFrom}` : Prisma.empty;
    const createdToSql = createdTo ? Prisma.sql`AND fq.created_at <= ${createdTo}` : Prisma.empty;
    const paymentIdSql = paymentIdPrefix
      ? Prisma.sql`AND fq.payment_id LIKE ${`${paymentIdPrefix}%`}`
      : Prisma.empty;
    const statusSql = status ? Prisma.sql`AND p.status = ${status}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<Array<{ gross: string; fee: string; net: string }>>(
      Prisma.sql`
        SELECT
          COALESCE(SUM(fq.gross_minor), 0)::text AS gross,
          COALESCE(SUM(fq.fee_minor), 0)::text AS fee,
          COALESCE(SUM(fq.net_minor), 0)::text AS net
        FROM "PaymentFeeQuote" fq
        ${joinSql}
        WHERE fq.merchant_id = ${merchantId}
        ${providerSql}
        ${currencySql}
        ${createdFromSql}
        ${createdToSql}
        ${paymentIdSql}
        ${statusSql}
      `,
    );
    const row = rows[0];
    return {
      gross: BigInt(row?.gross ?? '0'),
      fee: BigInt(row?.fee ?? '0'),
      net: BigInt(row?.net ?? '0'),
    };
  }

  /**
   * Suma de pagos liquidados sin fila `PaymentFeeQuote` (misma semántica que `buildMerchantFinanceOrphanPaymentWhere`).
   */
  private async sumOpsMerchantFinanceOrphanPaymentsSql(
    merchantId: string,
    query: Pick<OpsMerchantFinanceSummaryQueryDto, 'provider' | 'currency' | 'createdFrom' | 'createdTo'>,
  ): Promise<bigint> {
    const createdFrom = query.createdFrom ? new Date(query.createdFrom) : null;
    const createdTo = query.createdTo ? new Date(query.createdTo) : null;
    const currency = query.currency?.toUpperCase();
    const selectedProvider = query.provider;

    const currencySql = currency ? Prisma.sql`AND p.currency = ${currency}` : Prisma.empty;
    const providerSql = selectedProvider
      ? Prisma.sql`AND p.selected_provider = ${selectedProvider}`
      : Prisma.empty;
    const createdFromSql = createdFrom ? Prisma.sql`AND p.succeeded_at >= ${createdFrom}` : Prisma.empty;
    const createdToSql = createdTo ? Prisma.sql`AND p.succeeded_at <= ${createdTo}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<Array<{ orphan_gross: string }>>(
      Prisma.sql`
        SELECT COALESCE(SUM(p.amount_minor), 0)::text AS orphan_gross
        FROM "Payment" p
        WHERE p.merchant_id = ${merchantId}
          AND NOT EXISTS (
            SELECT 1 FROM "PaymentFeeQuote" fq WHERE fq.payment_id = p.id
          )
          AND p.status IN (${PAYMENT_V2_STATUS.SUCCEEDED}, ${PAYMENT_V2_STATUS.REFUNDED})
          AND p.succeeded_at IS NOT NULL
          ${createdFromSql}
          ${createdToSql}
          ${currencySql}
          ${providerSql}
      `,
    );
    return BigInt(rows[0]?.orphan_gross ?? '0');
  }

  async getOpsMerchantFinanceSummary(merchantId: string, query: OpsMerchantFinanceSummaryQueryDto) {
    this.assertMerchantFinanceDateOrder(query.createdFrom, query.createdTo);
    const [quoteSums, orphanGross] = await Promise.all([
      this.sumOpsMerchantFinanceFeeQuotesSql(merchantId, query),
      this.sumOpsMerchantFinanceOrphanPaymentsSql(merchantId, query),
    ]);

    return {
      merchantId,
      currency: query.currency?.toUpperCase() ?? null,
      totals: {
        grossMinor: (quoteSums.gross + orphanGross).toString(),
        feeMinor: quoteSums.fee.toString(),
        netMinor: (quoteSums.net + orphanGross).toString(),
      },
    };
  }

  /**
   * Listado de quotes de comisión por merchant (panel ops). Keyset estable `createdAt desc, id desc`.
   *
   * @param query.includeTotal - Por defecto `true`. Con `false` no se ejecuta `count()`; `page.total` y `page.totalPages` serán `null`.
   */
  async listOpsMerchantFinanceTransactions(merchantId: string, query: OpsMerchantFinanceTransactionsQueryDto) {
    this.assertMerchantFinanceDateOrder(query.createdFrom, query.createdTo);
    const includeTotal = query.includeTotal !== false;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    if (page > 1) {
      throw new BadRequestException({
        message: 'Pagination is cursor-based. Use cursorCreatedAt + cursorId (+ direction) instead of page>1.',
        hint: 'Call first page with page=1 (or omit), then pass the returned cursor to navigate.',
      });
    }

    const direction: 'next' | 'prev' = query.direction ?? 'next';
    const cursorCreatedAt = query.cursorCreatedAt ? new Date(query.cursorCreatedAt) : null;
    const cursorId = query.cursorId ?? null;
    if ((cursorCreatedAt && !cursorId) || (!cursorCreatedAt && cursorId)) {
      throw new BadRequestException('cursorCreatedAt and cursorId must be provided together');
    }
    if (cursorCreatedAt && Number.isNaN(cursorCreatedAt.valueOf())) {
      throw new BadRequestException('Invalid cursorCreatedAt');
    }

    const where = this.buildOpsMerchantFinanceFeeQuoteWhere(merchantId, query);
    const orderBy: Prisma.PaymentFeeQuoteOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }];

    const feeQuoteSelect = {
      id: true,
      paymentId: true,
      merchantId: true,
      provider: true,
      currency: true,
      grossMinor: true,
      feeMinor: true,
      netMinor: true,
      settlementMode: true,
      createdAt: true,
      payment: {
        select: {
          id: true,
          status: true,
          selectedProvider: true,
          createdAt: true,
        },
      },
    } as const;

    const [total, rows, hasPrevPage, hasNextPage] = await this.prisma.$transaction(async (tx) => {
      const totalCountPromise = includeTotal ? tx.paymentFeeQuote.count({ where }) : null;

      let keysetWhere: Prisma.PaymentFeeQuoteWhereInput = where;
      if (cursorCreatedAt && cursorId) {
        const boundaryClause: Prisma.PaymentFeeQuoteWhereInput =
          direction === 'next'
            ? {
                OR: [
                  { createdAt: { lt: cursorCreatedAt } },
                  { createdAt: cursorCreatedAt, id: { lt: cursorId } },
                ],
              }
            : {
                OR: [
                  { createdAt: { gt: cursorCreatedAt } },
                  { createdAt: cursorCreatedAt, id: { gt: cursorId } },
                ],
              };

        keysetWhere = {
          AND: [where, boundaryClause],
        };
      }

      const queryOrderBy: Prisma.PaymentFeeQuoteOrderByWithRelationInput[] =
        direction === 'next' ? orderBy : [{ createdAt: 'asc' }, { id: 'asc' }];

      const rawRows = await tx.paymentFeeQuote.findMany({
        where: keysetWhere,
        orderBy: queryOrderBy,
        take: pageSize + 1,
        select: feeQuoteSelect,
      });

      const hasMoreInDirection = rawRows.length > pageSize;
      const trimmed = hasMoreInDirection ? rawRows.slice(0, pageSize) : rawRows;
      const normalized = direction === 'next' ? trimmed : trimmed.slice().reverse();

      let prevExists = false;
      let nextExists = false;
      if (!includeTotal) {
        const hasCursor = Boolean(cursorCreatedAt && cursorId);
        prevExists = direction === 'prev' ? hasMoreInDirection : hasCursor;
        nextExists = direction === 'next' ? hasMoreInDirection : hasCursor;
      }
      if (normalized.length > 0) {
        const first = normalized[0];
        const last = normalized[normalized.length - 1];

        if (includeTotal && direction === 'next') {
          nextExists = hasMoreInDirection;

          const prevWhere: Prisma.PaymentFeeQuoteWhereInput = {
            AND: [
              where,
              {
                OR: [
                  { createdAt: { gt: first.createdAt } },
                  { createdAt: first.createdAt, id: { gt: first.id } },
                ],
              },
            ],
          };
          const prevRow = await tx.paymentFeeQuote.findFirst({ where: prevWhere, select: { id: true } });
          prevExists = Boolean(prevRow);
        } else {
          const prevWhere: Prisma.PaymentFeeQuoteWhereInput = {
            AND: [
              where,
              {
                OR: [
                  { createdAt: { gt: first.createdAt } },
                  { createdAt: first.createdAt, id: { gt: first.id } },
                ],
              },
            ],
          };
          const nextWhere: Prisma.PaymentFeeQuoteWhereInput = {
            AND: [
              where,
              {
                OR: [
                  { createdAt: { lt: last.createdAt } },
                  { createdAt: last.createdAt, id: { lt: last.id } },
                ],
              },
            ],
          };

          const [prevRow, nextRow] = await Promise.all([
            tx.paymentFeeQuote.findFirst({ where: prevWhere, select: { id: true } }),
            tx.paymentFeeQuote.findFirst({ where: nextWhere, select: { id: true } }),
          ]);
          prevExists = Boolean(prevRow);
          nextExists = Boolean(nextRow);
        }
      }

      if (includeTotal && totalCountPromise) {
        const totalCount = await totalCountPromise;
        return [totalCount, normalized, prevExists, nextExists] as const;
      }
      return [null, normalized, prevExists, nextExists] as const;
    });

    const items = rows.map((row) => ({
      id: row.id,
      paymentId: row.paymentId,
      merchantId: row.merchantId,
      provider: row.provider,
      selectedProvider: row.payment.selectedProvider,
      status: row.payment.status,
      currency: row.currency,
      settlementMode: row.settlementMode,
      grossMinor: BigInt(row.grossMinor).toString(),
      feeMinor: BigInt(row.feeMinor).toString(),
      netMinor: BigInt(row.netMinor).toString(),
      createdAt: row.createdAt,
      paymentCreatedAt: row.payment.createdAt,
    }));

    const totalPages = total != null ? Math.max(1, Math.ceil(total / pageSize)) : null;
    const prevCursor =
      items.length > 0 ? { createdAt: items[0].createdAt.toISOString(), id: items[0].id } : null;
    const nextCursor =
      items.length > 0
        ? { createdAt: items[items.length - 1].createdAt.toISOString(), id: items[items.length - 1].id }
        : null;

    return {
      items,
      page: {
        pageSize,
        total,
        totalPages,
        hasPrevPage,
        hasNextPage,
      },
      cursors: {
        prev: prevCursor,
        next: nextCursor,
      },
    };
  }

  /**
   * Listado de payouts por merchant (panel ops). Keyset estable `createdAt desc, id desc`.
   *
   * @param query.includeTotal - Por defecto `true`. Con `false` no se ejecuta `count()`; `page.total` y `page.totalPages` serán `null`.
   */
  async listOpsMerchantFinancePayouts(merchantId: string, query: OpsMerchantFinancePayoutsQueryDto) {
    this.assertMerchantFinanceDateOrder(query.createdFrom, query.createdTo);
    const includeTotal = query.includeTotal !== false;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    if (page > 1) {
      throw new BadRequestException({
        message: 'Pagination is cursor-based. Use cursorCreatedAt + cursorId (+ direction) instead of page>1.',
        hint: 'Call first page with page=1 (or omit), then pass the returned cursor to navigate.',
      });
    }

    const direction: 'next' | 'prev' = query.direction ?? 'next';
    const cursorCreatedAt = query.cursorCreatedAt ? new Date(query.cursorCreatedAt) : null;
    const cursorId = query.cursorId ?? null;
    if ((cursorCreatedAt && !cursorId) || (!cursorCreatedAt && cursorId)) {
      throw new BadRequestException('cursorCreatedAt and cursorId must be provided together');
    }
    if (cursorCreatedAt && Number.isNaN(cursorCreatedAt.valueOf())) {
      throw new BadRequestException('Invalid cursorCreatedAt');
    }

    const createdAt: Prisma.DateTimeFilter = {};
    if (query.createdFrom) {
      createdAt.gte = new Date(query.createdFrom);
    }
    if (query.createdTo) {
      createdAt.lte = new Date(query.createdTo);
    }
    const where: Prisma.PayoutWhereInput = {
      merchantId,
      ...(query.currency ? { currency: query.currency.toUpperCase() } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
    };

    const orderBy: Prisma.PayoutOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }];

    const payoutSelect = {
      id: true,
      merchantId: true,
      currency: true,
      status: true,
      windowStartAt: true,
      windowEndAt: true,
      grossMinor: true,
      feeMinor: true,
      netMinor: true,
      createdAt: true,
    } as const;

    const [total, rows, hasPrevPage, hasNextPage] = await this.prisma.$transaction(async (tx) => {
      const totalCountPromise = includeTotal ? tx.payout.count({ where }) : null;

      let keysetWhere: Prisma.PayoutWhereInput = where;
      if (cursorCreatedAt && cursorId) {
        const boundaryClause: Prisma.PayoutWhereInput =
          direction === 'next'
            ? {
                OR: [
                  { createdAt: { lt: cursorCreatedAt } },
                  { createdAt: cursorCreatedAt, id: { lt: cursorId } },
                ],
              }
            : {
                OR: [
                  { createdAt: { gt: cursorCreatedAt } },
                  { createdAt: cursorCreatedAt, id: { gt: cursorId } },
                ],
              };

        keysetWhere = {
          AND: [where, boundaryClause],
        };
      }

      const queryOrderBy: Prisma.PayoutOrderByWithRelationInput[] =
        direction === 'next' ? orderBy : [{ createdAt: 'asc' }, { id: 'asc' }];

      const rawRows = await tx.payout.findMany({
        where: keysetWhere,
        orderBy: queryOrderBy,
        take: pageSize + 1,
        select: payoutSelect,
      });

      const hasMoreInDirection = rawRows.length > pageSize;
      const trimmed = hasMoreInDirection ? rawRows.slice(0, pageSize) : rawRows;
      const normalized = direction === 'next' ? trimmed : trimmed.slice().reverse();

      let prevExists = false;
      let nextExists = false;
      if (!includeTotal) {
        const hasCursor = Boolean(cursorCreatedAt && cursorId);
        prevExists = direction === 'prev' ? hasMoreInDirection : hasCursor;
        nextExists = direction === 'next' ? hasMoreInDirection : hasCursor;
      }
      if (normalized.length > 0) {
        const first = normalized[0];
        const last = normalized[normalized.length - 1];

        if (includeTotal && direction === 'next') {
          nextExists = hasMoreInDirection;

          const prevWhere: Prisma.PayoutWhereInput = {
            AND: [
              where,
              {
                OR: [
                  { createdAt: { gt: first.createdAt } },
                  { createdAt: first.createdAt, id: { gt: first.id } },
                ],
              },
            ],
          };
          const prevRow = await tx.payout.findFirst({ where: prevWhere, select: { id: true } });
          prevExists = Boolean(prevRow);
        } else {
          const prevWhere: Prisma.PayoutWhereInput = {
            AND: [
              where,
              {
                OR: [
                  { createdAt: { gt: first.createdAt } },
                  { createdAt: first.createdAt, id: { gt: first.id } },
                ],
              },
            ],
          };
          const nextWhere: Prisma.PayoutWhereInput = {
            AND: [
              where,
              {
                OR: [
                  { createdAt: { lt: last.createdAt } },
                  { createdAt: last.createdAt, id: { lt: last.id } },
                ],
              },
            ],
          };

          const [prevRow, nextRow] = await Promise.all([
            tx.payout.findFirst({ where: prevWhere, select: { id: true } }),
            tx.payout.findFirst({ where: nextWhere, select: { id: true } }),
          ]);
          prevExists = Boolean(prevRow);
          nextExists = Boolean(nextRow);
        }
      }

      if (includeTotal && totalCountPromise) {
        const totalCount = await totalCountPromise;
        return [totalCount, normalized, prevExists, nextExists] as const;
      }
      return [null, normalized, prevExists, nextExists] as const;
    });

    const items = rows.map((row) => ({
      id: row.id,
      merchantId: row.merchantId,
      currency: row.currency,
      status: row.status,
      windowStartAt: row.windowStartAt,
      windowEndAt: row.windowEndAt,
      grossMinor: BigInt(row.grossMinor).toString(),
      feeMinor: BigInt(row.feeMinor).toString(),
      netMinor: BigInt(row.netMinor).toString(),
      createdAt: row.createdAt,
    }));

    const totalPages = total != null ? Math.max(1, Math.ceil(total / pageSize)) : null;
    const prevCursor =
      items.length > 0 ? { createdAt: items[0].createdAt.toISOString(), id: items[0].id } : null;
    const nextCursor =
      items.length > 0
        ? { createdAt: items[items.length - 1].createdAt.toISOString(), id: items[items.length - 1].id }
        : null;

    return {
      items,
      page: {
        pageSize,
        total,
        totalPages,
        hasPrevPage,
        hasNextPage,
      },
      cursors: {
        prev: prevCursor,
        next: nextCursor,
      },
    };
  }

  /**
   * Conteos por `status` para el panel ops: mismos filtros base que `listOpsTransactions` sin `status` en el where.
   * Una sola consulta `groupBy` sustituye múltiples `count()` del listado con `includeTotal`.
   */
  async getOpsTransactionCounts(query: OpsTransactionCountsQueryDto) {
    const where = this.buildOpsPaymentListWhere({
      merchantId: query.merchantId,
      paymentId: query.paymentId,
      provider: query.provider,
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
    });

    const rows = await this.prisma.payment.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      const c = row._count._all;
      byStatus[row.status] = c;
      total += c;
    }
    return { total, byStatus };
  }

  /**
   * Volumen acumulado por hora (UTC) de pagos `succeeded` para hoy y ayer, para comparar en un mismo eje 0–23h.
   * Agrupa y filtra por `succeeded_at` (momento de captura/éxito), no por `created_at`, para alinear el volumen
   * con el día UTC en que el pago pasó a `succeeded` (índice `@@index([status, currency, succeededAt])` en `Payment`).
   * En JSON, acumulados por hora y totales se serializan como **strings** (enteros en `amount_minor`) para no perder
   * precisión fuera de `Number.MAX_SAFE_INTEGER`.
   */
  async getOpsVolumeHourlySeries(query: OpsVolumeHourlyQueryDto) {
    const currency = (query.currency ?? 'EUR').toUpperCase();
    const now = new Date();
    const y = now.getUTCFullYear();
    const mo = now.getUTCMonth();
    const day = now.getUTCDate();
    const todayStart = new Date(Date.UTC(y, mo, day, 0, 0, 0, 0));
    const tomorrowStart = new Date(Date.UTC(y, mo, day + 1, 0, 0, 0, 0));
    const yesterdayStart = new Date(Date.UTC(y, mo, day - 1, 0, 0, 0, 0));
    const utcHourNow = now.getUTCHours();

    const merchantSql =
      query.merchantId && query.merchantId.trim() !== ''
        ? Prisma.sql`AND p.merchant_id = ${query.merchantId.trim()}`
        : Prisma.empty;
    const providerSql = query.provider
      ? Prisma.sql`AND p.selected_provider = ${query.provider}`
      : Prisma.empty;

    const queryHourly = async (rangeStart: Date, rangeEnd: Date): Promise<bigint[]> => {
      const hourly = new Array<bigint>(24).fill(0n);
      const rows = await this.prisma.$queryRaw<Array<{ hour: number; vol: bigint }>>(
        Prisma.sql`
          SELECT
            (EXTRACT(HOUR FROM (p.succeeded_at AT TIME ZONE 'UTC')))::int AS hour,
            COALESCE(SUM(p.amount_minor), 0)::bigint AS vol
          FROM "Payment" p
          WHERE p.status = ${PAYMENT_V2_STATUS.SUCCEEDED}
            AND p.currency = ${currency}
            AND p.succeeded_at IS NOT NULL
            AND p.succeeded_at >= ${rangeStart}
            AND p.succeeded_at < ${rangeEnd}
            ${merchantSql}
            ${providerSql}
          GROUP BY 1
          ORDER BY 1
        `,
      );
      for (const row of rows) {
        const h = row.hour;
        if (h >= 0 && h < 24) {
          hourly[h] = row.vol;
        }
      }
      return hourly;
    };

    const [todayHourly, yesterdayHourly] = await Promise.all([
      queryHourly(todayStart, tomorrowStart),
      queryHourly(yesterdayStart, todayStart),
    ]);

    const toCumulative = (hourly: bigint[]): string[] => {
      const out: string[] = [];
      let sum = 0n;
      for (let i = 0; i < 24; i++) {
        sum += hourly[i] ?? 0n;
        out.push(sum.toString());
      }
      return out;
    };

    const yesterdayCumulative = toCumulative(yesterdayHourly);
    const todayCumulativeFull = toCumulative(todayHourly);
    const todayCumulative: (string | null)[] = todayCumulativeFull.map((v, h) =>
      h > utcHourNow ? null : v,
    );

    let todayVolumeMinor = 0n;
    for (let i = 0; i <= utcHourNow; i++) {
      todayVolumeMinor += todayHourly[i] ?? 0n;
    }
    const yesterdayVolumeMinor = yesterdayHourly.reduce((a, b) => a + b, 0n);

    const labels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

    return {
      dayBoundary: 'UTC' as const,
      currency,
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      labels,
      todayCumulativeVolumeMinor: todayCumulative,
      yesterdayCumulativeVolumeMinor: yesterdayCumulative,
      totals: {
        todayVolumeMinor: todayVolumeMinor.toString(),
        yesterdayVolumeMinor: yesterdayVolumeMinor.toString(),
      },
    };
  }

  /**
   * Lista transacciones para monitoreo interno con filtros operativos y último intento de provider.
   *
   * @param query.includeTotal - Por defecto `true`. Con `false` no se ejecuta `count()`; `page.total` y `page.totalPages` serán `null`.
   */
  async listOpsTransactions(query: ListOpsTransactionsDto) {
    const includeTotal = query.includeTotal !== false;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    if (page > 1) {
      throw new BadRequestException({
        message: 'Pagination is cursor-based. Use cursorCreatedAt + cursorId (+ direction) instead of page>1.',
        hint: 'Call first page with page=1 (or omit), then pass the returned cursor to navigate.',
      });
    }

    const direction: 'next' | 'prev' = query.direction ?? 'next';
    const cursorCreatedAt = query.cursorCreatedAt ? new Date(query.cursorCreatedAt) : null;
    const cursorId = query.cursorId ?? null;
    if ((cursorCreatedAt && !cursorId) || (!cursorCreatedAt && cursorId)) {
      throw new BadRequestException('cursorCreatedAt and cursorId must be provided together');
    }
    if (cursorCreatedAt && Number.isNaN(cursorCreatedAt.valueOf())) {
      throw new BadRequestException('Invalid cursorCreatedAt');
    }

    const where = this.buildOpsPaymentListWhere({
      merchantId: query.merchantId,
      paymentId: query.paymentId,
      status: query.status,
      provider: query.provider,
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
    });

    const orderBy: Prisma.PaymentOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }];

    const [total, rowsPlusOne, hasPrevPage, hasNextPage] = await this.prisma.$transaction(async (tx) => {
      const totalCountPromise = includeTotal ? tx.payment.count({ where }) : null;

      let keysetWhere: Prisma.PaymentWhereInput = where;
      if (cursorCreatedAt && cursorId) {
        const boundaryClause: Prisma.PaymentWhereInput =
          direction === 'next'
            ? {
                OR: [
                  { createdAt: { lt: cursorCreatedAt } },
                  { createdAt: cursorCreatedAt, id: { lt: cursorId } },
                ],
              }
            : {
                OR: [
                  { createdAt: { gt: cursorCreatedAt } },
                  { createdAt: cursorCreatedAt, id: { gt: cursorId } },
                ],
              };

        keysetWhere = {
          AND: [where, boundaryClause],
        };
      }

      const queryOrderBy: Prisma.PaymentOrderByWithRelationInput[] =
        direction === 'next' ? orderBy : [{ createdAt: 'asc' }, { id: 'asc' }];

      const rows = await tx.payment.findMany({
        where: keysetWhere,
        orderBy: queryOrderBy,
        take: pageSize + 1,
        select: {
          id: true,
          merchantId: true,
          status: true,
          statusReason: true,
          amountMinor: true,
          currency: true,
          selectedProvider: true,
          providerRef: true,
          createdAt: true,
          updatedAt: true,
          lastAttemptAt: true,
          succeededAt: true,
          failedAt: true,
          canceledAt: true,
          merchant: {
            select: {
              name: true,
            },
          },
          attempts: {
            orderBy: { createdAt: 'desc' },
            take: 1,
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
          },
        },
      });

      const hasMoreInDirection = rows.length > pageSize;
      const trimmed = hasMoreInDirection ? rows.slice(0, pageSize) : rows;
      const normalized = direction === 'next' ? trimmed : trimmed.slice().reverse();

      let prevExists = false;
      let nextExists = false;
      // En modo polling (includeTotal=false) evitamos queries extra: inferimos por dirección y cursor.
      // Importante: esto debe funcionar aunque la página quede vacía (p.ej. cursor fuera de rango por purgas concurrentes).
      if (!includeTotal) {
        const hasCursor = Boolean(cursorCreatedAt && cursorId);
        prevExists = direction === 'prev' ? hasMoreInDirection : hasCursor;
        nextExists = direction === 'next' ? hasMoreInDirection : hasCursor;
      }
      if (normalized.length > 0) {
        const first = normalized[0];
        const last = normalized[normalized.length - 1];

        if (includeTotal && direction === 'next') {
          // Ya hacemos `take: pageSize + 1`, así que `hasMoreInDirection` implica next page.
          nextExists = hasMoreInDirection;

          const prevWhere: Prisma.PaymentWhereInput = {
            AND: [
              where,
              {
                OR: [
                  { createdAt: { gt: first.createdAt } },
                  { createdAt: first.createdAt, id: { gt: first.id } },
                ],
              },
            ],
          };
          const prevRow = await tx.payment.findFirst({ where: prevWhere, select: { id: true } });
          prevExists = Boolean(prevRow);
        } else {
          const prevWhere: Prisma.PaymentWhereInput = {
            AND: [
              where,
              {
                OR: [
                  { createdAt: { gt: first.createdAt } },
                  { createdAt: first.createdAt, id: { gt: first.id } },
                ],
              },
            ],
          };
          const nextWhere: Prisma.PaymentWhereInput = {
            AND: [
              where,
              {
                OR: [
                  { createdAt: { lt: last.createdAt } },
                  { createdAt: last.createdAt, id: { lt: last.id } },
                ],
              },
            ],
          };

          const [prevRow, nextRow] = await Promise.all([
            tx.payment.findFirst({ where: prevWhere, select: { id: true } }),
            tx.payment.findFirst({ where: nextWhere, select: { id: true } }),
          ]);
          prevExists = Boolean(prevRow);
          nextExists = Boolean(nextRow);
        }
      }

      if (includeTotal && totalCountPromise) {
        const totalCount = await totalCountPromise;
        return [totalCount, normalized, prevExists, nextExists] as const;
      }
      return [null, normalized, prevExists, nextExists] as const;
    });

    const rows = rowsPlusOne;

    const items: OpsTransactionsItem[] = rows.map((row) => {
      const lastAttempt = row.attempts[0] ?? null;
      return {
        id: row.id,
        merchantId: row.merchantId,
        merchantName: row.merchant.name,
        status: row.status,
        statusReason: row.statusReason,
        amountMinor: row.amountMinor,
        currency: row.currency,
        selectedProvider: row.selectedProvider,
        providerRef: row.providerRef,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lastAttemptAt: row.lastAttemptAt,
        succeededAt: row.succeededAt,
        failedAt: row.failedAt,
        canceledAt: row.canceledAt,
        routingReasonCode: row.statusReason ?? lastAttempt?.errorCode ?? null,
        lastAttempt,
      };
    });

    const totalPages = total != null ? Math.max(1, Math.ceil(total / pageSize)) : null;
    const prevCursor =
      items.length > 0 ? { createdAt: items[0].createdAt.toISOString(), id: items[0].id } : null;
    const nextCursor =
      items.length > 0
        ? { createdAt: items[items.length - 1].createdAt.toISOString(), id: items[items.length - 1].id }
        : null;
    return {
      items,
      page: {
        pageSize,
        total,
        totalPages,
        hasPrevPage,
        hasNextPage,
      },
      cursors: {
        prev: prevCursor,
        next: nextCursor,
      },
    };
  }

  /**
   * Detalle operativo interno: pago por id interno con intentos de proveedor (cronológico ascendente).
   * Carga como máximo `OPS_PAYMENT_DETAIL_ATTEMPTS_MAX` (200) intentos **más recientes**; si hay más,
   * `attemptsTruncated` es true y `attemptsTotal` refleja el conteo completo.
   *
   * @param paymentId - `Payment.id` (cuid u otro id persistido).
   * @param options.includePayload - Si es true, cada intento incluye `responsePayload` (metadata de proveedor; solo depuración).
   * @returns Agregado listo para JSON (Nest serializa `Date` en ISO).
   * @throws NotFoundException si no existe el pago.
   */
  async getOpsPaymentDetail(
    paymentId: string,
    options?: { includePayload?: boolean; backofficeMerchantScopeId?: string },
  ) {
    const includePayload = options?.includePayload === true;
    const row = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        merchantId: true,
        status: true,
        statusReason: true,
        amountMinor: true,
        currency: true,
        selectedProvider: true,
        providerRef: true,
        idempotencyKey: true,
        paymentLinkId: true,
        rail: true,
        createdAt: true,
        updatedAt: true,
        lastAttemptAt: true,
        succeededAt: true,
        failedAt: true,
        canceledAt: true,
        merchant: { select: { name: true } },
      },
    });

    if (!row) {
      throw new NotFoundException({ message: 'Payment not found', paymentId });
    }

    const scopeId = options?.backofficeMerchantScopeId;
    if (scopeId && row.merchantId !== scopeId) {
      throw new NotFoundException({ message: 'Payment not found', paymentId });
    }

    const [attemptsTotal, attemptsDesc] = await Promise.all([
      this.prisma.paymentAttempt.count({ where: { paymentId } }),
      this.prisma.paymentAttempt.findMany({
        where: { paymentId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: OPS_PAYMENT_DETAIL_ATTEMPTS_MAX,
        select: opsPaymentDetailAttemptSelect(includePayload),
      }),
    ]);

    const attemptsChronological = attemptsDesc.slice().reverse();

    return {
      id: row.id,
      merchantId: row.merchantId,
      merchantName: row.merchant.name,
      status: row.status,
      statusReason: row.statusReason,
      amountMinor: row.amountMinor,
      currency: row.currency,
      selectedProvider: row.selectedProvider,
      providerRef: row.providerRef,
      idempotencyKey: row.idempotencyKey,
      paymentLinkId: row.paymentLinkId,
      rail: row.rail,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastAttemptAt: row.lastAttemptAt,
      succeededAt: row.succeededAt,
      failedAt: row.failedAt,
      canceledAt: row.canceledAt,
      attemptsTotal,
      attemptsTruncated: attemptsTotal > OPS_PAYMENT_DETAIL_ATTEMPTS_MAX,
      attempts: attemptsChronological.map((a) => {
        const base = {
          id: a.id,
          operation: a.operation,
          provider: a.provider,
          attemptNo: a.attemptNo,
          status: a.status,
          errorCode: a.errorCode,
          errorMessage: a.errorMessage,
          latencyMs: a.latencyMs,
          providerPaymentId: a.providerPaymentId,
          createdAt: a.createdAt,
        };
        if (!includePayload) {
          return base;
        }
        const withPayload = a as typeof base & { responsePayload?: unknown | null };
        return { ...base, responsePayload: withPayload.responsePayload ?? null };
      }),
    };
  }

  private async executeProviderOperation(
    payment: OperationResult['payment'],
    operation: PaymentOperation,
    amountMinor: number,
    providerOrder: PaymentProviderName[],
  ): Promise<OperationResult> {
    let lastProviderAttempted: PaymentProviderName | null = null;
    let lastTerminalFailureReason: PaymentReasonCode = 'provider_unavailable';
    for (let providerIndex = 0; providerIndex < providerOrder.length; providerIndex += 1) {
      const providerName = providerOrder[providerIndex];
      lastProviderAttempted = providerName;
      const isLastProvider = providerIndex === providerOrder.length - 1;
      const circuitGate = await this.resolveProviderCircuitGate(providerName);
      if (circuitGate.block) {
        lastTerminalFailureReason = 'provider_unavailable';
        await this.safeCreateAttempt(payment, operation, providerName, {
          status: PAYMENT_V2_STATUS.FAILED,
          reasonCode: 'provider_unavailable',
          reasonMessage: circuitGate.blockReason ?? 'Provider circuit breaker is open',
        }, 0);
        continue;
      }
      if (operation === 'capture') {
        const rateRow = await this.fee.findActiveRateTable(payment.merchantId, payment.currency, providerName);
        if (!rateRow) {
          lastTerminalFailureReason = 'fee_configuration_missing';
          await this.safeCreateAttempt(
            payment,
            operation,
            providerName,
            {
              status: PAYMENT_V2_STATUS.FAILED,
              reasonCode: 'fee_configuration_missing',
              reasonMessage: 'No active fee rate table for this currency and provider',
            },
            0,
          );
          continue;
        }
        const feeInput = {
          amountMinor: payment.amountMinor,
          percentageBps: rateRow.percentageBps,
          fixedMinor: rateRow.fixedMinor,
          minimumMinor: rateRow.minimumMinor,
        };
        if (FeeService.uncappedFeeMinor(feeInput) > payment.amountMinor) {
          lastTerminalFailureReason = 'fee_exceeds_gross';
          await this.safeCreateAttempt(
            payment,
            operation,
            providerName,
            {
              status: PAYMENT_V2_STATUS.FAILED,
              reasonCode: 'fee_exceeds_gross',
              reasonMessage:
                'Active fee rate would charge more than the payment gross; adjust the rate table or payment amount',
            },
            0,
          );
          continue;
        }
      }
      try {
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
        if (operation === 'refund' && result.status === PAYMENT_V2_STATUS.FAILED) {
          throw new RefundProviderFailedError(
            payment.id,
            result.reasonCode ?? 'provider_error',
          );
        }
        return { payment, nextAction: result.nextAction ?? null };
      } finally {
        if (circuitGate.probeAcquired) {
          await this.releaseHalfOpenProbeSafe(providerName);
        }
      }
    }
    if (operation === 'refund') {
      throw new RefundProviderFailedError(payment.id, 'provider_unavailable');
    }
    const failed = await this.markPaymentFailed(
      payment.id,
      operation === 'capture' ? lastTerminalFailureReason : 'provider_unavailable',
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
      if (retries > 0) {
        const backoffMs = this.computeProviderRetryBackoffMs(retries - 1);
        await this.sleep(backoffMs);
      }
      const start = Date.now();
      let result: ProviderResult;
      try {
        const adapter = this.registry.getProvider(providerName);
        const idempotencyKey = this.buildProviderIdempotencyKey(operation, payment.id, amountMinor);
        const correlationId = this.correlationContext.getId();
        const context: ProviderContext = {
          merchantId: payment.merchantId,
          paymentId: payment.id,
          amountMinor,
          currency: payment.currency,
          providerPaymentId: payment.providerRef,
          idempotencyKey,
          ...(correlationId ? { correlationId } : {}),
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
        ...this.correlationFields(),
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
      await this.registerProviderFailure(providerName);
    } else {
      await this.resetProviderFailure(providerName);
    }
    return finalResult;
  }

  /**
   * Espera entre intentos consecutivos del mismo `adapter.run` ante `transientError`.
   * Exponencial acotada (`base * 2^n`) con tope `retryBackoffMaxMs` y jitter multiplicativo en [0.5, 1).
   * Si `retryBackoffBaseMs` es 0, no hay espera (útil en tests / desactivar backoff).
   *
   * @param attemptIndexZeroBased Índice del reintento: 0 tras el primer fallo, 1 tras el segundo, etc.
   */
  private computeProviderRetryBackoffMs(attemptIndexZeroBased: number): number {
    if (this.retryBackoffBaseMs <= 0) return 0;
    const rawCap = Math.min(
      this.retryBackoffMaxMs,
      this.retryBackoffBaseMs * 2 ** attemptIndexZeroBased,
    );
    const jitterFactor = 0.5 + Math.random() * 0.5;
    return Math.max(1, Math.min(this.retryBackoffMaxMs, Math.round(rawCap * jitterFactor)));
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildProviderIdempotencyKey(
    operation: PaymentOperation,
    paymentId: string,
    amountMinor: number,
  ): string {
    if (operation === 'refund') {
      // Refunds pueden existir múltiples veces para un mismo payment; el monto debe participar en la key.
      return `payv2:refund:${paymentId}:amount=${amountMinor}`;
    }
    return `payv2:${operation}:${paymentId}`;
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
   * Opt-in: solo errores con señal clara de red/timeout/5xx; un `Error` genérico no reintenta
   * (evita tratar bugs de programación como transitorios).
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
    if (!(caught instanceof Error)) {
      return false;
    }
    const err = caught as Error &
      NodeJS.ErrnoException & { statusCode?: number; response?: { status?: number } };

    if (typeof err.code === 'string') {
      const transientCodes = new Set([
        'ECONNRESET',
        'ECONNREFUSED',
        'ECONNABORTED',
        'ETIMEDOUT',
        'ENOTFOUND',
        'ENETUNREACH',
        'EHOSTUNREACH',
        'EPIPE',
        'ECANCELED',
        'EAI_AGAIN',
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_HEADERS_TIMEOUT',
        'UND_ERR_BODY_TIMEOUT',
      ]);
      if (transientCodes.has(err.code)) {
        return true;
      }
    }

    if (err.name === 'AbortError') {
      return true;
    }

    const responseStatus = err.response?.status;
    if (typeof responseStatus === 'number' && responseStatus >= 500 && responseStatus < 600) {
      return true;
    }
    const statusCode = err.statusCode;
    if (typeof statusCode === 'number' && statusCode >= 500 && statusCode < 600) {
      return true;
    }

    return false;
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
        this.log.error(this.correlationLogJson({ ...payload, fatal: true }));
        throw error;
      }
      this.log.error(this.correlationLogJson({ ...payload, tolerated: true }));
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
          this.correlationLogJson({
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
    void provider;
    if (!raw) return null;

    // Default: no persistimos raws desconocidos por seguridad.
    return null;
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
        this.correlationLogJson({
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

    if (operation === 'refund' && result.status === PAYMENT_V2_STATUS.FAILED) {
      return this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          lastAttemptAt: new Date(),
          selectedProvider: providerName,
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
    const rateTable = await this.fee.resolveActiveRateTable(
      payment.merchantId,
      payment.currency,
      providerName,
    );
    const feeInput = {
      amountMinor: payment.amountMinor,
      percentageBps: rateTable.percentageBps,
      fixedMinor: rateTable.fixedMinor,
      minimumMinor: rateTable.minimumMinor,
    };
    const uncappedFee = FeeService.uncappedFeeMinor(feeInput);
    const feeQuote = FeeService.calculate(feeInput);
    if (uncappedFee > payment.amountMinor) {
      this.log.warn(
        this.correlationLogJson({
          event: 'payments_v2.fee_clamped_to_gross',
          paymentId: payment.id,
          merchantId: payment.merchantId,
          currency: payment.currency,
          provider: providerName,
          grossMinor: payment.amountMinor,
          uncappedFeeMinor: uncappedFee,
        }),
      );
    }
    const { updated, transitioned } = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const cas = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: PAYMENT_V2_STATUS.AUTHORIZED,
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

      await tx.paymentFeeQuote.create({
        data: {
          paymentId: payment.id,
          merchantId: payment.merchantId,
          rateTableId: rateTable.id,
          provider: providerName,
          currency: payment.currency,
          percentageBps: rateTable.percentageBps,
          fixedMinor: rateTable.fixedMinor,
          minimumMinor: rateTable.minimumMinor,
          grossMinor: feeQuote.grossMinor,
          feeMinor: feeQuote.feeMinor,
          netMinor: feeQuote.netMinor,
          settlementMode: rateTable.settlementMode,
        },
      });
      const capturedAt = new Date();
      await tx.paymentSettlement.create({
        data: {
          paymentId: payment.id,
          merchantId: payment.merchantId,
          currency: payment.currency,
          provider: providerName,
          settlementMode: rateTable.settlementMode,
          status: 'PENDING',
          grossMinor: feeQuote.grossMinor,
          feeMinor: feeQuote.feeMinor,
          netMinor: feeQuote.netMinor,
          capturedAt,
          availableAt: SettlementService.computeAvailableAt(
            capturedAt,
            rateTable.payoutScheduleType,
            rateTable.payoutScheduleParam,
          ),
        },
      });
      await this.ledger.recordSuccessfulCapture(tx, {
        merchantId: payment.merchantId,
        paymentId: payment.id,
        grossMinor: feeQuote.grossMinor,
        feeMinor: feeQuote.feeMinor,
        netMinor: feeQuote.netMinor,
        currency: payment.currency,
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

  private operationIdempotencyCacheKey(
    merchantId: string,
    paymentId: string,
    operation: PaymentOperation,
    idempotencyKey: string,
  ): string {
    return `payv2op:${merchantId}:${paymentId}:${operation}:${this.idempotencyKeyRedisTag(idempotencyKey)}`;
  }

  /**
   * Libera lock `PaymentOperation` y clave `payv2op:*` opcional tras error que no debe dejar la operación en `done`
   * (fallo de proveedor en refund, excepción interna en capture/cancel/refund).
   */
  private async releasePaymentOperationLockForRetry(params: {
    merchantId: string;
    paymentId: string;
    operation: PaymentOperation;
    idempotencyKey?: string;
  }): Promise<void> {
    const { merchantId, paymentId, operation, idempotencyKey } = params;
    try {
      await this.prisma.paymentOperation.deleteMany({
        where: { paymentId, operation, merchantId },
      });
    } catch (error) {
      this.log.warn(
        this.correlationLogJson({
          event: 'payments_v2.operation_lock_release_failed',
          paymentId,
          operation,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    if (!idempotencyKey) return;
    const cacheKey = this.operationIdempotencyCacheKey(merchantId, paymentId, operation, idempotencyKey);
    try {
      await this.redis.delIdempotency(cacheKey);
    } catch (error) {
      this.log.warn(
        this.correlationLogJson({
          event: 'payments_v2.operation_idempotency_release_failed',
          paymentId,
          operation,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  private async tryAcquireOperationIdempotency(params: {
    merchantId: string;
    paymentId: string;
    operation: PaymentOperation;
    idempotencyKey: string;
    payloadHash: string;
  }): Promise<boolean> {
    const { merchantId, paymentId, operation, idempotencyKey, payloadHash } = params;
    const key = this.operationIdempotencyCacheKey(merchantId, paymentId, operation, idempotencyKey);
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
        this.correlationLogJson({
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

  /**
   * Adquiere o reutiliza la fila `PaymentOperation` por `(paymentId, operation)`.
   * Si el lock existente tiene `merchantId` distinto al solicitante, se elimina (dato inválido / bug previo) y se reintenta.
   * Takeover de lock stale: `updateMany` condicional (CAS) para que solo un request gane si varios compiten.
   */
  private async claimPaymentOperation(params: {
    merchantId: string;
    paymentId: string;
    operation: PaymentOperation;
    payloadHash: string;
  }): Promise<{ proceed: true } | { proceed: false; payment: OperationResult['payment'] }> {
    const { merchantId, paymentId, operation, payloadHash } = params;
    const now = new Date();
    const staleBefore = new Date(now.getTime() - this.operationLockStaleMs);
    const maxIterations = 12;

    const decision = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (let i = 0; i < maxIterations; i++) {
        const existing = await tx.paymentOperation.findUnique({
          where: { paymentId_operation: { paymentId, operation } },
          select: { status: true, payloadHash: true, processingAt: true, merchantId: true },
        });

        if (existing && existing.merchantId !== merchantId) {
          await tx.paymentOperation.delete({
            where: { paymentId_operation: { paymentId, operation } },
          });
          this.log.warn(
            this.correlationLogJson({
              event: 'payments_v2.operation_lock_merchant_mismatch',
              paymentId,
              operation,
              lockMerchantId: existing.merchantId,
              requestMerchantId: merchantId,
            }),
          );
          continue;
        }

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
            continue;
          }
        }

        if (existing.status === 'done') {
          if (existing.payloadHash !== payloadHash) {
            throw new ConflictException('Operation already completed with a different payload');
          }
          return { proceed: false as const };
        }

        if (existing.payloadHash !== payloadHash) {
          throw new ConflictException({
            message: 'Operation in progress with a different payload',
            paymentId,
            operation,
          });
        }

        const stale = existing.processingAt < staleBefore;
        if (!stale) {
          return { proceed: false as const };
        }

        const cas = await tx.paymentOperation.updateMany({
          where: {
            paymentId,
            operation,
            status: 'processing',
            payloadHash,
            processingAt: { lt: staleBefore },
          },
          data: {
            merchantId,
            payloadHash,
            status: 'processing',
            processingAt: now,
            completedAt: null,
          },
        });
        if (cas.count === 1) {
          return { proceed: true as const };
        }
        continue;
      }

      throw new ConflictException({
        message: 'Could not acquire payment operation lock',
        paymentId,
        operation,
      });
    });

    if (decision.proceed) return decision;

    const payment = await this.findMerchantPayment(merchantId, paymentId);
    return { proceed: false, payment };
  }

  /**
   * Marca el lock como `done` solo tras finalizar el flujo de negocio sin error (llamar desde el camino de éxito).
   */
  private async completePaymentOperation(params: {
    merchantId: string;
    paymentId: string;
    operation: PaymentOperation;
    finalStatus: string;
  }) {
    const { merchantId, paymentId, operation } = params;
    try {
      await this.prisma.paymentOperation.updateMany({
        where: { paymentId, operation, merchantId, status: 'processing' },
        data: { status: 'done', completedAt: new Date() },
      });
    } catch (error) {
      this.log.warn(
        this.correlationLogJson({
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
    const cacheKey = `payv2:${merchantId}:${this.idempotencyKeyRedisTag(idempotencyKey)}`;
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
          createPayloadHash: true,
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
        createPayloadHash: true,
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
    if (payment.status === PAYMENT_V2_STATUS.PENDING) {
      return { type: 'none' };
    }
    return null;
  }

  private async resolveCreateNextActionForExisting(
    payment: OperationResult['payment'],
  ): Promise<ProviderResult['nextAction'] | null> {
    return this.nextActionFromPersistedPayment(payment);
  }

  private assertIdempotencyPayloadMatch(
    existing: {
      amountMinor: number;
      currency: string;
      paymentLinkId: string | null;
      selectedProvider: string | null;
      createPayloadHash: string | null;
    },
    incoming: CreatePaymentIntentDto,
  ) {
    const incomingHash = hashCreatePaymentIntentPayload(incoming);
    if (existing.createPayloadHash != null) {
      if (existing.createPayloadHash !== incomingHash) {
        throw new ConflictException('Idempotency key already used with a different payment intent');
      }
      return;
    }
    // Filas anteriores a `create_payload_hash`: solo se validaron amount/divisa/link en su momento.
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
      const cacheKey = `payv2:${merchantId}:${this.idempotencyKeyRedisTag(idempotencyKey)}`;
      await this.redis.setIdempotency(cacheKey, paymentId, 24 * 3600);
    } catch (error) {
      this.log.warn(
        this.correlationLogJson({
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
    const link = await this.links.findForMerchant(merchantId, paymentLinkId, { requireUsable: true });
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
    if (value === null || value === '') return undefined;
    return isPaymentProviderName(value) ? value : undefined;
  }

  private toReasonCode(value: string | undefined): PaymentReasonCode {
    const valid: PaymentReasonCode[] = [
      'provider_unavailable',
      'provider_timeout',
      'provider_declined',
      'provider_validation_error',
      'provider_error',
      'fee_configuration_missing',
      'fee_exceeds_gross',
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

  private warnCircuitBreakerRedisUnavailableOnce(): void {
    if (paymentsV2CircuitBreakerRedisFallbackWarned) return;
    paymentsV2CircuitBreakerRedisFallbackWarned = true;
    this.log.warn(
      this.correlationLogJson({
        event: 'payments_v2.circuit_breaker_redis_unavailable',
        message:
          'Payments v2 provider circuit breaker is using in-process state (not shared across replicas). Configure REDIS_URL for shared circuit breaker state.',
      }),
    );
  }

  /**
   * Redis del CB configurado pero no usable: no debe propagar el error al flujo de pago.
   */
  private logCircuitBreakerRedisError(
    op: 'read_state' | 'increment_failure' | 'reset' | 'snapshot' | 'half_open_probe' | 'half_open_release',
    error: unknown,
    provider?: PaymentProviderName,
  ): void {
    this.log.warn(
      this.correlationLogJson({
        event: 'payments_v2.circuit_breaker_redis_error',
        op,
        provider: provider ?? null,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  private circuitBreakerSnapshotFromFallback(
    now: number,
  ): Record<
    PaymentProviderName,
    {
      failures: number;
      open: boolean;
      openedUntil: number;
      halfOpen?: boolean;
      circuitState?: 'closed' | 'open' | 'half_open';
    }
  > {
    const providers = this.registry.getRegisteredProviderNames();
    return providers.reduce(
      (acc, provider) => {
        const state = this.cbStateFallback.get(provider) ?? { failures: 0, openedUntil: 0 };
        const open = state.openedUntil > now;
        const base = {
          failures: state.failures,
          open,
          openedUntil: state.openedUntil,
        };
        acc[provider] = this.cbHalfOpenEnabled
          ? {
              ...base,
              halfOpen: false,
              circuitState: open ? ('open' as const) : ('closed' as const),
            }
          : base;
        return acc;
      },
      {} as Record<
        PaymentProviderName,
        {
          failures: number;
          open: boolean;
          openedUntil: number;
          halfOpen?: boolean;
          circuitState?: 'closed' | 'open' | 'half_open';
        }
      >,
    );
  }

  /**
   * TTL de la clave SET NX de half-open: acota el tiempo máximo que una sonda puede retener el lock
   * (reintentos + timeouts de proveedor + cooldown como colchón).
   */
  private halfOpenProbeTtlSeconds(): number {
    const ms = Math.min(
      300_000,
      Math.max(
        15_000,
        this.cbCooldownMs +
          this.providerTimeoutMs * (this.maxRetries + 1) +
          this.retryBackoffMaxMs * this.maxRetries,
      ),
    );
    return Math.max(1, Math.ceil(ms / 1000));
  }

  /**
   * TTL del HASH `payv2:cb:{provider}`: cooldown + margen (1h), acotado [60s, 7d].
   * Se renueva en cada incremento/reset para no acumular claves eternas si un proveedor deja de usarse.
   */
  private paymentsV2CircuitBreakerHashTtlSec(): number {
    const marginMs = 3_600_000;
    const sec = Math.ceil((this.cbCooldownMs + marginMs) / 1000);
    return Math.min(604_800, Math.max(60, sec));
  }

  /**
   * Transiciones (con `PAYMENTS_PROVIDER_CB_HALF_OPEN=true` y Redis):
   * - **open**: `openedUntil > now` → bloqueo total (igual que hoy).
   * - **half-open**: cooldown vencido (`openedUntil <= now`) y aún `failures >= umbral` → solo la petición
   *   que gana `SET payv2:cb:{provider}:probe NX` llama al adapter; el resto ve bloqueo como CB abierto.
   * - **closed**: `failures < umbral`, o `resetProviderFailure` tras éxito del adapter (HASH limpio).
   * En half-open, un fallo que cuenta para el CB vuelve a abrir ventana (`registerProviderFailure` / Lua).
   *
   * Sin Redis o flag en false: no hay half-open; tras cooldown el tráfico sigue el comportamiento previo.
   */
  private async resolveProviderCircuitGate(
    providerName: PaymentProviderName,
  ): Promise<{ block: boolean; blockReason?: string; probeAcquired: boolean }> {
    const state = await this.readCircuitState(providerName);
    const now = Date.now();
    if (state.openedUntil > now) {
      return { block: true, probeAcquired: false };
    }
    if (!this.cbHalfOpenEnabled || !this.cbRedisEnabled) {
      return { block: false, probeAcquired: false };
    }
    if (state.failures < this.cbFailures) {
      return { block: false, probeAcquired: false };
    }
    const ttlSec = this.halfOpenProbeTtlSeconds();
    try {
      const acquired = await this.redis.tryAcquirePaymentsV2HalfOpenProbe(providerName, ttlSec);
      if (acquired) {
        this.log.log(
          this.correlationLogJson({
            event: 'payments_v2.circuit_half_open_probe',
            provider: providerName,
            ttlSec,
          }),
        );
        return { block: false, probeAcquired: true };
      }
      this.log.debug(
        this.correlationLogJson({
          event: 'payments_v2.circuit_half_open_skipped',
          provider: providerName,
          reason: 'probe_busy',
        }),
      );
      return {
        block: true,
        blockReason: 'Provider circuit breaker half-open probe busy',
        probeAcquired: false,
      };
    } catch (error) {
      this.logCircuitBreakerRedisError('half_open_probe', error, providerName);
      /**
       * Si Redis no puede ejecutar la sonda NX, no asumimos “sin lock”: sin coordinación half-open
       * todas las peticiones en ventana de recuperación golpearían al PSP (thundering herd).
       * Bloqueamos como sonda ocupada (misma semántica operativa que `SET NX` no ganado).
       */
      return {
        block: true,
        blockReason: 'Provider circuit breaker half-open probe coordination unavailable',
        probeAcquired: false,
      };
    }
  }

  private async releaseHalfOpenProbeSafe(providerName: PaymentProviderName): Promise<void> {
    if (!this.cbHalfOpenEnabled || !this.cbRedisEnabled) return;
    try {
      await this.redis.releasePaymentsV2HalfOpenProbe(providerName);
    } catch (error) {
      this.logCircuitBreakerRedisError('half_open_release', error, providerName);
    }
  }

  private async readCircuitState(providerName: PaymentProviderName): Promise<CircuitBreakerState> {
    if (this.cbRedisEnabled) {
      try {
        return await this.redis.getPaymentsV2ProviderCircuitState(providerName);
      } catch (error) {
        this.logCircuitBreakerRedisError('read_state', error, providerName);
        // Fallar abierto si no hay estado local: no bloquear pagos por Redis caído.
        return this.cbStateFallback.get(providerName) ?? { failures: 0, openedUntil: 0 };
      }
    }
    this.warnCircuitBreakerRedisUnavailableOnce();
    return this.cbStateFallback.get(providerName) ?? { failures: 0, openedUntil: 0 };
  }

  private registerProviderFailureInMemory(providerName: PaymentProviderName): void {
    const current = this.cbStateFallback.get(providerName) ?? { failures: 0, openedUntil: 0 };
    const now = Date.now();
    const wasOpen = current.openedUntil > now;
    current.failures += 1;
    if (current.failures >= this.cbFailures) {
      current.openedUntil = now + this.cbCooldownMs;
      if (!wasOpen) {
        this.log.warn(
          this.correlationLogJson({
            event: 'payments_v2.circuit_opened',
            provider: providerName,
            openedUntil: current.openedUntil,
          }),
        );
      }
    }
    this.cbStateFallback.set(providerName, current);
  }

  private async registerProviderFailure(providerName: PaymentProviderName): Promise<void> {
    if (this.cbRedisEnabled) {
      try {
        const { openedUntil, openedNow } = await this.redis.incrementPaymentsV2ProviderCircuitFailure(
          providerName,
          this.cbFailures,
          this.cbCooldownMs,
          Date.now(),
          this.paymentsV2CircuitBreakerHashTtlSec(),
        );
        if (openedNow === 1) {
          this.log.warn(
            this.correlationLogJson({
              event: 'payments_v2.circuit_opened',
              provider: providerName,
              openedUntil,
            }),
          );
        }
        return;
      } catch (error) {
        this.logCircuitBreakerRedisError('increment_failure', error, providerName);
        this.registerProviderFailureInMemory(providerName);
        return;
      }
    }

    this.warnCircuitBreakerRedisUnavailableOnce();
    this.registerProviderFailureInMemory(providerName);
  }

  private async resetProviderFailure(providerName: PaymentProviderName): Promise<void> {
    if (this.cbRedisEnabled) {
      try {
        await this.redis.resetPaymentsV2ProviderCircuit(
          providerName,
          this.paymentsV2CircuitBreakerHashTtlSec(),
        );
        return;
      } catch (error) {
        this.logCircuitBreakerRedisError('reset', error, providerName);
        this.cbStateFallback.set(providerName, { failures: 0, openedUntil: 0 });
        return;
      }
    }
    this.warnCircuitBreakerRedisUnavailableOnce();
    this.cbStateFallback.set(providerName, { failures: 0, openedUntil: 0 });
  }

  private async getCircuitBreakerSnapshot(): Promise<
    Record<
      PaymentProviderName,
      {
        failures: number;
        open: boolean;
        openedUntil: number;
        halfOpen?: boolean;
        circuitState?: 'closed' | 'open' | 'half_open';
      }
    >
  > {
    const now = Date.now();
    const providers = this.registry.getRegisteredProviderNames();
    if (this.cbRedisEnabled) {
      try {
        const states = await Promise.all(
          providers.map((provider) => this.redis.getPaymentsV2ProviderCircuitState(provider)),
        );
        return providers.reduce(
          (acc, provider, i) => {
            const state = states[i] ?? { failures: 0, openedUntil: 0 };
            const open = state.openedUntil > now;
            const base = {
              failures: state.failures,
              open,
              openedUntil: state.openedUntil,
            };
            const logicalHalfOpen =
              this.cbHalfOpenEnabled && !open && state.failures >= this.cbFailures && this.cbRedisEnabled;
            acc[provider] = this.cbHalfOpenEnabled
              ? {
                  ...base,
                  halfOpen: logicalHalfOpen,
                  circuitState: open ? ('open' as const) : logicalHalfOpen ? ('half_open' as const) : ('closed' as const),
                }
              : base;
            return acc;
          },
          {} as Record<
            PaymentProviderName,
            {
              failures: number;
              open: boolean;
              openedUntil: number;
              halfOpen?: boolean;
              circuitState?: 'closed' | 'open' | 'half_open';
            }
          >,
        );
      } catch (error) {
        this.logCircuitBreakerRedisError('snapshot', error);
        return this.circuitBreakerSnapshotFromFallback(now);
      }
    }

    this.warnCircuitBreakerRedisUnavailableOnce();
    return this.circuitBreakerSnapshotFromFallback(now);
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
