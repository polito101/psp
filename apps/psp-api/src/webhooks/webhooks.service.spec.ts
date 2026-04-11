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
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  let service: WebhooksService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhooksService(prisma as never);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
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

  // ── worker: processOne ───────────────────────────────────────────────────
  it('worker delivers successfully on first attempt', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'wd_1', merchantId: 'm_1', eventType: 'payment.succeeded',
      payload: { payment_id: 'p_1' }, attempts: 0, status: 'pending',
      createdAt: createdAtFixture,
    });
    prisma.merchant.findUnique.mockResolvedValue({
      webhookUrl: 'https://example.com/hook',
      webhookSecretCiphertext: 'cipher',
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await (service as unknown as { processOne: (id: string) => Promise<void> }).processOne('wd_1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchOpts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(fetchOpts.headers).toMatchObject(
      expect.objectContaining({ 'X-PSP-Delivery-Id': 'wd_1' }),
    );
    const parsed = JSON.parse(fetchOpts.body as string);
    expect(parsed.id).toBe('wd_1');
    expect(parsed.created_at).toBe(createdAtFixture.toISOString());
    expect(parsed.data).toEqual({ payment_id: 'p_1' });
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: 'wd_1' },
      data: expect.objectContaining({ status: 'delivered', attempts: 1, lastError: null }),
    });
  });

  it('worker schedules retry with backoff on transient failure', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'wd_1', merchantId: 'm_1', eventType: 'payment.succeeded',
      payload: {}, attempts: 0, status: 'pending',
      createdAt: createdAtFixture,
    });
    prisma.merchant.findUnique.mockResolvedValue({
      webhookUrl: 'https://example.com/hook',
      webhookSecretCiphertext: 'cipher',
    });
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await (service as unknown as { processOne: (id: string) => Promise<void> }).processOne('wd_1');

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: 'wd_1' },
      data: expect.objectContaining({ status: 'pending', attempts: 1, lastError: 'HTTP 500' }),
    });
  });

  it('worker marks failed after max attempts', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'wd_1', merchantId: 'm_1', eventType: 'payment.succeeded',
      payload: {}, attempts: 2, status: 'pending',
      createdAt: createdAtFixture,
    });
    prisma.merchant.findUnique.mockResolvedValue({
      webhookUrl: 'https://example.com/hook',
      webhookSecretCiphertext: 'cipher',
    });
    fetchMock.mockRejectedValue(new Error('network timeout'));

    await (service as unknown as { processOne: (id: string) => Promise<void> }).processOne('wd_1');

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: 'wd_1' },
      data: expect.objectContaining({ status: 'failed', attempts: 3, lastError: 'network timeout' }),
    });
  });

  it('worker marks failed when webhookUrl removed during processing', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'wd_1', merchantId: 'm_1', eventType: 'payment.succeeded',
      payload: {}, attempts: 0, status: 'pending',
      createdAt: createdAtFixture,
    });
    prisma.merchant.findUnique.mockResolvedValue({ webhookUrl: null });

    await (service as unknown as { processOne: (id: string) => Promise<void> }).processOne('wd_1');

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: 'wd_1' },
      data: expect.objectContaining({ status: 'failed' }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── retryFailedDelivery ──────────────────────────────────────────────────
  it('throws NotFoundException when delivery not found', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue(null);
    await expect(service.retryFailedDelivery('wd_missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ConflictException when delivery is not failed', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue({ id: 'wd_1', status: 'delivered' });
    await expect(service.retryFailedDelivery('wd_1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('resets failed delivery to pending', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue({ id: 'wd_failed', status: 'failed' });
    prisma.webhookDelivery.update.mockResolvedValue({ id: 'wd_failed' });

    const result = await service.retryFailedDelivery('wd_failed');

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: 'wd_failed' },
      data: expect.objectContaining({ status: 'pending', attempts: 0, lastError: null }),
    });
    expect(result.status).toBe('pending');
    expect(result.deliveryId).toBe('wd_failed');
  });
});
