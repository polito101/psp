import { BadRequestException } from '@nestjs/common';
import { PaymentsV2InternalController } from './payments-v2-internal.controller';
import { PaymentsV2Service } from './payments-v2.service';

describe('PaymentsV2 merchant finance', () => {
  const config = {
    get: jest.fn((key: string) => process.env[key]),
  };

  const prisma: Record<string, unknown> & {
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    paymentFeeQuote: Record<string, jest.Mock>;
    payment: Record<string, jest.Mock>;
    payout: Record<string, jest.Mock>;
  } = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    paymentFeeQuote: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
    },
    payment: {},
    payout: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));

  const links = {
    findForMerchant: jest.fn(),
  };

  const redis = {
    getClient: jest.fn().mockReturnValue(null),
  };

  const ledger = {
    recordSuccessfulCapture: jest.fn(),
    recordSuccessfulRefund: jest.fn(),
  };

  const webhooks = {
    deliver: jest.fn(),
    getQueueSnapshot: jest.fn(),
  };

  const stripeProvider = { run: jest.fn() };
  const registry = {
    orderedProviders: jest.fn(),
    getProvider: jest.fn(),
    getRegisteredProviderNames: jest.fn().mockReturnValue(['stripe', 'mock']),
  };

  const observability = {
    registerAttempt: jest.fn(),
    registerAttemptPersistFailure: jest.fn(),
    logProviderEvent: jest.fn(),
    snapshot: jest.fn(),
  };

  const stripeAdapter = {
    retrievePaymentIntent: jest.fn(),
  };

  const merchantRateLimit = {
    consumeIfNeeded: jest.fn().mockResolvedValue(undefined),
  };

  const fee = {
    findActiveRateTable: jest.fn(),
    hasActiveRateTableForAnyProvider: jest.fn(),
    resolveActiveRateTable: jest.fn(),
    calculate: jest.fn(),
  };

  const correlationContext = {
    getId: jest.fn().mockReturnValue(undefined),
  };

  const buildService = () =>
    new PaymentsV2Service(
      config as never,
      prisma as never,
      links as never,
      redis as never,
      ledger as never,
      webhooks as never,
      registry as never,
      observability as never,
      stripeAdapter as never,
      fee as never,
      merchantRateLimit as never,
      correlationContext as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYMENTS_PROVIDER_MAX_RETRIES = '1';
    process.env.PAYMENTS_PROVIDER_CB_FAILURES = '3';
    process.env.PAYMENTS_PROVIDER_CB_COOLDOWN_MS = '60000';
    process.env.PAYMENTS_PROVIDER_RETRY_BASE_MS = '0';
    process.env.PAYMENTS_PROVIDER_RETRY_MAX_MS = '3000';
  });

  it('returns gross/fee/net totals for merchant and currency', async () => {
    const service = buildService();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ gross: '12000', fee: '450', net: '11550' }])
      .mockResolvedValueOnce([{ orphan_gross: '0' }]);

    const result = await service.getOpsMerchantFinanceSummary('merch_1', {
      currency: 'EUR',
      provider: 'stripe',
      createdFrom: '2026-04-01T00:00:00.000Z',
      createdTo: '2026-04-30T23:59:59.999Z',
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(result.totals).toEqual({
      grossMinor: '12000',
      feeMinor: '450',
      netMinor: '11550',
    });
  });

  it('suma pagos huérfanos (sin fee quote) al gross y net del resumen', async () => {
    const service = buildService();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ gross: '1000', fee: '30', net: '970' }])
      .mockResolvedValueOnce([{ orphan_gross: '500' }]);

    const result = await service.getOpsMerchantFinanceSummary('merch_1', {
      currency: 'EUR',
    });

    expect(result.totals).toEqual({
      grossMinor: '1500',
      feeMinor: '30',
      netMinor: '1470',
    });
  });

  it('mantiene precisión cuando los totales superan Number.MAX_SAFE_INTEGER', async () => {
    const service = buildService();
    const beyondSafe = '9007199254740993';
    prisma.$queryRaw
      .mockResolvedValueOnce([{ gross: beyondSafe, fee: '0', net: beyondSafe }])
      .mockResolvedValueOnce([{ orphan_gross: '1' }]);

    const result = await service.getOpsMerchantFinanceSummary('merch_1', {
      currency: 'EUR',
    });

    expect(result.totals.grossMinor).toBe('9007199254740994');
    expect(result.totals.feeMinor).toBe('0');
    expect(result.totals.netMinor).toBe('9007199254740994');
  });

  it('rechaza createdFrom posterior a createdTo en summary, transacciones y payouts', async () => {
    const service = buildService();
    const q = {
      currency: 'EUR',
      createdFrom: '2026-04-30T00:00:00.000Z',
      createdTo: '2026-04-01T00:00:00.000Z',
    };

    await expect(service.getOpsMerchantFinanceSummary('merch_1', q)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.listOpsMerchantFinanceTransactions('merch_1', { ...q, page: 1, pageSize: 25 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.listOpsMerchantFinancePayouts('merch_1', { ...q, page: 1, pageSize: 25 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('lists merchant finance transactions with gross/fee/net', async () => {
    const service = buildService();
    prisma.paymentFeeQuote.findMany.mockResolvedValue([
      {
        id: 'fq_1',
        paymentId: 'pay_1',
        merchantId: 'merch_1',
        provider: 'stripe',
        currency: 'EUR',
        grossMinor: 2500,
        feeMinor: 75,
        netMinor: 2425,
        settlementMode: 'NET',
        createdAt: new Date('2026-04-10T12:00:00.000Z'),
        payment: {
          id: 'pay_1',
          status: 'succeeded',
          selectedProvider: 'stripe',
          createdAt: new Date('2026-04-10T11:59:00.000Z'),
        },
      },
    ]);
    prisma.paymentFeeQuote.count.mockResolvedValue(1);
    prisma.paymentFeeQuote.findFirst.mockResolvedValue(null);

    const result = await service.listOpsMerchantFinanceTransactions('merch_1', {
      currency: 'EUR',
      status: 'succeeded',
      page: 1,
      pageSize: 25,
    });

    expect(prisma.paymentFeeQuote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 26,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      paymentId: 'pay_1',
      grossMinor: '2500',
      feeMinor: '75',
      netMinor: '2425',
    });
    expect(result.page.total).toBe(1);
    expect(result.cursors.next).toEqual({
      createdAt: '2026-04-10T12:00:00.000Z',
      id: 'fq_1',
    });
  });

  it('lists merchant payouts filtered by status/currency/date range', async () => {
    const service = buildService();
    prisma.payout.findMany.mockResolvedValue([
      {
        id: 'po_1',
        merchantId: 'merch_1',
        currency: 'EUR',
        status: 'SENT',
        windowStartAt: new Date('2026-04-01T00:00:00.000Z'),
        windowEndAt: new Date('2026-04-07T23:59:59.999Z'),
        grossMinor: 10000,
        feeMinor: 300,
        netMinor: 9700,
        createdAt: new Date('2026-04-08T00:00:00.000Z'),
      },
    ]);
    prisma.payout.count.mockResolvedValue(1);
    prisma.payout.findFirst.mockResolvedValue(null);

    const result = await service.listOpsMerchantFinancePayouts('merch_1', {
      currency: 'EUR',
      status: 'SENT',
      createdFrom: '2026-04-01T00:00:00.000Z',
      createdTo: '2026-04-30T23:59:59.999Z',
      page: 1,
      pageSize: 25,
    });

    expect(prisma.payout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 26,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: {
          merchantId: 'merch_1',
          currency: 'EUR',
          status: 'SENT',
          createdAt: {
            gte: new Date('2026-04-01T00:00:00.000Z'),
            lte: new Date('2026-04-30T23:59:59.999Z'),
          },
        },
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'po_1',
      grossMinor: '10000',
      feeMinor: '300',
      netMinor: '9700',
    });
  });
});

describe('PaymentsV2InternalController merchant finance routes', () => {
  it('delegates summary/transactions/payouts to service', async () => {
    const payments = {
      getOpsMerchantFinanceSummary: jest.fn().mockResolvedValue({ ok: true }),
      listOpsMerchantFinanceTransactions: jest.fn().mockResolvedValue({ ok: true }),
      listOpsMerchantFinancePayouts: jest.fn().mockResolvedValue({ ok: true }),
    };
    const controller = new PaymentsV2InternalController(payments as never);

    await controller.merchantFinanceSummary('m_1', { currency: 'EUR' });
    await controller.merchantFinanceTransactions('m_1', { currency: 'EUR' });
    await controller.merchantFinancePayouts('m_1', { currency: 'EUR' });

    expect(payments.getOpsMerchantFinanceSummary).toHaveBeenCalledWith('m_1', { currency: 'EUR' });
    expect(payments.listOpsMerchantFinanceTransactions).toHaveBeenCalledWith('m_1', { currency: 'EUR' });
    expect(payments.listOpsMerchantFinancePayouts).toHaveBeenCalledWith('m_1', { currency: 'EUR' });
  });
});
