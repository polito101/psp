import { Controller, Get, Logger } from '@nestjs/common';
import { VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

type HealthCheck = {
  status: 'ok' | 'error';
  details?: string;
};

@ApiTags('health')
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  private readonly log = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check básico (app/db/redis)' })
  async getHealth() {
    const db: HealthCheck = { status: 'ok' };
    const redisCheck: HealthCheck = { status: 'ok' };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      db.status = 'error';
      // El mensaje real se loguea en servidor; al cliente solo llega un string genérico
      // para no filtrar detalles de infraestructura a través de un endpoint público.
      db.details = 'db check failed';
      this.log.error(`Health db check failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      const client = this.redis.getClient();
      if (client) {
        await client.ping();
      }
    } catch (e) {
      redisCheck.status = 'error';
      redisCheck.details = 'redis check failed';
      this.log.error(`Health redis check failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    const status = db.status === 'ok' && redisCheck.status === 'ok' ? 'ok' : 'degraded';
    return {
      status,
      timestamp: new Date().toISOString(),
      checks: {
        app: { status: 'ok' as const },
        db,
        redis: redisCheck,
      },
    };
  }
}

