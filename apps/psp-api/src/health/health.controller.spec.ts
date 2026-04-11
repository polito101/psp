import { HealthController } from './health.controller';

describe('HealthController', () => {
  const prisma = {
    $queryRaw: jest.fn(),
  };
  const redis = {
    getClient: jest.fn(),
  };

  let controller: HealthController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new HealthController(prisma as never, redis as never);
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
});

