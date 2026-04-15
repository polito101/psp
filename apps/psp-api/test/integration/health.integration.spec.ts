import request from 'supertest';
import { INestApplication } from '@nestjs/common/interfaces';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, resetIntegrationDb } from './helpers/integration-app';

describe('health integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const setup = await createIntegrationApp();
    app = setup.app;
    prisma = setup.prisma;
  });

  beforeEach(async () => {
    await resetIntegrationDb(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns health status with detailed checks', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(['ok', 'degraded']).toContain(response.body.status);
    expect(response.body.checks).toBeDefined();
    expect(response.body.checks.app.status).toBe('ok');
    expect(response.body.checks.db).toBeDefined();
    expect(response.body.checks.redis).toBeDefined();
    expect(typeof response.body.timestamp).toBe('string');
  });
});
