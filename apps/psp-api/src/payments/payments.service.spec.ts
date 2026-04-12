import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  const prisma = {
    payment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    paymentLink: {
      updateMany: jest.fn(),
    },
    merchant: {
      findUniqueOrThrow: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const ledger = {
    recordSuccessfulCapture: jest.fn(),
  };

  const webhooks = {
    deliver: jest.fn(),
  };

  const redis = {
    getIdempotency: jest.fn(),
    setIdempotency: jest.fn(),
  };

  const links = {
    findForMerchant: jest.fn(),
    findBySlug: jest.fn(),
  };

  let service: PaymentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentsService(
      prisma as never,
      ledger as never,
      webhooks as never,
      redis as never,
      links as never,
    );
  });

  it('throws BadRequest when payment link amount/currency mismatch', async () => {
    redis.getIdempotency.mockResolvedValue(null);
    links.findForMerchant.mockResolvedValue({
      id: 'pl_1',
      amountMinor: 1200,
      currency: 'EUR',
    });

    await expect(
      service.create('m_1', {
        amountMinor: 1999,
        currency: 'EUR',
        paymentLinkId: 'pl_1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns existing payment for same idempotency payload', async () => {
    const existing = {
      id: 'pay_1',
      amountMinor: 1999,
      currency: 'EUR',
      paymentLinkId: 'pl_1',
      rail: 'fiat',
    };
    redis.getIdempotency.mockResolvedValue('pay_1');
    prisma.payment.findUnique.mockResolvedValue(existing);

    const result = await service.create('m_1', {
      amountMinor: 1999,
      currency: 'EUR',
      paymentLinkId: 'pl_1',
      rail: 'fiat',
      idempotencyKey: 'idem-1',
    });

    expect(result).toBe(existing);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('throws Conflict when idempotency key is reused with different payload', async () => {
    redis.getIdempotency.mockResolvedValue('pay_1');
    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      amountMinor: 1000,
      currency: 'EUR',
      paymentLinkId: null,
      rail: 'fiat',
    });

    await expect(
      service.create('m_1', {
        amountMinor: 1999,
        currency: 'EUR',
        idempotencyKey: 'idem-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates payment when Redis getIdempotency fails (treated as cache miss)', async () => {
    redis.getIdempotency.mockRejectedValue(new Error('ECONNREFUSED'));
    const created = {
      id: 'pay_new',
      amountMinor: 1999,
      currency: 'EUR',
      paymentLinkId: null,
      rail: 'fiat',
      status: 'pending',
    };
    prisma.payment.create.mockResolvedValue(created);
    redis.setIdempotency.mockResolvedValue(true);

    const result = await service.create('m_1', {
      amountMinor: 1999,
      currency: 'EUR',
      rail: 'fiat',
      idempotencyKey: 'idem-redis-down',
    });

    expect(result).toBe(created);
    expect(prisma.payment.create).toHaveBeenCalled();
    expect(redis.setIdempotency).toHaveBeenCalledWith(
      'pay:m_1:idem-redis-down',
      'pay_new',
      24 * 3600,
    );
  });

  it('returns created payment when Redis setIdempotency fails after create', async () => {
    redis.getIdempotency.mockResolvedValue(null);
    const created = {
      id: 'pay_new',
      amountMinor: 1999,
      currency: 'EUR',
      paymentLinkId: null,
      rail: 'fiat',
      status: 'pending',
    };
    prisma.payment.create.mockResolvedValue(created);
    redis.setIdempotency.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await service.create('m_1', {
      amountMinor: 1999,
      currency: 'EUR',
      rail: 'fiat',
      idempotencyKey: 'idem-set-fail',
    });

    expect(result).toBe(created);
  });

  it('returns existing payment after P2002 race when payload matches', async () => {
    redis.getIdempotency.mockResolvedValue(null);
    prisma.payment.create.mockRejectedValue({ code: 'P2002' });
    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      amountMinor: 1999,
      currency: 'EUR',
      paymentLinkId: null,
      rail: 'fiat',
    });

    const result = await service.create('m_1', {
      amountMinor: 1999,
      currency: 'EUR',
      rail: 'fiat',
      idempotencyKey: 'idem-race',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'pay_1',
        amountMinor: 1999,
      }),
    );
  });

  it('captures payment and writes ledger + webhook side effects', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_1',
      merchantId: 'm_1',
      amountMinor: 1999,
      currency: 'EUR',
      status: 'pending',
      providerRef: 'sim_abc',
      paymentLinkId: 'pl_1',
    });
    prisma.merchant.findUniqueOrThrow.mockResolvedValue({ feeBps: 290 });

    const tx = {
      payment: {
        update: jest.fn().mockResolvedValue({
          id: 'pay_1',
          amountMinor: 1999,
          currency: 'EUR',
          status: 'succeeded',
          providerRef: 'sim_abc',
          paymentLinkId: 'pl_1',
        }),
      },
      paymentLink: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    prisma.$transaction.mockImplementation(async (cb: (trx: unknown) => Promise<unknown>) => cb(tx));

    const updated = await service.capture('m_1', 'pay_1');

    expect(updated.status).toBe('succeeded');
    expect(ledger.recordSuccessfulCapture).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        merchantId: 'm_1',
        paymentId: 'pay_1',
        amountMinor: 1999,
        currency: 'EUR',
        feeBps: 290,
      }),
    );
    expect(tx.paymentLink.updateMany).toHaveBeenCalled();
    expect(webhooks.deliver).toHaveBeenCalledWith(
      'm_1',
      'payment.succeeded',
      expect.objectContaining({
        payment_id: 'pay_1',
        amount_minor: 1999,
        currency: 'EUR',
        status: 'succeeded',
      }),
    );
  });

  it('throws NotFound when payment does not belong to merchant', async () => {
    prisma.payment.findFirst.mockResolvedValue(null);
    await expect(service.findOne('m_1', 'pay_missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

