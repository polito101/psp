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
});

