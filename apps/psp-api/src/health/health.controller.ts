import { Controller, Get } from '@nestjs/common';
import { VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

type HealthCheck = {
  status: 'ok' | 'error';
  details?: string;
};

@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check básico (app/db/redis)' })
  async getHealth() {
    const db: HealthCheck = { status: 'ok' };
    const redis: HealthCheck = { status: 'ok' };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      db.status = 'error';
      db.details = e instanceof Error ? e.message : String(e);
    }

    try {
      const client = this.redis.getClient();
      if (client) {
        await client.ping();
      }
    } catch (e) {
      redis.status = 'error';
      redis.details = e instanceof Error ? e.message : String(e);
    }

    const status = db.status === 'ok' && redis.status === 'ok' ? 'ok' : 'degraded';
    return {
      status,
      timestamp: new Date().toISOString(),
      checks: {
        app: { status: 'ok' as const },
        db,
        redis,
      },
    };
  }
}

