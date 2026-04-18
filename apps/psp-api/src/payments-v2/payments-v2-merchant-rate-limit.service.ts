import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import {
  PaymentsV2MerchantRateLimitOperation,
  paymentsV2MerchantRateLimitBucket,
  paymentsV2MerchantRateLimitKey,
  paymentsV2MerchantRateLimitRetryAfterSec,
} from './payments-v2-merchant-rate-limit';

export type MerchantRateLimitRule = { limit: number; windowSec: number };

type MerchantOpCircuit = { failOpenUntilMs: number; purgeAtMs: number };
type MemRlEntry = { bucket: number; count: number; purgeAtMs: number };

/** Una sola advertencia por proceso si Redis falla o no está configurado con cuota merchant activa (fail-open). */
let paymentsV2MerchantRlRedisFailOpenWarned = false;

const MERCHANT_RL_PRUNE_INTERVAL_MS = 60_000;
const MERCHANT_RL_PRUNE_MAX_PER_CONSUME = 500;

@Injectable()
export class PaymentsV2MerchantRateLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PaymentsV2MerchantRateLimitService.name);
  private readonly enabled: boolean;
  private readonly createRule: MerchantRateLimitRule | null;
  private readonly captureRule: MerchantRateLimitRule | null;
  private readonly refundRule: MerchantRateLimitRule | null;
  /**
   * Circuito fail-open por merchant+op: hasta `failOpenUntilMs` no se llama Redis; `purgeAtMs` acota
   * la vida del estado en memoria aunque ese merchant no vuelva tras un incidente (evita crecimiento
   * ilimitado de Maps bajo alta cardinalidad).
   */
  private readonly circuitByMerchantOp = new Map<string, MerchantOpCircuit>();
  /**
   * Cuota en proceso durante fail-open por merchant+op (misma ventana fija que Redis).
   * Evita perder del todo la protección mientras el circuito por merchant está abierto.
   */
  private readonly memRlByMerchantOp = new Map<string, MemRlEntry>();
  /** Duración del bypass de Redis tras detectar indisponibilidad. */
  private readonly redisFailOpenBackoffMs: number;
  /** Tope superior de TTL de entradas en los Maps de este servicio (se fuerza ≥ backoff + ventana máxima). */
  private readonly merchantRlStateMaxTtlMs: number;
  private pruneIntervalHandle: ReturnType<typeof setInterval> | null = null;

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
    const maxWindowSec = Math.max(
      this.createRule?.windowSec ?? 1,
      this.captureRule?.windowSec ?? 1,
      this.refundRule?.windowSec ?? 1,
    );
    const readMaxTtl = this.readOptionalBoundedMs(
      'PAYMENTS_V2_MERCHANT_RL_STATE_MAX_TTL_MS',
      600_000,
      60_000,
      3_600_000,
    );
    const minTtlForCircuit = this.redisFailOpenBackoffMs + maxWindowSec * 1000 + 1_000;
    this.merchantRlStateMaxTtlMs = Math.max(readMaxTtl, minTtlForCircuit);
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    if (this.pruneIntervalHandle) return;
    this.pruneIntervalHandle = setInterval(() => {
      this.pruneExpiredMerchantState(Date.now(), Number.MAX_SAFE_INTEGER);
    }, MERCHANT_RL_PRUNE_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.pruneIntervalHandle) {
      clearInterval(this.pruneIntervalHandle);
      this.pruneIntervalHandle = null;
    }
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
   * Sin cliente Redis: fail-open (no bloquea pagos; log único acotado).
   * Si Redis falla tras INCRs exitosos, se conserva el contador en memoria y esta misma petición puede 429;
   * el backoff por merchant+op sigue aplicando cuota en memoria mientras el circuito está abierto.
   */
  async consumeIfNeeded(merchantId: string, op: PaymentsV2MerchantRateLimitOperation): Promise<void> {
    const rule = this.ruleFor(op);
    if (!rule) return;

    const nowMs = Date.now();
    this.pruneExpiredMerchantState(nowMs, MERCHANT_RL_PRUNE_MAX_PER_CONSUME);

    const circuitKey = this.circuitKey(merchantId, op);
    let circuit = this.circuitByMerchantOp.get(circuitKey);
    if (circuit && nowMs >= circuit.purgeAtMs) {
      this.circuitByMerchantOp.delete(circuitKey);
      this.memRlByMerchantOp.delete(circuitKey);
      circuit = undefined;
    }
    const failOpenUntil = circuit?.failOpenUntilMs ?? 0;
    if (nowMs < failOpenUntil) {
      this.consumeInMemoryOrThrow(merchantId, op, rule, nowMs);
      return;
    }
    if (failOpenUntil > 0) {
      this.circuitByMerchantOp.delete(circuitKey);
      this.memRlByMerchantOp.delete(circuitKey);
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
      /** Espejo del INCR Redis por ventana: si el siguiente comando falla, el fallback en memoria no “pierde” los consumos ya contabilizados en Redis. */
      this.memRlByMerchantOp.set(this.circuitKey(merchantId, op), {
        bucket,
        count,
        purgeAtMs: Math.min(
          nowMs + rule.windowSec * 1000 * 2,
          nowMs + this.merchantRlStateMaxTtlMs,
        ),
      });
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
      this.armRedisFailOpenCircuit(merchantId, op, rule);
      this.warnFailOpen('redis_error', e);
      this.consumeInMemoryOrThrow(merchantId, op, rule, nowMs);
    }
  }

  private circuitKey(merchantId: string, op: PaymentsV2MerchantRateLimitOperation): string {
    return `${merchantId}:${op}`;
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
    const circuit = this.circuitByMerchantOp.get(mapKey);
    const memPurgeAt =
      circuit?.purgeAtMs ??
      Math.min(
        nowMs + this.redisFailOpenBackoffMs + rule.windowSec * 1000,
        nowMs + this.merchantRlStateMaxTtlMs,
      );
    let st = this.memRlByMerchantOp.get(mapKey);
    if (!st || st.bucket !== bucket) {
      st = { bucket, count: 0, purgeAtMs: memPurgeAt };
    } else {
      st.purgeAtMs = Math.max(st.purgeAtMs, memPurgeAt);
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

  private armRedisFailOpenCircuit(
    merchantId: string,
    op: PaymentsV2MerchantRateLimitOperation,
    rule: MerchantRateLimitRule,
  ): void {
    const nowMs = Date.now();
    const failOpenUntilMs = nowMs + this.redisFailOpenBackoffMs;
    const purgeAtMs = Math.max(
      failOpenUntilMs + 1,
      Math.min(
        nowMs + this.redisFailOpenBackoffMs + rule.windowSec * 1000,
        nowMs + this.merchantRlStateMaxTtlMs,
      ),
    );
    this.circuitByMerchantOp.set(this.circuitKey(merchantId, op), { failOpenUntilMs, purgeAtMs });
  }

  /** Elimina entradas expiradas; `maxDeletes` acota el trabajo en la ruta caliente. */
  private pruneExpiredMerchantState(nowMs: number, maxDeletes: number): void {
    let deleted = 0;
    for (const [k, st] of this.circuitByMerchantOp) {
      if (st.purgeAtMs <= nowMs) {
        this.circuitByMerchantOp.delete(k);
        this.memRlByMerchantOp.delete(k);
        deleted += 1;
        if (deleted >= maxDeletes) return;
      }
    }
    for (const [k, st] of this.memRlByMerchantOp) {
      if (st.purgeAtMs <= nowMs) {
        this.memRlByMerchantOp.delete(k);
        deleted += 1;
        if (deleted >= maxDeletes) return;
      }
    }
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
