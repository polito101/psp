import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

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
}
