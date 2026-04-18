import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { parseMerchantRateLimitRedisCommandTimeoutMs } from '../config/merchant-rate-limit-redis-timeout';
import { RedisService } from './redis.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: RedisService,
      useFactory: (config: ConfigService) => {
        const urlRaw = config.get<string>('REDIS_URL');
        const url = urlRaw !== undefined && String(urlRaw).trim() !== '' ? String(urlRaw).trim() : undefined;
        const merchantRlCommandTimeoutMs = parseMerchantRateLimitRedisCommandTimeoutMs(
          config.get<string>('PAYMENTS_V2_MERCHANT_RL_REDIS_OP_TIMEOUT_MS'),
        );
        return new RedisService(
          url,
          url ? { merchantRateLimitCommandTimeoutMs: merchantRlCommandTimeoutMs } : undefined,
        );
      },
      inject: [ConfigService],
    },
  ],
  exports: [RedisService],
})
export class RedisModule {}
