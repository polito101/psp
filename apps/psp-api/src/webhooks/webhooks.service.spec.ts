import { ConflictException, NotFoundException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

jest.mock('../crypto/secret-box', () => ({
  decryptUtf8: jest.fn(() => 'plain_secret'),
}));

describe('WebhooksService', () => {
  const prisma = {
    merchant: { findUnique: jest.fn() },
    webhookDelivery: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  let service: WebhooksService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhooksService(prisma as never);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    prisma.webhookDelivery.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── signPayload ──────────────────────────────────────────────────────────
  it('signPayload returns deterministic HMAC', () => {
    const sig1 = service.signPayload('secret', '{"ok":true}', '123');
    const sig2 = service.signPayload('secret', '{"ok":true}', '123');
    expect(sig1).toBe(sig2);
  });

  // ── deliver (solo enqueue) ───────────────────────────────────────────────
  it('skips and returns skipped when merchant has no webhookUrl', async () => {
    prisma.merchant.findUnique.mockResolvedValue({ webhookUrl: null });
    const result = await service.deliver('m_1', 'payment.succeeded', {});
    expect(result.status).toBe('skipped');
    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates a pending delivery when webhookUrl is present', async () => {
    prisma.merchant.findUnique.mockResolvedValue({ webhookUrl: 'https://example.com/hook' });
    prisma.webhookDelivery.create.mockResolvedValue({ id: 'wd_1' });

    const result = await service.deliver('m_1', 'payment.succeeded', { payment_id: 'p_1' });

    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: 'm_1',
        eventType: 'payment.succeeded',
        status: 'pending',
        attempts: 0,
      }),
    });
    expect(result.status).toBe('pending');
    expect(result.deliveryId).toBe('wd_1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  const createdAtFixture = new Date('2026-04-10T12:00:00.000Z');

  // ── worker: tryClaimAndProcess ───────────────────────────────────────────
  it('worker delivers successfully on first attempt', async () => {
    prisma.webhookDelivery.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'wd_1', merchantId: 'm_1', eventType: 'payment.succeeded',
      payload: { payment_id: 'p_1' }, attempts: 0, status: 'processing',
      createdAt: createdAtFixture,
    });
    prisma.merchant.findUnique.mockResolvedValue({
      webhookUrl: 'https://example.com/hook',
      webhookSecretCiphertext: 'cipher',
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await (service as unknown as { tryClaimAndProcess: (id: string) => Promise<void> }).tryClaimAndProcess(
      'wd_1',
    );

    expect(prisma.webhookDelivery.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'wd_1',
        status: 'pending',
        scheduledAt: { lte: expect.any(Date) },
      },
      data: { status: 'processing', scheduledAt: expect.any(Date) },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchOpts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(fetchOpts.headers).toMatchObject(
      expect.objectContaining({ 'X-PSP-Delivery-Id': 'wd_1' }),
    );
    const parsed = JSON.parse(fetchOpts.body as string);
    expect(parsed.id).toBe('wd_1');
    expect(parsed.created_at).toBe(createdAtFixture.toISOString());
    expect(parsed.data).toEqual({ payment_id: 'p_1' });
    expect(prisma.webhookDelivery.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'wd_1', status: 'processing' },
      data: expect.objectContaining({ status: 'delivered', attempts: 1, lastError: null }),
    });
  });

  it('worker schedules retry with backoff on transient failure', async () => {
    prisma.webhookDelivery.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'wd_1', merchantId: 'm_1', eventType: 'payment.succeeded',
      payload: {}, attempts: 0, status: 'processing',
      createdAt: createdAtFixture,
    });
    prisma.merchant.findUnique.mockResolvedValue({
      webhookUrl: 'https://example.com/hook',
      webhookSecretCiphertext: 'cipher',
    });
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await (service as unknown as { tryClaimAndProcess: (id: string) => Promise<void> }).tryClaimAndProcess(
      'wd_1',
    );

    expect(prisma.webhookDelivery.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'wd_1', status: 'processing' },
      data: expect.objectContaining({ status: 'pending', attempts: 1, lastError: 'HTTP 500' }),
    });
  });

  it('worker marks failed after max attempts', async () => {
    prisma.webhookDelivery.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'wd_1', merchantId: 'm_1', eventType: 'payment.succeeded',
      payload: {}, attempts: 2, status: 'processing',
      createdAt: createdAtFixture,
    });
    prisma.merchant.findUnique.mockResolvedValue({
      webhookUrl: 'https://example.com/hook',
      webhookSecretCiphertext: 'cipher',
    });
    fetchMock.mockRejectedValue(new Error('network timeout'));

    await (service as unknown as { tryClaimAndProcess: (id: string) => Promise<void> }).tryClaimAndProcess(
      'wd_1',
    );

    expect(prisma.webhookDelivery.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'wd_1', status: 'processing' },
      data: expect.objectContaining({ status: 'failed', attempts: 3, lastError: 'network timeout' }),
    });
  });

  it('worker skips fetch when delivery left processing before HTTP (e.g. manual requeue)', async () => {
    prisma.webhookDelivery.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'wd_1', merchantId: 'm_1', eventType: 'payment.succeeded',
      payload: {}, attempts: 0, status: 'processing',
      createdAt: createdAtFixture,
    });
    prisma.merchant.findUnique.mockResolvedValue({
      webhookUrl: 'https://example.com/hook',
      webhookSecretCiphertext: 'cipher',
    });
    prisma.webhookDelivery.findFirst.mockResolvedValueOnce(null);

    await (service as unknown as { tryClaimAndProcess: (id: string) => Promise<void> }).tryClaimAndProcess(
      'wd_1',
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.webhookDelivery.updateMany).toHaveBeenCalledTimes(1);
  });

  it('worker marks failed when webhookUrl removed during processing', async () => {
    prisma.webhookDelivery.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'wd_1', merchantId: 'm_1', eventType: 'payment.succeeded',
      payload: {}, attempts: 0, status: 'processing',
      createdAt: createdAtFixture,
    });
    prisma.merchant.findUnique.mockResolvedValue({ webhookUrl: null });

    await (service as unknown as { tryClaimAndProcess: (id: string) => Promise<void> }).tryClaimAndProcess(
      'wd_1',
    );

    expect(prisma.webhookDelivery.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'wd_1', status: 'processing' },
      data: expect.objectContaining({ status: 'failed' }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('worker skips fetch when atomic claim loses the race', async () => {
    prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 0 });

    await (service as unknown as { tryClaimAndProcess: (id: string) => Promise<void> }).tryClaimAndProcess(
      'wd_1',
    );

    expect(prisma.webhookDelivery.findUnique).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('worker marks delivery failed when findUnique returns null after claim (inconsistent state)', async () => {
    // Claim exitoso, pero la fila desaparece entre el claim y el findUnique (fila borrada).
    prisma.webhookDelivery.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 1 }); // finishFromProcessing
    prisma.webhookDelivery.findUnique.mockResolvedValue(null);

    await (service as unknown as { tryClaimAndProcess: (id: string) => Promise<void> }).tryClaimAndProcess(
      'wd_1',
    );

    expect(prisma.webhookDelivery.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'wd_1', status: 'processing' },
      data: expect.objectContaining({ status: 'failed', lastError: expect.stringContaining('missing') }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('worker safety-net catch releases delivery when an unexpected error occurs after claim', async () => {
    // Simula un error de BD inesperado en merchant.findUnique (la ruta no cubierta por try/catch interno).
    prisma.webhookDelivery.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 1 }); // scheduleRetryOrFail desde el catch externo
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'wd_1', merchantId: 'm_1', eventType: 'payment.succeeded',
      payload: {}, attempts: 1, status: 'processing',
      createdAt: new Date(),
    });
    prisma.merchant.findUnique.mockRejectedValue(new Error('DB connection lost'));

    await (service as unknown as { tryClaimAndProcess: (id: string) => Promise<void> }).tryClaimAndProcess(
      'wd_1',
    );

    // El catch externo debe llamar a scheduleRetryOrFail con attempts + 1
    expect(prisma.webhookDelivery.updateMany).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        where: expect.objectContaining({ id: 'wd_1', status: 'processing' }),
        data: expect.objectContaining({ lastError: expect.stringContaining('Unexpected error') }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('worker logs cleanup failure when both processing and safety-net cleanup fail', async () => {
    // El claim tiene éxito, findUnique explota, y scheduleRetryOrFail también falla.
    prisma.webhookDelivery.updateMany.mockResolvedValueOnce({ count: 1 }); // claim
    prisma.webhookDelivery.findUnique.mockRejectedValue(new Error('DB down'));
    // scheduleRetryOrFail llama a updateMany → también falla
    prisma.webhookDelivery.updateMany.mockRejectedValueOnce(new Error('DB still down'));

    // No debe propagar: el catch externo absorbe el error de cleanup
    await expect(
      (service as unknown as { tryClaimAndProcess: (id: string) => Promise<void> }).tryClaimAndProcess('wd_1'),
    ).resolves.toBeUndefined();
  });

  // ── retryFailedDelivery ──────────────────────────────────────────────────
  it('throws NotFoundException when delivery not found', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue(null);
    await expect(service.retryFailedDelivery('wd_missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ConflictException when delivery is not failed or stuck processing', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue({ id: 'wd_1', status: 'delivered' });
    await expect(service.retryFailedDelivery('wd_1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws ConflictException when delivery is still pending', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue({ id: 'wd_1', status: 'pending' });
    await expect(service.retryFailedDelivery('wd_1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('resets failed delivery to pending using conditional updateMany', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'wd_failed',
      status: 'failed',
      scheduledAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.retryFailedDelivery('wd_failed');

    expect(prisma.webhookDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'wd_failed',
        OR: [{ status: 'failed' }, { status: 'processing', scheduledAt: { lte: expect.any(Date) } }],
      },
      data: expect.objectContaining({ status: 'pending', attempts: 0, lastError: null }),
    });
    expect(prisma.webhookDelivery.update).not.toHaveBeenCalled();
    expect(result.status).toBe('pending');
    expect(result.deliveryId).toBe('wd_failed');
  });

  it('resets stuck processing delivery to pending using conditional updateMany', async () => {
    const now = new Date('2026-04-12T12:00:00.000Z');
    jest.useFakeTimers({ now: now.getTime() });
    const stuckBefore = new Date(now.getTime() - 15_000);
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'wd_stuck',
      status: 'processing',
      scheduledAt: new Date(now.getTime() - 20_000),
    });
    prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.retryFailedDelivery('wd_stuck');

    expect(prisma.webhookDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'wd_stuck',
        OR: [{ status: 'failed' }, { status: 'processing', scheduledAt: { lte: stuckBefore } }],
      },
      data: expect.objectContaining({ status: 'pending', attempts: 0, lastError: null }),
    });
    expect(prisma.webhookDelivery.update).not.toHaveBeenCalled();
    expect(result.status).toBe('pending');
    expect(result.deliveryId).toBe('wd_stuck');
  });

  it('rejects retry on active processing (simula fetch en curso: no reencolar → evita POST duplicado)', async () => {
    const now = new Date('2026-04-12T12:00:00.000Z');
    jest.useFakeTimers({ now: now.getTime() });
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'wd_active',
      status: 'processing',
      scheduledAt: new Date(now.getTime() - 2_000),
    });

    await expect(service.retryFailedDelivery('wd_active')).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.webhookDelivery.updateMany).not.toHaveBeenCalled();
  });

  it('throws ConflictException when status changed concurrently before the updateMany (race condition)', async () => {
    // Simula la carrera: findUnique ve 'processing' atascado, pero el worker termina y pasa a
    // 'delivered' antes de que llegue el updateMany → count === 0 → no se sobreescribe.
    const now = new Date('2026-04-12T12:00:00.000Z');
    jest.useFakeTimers({ now: now.getTime() });
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'wd_race',
      status: 'processing',
      scheduledAt: new Date(now.getTime() - 20_000),
    });
    prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.retryFailedDelivery('wd_race')).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.webhookDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'wd_race',
        OR: [{ status: 'failed' }, { status: 'processing', scheduledAt: { lte: expect.any(Date) } }],
      },
      data: expect.any(Object),
    });
  });

  // ── processPendingDeliveries ─────────────────────────────────────────────
  it('processPendingDeliveries invokes tryClaimAndProcess for each due delivery', async () => {
    prisma.webhookDelivery.findMany.mockResolvedValue([
      { id: 'wd_1' },
      { id: 'wd_2' },
      { id: 'wd_3' },
    ]);
    // claim falla → sin operaciones adicionales
    prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 0 });

    const count = await (service as unknown as { processPendingDeliveries: () => Promise<number> }).processPendingDeliveries();

    expect(prisma.webhookDelivery.updateMany).toHaveBeenCalledTimes(3);
    expect(count).toBe(3);
  });

  it('processPendingDeliveries returns 0 when no due deliveries (signals idle to worker)', async () => {
    prisma.webhookDelivery.findMany.mockResolvedValue([]);

    const count = await (service as unknown as { processPendingDeliveries: () => Promise<number> }).processPendingDeliveries();

    expect(count).toBe(0);
    expect(prisma.webhookDelivery.updateMany).not.toHaveBeenCalled();
  });

  // ── feature flag & idle backoff ──────────────────────────────────────────
  describe('WEBHOOK_WORKER_ENABLED feature flag', () => {
    afterEach(() => {
      delete process.env.WEBHOOK_WORKER_ENABLED;
    });

    it('starts the worker when WEBHOOK_WORKER_ENABLED is not set (default on)', () => {
      delete process.env.WEBHOOK_WORKER_ENABLED;
      const svc = new WebhooksService(prisma as never);
      const startSpy = jest.spyOn(svc as unknown as { startWorker: () => void }, 'startWorker');
      svc.onModuleInit();
      expect(startSpy).toHaveBeenCalledTimes(1);
      svc.onModuleDestroy();
    });

    it('starts the worker when WEBHOOK_WORKER_ENABLED=true', () => {
      process.env.WEBHOOK_WORKER_ENABLED = 'true';
      const svc = new WebhooksService(prisma as never);
      const startSpy = jest.spyOn(svc as unknown as { startWorker: () => void }, 'startWorker');
      svc.onModuleInit();
      expect(startSpy).toHaveBeenCalledTimes(1);
      svc.onModuleDestroy();
    });

    it('does NOT start the worker when WEBHOOK_WORKER_ENABLED=false', () => {
      process.env.WEBHOOK_WORKER_ENABLED = 'false';
      const svc = new WebhooksService(prisma as never);
      const startSpy = jest.spyOn(svc as unknown as { startWorker: () => void }, 'startWorker');
      svc.onModuleInit();
      expect(startSpy).not.toHaveBeenCalled();
    });
  });

  describe('idle backoff', () => {
    it('processPendingDeliveries returns 0 for an empty queue (foundation for backoff logic)', async () => {
      prisma.webhookDelivery.findMany.mockResolvedValue([]);

      const count = await (service as unknown as { processPendingDeliveries: () => Promise<number> })
        .processPendingDeliveries();

      expect(count).toBe(0);
    });

    it('processPendingDeliveries returns the number of due deliveries found', async () => {
      prisma.webhookDelivery.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      prisma.webhookDelivery.updateMany.mockResolvedValue({ count: 0 });

      const count = await (service as unknown as { processPendingDeliveries: () => Promise<number> })
        .processPendingDeliveries();

      expect(count).toBe(2);
    });

    it('worker stops rescheduling after stopWorker is called', async () => {
      prisma.webhookDelivery.findMany.mockResolvedValue([]);

      const svc = service as unknown as {
        startWorker: () => void;
        stopWorker: () => void;
        workerTimer: NodeJS.Timeout | null;
      };

      svc.startWorker();
      // Esperar a que el primer tick (asíncrono) termine
      await new Promise<void>((resolve) => setImmediate(resolve));

      svc.stopWorker();

      expect(svc.workerTimer).toBeNull();
    });
  });

  // ── runWithConcurrency ───────────────────────────────────────────────────
  it('runWithConcurrency executes all tasks and respects the concurrency limit', async () => {
    const LIMIT = 5;
    const TOTAL = 20;
    let active = 0;
    let peak = 0;

    const tasks = Array.from({ length: TOTAL }, () => async () => {
      active++;
      peak = Math.max(peak, active);
      // cede el event loop para que otras tareas puedan arrancar
      await new Promise<void>((resolve) => setImmediate(resolve));
      active--;
    });

    await (service as unknown as { runWithConcurrency: (t: typeof tasks, l: number) => Promise<void> })
      .runWithConcurrency(tasks, LIMIT);

    expect(peak).toBeLessThanOrEqual(LIMIT);
    expect(active).toBe(0);
  });

  it('runWithConcurrency does not throw when a task rejects (synchronous rejection)', async () => {
    let completed = 0;
    const tasks = [
      async () => { completed++; },
      async () => { throw new Error('boom'); },
      async () => { completed++; },
    ];

    await expect(
      (service as unknown as { runWithConcurrency: (t: typeof tasks, l: number) => Promise<void> })
        .runWithConcurrency(tasks, 2),
    ).resolves.toBeUndefined();

    expect(completed).toBe(2);
  });

  it('runWithConcurrency does not throw and completes remaining tasks when a fast-failing task rejects before a slow task resolves', async () => {
    // Este test reproduce el escenario adverso: la tarea que falla (rápida) se asienta
    // en Promise.race antes que la tarea lenta, lo que en la implementación anterior
    // hacía que Promise.race lanzara y abortara el loop sin ejecutar la tercera tarea.
    let completed = 0;
    const tasks = [
      // tarea lenta (simula IO de red en curso)
      () => new Promise<void>((resolve) => setImmediate(() => { completed++; resolve(); })),
      // tarea que rechaza en el mismo tick que la anterior resolvería
      () => Promise.reject(new Error('transient failure')),
      // tercera tarea: debe ejecutarse igualmente
      async () => { completed++; },
    ];

    await expect(
      (service as unknown as { runWithConcurrency: (t: typeof tasks, l: number) => Promise<void> })
        .runWithConcurrency(tasks, 2),
    ).resolves.toBeUndefined();

    expect(completed).toBe(2);
  });
});
