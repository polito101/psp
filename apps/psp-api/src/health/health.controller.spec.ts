import { Logger } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const prisma = {
    $queryRaw: jest.fn(),
  };
  const redis = {
    getClient: jest.fn(),
  };

  let controller: HealthController;
  let logErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    controller = new HealthController(prisma as never, redis as never);
    logErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logErrorSpy.mockRestore();
    jest.useRealTimers();
  });

  it('returns ok when DB and Redis checks pass', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redis.getClient.mockReturnValue({
      ping: jest.fn().mockResolvedValue('PONG'),
    });

    const result = await controller.getHealth();
    expect(result.status).toBe('ok');
    expect(result.checks.db.status).toBe('ok');
    expect(result.checks.redis.status).toBe('ok');
  });

  it('returns degraded when DB fails', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('db down'));
    redis.getClient.mockReturnValue(null);

    const result = await controller.getHealth();
    expect(result.status).toBe('degraded');
    expect(result.checks.db.status).toBe('error');
    expect(result.checks.redis.status).toBe('ok');
  });

  it('does not expose internal DB error message in the response', async () => {
    const internalMsg = 'Connection refused: postgresql://secret-host:5432/prod';
    prisma.$queryRaw.mockRejectedValue(new Error(internalMsg));
    redis.getClient.mockReturnValue({ ping: jest.fn().mockResolvedValue('PONG') });

    const result = await controller.getHealth();

    expect(result.checks.db.status).toBe('error');
    expect(result.checks.db.details).not.toContain(internalMsg);
    expect(result.checks.db.details).toBe('db check failed');
  });

  it('does not expose internal Redis error message in the response', async () => {
    const internalMsg = 'ECONNREFUSED redis://internal-redis:6379';
    prisma.$queryRaw.mockResolvedValue([]);
    redis.getClient.mockReturnValue({
      ping: jest.fn().mockRejectedValue(new Error(internalMsg)),
    });

    const result = await controller.getHealth();

    expect(result.checks.redis.status).toBe('error');
    expect(result.checks.redis.details).not.toContain(internalMsg);
    expect(result.checks.redis.details).toBe('redis check failed');
  });

  it('returns degraded when both DB and Redis fail', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('db down'));
    redis.getClient.mockReturnValue({
      ping: jest.fn().mockRejectedValue(new Error('redis down')),
    });

    const result = await controller.getHealth();
    expect(result.status).toBe('degraded');
    expect(result.checks.db.status).toBe('error');
    expect(result.checks.redis.status).toBe('error');
  });

  // ── in-memory cache ──────────────────────────────────────────────────────
  describe('in-memory cache', () => {
    it('returns cached result on second call within TTL without re-querying DB/Redis', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      redis.getClient.mockReturnValue({ ping: jest.fn().mockResolvedValue('PONG') });

      const first = await controller.getHealth();
      const second = await controller.getHealth();

      // El resultado debe ser el mismo objeto (referencia)
      expect(second).toBe(first);
      // DB y Redis solo consultados una vez
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('re-queries DB/Redis after cache TTL expires', async () => {
      jest.useFakeTimers();

      prisma.$queryRaw.mockResolvedValue([]);
      redis.getClient.mockReturnValue({ ping: jest.fn().mockResolvedValue('PONG') });

      await controller.getHealth();

      // Avanzar el tiempo más allá del TTL
      jest.advanceTimersByTime(HealthController.CACHE_TTL_MS + 1);

      await controller.getHealth();

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('caches degraded results too (avoids hammering DB when it is down)', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('db down'));
      redis.getClient.mockReturnValue(null);

      const first = await controller.getHealth();
      const second = await controller.getHealth();

      expect(first.status).toBe('degraded');
      expect(second).toBe(first);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('cache timestamp reflects when the check was performed, not when the cache was hit', async () => {
      jest.useFakeTimers();
      const t0 = Date.now();

      prisma.$queryRaw.mockResolvedValue([]);
      redis.getClient.mockReturnValue({ ping: jest.fn().mockResolvedValue('PONG') });

      const first = await controller.getHealth();
      jest.advanceTimersByTime(1_000);
      const second = await controller.getHealth();

      // Ambas llamadas devuelven la misma marca temporal (la del check real)
      expect(second.timestamp).toBe(first.timestamp);
      expect(new Date(first.timestamp).getTime()).toBe(t0);
    });
  });

  // ── log sanitization ──────────────────────────────────────────────────────
  describe('log sanitization', () => {
    it('redacts connection URLs with credentials from DB error log', async () => {
      prisma.$queryRaw.mockRejectedValue(
        new Error('connect ECONNREFUSED postgresql://admin:secret@db-host:5432/prod'),
      );
      redis.getClient.mockReturnValue({ ping: jest.fn().mockResolvedValue('PONG') });

      await controller.getHealth();

      expect(logErrorSpy).toHaveBeenCalledTimes(1);
      const logged: string = logErrorSpy.mock.calls[0][0] as string;
      expect(logged).not.toMatch(/admin:secret/);
      expect(logged).not.toMatch(/db-host/);
      expect(logged).toContain('[redacted-url]');
    });

    it('redacts connection URLs from Redis error log', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      redis.getClient.mockReturnValue({
        ping: jest.fn().mockRejectedValue(
          new Error('ECONNREFUSED redis://internal-redis:6379'),
        ),
      });

      await controller.getHealth();

      expect(logErrorSpy).toHaveBeenCalledTimes(1);
      const logged: string = logErrorSpy.mock.calls[0][0] as string;
      expect(logged).not.toMatch(/internal-redis/);
      expect(logged).toContain('[redacted-url]');
    });

    it('logs error name and sanitized message without URLs', async () => {
      const err = new Error('connect ECONNREFUSED postgresql://x:y@host/db');
      err.name = 'PrismaClientInitializationError';
      prisma.$queryRaw.mockRejectedValue(err);
      redis.getClient.mockReturnValue({ ping: jest.fn().mockResolvedValue('PONG') });

      await controller.getHealth();

      const logged: string = logErrorSpy.mock.calls[0][0] as string;
      expect(logged).toContain('PrismaClientInitializationError');
      expect(logged).not.toMatch(/x:y@host/);
    });

    it('truncates excessively long error messages in the log', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('x'.repeat(500)));
      redis.getClient.mockReturnValue({ ping: jest.fn().mockResolvedValue('PONG') });

      await controller.getHealth();

      const logged: string = logErrorSpy.mock.calls[0][0] as string;
      // prefix "Health db check failed: Error: " + max 200 chars sanitized message
      expect(logged.length).toBeLessThanOrEqual('Health db check failed: Error: '.length + 200);
    });
  });
});

