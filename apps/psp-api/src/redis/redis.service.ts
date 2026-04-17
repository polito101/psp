import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Prefijo de clave Redis HASH por proveedor para el circuit breaker de Payments V2.
 * Campos: `failures` (contador), `openedUntil` (epoch ms hasta el que el circuito se considera abierto).
 */
export const PAYMENTS_V2_CB_HASH_PREFIX = 'payv2:cb';

/**
 * Clave efímera SET NX para exclusión mutua de la sonda half-open por proveedor (Payments V2).
 * Valor arbitrario; la presencia de la clave indica “hay una petición de prueba en curso”.
 */
export function paymentsV2CircuitHalfOpenProbeKey(provider: string): string {
  return `${PAYMENTS_V2_CB_HASH_PREFIX}:${provider}:probe`;
}

/**
 * Lua atómico: incrementa fallos y, si alcanza umbral, fija `openedUntil = now + cooldownMs`.
 * Devuelve `openedNow=1` en la transición cerrado→abierto (antes del INCR, `openedUntil <= now`
 * y tras el INCR `failures >= threshold`), no en fallos extra mientras el circuito sigue abierto.
 */
const PAYMENTS_V2_CB_LUA_INCREMENT = `
local key = KEYS[1]
local threshold = tonumber(ARGV[1])
local cooldownMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local openedUntilPrevRaw = redis.call('HGET', key, 'openedUntil')
local openedUntilPrev = 0
if openedUntilPrevRaw then
  openedUntilPrev = tonumber(openedUntilPrevRaw) or 0
end
local wasOpen = 0
if openedUntilPrev > now then
  wasOpen = 1
end
local failures = redis.call('HINCRBY', key, 'failures', 1)
local openedNow = 0
if failures >= threshold then
  redis.call('HSET', key, 'openedUntil', now + cooldownMs)
  if wasOpen == 0 then
    openedNow = 1
  end
end
local openedRaw = redis.call('HGET', key, 'openedUntil')
local openedUntil = 0
if openedRaw then
  openedUntil = tonumber(openedRaw) or 0
end
return {failures, openedUntil, openedNow}
`;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis | null;

  constructor(url: string | undefined) {
    this.client = url ? new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true }) : null;
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  async setIdempotency(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!this.client) return true;
    const r = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return r === 'OK';
  }

  async getIdempotency(key: string): Promise<string | null> {
    if (!this.client) return null;
    return this.client.get(key);
  }

  /** Elimina una clave de idempotencia (p. ej. tras fallo no terminal que debe permitir reintento). */
  async delIdempotency(key: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(key);
  }

  private paymentsV2CircuitBreakerHashKey(provider: string): string {
    return `${PAYMENTS_V2_CB_HASH_PREFIX}:${provider}`;
  }

  /**
   * Incrementa el contador de fallos del CB v2 para un proveedor y opcionalmente abre/extiende la ventana.
   * `openedNow` vale 1 cuando, en esta llamada, el circuito pasa de cerrado a abierto (`openedUntil` previo
   * no posterior a `nowMs` y, tras el incremento, `failures >= threshold`). No se emite en fallos consecutivos
   * mientras la ventana sigue vigente.
   * Requiere cliente Redis configurado.
   */
  async incrementPaymentsV2ProviderCircuitFailure(
    provider: string,
    failuresThreshold: number,
    cooldownMs: number,
    nowMs: number,
  ): Promise<{ failures: number; openedUntil: number; openedNow: number }> {
    if (!this.client) {
      throw new Error('Redis client not configured');
    }
    const key = this.paymentsV2CircuitBreakerHashKey(provider);
    const raw = (await this.client.eval(
      PAYMENTS_V2_CB_LUA_INCREMENT,
      1,
      key,
      String(failuresThreshold),
      String(cooldownMs),
      String(Math.trunc(nowMs)),
    )) as unknown;
    if (!Array.isArray(raw) || raw.length < 2) {
      throw new Error('Unexpected Redis eval result for payments v2 circuit breaker');
    }
    const openedNowRaw = raw.length >= 3 ? raw[2] : 0;
    const openedNowNum = Number(openedNowRaw);
    return {
      failures: Number(raw[0]),
      openedUntil: Number(raw[1]),
      openedNow: Number.isFinite(openedNowNum) ? openedNowNum : 0,
    };
  }

  /** Pone el estado del CB v2 del proveedor a cerrado (fallos 0, sin ventana abierta). */
  async resetPaymentsV2ProviderCircuit(provider: string): Promise<void> {
    if (!this.client) return;
    const key = this.paymentsV2CircuitBreakerHashKey(provider);
    await this.client.hset(key, 'failures', '0', 'openedUntil', '0');
  }

  /**
   * Lee el estado HASH del CB v2; si no existe, devuelve ceros.
   */
  async getPaymentsV2ProviderCircuitState(provider: string): Promise<{ failures: number; openedUntil: number }> {
    if (!this.client) {
      return { failures: 0, openedUntil: 0 };
    }
    const key = this.paymentsV2CircuitBreakerHashKey(provider);
    const [failuresRaw, openedRaw] = await this.client.hmget(key, 'failures', 'openedUntil');
    const failures = failuresRaw != null && failuresRaw !== '' ? Number(failuresRaw) : 0;
    const openedUntil = openedRaw != null && openedRaw !== '' ? Number(openedRaw) : 0;
    return {
      failures: Number.isFinite(failures) ? failures : 0,
      openedUntil: Number.isFinite(openedUntil) ? openedUntil : 0,
    };
  }

  /**
   * Intenta reservar la sonda half-open para un proveedor (SET NX EX). Una sola réplica/petición gana.
   * Requiere cliente Redis configurado.
   */
  async tryAcquirePaymentsV2HalfOpenProbe(provider: string, ttlSeconds: number): Promise<boolean> {
    if (!this.client) {
      throw new Error('Redis client not configured');
    }
    const key = paymentsV2CircuitHalfOpenProbeKey(provider);
    const ttl = Math.max(1, Math.trunc(ttlSeconds));
    const r = await this.client.set(key, '1', 'EX', ttl, 'NX');
    return r === 'OK';
  }

  /** Libera la sonda half-open (p. ej. al terminar `adapter.run` con éxito o fallo). Idempotente. */
  async releasePaymentsV2HalfOpenProbe(provider: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(paymentsV2CircuitHalfOpenProbeKey(provider));
  }
}
