import { ForbiddenException } from '@nestjs/common';
import { PaymentsV2Service } from './payments-v2.service';
import { PAYMENT_V2_STATUS } from './domain/payment-status';

describe('PaymentsV2Service', () => {
  const prisma = {
    payment: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    paymentAttempt: {
      aggregate: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    merchant: {
      findUniqueOrThrow: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const links = {
    findForMerchant: jest.fn(),
  };

  const redis = {
    getIdempotency: jest.fn(),
    setIdempotency: jest.fn(),
  };

  const ledger = {
    recordSuccessfulCapture: jest.fn(),
    recordSuccessfulRefund: jest.fn(),
  };

  const webhooks = {
    deliver: jest.fn(),
  };

  const stripeProvider = { run: jest.fn() };
  const mockProvider = { run: jest.fn() };
  const registry = {
    orderedProviders: jest.fn(),
    getProvider: jest.fn(),
  };

  const observability = {
    registerAttempt: jest.fn(),
    logProviderEvent: jest.fn(),
    snapshot: jest.fn(),
  };

  let service: PaymentsV2Service;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYMENTS_V2_ENABLED_MERCHANTS = '*';
    process.env.PAYMENTS_PROVIDER_MAX_RETRIES = '1';
    process.env.PAYMENTS_PROVIDER_CB_FAILURES = '3';
    process.env.PAYMENTS_PROVIDER_CB_COOLDOWN_MS = '60000';
    service = new PaymentsV2Service(
      prisma as never,
      links as never,
      redis as never,
      ledger as never,
      webhooks as never,
      registry as never,
      observability as never,
    );
    prisma.$transaction.mockImplementation(async (fn: (trx: unknown) => Promise<unknown>) => fn(prisma));
    redis.getIdempotency.mockResolvedValue(null);
    redis.setIdempotency.mockResolvedValue(true);
    prisma.paymentAttempt.aggregate.mockResolvedValue({ _max: { attemptNo: 0 } });
    prisma.paymentAttempt.create.mockResolvedValue(undefined);
  });

  it('rechaza merchant no habilitado para rollout v2', async () => {
    process.env.PAYMENTS_V2_ENABLED_MERCHANTS = 'm_enabled';
    await expect(
      service.createIntent(
        'm_other',
        { amountMinor: 1000, currency: 'EUR', provider: 'mock' },
        'idem_1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('crea intent y aplica estado autorizado con proveedor mock', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    prisma.payment.create.mockResolvedValue({
      id: 'pay_1',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.PROCESSING,
      amountMinor: 1200,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: null,
      paymentLinkId: null,
    });
    mockProvider.run.mockResolvedValue({
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      providerPaymentId: 'mock_pi_1',
      nextAction: { type: 'none' },
    });
    prisma.payment.update.mockResolvedValue({
      id: 'pay_1',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 1200,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'mock_pi_1',
      statusReason: null,
      paymentLinkId: null,
    });

    const result = await service.createIntent('m_1', {
      amountMinor: 1200,
      currency: 'EUR',
      provider: 'mock',
    });

    expect(result.payment.status).toBe(PAYMENT_V2_STATUS.AUTHORIZED);
    expect(prisma.paymentAttempt.create).toHaveBeenCalled();
    expect(mockProvider.run).toHaveBeenCalled();
  });

  it('hace fallback cuando stripe no está disponible', async () => {
    registry.orderedProviders.mockReturnValue(['stripe', 'mock']);
    registry.getProvider.mockImplementation((provider: string) =>
      provider === 'stripe' ? stripeProvider : mockProvider,
    );
    prisma.payment.create.mockResolvedValue({
      id: 'pay_2',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.PROCESSING,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'stripe',
      providerRef: null,
      statusReason: null,
      paymentLinkId: null,
    });
    stripeProvider.run.mockResolvedValue({
      status: PAYMENT_V2_STATUS.FAILED,
      reasonCode: 'provider_unavailable',
      transientError: false,
    });
    mockProvider.run.mockResolvedValue({
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      providerPaymentId: 'mock_pi_2',
    });
    prisma.payment.update.mockResolvedValue({
      id: 'pay_2',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'mock_pi_2',
      statusReason: null,
      paymentLinkId: null,
    });

    const result = await service.createIntent('m_1', {
      amountMinor: 1000,
      currency: 'EUR',
    });

    expect(stripeProvider.run).toHaveBeenCalled();
    expect(mockProvider.run).toHaveBeenCalled();
    expect(result.payment.selectedProvider).toBe('mock');
    // Invariant: el fallback no debe dejar timestamps de fallo cuando termina en éxito.
    // Validamos a nivel de update del estado exitoso que `failedAt` se limpia.
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PAYMENT_V2_STATUS.AUTHORIZED,
          failedAt: null,
        }),
      }),
    );
  });

  it('devuelve pago existente en carrera P2002 con idempotency key', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    prisma.payment.create.mockRejectedValue({ code: 'P2002' });
    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_race',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.PROCESSING,
      amountMinor: 1200,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: null,
      paymentLinkId: null,
    });

    const result = await service.createIntent(
      'm_1',
      {
        amountMinor: 1200,
        currency: 'EUR',
        provider: 'mock',
      },
      'idem-race',
    );

    expect(result.payment.id).toBe('pay_race');
    expect(result.nextAction).toBeNull();
    expect(mockProvider.run).not.toHaveBeenCalled();
  });

  it('en hit idempotente preserva nextAction cuando el pago requiere acción (3DS)', async () => {
    registry.orderedProviders.mockReturnValue(['stripe']);
    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_action',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.REQUIRES_ACTION,
      amountMinor: 1200,
      currency: 'EUR',
      selectedProvider: 'stripe',
      providerRef: 'pi_123',
      statusReason: null,
      paymentLinkId: null,
    });

    const result = await service.createIntent(
      'm_1',
      { amountMinor: 1200, currency: 'EUR', provider: 'stripe' },
      'idem-action',
    );

    expect(result.payment.id).toBe('pay_action');
    expect(result.payment.status).toBe(PAYMENT_V2_STATUS.REQUIRES_ACTION);
    expect(result.nextAction).toEqual({ type: '3ds' });
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(stripeProvider.run).not.toHaveBeenCalled();
    expect(mockProvider.run).not.toHaveBeenCalled();
  });

  it('reintenta createAttempt ante P2002 y evita romper el flujo', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    prisma.payment.create.mockResolvedValue({
      id: 'pay_retry',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.PROCESSING,
      amountMinor: 1500,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: null,
      paymentLinkId: null,
    });
    mockProvider.run.mockResolvedValue({
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      providerPaymentId: 'mock_pi_retry',
      nextAction: { type: 'none' },
    });
    prisma.paymentAttempt.aggregate
      .mockResolvedValueOnce({ _max: { attemptNo: 0 } })
      .mockResolvedValueOnce({ _max: { attemptNo: 1 } });
    prisma.paymentAttempt.create.mockRejectedValueOnce({ code: 'P2002' }).mockResolvedValueOnce(undefined);
    prisma.payment.update.mockResolvedValue({
      id: 'pay_retry',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 1500,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'mock_pi_retry',
      statusReason: null,
      paymentLinkId: null,
    });

    const result = await service.createIntent('m_1', {
      amountMinor: 1500,
      currency: 'EUR',
      provider: 'mock',
    });

    expect(result.payment.status).toBe(PAYMENT_V2_STATUS.AUTHORIZED);
    expect(prisma.paymentAttempt.create).toHaveBeenCalledTimes(2);
    expect(prisma.paymentAttempt.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          attemptNo: 2,
        }),
      }),
    );
  });

  it('registra ledger cuando refund termina en success', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_refund',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'prov_1',
      statusReason: null,
      paymentLinkId: null,
    });
    mockProvider.run.mockResolvedValue({
      status: PAYMENT_V2_STATUS.REFUNDED,
      providerPaymentId: 'prov_refund_1',
    });

    const tx = {
      payment: {
        update: jest.fn().mockResolvedValue({
          id: 'pay_refund',
          merchantId: 'm_1',
          status: PAYMENT_V2_STATUS.REFUNDED,
          amountMinor: 1000,
          currency: 'EUR',
          selectedProvider: 'mock',
          providerRef: 'prov_refund_1',
          statusReason: null,
          paymentLinkId: null,
        }),
      },
      paymentAttempt: {
        aggregate: jest.fn().mockResolvedValue({ _max: { attemptNo: 0 } }),
        create: jest.fn().mockResolvedValue(undefined),
      },
    };
    prisma.$transaction.mockImplementation(async (fn: (trx: unknown) => Promise<unknown>) => fn(tx));

    const result = await service.refund('m_1', 'pay_refund', 400);

    expect(result.payment.status).toBe(PAYMENT_V2_STATUS.REFUNDED);
    expect(ledger.recordSuccessfulRefund).toHaveBeenCalledWith(tx, {
      merchantId: 'm_1',
      paymentId: 'pay_refund',
      amountMinor: 400,
      currency: 'EUR',
    });
  });
});
