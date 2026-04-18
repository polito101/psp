import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import {
  PaymentsV2MerchantRateLimitOperation,
  paymentsV2MerchantRateLimitBucket,
  paymentsV2MerchantRateLimitKey,
  paymentsV2MerchantRateLimitRetryAfterSec,
} from './payments-v2-merchant-rate-limit';

export type MerchantRateLimitRule = { limit: number; windowSec: number };

/** Una sola advertencia por proceso si Redis falla o no está configurado con cuota merchant activa (fail-open). */
let paymentsV2MerchantRlRedisFailOpenWarned = false;

@Injectable()
export class PaymentsV2MerchantRateLimitService {
  private readonly log = new Logger(PaymentsV2MerchantRateLimitService.name);
  private readonly enabled: boolean;
  private readonly createRule: MerchantRateLimitRule | null;
  private readonly captureRule: MerchantRateLimitRule | null;
  private readonly refundRule: MerchantRateLimitRule | null;
  /**
   * Tras un fallo/timeout de Redis para un par merchant+op, no reintentar INCR hasta este instante.
   * Aislado por merchant (y operación): un incidente no abre el bypass al resto del pod.
   */
  private readonly redisFailOpenUntilByMerchantOp = new Map<string, number>();
  /**
   * Cuota en proceso durante fail-open por merchant+op (misma ventana fija que Redis).
   * Evita perder del todo la protección mientras el circuito por merchant está abierto.
   */
  private readonly memRlByMerchantOp = new Map<string, { bucket: number; count: number }>();
  /** Duración del bypass de Redis tras detectar indisponibilidad. */
  private readonly redisFailOpenBackoffMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.enabled =
      (this.config.get<string>('PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED') ?? 'false').toLowerCase() === 'true';
    this.createRule = this.enabled
      ? {
          limit: this.getPositiveInt('PAYMENTS_V2_MERCHANT_CREATE_LIMIT'),
          windowSec: this.getPositiveInt('PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC'),
        }
      : null;
    this.captureRule = this.enabled ? this.readOptionalPair('CAPTURE') : null;
    this.refundRule = this.enabled ? this.readOptionalPair('REFUND') : null;
    this.redisFailOpenBackoffMs = this.readOptionalBoundedMs(
      'PAYMENTS_V2_MERCHANT_RL_FAIL_OPEN_BACKOFF_MS',
      30_000,
      5_000,
      300_000,
    );
  }

  private readOptionalBoundedMs(
    key: string,
    defaultMs: number,
    minMs: number,
    maxMs: number,
  ): number {
    const raw = this.config.get<string>(key);
    if (raw === undefined || String(raw).trim() === '') {
      return defaultMs;
    }
    const n = Number(String(raw).trim());
    if (!Number.isFinite(n)) {
      return defaultMs;
    }
    const v = Math.trunc(n);
    if (v < minMs) return minMs;
    if (v > maxMs) return maxMs;
    return v;
  }

  private readOptionalPair(which: 'CAPTURE' | 'REFUND'): MerchantRateLimitRule | null {
    const limitRaw = this.config.get<string>(`PAYMENTS_V2_MERCHANT_${which}_LIMIT`);
    const windowRaw = this.config.get<string>(`PAYMENTS_V2_MERCHANT_${which}_WINDOW_SEC`);
    const hasLimit = limitRaw !== undefined && String(limitRaw).trim() !== '';
    const hasWin = windowRaw !== undefined && String(windowRaw).trim() !== '';
    if (!hasLimit && !hasWin) return null;
    if (!hasLimit || !hasWin) {
      throw new Error(
        `PAYMENTS_V2_MERCHANT_${which}_LIMIT and PAYMENTS_V2_MERCHANT_${which}_WINDOW_SEC must both be set when merchant rate limiting is enabled`,
      );
    }
    const limit = Number(String(limitRaw).trim());
    const windowSec = Number(String(windowRaw).trim());
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(`PAYMENTS_V2_MERCHANT_${which}_LIMIT must be a positive integer`);
    }
    if (!Number.isInteger(windowSec) || windowSec <= 0) {
      throw new Error(`PAYMENTS_V2_MERCHANT_${which}_WINDOW_SEC must be a positive integer`);
    }
    return { limit, windowSec };
  }

  private getPositiveInt(key: string): number {
    const raw = this.config.get<string>(key);
    if (raw === undefined || String(raw).trim() === '') {
      throw new Error(`${key} is required when PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED=true`);
    }
    const n = Number(String(raw).trim());
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`${key} must be a positive integer`);
    }
    return n;
  }

  private ruleFor(op: PaymentsV2MerchantRateLimitOperation): MerchantRateLimitRule | null {
    if (!this.enabled) return null;
    if (op === 'create') return this.createRule;
    if (op === 'capture') return this.captureRule;
    return this.refundRule;
  }

  /**
   * Incrementa contador Redis por ventana fija; si supera el tope → 429 con `retryAfter` en segundos.
   * Fail-open si no hay cliente Redis o error de Redis (no bloquea pagos; log único acotado).
   * El circuito de backoff por indisponibilidad de Redis es por merchant y operación; durante ese
   * período se aplica una cuota en memoria en el proceso para no abrir el bypass al resto de merchants.
   */
  async consumeIfNeeded(merchantId: string, op: PaymentsV2MerchantRateLimitOperation): Promise<void> {
    const rule = this.ruleFor(op);
    if (!rule) return;

    const nowMs = Date.now();
    const circuitKey = this.circuitKey(merchantId, op);
    const failOpenUntil = this.redisFailOpenUntilByMerchantOp.get(circuitKey) ?? 0;
    if (nowMs < failOpenUntil) {
      this.consumeInMemoryOrThrow(merchantId, op, rule, nowMs);
      return;
    }
    if (failOpenUntil > 0) {
      this.redisFailOpenUntilByMerchantOp.delete(circuitKey);
    }

    const nowSec = Math.floor(nowMs / 1000);
    const bucket = paymentsV2MerchantRateLimitBucket(nowSec, rule.windowSec);
    const key = paymentsV2MerchantRateLimitKey(merchantId, op, bucket);

    try {
      const client = this.redis.getClient();
      if (!client) {
        this.warnFailOpen('redis_client_missing');
        return;
      }
      const count = await this.redis.incrWithExpireOnFirstForMerchantRateLimit(key, rule.windowSec);
      this.clearInMemoryMerchantOp(merchantId, op);
      if (count > rule.limit) {
        const retryAfter = paymentsV2MerchantRateLimitRetryAfterSec(nowSec, rule.windowSec);
        this.log.warn(
          JSON.stringify({
            event: 'payments_v2.merchant_rate_limited',
            merchantId,
            operation: op,
            windowSec: rule.windowSec,
            limit: rule.limit,
          }),
        );
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Merchant rate limit exceeded',
            retryAfter,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
        throw e;
      }
      this.armRedisFailOpenCircuit(merchantId, op);
      this.warnFailOpen('redis_error', e);
    }
  }

  private circuitKey(merchantId: string, op: PaymentsV2MerchantRateLimitOperation): string {
    return `${merchantId}:${op}`;
  }

  private clearInMemoryMerchantOp(merchantId: string, op: PaymentsV2MerchantRateLimitOperation): void {
    this.memRlByMerchantOp.delete(this.circuitKey(merchantId, op));
  }

  /** Misma semántica de ventana fija que la clave Redis; puede lanzar 429. */
  private consumeInMemoryOrThrow(
    merchantId: string,
    op: PaymentsV2MerchantRateLimitOperation,
    rule: MerchantRateLimitRule,
    nowMs: number,
  ): void {
    const nowSec = Math.floor(nowMs / 1000);
    const bucket = paymentsV2MerchantRateLimitBucket(nowSec, rule.windowSec);
    const mapKey = this.circuitKey(merchantId, op);
    let st = this.memRlByMerchantOp.get(mapKey);
    if (!st || st.bucket !== bucket) {
      st = { bucket, count: 0 };
    }
    st.count += 1;
    this.memRlByMerchantOp.set(mapKey, st);
    if (st.count > rule.limit) {
      const retryAfter = paymentsV2MerchantRateLimitRetryAfterSec(nowSec, rule.windowSec);
      this.log.warn(
        JSON.stringify({
          event: 'payments_v2.merchant_rate_limited',
          merchantId,
          operation: op,
          windowSec: rule.windowSec,
          limit: rule.limit,
          source: 'memory_fail_open',
        }),
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Merchant rate limit exceeded',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private armRedisFailOpenCircuit(merchantId: string, op: PaymentsV2MerchantRateLimitOperation): void {
    this.redisFailOpenUntilByMerchantOp.set(
      this.circuitKey(merchantId, op),
      Date.now() + this.redisFailOpenBackoffMs,
    );
  }

  private warnFailOpen(reason: string, err?: unknown): void {
    if (paymentsV2MerchantRlRedisFailOpenWarned) return;
    paymentsV2MerchantRlRedisFailOpenWarned = true;
    this.log.warn(
      JSON.stringify({
        event: 'payments_v2.merchant_rate_limit_redis_unavailable',
        reason,
        detail: err instanceof Error ? err.message : err != null ? String(err) : undefined,
      }),
    );
  }
}
