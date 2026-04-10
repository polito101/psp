import { WebhooksService } from './webhooks.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

jest.mock('../crypto/secret-box', () => ({
  decryptUtf8: jest.fn(() => 'plain_secret'),
}));

describe('WebhooksService', () => {
  const prisma = {
    merchant: {
      findUnique: jest.fn(),
    },
    webhookDelivery: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  let service: WebhooksService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhooksService(prisma as never);
    (service as unknown as { sleep: () => Promise<void> }).sleep = jest
      .fn()
      .mockResolvedValue(undefined);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('signPayload returns deterministic HMAC', () => {
    const sig1 = service.signPayload('secret', '{"ok":true}', '123');
    const sig2 = service.signPayload('secret', '{"ok":true}', '123');
    expect(sig1).toBe(sig2);
  });

  it('does not deliver when merchant has no webhookUrl', async () => {
    prisma.merchant.findUnique.mockResolvedValue({
      webhookUrl: null,
      webhookSecretCiphertext: 'cipher',
    });

    await service.deliver('m_1', 'payment.succeeded', { payment_id: 'pay_1' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
  });

  it('retries and records delivered after transient failure', async () => {
    prisma.merchant.findUnique.mockResolvedValue({
      webhookUrl: 'https://merchant.example/webhooks',
      webhookSecretCiphertext: 'cipher',
    });
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    prisma.webhookDelivery.create.mockResolvedValue({ id: 'wd_1' });
    await service.deliver('m_1', 'payment.succeeded', { payment_id: 'pay_1' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: 'm_1',
        eventType: 'payment.succeeded',
        status: 'delivered',
        attempts: 2,
        lastError: null,
      }),
    });
  });

  it('records failed delivery after exhausting retries', async () => {
    prisma.merchant.findUnique.mockResolvedValue({
      webhookUrl: 'https://merchant.example/webhooks',
      webhookSecretCiphertext: 'cipher',
    });
    fetchMock.mockRejectedValue(new Error('network timeout'));

    await service.deliver('m_1', 'payment.succeeded', { payment_id: 'pay_1' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: 'm_1',
        eventType: 'payment.succeeded',
        status: 'failed',
        attempts: 3,
        lastError: 'network timeout',
      }),
    });
  });

  it('throws NotFound when retry source does not exist', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue(null);
    await expect(service.retryFailedDelivery('wd_missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws Conflict when retry source is not failed', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'wd_1',
      merchantId: 'm_1',
      eventType: 'payment.succeeded',
      payload: {},
      status: 'delivered',
    });
    await expect(service.retryFailedDelivery('wd_1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('retries failed delivery and returns latest status summary', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'wd_failed',
      merchantId: 'm_1',
      eventType: 'payment.succeeded',
      payload: { payment_id: 'pay_1' },
      status: 'failed',
    });
    prisma.merchant.findUnique.mockResolvedValue({
      webhookUrl: 'https://merchant.example/webhooks',
      webhookSecretCiphertext: 'cipher',
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    prisma.webhookDelivery.create.mockResolvedValue({ id: 'wd_new' });
    const result = await service.retryFailedDelivery('wd_failed');

    expect(result).toEqual({
      sourceDeliveryId: 'wd_failed',
      retried: true,
      status: 'delivered',
      attempts: 1,
      lastError: null,
      retryDeliveryId: 'wd_new',
    });
  });

  it('returns retried=false when webhook URL is missing', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'wd_failed',
      merchantId: 'm_1',
      eventType: 'payment.succeeded',
      payload: { payment_id: 'pay_1' },
      status: 'failed',
    });
    prisma.merchant.findUnique.mockResolvedValue({
      webhookUrl: null,
      webhookSecretCiphertext: 'cipher',
    });

    const result = await service.retryFailedDelivery('wd_failed');

    expect(result).toEqual({
      sourceDeliveryId: 'wd_failed',
      retried: false,
      status: 'skipped',
      attempts: 0,
      lastError: 'Missing webhook URL',
      retryDeliveryId: undefined,
    });
    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
  });
});

