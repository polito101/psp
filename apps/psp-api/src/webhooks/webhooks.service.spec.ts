import { WebhooksService } from './webhooks.service';

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
});

