import { Controller, Get, Logger } from '@nestjs/common';
import { VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Elimina substrings tipo `scheme://[user:pass@]host[:port][/path]` de un mensaje
 * antes de enviarlo a logs para evitar filtrar credenciales o topología interna.
 *
 * Retorna el nombre del error y el mensaje sanitizado, ambos truncados a 200 caracteres.
 */
function sanitizeErrorForLog(e: unknown): string {
  const name = e instanceof Error ? e.name : 'UnknownError';
  const raw = e instanceof Error ? e.message : String(e);
  const sanitized = raw
    .replace(/[a-zA-Z][a-zA-Z0-9+\-.]*:\/\/[^\s"'>]*/g, '[redacted-url]')
    .slice(0, 200);
  return `${name}: ${sanitized}`;
}

type HealthCheck = {
  status: 'ok' | 'error';
  details?: string;
};

type HealthResult = {
  status: 'ok' | 'degraded';
  timestamp: string;
  checks: {
    app: { status: 'ok' };
    db: HealthCheck;
    redis: HealthCheck;
  };
};

/**
 * Throttle específico para `/health`: 60 req/min por IP.
 *
 * Más permisivo que el global (120/min para APIs de negocio) para acomodar
 * probes de K8s/ELB/monitoring que pueden correr desde múltiples nodos,
 * pero no ilimitado: un flood seguiría recibiendo 429 antes de saturar DB/Redis.
 *
 * El caché de CACHE_TTL_MS refuerza esta protección: incluso dentro del límite,
 * las queries reales a DB/Redis solo ocurren una vez por ventana de caché.
 */
@ApiTags('health')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  /** TTL del caché en memoria. Múltiples hits dentro de esta ventana devuelven el mismo resultado sin tocar DB/Redis. */
  static readonly CACHE_TTL_MS = 5_000;

  private readonly log = new Logger(HealthController.name);

  /** Caché de la última respuesta con su instante de expiración. */
  private cachedResult: { data: HealthResult; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check básico (app/db/redis)' })
  async getHealth(): Promise<HealthResult> {
    const now = Date.now();

    if (this.cachedResult && now < this.cachedResult.expiresAt) {
      return this.cachedResult.data;
    }

    const db: HealthCheck = { status: 'ok' };
    const redisCheck: HealthCheck = { status: 'ok' };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      db.status = 'error';
      // El mensaje real se loguea en servidor; al cliente solo llega un string genérico
      // para no filtrar detalles de infraestructura a través de un endpoint público.
      db.details = 'db check failed';
      this.log.error(`Health db check failed: ${sanitizeErrorForLog(e)}`);
    }

    try {
      const client = this.redis.getClient();
      if (client) {
        await client.ping();
      }
    } catch (e) {
      redisCheck.status = 'error';
      redisCheck.details = 'redis check failed';
      this.log.error(`Health redis check failed: ${sanitizeErrorForLog(e)}`);
    }

    const result: HealthResult = {
      status: db.status === 'ok' && redisCheck.status === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date(now).toISOString(),
      checks: {
        app: { status: 'ok' },
        db,
        redis: redisCheck,
      },
    };

    this.cachedResult = { data: result, expiresAt: now + HealthController.CACHE_TTL_MS };
    return result;
  }
}

