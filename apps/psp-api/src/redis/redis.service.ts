import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Prefijo de clave Redis HASH por proveedor para el circuit breaker de Payments V2.
 * Campos: `failures` (contador), `openedUntil` (epoch ms hasta el que el circuito se considera abierto).
 */
export const PAYMENTS_V2_CB_HASH_PREFIX = 'payv2:cb';

/** Lua atómico: incrementa fallos y, si alcanza umbral, fija `openedUntil = now + cooldownMs`. */
const PAYMENTS_V2_CB_LUA_INCREMENT = `
local key = KEYS[1]
local threshold = tonumber(ARGV[1])
local cooldownMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local failures = redis.call('HINCRBY', key, 'failures', 1)
if failures >= threshold then
  redis.call('HSET', key, 'openedUntil', now + cooldownMs)
end
local openedRaw = redis.call('HGET', key, 'openedUntil')
local openedUntil = 0
if openedRaw then
  openedUntil = tonumber(openedRaw) or 0
end
return {failures, openedUntil}
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
   * Requiere cliente Redis configurado.
   */
  async incrementPaymentsV2ProviderCircuitFailure(
    provider: string,
    failuresThreshold: number,
    cooldownMs: number,
    nowMs: number,
  ): Promise<{ failures: number; openedUntil: number }> {
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
    return { failures: Number(raw[0]), openedUntil: Number(raw[1]) };
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
}
