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

/** Expiración programada para poda O(log n) sin recorrer Maps completos. */
type MerchantRlExpiryHeapEntry =
  | { kind: 'circuit'; key: string; purgeAtMs: number }
  | { kind: 'mem'; key: string; purgeAtMs: number };

/** Una sola advertencia por proceso si Redis falla o no está configurado con cuota merchant activa (fail-open). */
let paymentsV2MerchantRlRedisFailOpenWarned = false;

const MERCHANT_RL_PRUNE_INTERVAL_MS = 60_000;
const MERCHANT_RL_PRUNE_MAX_PER_CONSUME = 500;
/** Borrados efectivos por tick en el prune periódico; el resto se encadena con `setImmediate`. */
const MERCHANT_RL_PRUNE_PERIODIC_CHUNK = 10_000;
/** Pops máx. del heap en el hot path (`consumeIfNeeded`): evita CPU acotada solo por backlog de obsoletos. */
const MERCHANT_RL_PRUNE_HOT_PATH_MAX_HEAP_POPS = 32;
/** Pops del heap en el prune periódico (puede drenar miles de entradas obsoletas sin bloquear una petición). */
const MERCHANT_RL_PRUNE_PERIODIC_MAX_HEAP_POPS = 10_000;

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
  private readonly merchantRlExpiryHeap: MerchantRlExpiryHeapEntry[] = [];
  /** Índice en `merchantRlExpiryHeap` por clave lógica (`kind:key`); permite actualizar `purgeAtMs` sin duplicar nodos. */
  private readonly merchantRlHeapIndexByLogicalKey = new Map<string, number>();

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
      this.schedulePeriodicPruneDrain(Date.now());
    }, MERCHANT_RL_PRUNE_INTERVAL_MS);
    this.pruneIntervalHandle.unref?.();
  }

  /**
   * Prune periódico en chunks para no monopolizar un tick del event loop; si queda trabajo
   * (expirados o pops obsoletos que agotaron el presupuesto de heap), continúa en `setImmediate`.
   */
  private schedulePeriodicPruneDrain(nowMs: number): void {
    const drain = (): void => {
      this.pruneExpiredMerchantState(
        nowMs,
        MERCHANT_RL_PRUNE_PERIODIC_CHUNK,
        MERCHANT_RL_PRUNE_PERIODIC_MAX_HEAP_POPS,
      );
      const peeked = this.merchantRlExpiryHeapPeek();
      if (peeked !== undefined && peeked.purgeAtMs <= nowMs) {
        setImmediate(drain);
      }
    };
    setImmediate(drain);
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
   * El espejo `memRlByMerchantOp` no se limpia al cerrar el backoff: solo se reemplaza tras un INCR Redis
   * exitoso o se purga por `purgeAtMs`/TTL, para no perder continuidad ante flapping prolongado.
   */
  async consumeIfNeeded(merchantId: string, op: PaymentsV2MerchantRateLimitOperation): Promise<void> {
    const rule = this.ruleFor(op);
    if (!rule) return;

    const nowMs = Date.now();
    this.pruneExpiredMerchantState(
      nowMs,
      MERCHANT_RL_PRUNE_MAX_PER_CONSUME,
      MERCHANT_RL_PRUNE_HOT_PATH_MAX_HEAP_POPS,
    );

    const circuitKey = this.circuitKey(merchantId, op);
    let circuit = this.circuitByMerchantOp.get(circuitKey);
    if (circuit && nowMs >= circuit.purgeAtMs) {
      this.circuitByMerchantOp.delete(circuitKey);
      circuit = undefined;
    }
    const failOpenUntil = circuit?.failOpenUntilMs ?? 0;
    if (nowMs < failOpenUntil) {
      this.consumeInMemoryOrThrow(merchantId, op, rule, nowMs);
      return;
    }
    if (failOpenUntil > 0) {
      this.circuitByMerchantOp.delete(circuitKey);
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
      /** Fin de bucket en ms (constante dentro de la ventana): mismo criterio que la ventana fija Redis; evita un push al heap por request. */
      const memPurgeAt = (bucket + 1) * rule.windowSec * 1000;
      const ck = this.circuitKey(merchantId, op);
      const prevMem = this.memRlByMerchantOp.get(ck);
      if (!prevMem || prevMem.bucket !== bucket) {
        this.memRlByMerchantOp.set(ck, { bucket, count, purgeAtMs: memPurgeAt });
      } else {
        prevMem.count = count;
        prevMem.purgeAtMs = memPurgeAt;
      }
      this.merchantRlExpiryHeapPushOrUpdate({ kind: 'mem', key: ck, purgeAtMs: memPurgeAt });
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
    const bucketEndMs = (bucket + 1) * rule.windowSec * 1000;
    let st = this.memRlByMerchantOp.get(mapKey);
    if (!st || st.bucket !== bucket) {
      st = { bucket, count: 0, purgeAtMs: bucketEndMs };
    }
    st.count += 1;
    st.purgeAtMs = bucketEndMs;
    this.memRlByMerchantOp.set(mapKey, st);
    this.merchantRlExpiryHeapPushOrUpdate({ kind: 'mem', key: mapKey, purgeAtMs: bucketEndMs });
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
    const ck = this.circuitKey(merchantId, op);
    this.circuitByMerchantOp.set(ck, { failOpenUntilMs, purgeAtMs });
    this.merchantRlExpiryHeapPushOrUpdate({ kind: 'circuit', key: ck, purgeAtMs });
  }

  private merchantRlHeapLogicalKey(e: MerchantRlExpiryHeapEntry): string {
    return `${e.kind}:${e.key}`;
  }

  private merchantRlHeapSwap(i: number, j: number): void {
    const h = this.merchantRlExpiryHeap;
    const a = h[i]!;
    const b = h[j]!;
    h[i] = b;
    h[j] = a;
    this.merchantRlHeapIndexByLogicalKey.set(this.merchantRlHeapLogicalKey(b), i);
    this.merchantRlHeapIndexByLogicalKey.set(this.merchantRlHeapLogicalKey(a), j);
  }

  private merchantRlExpiryHeapLess(a: MerchantRlExpiryHeapEntry, b: MerchantRlExpiryHeapEntry): boolean {
    if (a.purgeAtMs !== b.purgeAtMs) return a.purgeAtMs < b.purgeAtMs;
    if (a.kind !== b.kind) return a.kind === 'circuit';
    return a.key < b.key;
  }

  private merchantRlExpiryHeapSiftUp(i: number): void {
    const h = this.merchantRlExpiryHeap;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.merchantRlExpiryHeapLess(h[i]!, h[p]!)) break;
      this.merchantRlHeapSwap(i, p);
      i = p;
    }
  }

  private merchantRlExpiryHeapSiftDown(i: number): void {
    const h = this.merchantRlExpiryHeap;
    const n = h.length;
    while (true) {
      let smallest = i;
      const l = i * 2 + 1;
      const r = i * 2 + 2;
      if (l < n && this.merchantRlExpiryHeapLess(h[l]!, h[smallest]!)) smallest = l;
      if (r < n && this.merchantRlExpiryHeapLess(h[r]!, h[smallest]!)) smallest = r;
      if (smallest === i) break;
      this.merchantRlHeapSwap(i, smallest);
      i = smallest;
    }
  }

  /** Una entrada por `kind:key`; si ya existe, actualiza `purgeAtMs` y reordena (sin crecer el heap por request). */
  private merchantRlExpiryHeapPushOrUpdate(e: MerchantRlExpiryHeapEntry): void {
    const lk = this.merchantRlHeapLogicalKey(e);
    const idx = this.merchantRlHeapIndexByLogicalKey.get(lk);
    if (idx !== undefined) {
      const cur = this.merchantRlExpiryHeap[idx]!;
      const oldPurge = cur.purgeAtMs;
      if (oldPurge === e.purgeAtMs) return;
      cur.purgeAtMs = e.purgeAtMs;
      if (e.purgeAtMs < oldPurge) {
        this.merchantRlExpiryHeapSiftUp(idx);
      } else {
        this.merchantRlExpiryHeapSiftDown(idx);
      }
      return;
    }
    const i = this.merchantRlExpiryHeap.length;
    this.merchantRlExpiryHeap.push(e);
    this.merchantRlHeapIndexByLogicalKey.set(lk, i);
    this.merchantRlExpiryHeapSiftUp(i);
  }

  private merchantRlExpiryHeapPeek(): MerchantRlExpiryHeapEntry | undefined {
    return this.merchantRlExpiryHeap[0];
  }

  private merchantRlExpiryHeapPop(): MerchantRlExpiryHeapEntry | undefined {
    const h = this.merchantRlExpiryHeap;
    if (h.length === 0) return undefined;
    const top = h[0]!;
    this.merchantRlHeapIndexByLogicalKey.delete(this.merchantRlHeapLogicalKey(top));
    const last = h.pop()!;
    if (h.length === 0) return top;
    h[0] = last;
    this.merchantRlHeapIndexByLogicalKey.set(this.merchantRlHeapLogicalKey(last), 0);
    this.merchantRlExpiryHeapSiftDown(0);
    return top;
  }

  /**
   * Elimina entradas expiradas usando un min-heap por `purgeAtMs` (sin escanear Maps enteros
   * cuando no hay expirados). `maxDeletes` acota borrados efectivos; el heap puede tener
   * entradas obsoletas si se amplía `purgeAtMs` — se descartan al hacer pop.
   */
  private pruneExpiredMerchantState(nowMs: number, maxDeletes: number, maxHeapPops: number): void {
    let deleted = 0;
    let pops = 0;
    while (deleted < maxDeletes && pops < maxHeapPops) {
      const peeked = this.merchantRlExpiryHeapPeek();
      if (peeked === undefined || peeked.purgeAtMs > nowMs) return;
      pops += 1;
      const top = this.merchantRlExpiryHeapPop()!;
      if (top.kind === 'circuit') {
        const c = this.circuitByMerchantOp.get(top.key);
        if (!c || c.purgeAtMs !== top.purgeAtMs) continue;
        this.circuitByMerchantOp.delete(top.key);
        deleted += 1;
      } else {
        const m = this.memRlByMerchantOp.get(top.key);
        if (!m || m.purgeAtMs !== top.purgeAtMs) continue;
        this.memRlByMerchantOp.delete(top.key);
        deleted += 1;
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
