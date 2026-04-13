import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PaymentsV2Service } from './payments-v2.service';
import { PAYMENT_V2_STATUS } from './domain/payment-status';
import { ProviderResult } from './providers/payment-provider.interface';

describe('PaymentsV2Service', () => {
  const config = {
    get: jest.fn((key: string) => process.env[key]),
  };

  const prisma = {
    payment: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    paymentOperation: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
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
    delIdempotency: jest.fn(),
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
    registerAttemptPersistFailure: jest.fn(),
    logProviderEvent: jest.fn(),
    snapshot: jest.fn(),
  };

  const stripeAdapter = {
    retrievePaymentIntent: jest.fn(),
  };

  let service: PaymentsV2Service;

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
    );

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYMENTS_V2_ENABLED_MERCHANTS = '*';
    process.env.PAYMENTS_PROVIDER_MAX_RETRIES = '1';
    process.env.PAYMENTS_PROVIDER_CB_FAILURES = '3';
    process.env.PAYMENTS_PROVIDER_CB_COOLDOWN_MS = '60000';
    process.env.PAYMENTS_V2_TOLERATE_ATTEMPT_PERSIST_FAILURE = 'true';
    service = buildService();
    prisma.$transaction.mockImplementation(async (fn: (trx: unknown) => Promise<unknown>) => fn(prisma));
    redis.getIdempotency.mockResolvedValue(null);
    redis.setIdempotency.mockResolvedValue(true);
    prisma.paymentAttempt.aggregate.mockResolvedValue({ _max: { attemptNo: 0 } });
    prisma.paymentAttempt.create.mockResolvedValue(undefined);
    prisma.paymentOperation.findUnique.mockResolvedValue(null);
    prisma.paymentOperation.create.mockResolvedValue(undefined);
    prisma.paymentOperation.update.mockResolvedValue(undefined);
    prisma.paymentOperation.updateMany.mockResolvedValue({ count: 1 });
    prisma.paymentOperation.deleteMany.mockResolvedValue({ count: 1 });
    stripeAdapter.retrievePaymentIntent.mockReset();
    stripeAdapter.retrievePaymentIntent.mockResolvedValue({
      status: PAYMENT_V2_STATUS.FAILED,
      reasonCode: 'provider_error',
      reasonMessage: 'retrieve stub',
    });
  });

  it('rechaza Idempotency-Key demasiado larga', async () => {
    const longKey = 'a'.repeat(257);
    await expect(
      service.createIntent('m_1', { amountMinor: 1000, currency: 'EUR', provider: 'mock' }, longKey),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza Idempotency-Key con caracteres fuera del charset permitido', async () => {
    await expect(
      service.createIntent('m_1', { amountMinor: 1000, currency: 'EUR', provider: 'mock' }, 'key with space'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('acepta la primera entrada si la cabecera Idempotency-Key viene duplicada (array)', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    prisma.payment.findUnique.mockResolvedValue(null);
    prisma.payment.create.mockResolvedValue({
      id: 'pay_dup',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.PROCESSING,
      amountMinor: 500,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: null,
      paymentLinkId: null,
    });
    mockProvider.run.mockResolvedValue({
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      providerPaymentId: 'mock_pi_dup',
      nextAction: { type: 'none' },
    });
    prisma.payment.update.mockResolvedValue({
      id: 'pay_dup',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 500,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'mock_pi_dup',
      statusReason: null,
      paymentLinkId: null,
    });

    await service.createIntent(
      'm_1',
      { amountMinor: 500, currency: 'EUR', provider: 'mock' },
      ['first-key', 'ignored'],
    );

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ idempotencyKey: 'first-key' }),
      }),
    );
  });

  it('rechaza merchant no habilitado para rollout v2', async () => {
    process.env.PAYMENTS_V2_ENABLED_MERCHANTS = 'm_enabled';
    service = buildService();
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
    stripeAdapter.retrievePaymentIntent.mockResolvedValue({
      status: PAYMENT_V2_STATUS.REQUIRES_ACTION,
      providerPaymentId: 'pi_123',
      nextAction: {
        type: '3ds',
        clientSecret: 'pi_123_secret_test',
        stripeNextActionType: 'use_stripe_sdk',
      },
    });

    const result = await service.createIntent(
      'm_1',
      { amountMinor: 1200, currency: 'EUR', provider: 'stripe' },
      'idem-action',
    );

    expect(result.payment.id).toBe('pay_action');
    expect(result.payment.status).toBe(PAYMENT_V2_STATUS.REQUIRES_ACTION);
    expect(result.nextAction).toEqual({
      type: '3ds',
      clientSecret: 'pi_123_secret_test',
      stripeNextActionType: 'use_stripe_sdk',
    });
    expect(stripeAdapter.retrievePaymentIntent).toHaveBeenCalledWith('pi_123');
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

  it('no aborta la operación si falla la persistencia del attempt tras ejecutar el proveedor', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    prisma.payment.create.mockResolvedValue({
      id: 'pay_attempt_persist_fail',
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
      providerPaymentId: 'mock_pi_persist_fail',
      nextAction: { type: 'none' },
    });
    prisma.$transaction.mockRejectedValue({ code: 'P2034' });
    prisma.payment.update.mockResolvedValue({
      id: 'pay_attempt_persist_fail',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 1500,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'mock_pi_persist_fail',
      statusReason: null,
      paymentLinkId: null,
    });

    const result = await service.createIntent('m_1', {
      amountMinor: 1500,
      currency: 'EUR',
      provider: 'mock',
    });

    expect(result.payment.status).toBe(PAYMENT_V2_STATUS.AUTHORIZED);
    expect(observability.registerAttemptPersistFailure).toHaveBeenCalledWith({
      provider: 'mock',
      operation: 'create',
    });
  });

  it('refund fallido no pasa el pago a FAILED y lanza Conflict', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    const paymentSucceeded = {
      id: 'pay_refund_fail',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'prov_1',
      statusReason: null,
      paymentLinkId: null,
    };
    prisma.payment.findFirst.mockResolvedValue(paymentSucceeded);
    mockProvider.run.mockResolvedValue({
      status: PAYMENT_V2_STATUS.FAILED,
      reasonCode: 'provider_error',
      reasonMessage: 'stripe unavailable',
    });
    prisma.payment.update.mockResolvedValue({
      ...paymentSucceeded,
      lastAttemptAt: new Date(),
      selectedProvider: 'mock',
    });
    const txClaim = {
      paymentOperation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(undefined),
      },
      paymentAttempt: {
        aggregate: jest.fn().mockResolvedValue({ _max: { attemptNo: 0 } }),
        create: jest.fn().mockResolvedValue(undefined),
      },
    };
    prisma.$transaction.mockImplementation(async (fn: (trx: unknown) => Promise<unknown>) => fn(txClaim));

    await expect(service.refund('m_1', 'pay_refund_fail', 400)).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'Refund failed; payment remains succeeded and can be retried',
        paymentId: 'pay_refund_fail',
        reasonCode: 'provider_error',
      }),
    });

    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_refund_fail' },
        data: expect.not.objectContaining({ status: PAYMENT_V2_STATUS.FAILED }),
      }),
    );
    expect(prisma.paymentOperation.deleteMany).toHaveBeenCalledWith({
      where: { paymentId: 'pay_refund_fail', operation: 'refund' },
    });
    expect(ledger.recordSuccessfulRefund).not.toHaveBeenCalled();
  });

  it('tras refund fallido se puede reintentar y completar refund', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    const paymentSucceeded = {
      id: 'pay_refund_retry',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'prov_1',
      statusReason: null,
      paymentLinkId: null,
    };
    prisma.payment.findFirst.mockResolvedValue(paymentSucceeded);
    mockProvider.run
      .mockResolvedValueOnce({
        status: PAYMENT_V2_STATUS.FAILED,
        reasonCode: 'provider_timeout',
        reasonMessage: 'timeout',
      })
      .mockResolvedValueOnce({
        status: PAYMENT_V2_STATUS.REFUNDED,
        providerPaymentId: 're_ok',
      });

    const txClaim = {
      paymentOperation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(undefined),
      },
      paymentAttempt: {
        aggregate: jest.fn().mockResolvedValue({ _max: { attemptNo: 0 } }),
        create: jest.fn().mockResolvedValue(undefined),
      },
    };
    const txRefundOk = {
      payment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...paymentSucceeded,
          status: PAYMENT_V2_STATUS.REFUNDED,
          providerRef: 're_ok',
        }),
      },
      paymentOperation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(undefined),
      },
      paymentAttempt: {
        aggregate: jest.fn().mockResolvedValue({ _max: { attemptNo: 0 } }),
        create: jest.fn().mockResolvedValue(undefined),
      },
    };

    prisma.$transaction.mockImplementation(async (fn: (trx: unknown) => Promise<unknown>) => fn(txClaim));
    prisma.payment.update.mockResolvedValue({
      ...paymentSucceeded,
      lastAttemptAt: new Date(),
      selectedProvider: 'mock',
    });

    await expect(service.refund('m_1', 'pay_refund_retry', 400)).rejects.toBeInstanceOf(ConflictException);

    prisma.$transaction.mockImplementation(async (fn: (trx: unknown) => Promise<unknown>) => fn(txRefundOk));
    prisma.payment.update.mockReset();
    prisma.payment.update.mockImplementation((args: { data?: Record<string, unknown> }) => {
      if (args.data && 'status' in args.data && args.data.status === PAYMENT_V2_STATUS.REFUNDED) {
        return Promise.resolve({
          ...paymentSucceeded,
          status: PAYMENT_V2_STATUS.REFUNDED,
          providerRef: 're_ok',
          selectedProvider: 'mock',
        });
      }
      return Promise.resolve({
        ...paymentSucceeded,
        lastAttemptAt: new Date(),
        selectedProvider: 'mock',
      });
    });

    const ok = await service.refund('m_1', 'pay_refund_retry', 400);
    expect(ok.payment.status).toBe(PAYMENT_V2_STATUS.REFUNDED);
    expect(ledger.recordSuccessfulRefund).toHaveBeenCalled();
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
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
      paymentOperation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
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

  it('refund concurrente con distinto monto lanza Conflict mientras el lock refund está processing', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_refund_race',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'prov_1',
      statusReason: null,
      paymentLinkId: null,
    });
    const tx = {
      paymentOperation: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'processing',
          payloadHash: 'amount=500',
          processingAt: new Date(),
        }),
      },
    };
    prisma.$transaction.mockImplementation(async (fn: (trx: unknown) => Promise<unknown>) => fn(tx));

    await expect(service.refund('m_1', 'pay_refund_race', 300)).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'Operation in progress with a different payload',
        paymentId: 'pay_refund_race',
        operation: 'refund',
      }),
    });
    expect(mockProvider.run).not.toHaveBeenCalled();
  });

  it('refund con mismo payload que lock processing devuelve pago sin re-ejecutar provider', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    const paymentRow = {
      id: 'pay_refund_wait',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'prov_1',
      statusReason: null,
      paymentLinkId: null,
    };
    prisma.payment.findFirst.mockResolvedValue(paymentRow);
    const tx = {
      paymentOperation: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'processing',
          payloadHash: 'amount=400',
          processingAt: new Date(),
        }),
      },
    };
    prisma.$transaction.mockImplementation(async (fn: (trx: unknown) => Promise<unknown>) => fn(tx));

    const result = await service.refund('m_1', 'pay_refund_wait', 400);

    expect(result.payment).toEqual(paymentRow);
    expect(mockProvider.run).not.toHaveBeenCalled();
  });

  it('marca FAILED si provider devuelve éxito sin providerPaymentId y payment.providerRef es null', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    prisma.payment.create.mockResolvedValue({
      id: 'pay_missing_provider_id',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.PENDING,
      amountMinor: 1500,
      currency: 'EUR',
      selectedProvider: null,
      providerRef: null,
      statusReason: null,
      paymentLinkId: null,
    });
    // Fuerza un resultado "no FAILED" pero sin providerPaymentId (bug de provider)
    mockProvider.run.mockResolvedValue({
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      // providerPaymentId ausente
      nextAction: { type: 'none' },
    } as unknown as ProviderResult);
    prisma.payment.update.mockResolvedValue({
      id: 'pay_missing_provider_id',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.FAILED,
      amountMinor: 1500,
      currency: 'EUR',
      selectedProvider: null,
      providerRef: null,
      statusReason: 'provider_error',
      paymentLinkId: null,
    });

    const result = await service.createIntent('m_1', {
      amountMinor: 1500,
      currency: 'EUR',
      provider: 'mock',
    });

    expect(result.payment.status).toBe(PAYMENT_V2_STATUS.FAILED);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PAYMENT_V2_STATUS.FAILED,
          statusReason: 'provider_error',
        }),
      }),
    );
  });

  it('si el adapter lanza, convierte a FAILED provider_error y registra attempt + métricas', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    prisma.payment.create.mockResolvedValue({
      id: 'pay_adapter_throw',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.PROCESSING,
      amountMinor: 1500,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: null,
      paymentLinkId: null,
    });
    mockProvider.run.mockRejectedValue(new Error('unexpected throw'));
    prisma.payment.update.mockResolvedValue({
      id: 'pay_adapter_throw',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.FAILED,
      amountMinor: 1500,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: 'provider_error',
      paymentLinkId: null,
    });

    const result = await service.createIntent('m_1', {
      amountMinor: 1500,
      currency: 'EUR',
      provider: 'mock',
    });

    expect(result.payment.status).toBe(PAYMENT_V2_STATUS.FAILED);
    expect(prisma.paymentAttempt.create).toHaveBeenCalled();
    expect(observability.registerAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'mock',
        operation: 'create',
        success: false,
      }),
    );
    expect(observability.logProviderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PAYMENT_V2_STATUS.FAILED,
        reasonCode: 'provider_error',
      }),
    );
  });

  it('TypeError del adapter no es transitorio: un solo intento en runWithRetry', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    prisma.payment.create.mockResolvedValue({
      id: 'pay_type_throw',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.PROCESSING,
      amountMinor: 500,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: null,
      paymentLinkId: null,
    });
    mockProvider.run.mockRejectedValue(new TypeError('parse bug'));
    prisma.payment.update.mockResolvedValue({
      id: 'pay_type_throw',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.FAILED,
      amountMinor: 500,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: 'provider_error',
      paymentLinkId: null,
    });

    await service.createIntent('m_1', {
      amountMinor: 500,
      currency: 'EUR',
      provider: 'mock',
    });

    expect(observability.registerAttempt).toHaveBeenCalledTimes(1);
  });

  it('completa el lock de capture cuando el pago ya está SUCCEEDED (evita processing colgado)', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_already_ok',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'pi_1',
      statusReason: null,
      paymentLinkId: null,
    });
    prisma.paymentOperation.findUnique.mockResolvedValue(null);
    prisma.paymentOperation.create.mockResolvedValue(undefined);

    const result = await service.capture('m_1', 'pay_already_ok');

    expect(result.payment.status).toBe(PAYMENT_V2_STATUS.SUCCEEDED);
    expect(prisma.paymentOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paymentId: 'pay_already_ok', operation: 'capture', status: 'processing' },
      }),
    );
  });
});
