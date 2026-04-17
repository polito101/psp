import { BadRequestException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { hashCreatePaymentIntentPayload } from './create-payment-intent-payload-hash';
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
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    paymentLink: {
      updateMany: jest.fn(),
    },
    paymentOperation: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      delete: jest.fn(),
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
    getClient: jest.fn().mockReturnValue(null),
    getIdempotency: jest.fn(),
    setIdempotency: jest.fn(),
    delIdempotency: jest.fn(),
    incrementPaymentsV2ProviderCircuitFailure: jest.fn(),
    resetPaymentsV2ProviderCircuit: jest.fn(),
    getPaymentsV2ProviderCircuitState: jest.fn(),
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
    redis.getClient.mockReturnValue(null);
    redis.getIdempotency.mockResolvedValue(null);
    redis.setIdempotency.mockResolvedValue(true);
    redis.incrementPaymentsV2ProviderCircuitFailure.mockReset();
    redis.resetPaymentsV2ProviderCircuit.mockReset();
    redis.getPaymentsV2ProviderCircuitState.mockReset();
    prisma.paymentAttempt.aggregate.mockResolvedValue({ _max: { attemptNo: 0 } });
    prisma.paymentAttempt.create.mockResolvedValue(undefined);
    prisma.payment.updateMany.mockResolvedValue({ count: 1 });
    prisma.payment.findUniqueOrThrow.mockResolvedValue({
      id: 'pay_default',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'pi_1',
      statusReason: null,
      paymentLinkId: null,
    });
    prisma.paymentLink.updateMany.mockResolvedValue({ count: 1 });
    prisma.merchant.findUniqueOrThrow.mockResolvedValue({ feeBps: 0 });
    prisma.paymentOperation.findUnique.mockResolvedValue(null);
    prisma.paymentOperation.create.mockResolvedValue(undefined);
    prisma.paymentOperation.delete.mockResolvedValue(undefined);
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
      service.createIntent('m_1', { amountMinor: 1000, currency: 'EUR' }, longKey),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza Idempotency-Key con caracteres fuera del charset permitido', async () => {
    await expect(
      service.createIntent('m_1', { amountMinor: 1000, currency: 'EUR' }, 'key with space'),
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
      { amountMinor: 500, currency: 'EUR' },
      ['first-key', 'ignored'],
    );

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'first-key',
          createPayloadHash: hashCreatePaymentIntentPayload({ amountMinor: 500, currency: 'EUR' }),
        }),
      }),
    );
  });

  it('rechaza merchant no habilitado para rollout v2', async () => {
    process.env.PAYMENTS_V2_ENABLED_MERCHANTS = 'm_enabled';
    service = buildService();
    await expect(
      service.createIntent(
        'm_other',
        { amountMinor: 1000, currency: 'EUR' },
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
      { amountMinor: 1200, currency: 'EUR' },
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

  it('rechaza replay idempotente si difiere stripePaymentMethodId (misma clave)', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    const firstPm = { amountMinor: 1000, currency: 'EUR', stripePaymentMethodId: 'pm_card_visa' as const };
    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_idem_pm',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'pi_x',
      statusReason: null,
      paymentLinkId: null,
      createPayloadHash: hashCreatePaymentIntentPayload(firstPm),
    });

    await expect(
      service.createIntent(
        'm_1',
        { amountMinor: 1000, currency: 'EUR', stripePaymentMethodId: 'pm_card_mastercard' },
        'idem-pm-mismatch',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.payment.create).not.toHaveBeenCalled();
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
        delete: jest.fn().mockResolvedValue(undefined),
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
      where: { paymentId: 'pay_refund_fail', operation: 'refund', merchantId: 'm_1' },
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
        delete: jest.fn().mockResolvedValue(undefined),
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
        delete: jest.fn().mockResolvedValue(undefined),
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
        delete: jest.fn().mockResolvedValue(undefined),
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
          merchantId: 'm_1',
          status: 'processing',
          payloadHash: 'amount=500',
          processingAt: new Date(),
        }),
        delete: jest.fn().mockResolvedValue(undefined),
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
          merchantId: 'm_1',
          status: 'processing',
          payloadHash: 'amount=400',
          processingAt: new Date(),
        }),
        delete: jest.fn().mockResolvedValue(undefined),
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
    });

    expect(observability.registerAttempt).toHaveBeenCalledTimes(1);
  });

  it('no adquiere lock de capture si el pago ya está SUCCEEDED', async () => {
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

    const result = await service.capture('m_1', 'pay_already_ok');

    expect(result.payment.status).toBe(PAYMENT_V2_STATUS.SUCCEEDED);
    expect(prisma.paymentOperation.create).not.toHaveBeenCalled();
    expect(prisma.paymentOperation.updateMany).not.toHaveBeenCalled();
  });

  it('capture con excepción interna libera lock y no marca done', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    const payCap = {
      id: 'pay_cap_throw',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 500,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'pi_x',
      statusReason: null,
      paymentLinkId: null,
    };
    const payCapSucceeded = { ...payCap, status: PAYMENT_V2_STATUS.SUCCEEDED };
    prisma.payment.findFirst.mockResolvedValue(payCap);
    mockProvider.run.mockResolvedValue({
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      providerPaymentId: 'pi_x',
      nextAction: { type: 'none' },
    });
    prisma.merchant.findUniqueOrThrow.mockResolvedValue({ feeBps: 0 });
    prisma.payment.updateMany.mockResolvedValue({ count: 1 });
    prisma.payment.findUniqueOrThrow.mockResolvedValue(payCapSucceeded);
    ledger.recordSuccessfulCapture.mockRejectedValueOnce(new Error('db apply failed'));

    await expect(service.capture('m_1', 'pay_cap_throw', 'idem-cap-err')).rejects.toThrow('db apply failed');

    expect(prisma.paymentOperation.deleteMany).toHaveBeenCalledWith({
      where: { paymentId: 'pay_cap_throw', operation: 'capture', merchantId: 'm_1' },
    });
    expect(prisma.paymentOperation.updateMany).not.toHaveBeenCalled();
    expect(redis.delIdempotency).toHaveBeenCalled();
  });

  it('capture elimina lock con merchantId incorrecto y permite al dueño del pago continuar', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_owned',
      merchantId: 'm_owner',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 500,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'pi_own',
      statusReason: null,
      paymentLinkId: null,
    });

    let findOpCalls = 0;
    prisma.paymentOperation.findUnique.mockImplementation(async () => {
      findOpCalls += 1;
      if (findOpCalls === 1) {
        return {
          merchantId: 'm_attacker',
          status: 'done',
          payloadHash: 'v=1',
          processingAt: new Date(),
        };
      }
      return null;
    });

    mockProvider.run.mockResolvedValue({
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      providerPaymentId: 'pi_own',
      nextAction: { type: 'none' },
    });
    prisma.merchant.findUniqueOrThrow.mockResolvedValue({ feeBps: 0 });
    prisma.payment.findUniqueOrThrow.mockResolvedValue({
      id: 'pay_owned',
      merchantId: 'm_owner',
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      amountMinor: 500,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'pi_own',
      statusReason: null,
      paymentLinkId: null,
    });
    prisma.payment.update.mockResolvedValue({
      id: 'pay_owned',
      merchantId: 'm_owner',
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      amountMinor: 500,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'pi_own',
      statusReason: null,
      paymentLinkId: null,
    });

    const result = await service.capture('m_owner', 'pay_owned');

    expect(prisma.paymentOperation.delete).toHaveBeenCalledWith({
      where: { paymentId_operation: { paymentId: 'pay_owned', operation: 'capture' } },
    });
    expect(prisma.paymentOperation.create).toHaveBeenCalled();
    expect(result.payment.status).toBe(PAYMENT_V2_STATUS.SUCCEEDED);
  });

  it('stripe webhook devuelve missing_provider_ref cuando no puede extraer providerRef', async () => {
    const result = await service.applyStripeWebhookEvent('charge.refunded', {
      id: 'ch_1',
      refunded: true,
      // payment_intent ausente
    });

    expect(result).toEqual({ handled: false, reason: 'missing_provider_ref' });
    expect(prisma.payment.findFirst).not.toHaveBeenCalled();
  });

  it('stripe webhook devuelve payment_not_found para providerRef desconocido', async () => {
    prisma.payment.findFirst.mockResolvedValue(null);

    const result = await service.applyStripeWebhookEvent('payment_intent.succeeded', {
      id: 'pi_unknown',
      object: 'payment_intent',
    });

    expect(result).toEqual({ handled: false, reason: 'payment_not_found' });
  });

  it('stripe webhook payment_failed NO marca FAILED si el pago está AUTHORIZED; preserva status y setea reason', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_webhook_failed',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'stripe',
      providerRef: 'pi_failed',
      statusReason: null,
      paymentLinkId: null,
    });

    const result = await service.applyStripeWebhookEvent('payment_intent.payment_failed', {
      id: 'pi_failed',
      last_payment_error: { type: 'card_error' },
    });

    expect(result).toEqual({ handled: true, paymentId: 'pay_webhook_failed' });
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_webhook_failed', status: PAYMENT_V2_STATUS.AUTHORIZED },
        data: expect.objectContaining({
          status: PAYMENT_V2_STATUS.AUTHORIZED,
          statusReason: 'provider_declined',
        }),
      }),
    );
  });

  it('stripe webhook payment_failed traduce estados no finales a PENDING y conserva reason', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_webhook_pending',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.PROCESSING,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'stripe',
      providerRef: 'pi_processing',
      statusReason: null,
      paymentLinkId: null,
    });

    const result = await service.applyStripeWebhookEvent('payment_intent.payment_failed', {
      id: 'pi_processing',
      last_payment_error: { type: 'card_error' },
    });

    expect(result).toEqual({ handled: true, paymentId: 'pay_webhook_pending' });
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'pay_webhook_pending',
          status: { in: [PAYMENT_V2_STATUS.PROCESSING, PAYMENT_V2_STATUS.PENDING, PAYMENT_V2_STATUS.REQUIRES_ACTION] },
        },
        data: expect.objectContaining({
          status: PAYMENT_V2_STATUS.PENDING,
          statusReason: 'provider_declined',
          failedAt: null,
        }),
      }),
    );
  });

  it('stripe webhook unsupported event devuelve handled=false con paymentId', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_unsupported',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'stripe',
      providerRef: 'pi_unsupported',
      statusReason: null,
      paymentLinkId: null,
    });

    const result = await service.applyStripeWebhookEvent('payment_intent.processing', {
      id: 'pi_unsupported',
    });

    expect(result).toEqual({
      handled: false,
      paymentId: 'pay_unsupported',
      reason: 'unsupported_event_type',
    });
  });

  it('stripe webhook charge.refunded fully refunded hace CAS y ledger refund', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_refunded',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      amountMinor: 2000,
      currency: 'EUR',
      selectedProvider: 'stripe',
      providerRef: 'pi_refunded',
      statusReason: null,
      paymentLinkId: null,
    });
    const tx = {
      payment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.$transaction.mockImplementationOnce(async (fn: (trx: unknown) => Promise<unknown>) => fn(tx));

    const result = await service.applyStripeWebhookEvent('charge.refunded', {
      id: 'ch_1',
      payment_intent: 'pi_refunded',
      refunded: true,
      amount_refunded: 1200,
    });

    expect(result).toEqual({ handled: true, paymentId: 'pay_refunded' });
    expect(tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_refunded', status: PAYMENT_V2_STATUS.SUCCEEDED },
      }),
    );
    expect(ledger.recordSuccessfulRefund).toHaveBeenCalledWith(tx, {
      merchantId: 'm_1',
      paymentId: 'pay_refunded',
      amountMinor: 1200,
      currency: 'EUR',
    });
  });

  it('stripe webhook payment_intent.succeeded delega en captureSucceeded', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_succeeded',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 999,
      currency: 'EUR',
      selectedProvider: 'stripe',
      providerRef: 'pi_ok',
      statusReason: null,
      paymentLinkId: null,
    });
    const captureSpy = jest
      .spyOn(service as unknown as { captureSucceeded: (...args: unknown[]) => Promise<unknown> }, 'captureSucceeded')
      .mockResolvedValue({
        id: 'pay_succeeded',
        merchantId: 'm_1',
        status: PAYMENT_V2_STATUS.SUCCEEDED,
      });

    const result = await service.applyStripeWebhookEvent('payment_intent.succeeded', {
      id: 'pi_ok',
    });

    expect(result).toEqual({ handled: true, paymentId: 'pay_succeeded' });
    expect(captureSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pay_succeeded' }),
      'stripe',
      expect.objectContaining({ status: PAYMENT_V2_STATUS.SUCCEEDED, providerPaymentId: 'pi_ok' }),
    );
    captureSpy.mockRestore();
  });

  it('stripe webhook charge.dispute.created marca DISPUTED desde SUCCEEDED', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_dsp',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      amountMinor: 2000,
      currency: 'EUR',
      selectedProvider: 'stripe',
      providerRef: 'pi_dsp',
      statusReason: null,
      paymentLinkId: null,
    });
    prisma.payment.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await service.applyStripeWebhookEvent('charge.dispute.created', {
      id: 'dp_1',
      object: 'dispute',
      status: 'needs_response',
      charge: {
        object: 'charge',
        id: 'ch_1',
        payment_intent: 'pi_dsp',
      },
    });

    expect(result).toEqual({ handled: true, paymentId: 'pay_dsp' });
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_dsp', status: PAYMENT_V2_STATUS.SUCCEEDED },
        data: expect.objectContaining({ status: PAYMENT_V2_STATUS.DISPUTED }),
      }),
    );
  });

  it('stripe webhook charge.dispute.* usa payment_intent plano en el dispute', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_dsp2',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'stripe',
      providerRef: 'pi_flat',
      statusReason: null,
      paymentLinkId: null,
    });
    prisma.payment.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await service.applyStripeWebhookEvent('charge.dispute.funds_withdrawn', {
      id: 'dp_2',
      payment_intent: 'pi_flat',
      status: 'needs_response',
    });

    expect(result).toEqual({ handled: true, paymentId: 'pay_dsp2' });
  });

  it('stripe webhook dispute opening idempotente si ya está DISPUTED', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_dsp3',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.DISPUTED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'stripe',
      providerRef: 'pi_dsp3',
      statusReason: null,
      paymentLinkId: null,
    });
    prisma.payment.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.payment.findUnique.mockResolvedValueOnce({ status: PAYMENT_V2_STATUS.DISPUTED });

    const result = await service.applyStripeWebhookEvent('charge.dispute.updated', {
      id: 'dp_3',
      payment_intent: 'pi_dsp3',
      status: 'under_review',
    });

    expect(result).toEqual({ handled: true, paymentId: 'pay_dsp3' });
  });

  it('stripe webhook dispute opening devuelve dispute_requires_succeeded_or_disputed si el pago no califica', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_auth',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'stripe',
      providerRef: 'pi_auth',
      statusReason: null,
      paymentLinkId: null,
    });
    prisma.payment.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.payment.findUnique.mockResolvedValueOnce({ status: PAYMENT_V2_STATUS.AUTHORIZED });

    const result = await service.applyStripeWebhookEvent('charge.dispute.created', {
      id: 'dp_4',
      payment_intent: 'pi_auth',
      status: 'needs_response',
    });

    expect(result).toEqual({
      handled: false,
      paymentId: 'pay_auth',
      reason: 'dispute_requires_succeeded_or_disputed',
    });
  });

  it('stripe webhook charge.dispute.closed won restaura SUCCEEDED', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_won',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.DISPUTED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'stripe',
      providerRef: 'pi_won',
      statusReason: null,
      paymentLinkId: null,
    });
    prisma.payment.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await service.applyStripeWebhookEvent('charge.dispute.closed', {
      id: 'dp_won',
      payment_intent: 'pi_won',
      status: 'won',
    });

    expect(result).toEqual({ handled: true, paymentId: 'pay_won' });
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_won', status: PAYMENT_V2_STATUS.DISPUTED },
        data: expect.objectContaining({ status: PAYMENT_V2_STATUS.SUCCEEDED }),
      }),
    );
  });

  it('stripe webhook charge.dispute.closed lost marca DISPUTE_LOST', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_lost',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.DISPUTED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'stripe',
      providerRef: 'pi_lost',
      statusReason: null,
      paymentLinkId: null,
    });
    prisma.payment.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await service.applyStripeWebhookEvent('charge.dispute.closed', {
      id: 'dp_lost',
      payment_intent: 'pi_lost',
      status: 'lost',
    });

    expect(result).toEqual({ handled: true, paymentId: 'pay_lost' });
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_lost', status: PAYMENT_V2_STATUS.DISPUTED },
        data: expect.objectContaining({ status: PAYMENT_V2_STATUS.DISPUTE_LOST }),
      }),
    );
  });

  it('stripe webhook charge.dispute.closed con status no soportado devuelve razon dedicada', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_misc',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.DISPUTED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'stripe',
      providerRef: 'pi_misc',
      statusReason: null,
      paymentLinkId: null,
    });

    const result = await service.applyStripeWebhookEvent('charge.dispute.closed', {
      id: 'dp_misc',
      payment_intent: 'pi_misc',
      status: 'warning_closed',
    });

    expect(result).toEqual({
      handled: false,
      paymentId: 'pay_misc',
      reason: 'stripe_dispute_closed_unhandled_status',
    });
  });

  it('stripe webhook dispute devuelve missing_provider_ref si charge es solo id', async () => {
    const result = await service.applyStripeWebhookEvent('charge.dispute.created', {
      id: 'dp_nopi',
      charge: 'ch_only_id',
      status: 'needs_response',
    });

    expect(result).toEqual({ handled: false, reason: 'missing_provider_ref' });
    expect(prisma.payment.findFirst).not.toHaveBeenCalled();
  });

  type CbSvc = {
    registerProviderFailure: (p: 'stripe' | 'mock') => Promise<void>;
    resetProviderFailure: (p: 'stripe' | 'mock') => Promise<void>;
    getCircuitBreakerSnapshot: () => Promise<Record<string, { failures: number; open: boolean; openedUntil: number }>>;
  };

  it('con Redis: conteo de fallos abre circuito y el snapshot refleja estado en Redis', async () => {
    let state = { failures: 0, openedUntil: 0 };
    redis.getClient.mockReturnValue({});
    redis.incrementPaymentsV2ProviderCircuitFailure.mockImplementation(async () => {
      const now = Date.now();
      const wasOpen = state.openedUntil > now;
      state.failures += 1;
      if (state.failures >= 3) {
        state.openedUntil = now + 60_000;
      }
      const openedNow = state.failures >= 3 && !wasOpen ? 1 : 0;
      return { failures: state.failures, openedUntil: state.openedUntil, openedNow };
    });
    redis.getPaymentsV2ProviderCircuitState.mockImplementation(async () => ({ ...state }));
    redis.resetPaymentsV2ProviderCircuit.mockImplementation(async () => {
      state = { failures: 0, openedUntil: 0 };
    });
    service = buildService();
    const cb = service as unknown as CbSvc;

    await cb.registerProviderFailure('stripe');
    await cb.registerProviderFailure('stripe');
    let snap = await cb.getCircuitBreakerSnapshot();
    expect(snap.stripe.open).toBe(false);

    await cb.registerProviderFailure('stripe');
    snap = await cb.getCircuitBreakerSnapshot();
    expect(snap.stripe.open).toBe(true);
    expect(snap.stripe.failures).toBeGreaterThanOrEqual(3);
    expect(redis.getPaymentsV2ProviderCircuitState).toHaveBeenCalled();
  });

  it('con Redis: reset tras éxito limpia estado vía Redis', async () => {
    let state = { failures: 2, openedUntil: 0 };
    redis.getClient.mockReturnValue({});
    redis.incrementPaymentsV2ProviderCircuitFailure.mockImplementation(async () => {
      const now = Date.now();
      const wasOpen = state.openedUntil > now;
      state.failures += 1;
      if (state.failures >= 3) state.openedUntil = now + 60_000;
      const openedNow = state.failures >= 3 && !wasOpen ? 1 : 0;
      return { ...state, openedNow };
    });
    redis.getPaymentsV2ProviderCircuitState.mockImplementation(async () => ({ ...state }));
    redis.resetPaymentsV2ProviderCircuit.mockImplementation(async () => {
      state = { failures: 0, openedUntil: 0 };
    });
    service = buildService();
    const cb = service as unknown as CbSvc;

    await cb.registerProviderFailure('stripe');
    expect(state.failures).toBe(3);
    await cb.resetProviderFailure('stripe');
    expect(redis.resetPaymentsV2ProviderCircuit).toHaveBeenCalledWith('stripe');
    const snap = await cb.getCircuitBreakerSnapshot();
    expect(snap.stripe.failures).toBe(0);
    expect(snap.stripe.open).toBe(false);
  });

  it('sin cliente Redis usa Map local y no invoca comandos de CB en Redis', async () => {
    redis.getClient.mockReturnValue(null);
    service = buildService();
    const cb = service as unknown as CbSvc;

    await cb.registerProviderFailure('mock');
    await cb.registerProviderFailure('mock');
    const snap = await cb.getCircuitBreakerSnapshot();

    expect(redis.incrementPaymentsV2ProviderCircuitFailure).not.toHaveBeenCalled();
    expect(redis.resetPaymentsV2ProviderCircuit).not.toHaveBeenCalled();
    expect(snap.mock.failures).toBe(2);
  });

  it('con Redis: payments_v2.circuit_opened se emite una sola vez por apertura (no spam tras umbral)', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let state = { failures: 0, openedUntil: 0 };
    redis.getClient.mockReturnValue({});
    redis.incrementPaymentsV2ProviderCircuitFailure.mockImplementation(async () => {
      const now = Date.now();
      const wasOpen = state.openedUntil > now;
      state.failures += 1;
      if (state.failures >= 3) {
        state.openedUntil = now + 60_000;
      }
      const openedNow = state.failures >= 3 && !wasOpen ? 1 : 0;
      return { failures: state.failures, openedUntil: state.openedUntil, openedNow };
    });
    redis.getPaymentsV2ProviderCircuitState.mockImplementation(async () => ({ ...state }));
    service = buildService();
    const cb = service as unknown as CbSvc;

    await cb.registerProviderFailure('stripe');
    await cb.registerProviderFailure('stripe');
    await cb.registerProviderFailure('stripe');
    await cb.registerProviderFailure('stripe');
    await cb.registerProviderFailure('stripe');

    const circuitOpenedCalls = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('payments_v2.circuit_opened'),
    );
    expect(circuitOpenedCalls).toHaveLength(1);
    warnSpy.mockRestore();
  });

  it('sin Redis: payments_v2.circuit_opened una sola vez por apertura con fallos posteriores al umbral', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    redis.getClient.mockReturnValue(null);
    service = buildService();
    const cb = service as unknown as CbSvc;

    await cb.registerProviderFailure('mock');
    await cb.registerProviderFailure('mock');
    await cb.registerProviderFailure('mock');
    await cb.registerProviderFailure('mock');

    const circuitOpenedCalls = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('payments_v2.circuit_opened'),
    );
    expect(circuitOpenedCalls).toHaveLength(1);
    warnSpy.mockRestore();
  });

  it('sin Redis: payments_v2.circuit_opened se re-emite tras cooldown (reapertura)', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    redis.getClient.mockReturnValue(null);
    const t0 = 1_700_000_000_000;
    jest.useFakeTimers({ now: t0 });
    service = buildService();
    const cb = service as unknown as CbSvc;

    await cb.registerProviderFailure('mock');
    await cb.registerProviderFailure('mock');
    await cb.registerProviderFailure('mock');
    jest.advanceTimersByTime(60_000 + 1);
    await cb.registerProviderFailure('mock');

    const circuitOpenedCalls = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('payments_v2.circuit_opened'),
    );
    expect(circuitOpenedCalls).toHaveLength(2);
    warnSpy.mockRestore();
    jest.useRealTimers();
  });

  it('sin Redis: circuit_opened en reapertura aunque failures quede muy por encima del umbral (no hace falta volver a igualar el umbral)', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    redis.getClient.mockReturnValue(null);
    const t0 = 1_711_000_000_000;
    jest.useFakeTimers({ now: t0 });
    service = buildService();
    const cb = service as unknown as CbSvc;

    await cb.registerProviderFailure('mock');
    await cb.registerProviderFailure('mock');
    await cb.registerProviderFailure('mock');
    for (let i = 0; i < 7; i += 1) {
      await cb.registerProviderFailure('mock');
    }
    jest.advanceTimersByTime(60_000 + 1);
    await cb.registerProviderFailure('mock');

    const circuitOpenedCalls = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('payments_v2.circuit_opened'),
    );
    expect(circuitOpenedCalls).toHaveLength(2);
    warnSpy.mockRestore();
    jest.useRealTimers();
  });

  it('con Redis: payments_v2.circuit_opened se re-emite tras cooldown (reapertura)', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let state = { failures: 0, openedUntil: 0 };
    redis.getClient.mockReturnValue({});
    redis.incrementPaymentsV2ProviderCircuitFailure.mockImplementation(async () => {
      const now = Date.now();
      const wasOpen = state.openedUntil > now;
      state.failures += 1;
      if (state.failures >= 3) {
        state.openedUntil = now + 60_000;
      }
      const openedNow = state.failures >= 3 && !wasOpen ? 1 : 0;
      return { failures: state.failures, openedUntil: state.openedUntil, openedNow };
    });
    redis.getPaymentsV2ProviderCircuitState.mockImplementation(async () => ({ ...state }));
    const t0 = 1_700_000_000_000;
    jest.useFakeTimers({ now: t0 });
    service = buildService();
    const cb = service as unknown as CbSvc;

    await cb.registerProviderFailure('stripe');
    await cb.registerProviderFailure('stripe');
    await cb.registerProviderFailure('stripe');
    jest.advanceTimersByTime(60_000 + 1);
    await cb.registerProviderFailure('stripe');

    const circuitOpenedCalls = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('payments_v2.circuit_opened'),
    );
    expect(circuitOpenedCalls).toHaveLength(2);
    warnSpy.mockRestore();
    jest.useRealTimers();
  });

  it('con Redis: circuit_opened en reapertura aunque failures quede muy por encima del umbral (no hace falta volver a igualar el umbral)', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let state = { failures: 0, openedUntil: 0 };
    redis.getClient.mockReturnValue({});
    redis.incrementPaymentsV2ProviderCircuitFailure.mockImplementation(async () => {
      const now = Date.now();
      const wasOpen = state.openedUntil > now;
      state.failures += 1;
      if (state.failures >= 3) {
        state.openedUntil = now + 60_000;
      }
      const openedNow = state.failures >= 3 && !wasOpen ? 1 : 0;
      return { failures: state.failures, openedUntil: state.openedUntil, openedNow };
    });
    redis.getPaymentsV2ProviderCircuitState.mockImplementation(async () => ({ ...state }));
    const t0 = 1_712_000_000_000;
    jest.useFakeTimers({ now: t0 });
    service = buildService();
    const cb = service as unknown as CbSvc;

    await cb.registerProviderFailure('stripe');
    await cb.registerProviderFailure('stripe');
    await cb.registerProviderFailure('stripe');
    for (let i = 0; i < 7; i += 1) {
      await cb.registerProviderFailure('stripe');
    }
    jest.advanceTimersByTime(60_000 + 1);
    await cb.registerProviderFailure('stripe');

    const circuitOpenedCalls = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('payments_v2.circuit_opened'),
    );
    expect(circuitOpenedCalls).toHaveLength(2);
    warnSpy.mockRestore();
    jest.useRealTimers();
  });

  it('con Redis: si increment del circuit breaker en Redis lanza, createIntent sigue y refleja el fallo del provider', async () => {
    redis.getClient.mockReturnValue({});
    redis.getPaymentsV2ProviderCircuitState.mockResolvedValue({ failures: 0, openedUntil: 0 });
    redis.incrementPaymentsV2ProviderCircuitFailure.mockRejectedValue(new Error('redis unavailable'));
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    prisma.payment.create.mockResolvedValue({
      id: 'pay_cb_redis_throw',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.PROCESSING,
      amountMinor: 700,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: null,
      paymentLinkId: null,
    });
    mockProvider.run.mockResolvedValue({
      status: PAYMENT_V2_STATUS.FAILED,
      reasonCode: 'provider_unavailable',
      reasonMessage: 'down',
    });
    prisma.payment.update.mockResolvedValue({
      id: 'pay_cb_redis_throw',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.FAILED,
      amountMinor: 700,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: 'provider_unavailable',
      paymentLinkId: null,
    });

    service = buildService();

    const result = await service.createIntent('m_1', {
      amountMinor: 700,
      currency: 'EUR',
    });

    expect(result.payment.status).toBe(PAYMENT_V2_STATUS.FAILED);
    expect(redis.incrementPaymentsV2ProviderCircuitFailure).toHaveBeenCalled();
    expect(observability.logProviderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay_cb_redis_throw',
        reasonCode: 'provider_unavailable',
      }),
    );
  });

  it('con Redis: snapshot de CB usa fallback en memoria si Redis falla al leer estado', async () => {
    redis.getClient.mockReturnValue({});
    redis.getPaymentsV2ProviderCircuitState.mockRejectedValue(new Error('redis read failed'));
    service = buildService();
    const cb = service as unknown as CbSvc;

    const snap = await cb.getCircuitBreakerSnapshot();

    expect(snap.stripe.open).toBe(false);
    expect(snap.mock.open).toBe(false);
  });
});
