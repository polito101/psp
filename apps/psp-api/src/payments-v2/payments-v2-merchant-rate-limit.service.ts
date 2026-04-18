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

/** Rechazo controlado cuando el INCR Redis supera el tope de tiempo (fail-open rápido). */
class MerchantRateLimitRedisTimeoutError extends Error {
  readonly name = 'MerchantRateLimitRedisTimeoutError';
  constructor() {
    super('merchant rate limit redis operation timed out');
  }
}

@Injectable()
export class PaymentsV2MerchantRateLimitService {
  private readonly log = new Logger(PaymentsV2MerchantRateLimitService.name);
  private readonly enabled: boolean;
  private readonly createRule: MerchantRateLimitRule | null;
  private readonly captureRule: MerchantRateLimitRule | null;
  private readonly refundRule: MerchantRateLimitRule | null;
  /** Tras un fallo/timeout de Redis, no reintentar INCR hasta este instante (circuito local por proceso). */
  private merchantRlRedisFailOpenUntilMs = 0;
  /** Máx. espera al INCR+EXPIRE del rate limit; evita latencia larga con Redis lento o caído. */
  private readonly redisIncrTimeoutMs: number;
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
    this.redisIncrTimeoutMs = this.readOptionalBoundedMs(
      'PAYMENTS_V2_MERCHANT_RL_REDIS_OP_TIMEOUT_MS',
      150,
      50,
      2_000,
    );
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
   */
  async consumeIfNeeded(merchantId: string, op: PaymentsV2MerchantRateLimitOperation): Promise<void> {
    const rule = this.ruleFor(op);
    if (!rule) return;

    const nowMs = Date.now();
    if (nowMs < this.merchantRlRedisFailOpenUntilMs) {
      return;
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
      const count = await this.incrWithExpireOnFirstBounded(key, rule.windowSec);
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
      this.armRedisFailOpenCircuit();
      this.warnFailOpen('redis_error', e);
    }
  }

  /**
   * INCR con tope de tiempo: si Redis tarda o ioredis reintenta, no retenemos la petición de pago más de `redisIncrTimeoutMs`.
   */
  private async incrWithExpireOnFirstBounded(key: string, windowSec: number): Promise<number> {
    const op = this.redis.incrWithExpireOnFirst(key, windowSec);
    const timeoutMs = this.redisIncrTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new MerchantRateLimitRedisTimeoutError()), timeoutMs);
    });
    try {
      return await Promise.race([op, timeoutPromise]);
    } catch (e) {
      if (e instanceof MerchantRateLimitRedisTimeoutError) {
        void op.catch(() => {
          /* Redis puede resolver/rechazar tarde; evita unhandledRejection si ganó el timeout */
        });
      }
      throw e;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private armRedisFailOpenCircuit(): void {
    this.merchantRlRedisFailOpenUntilMs = Date.now() + this.redisFailOpenBackoffMs;
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
