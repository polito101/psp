jest.mock('node:dns/promises', () => ({
  resolve4: jest.fn().mockResolvedValue(['1.1.1.1']),
  resolve6: jest.fn().mockRejectedValue(Object.assign(new Error('none'), { code: 'ENODATA' })),
}));

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { hashCreatePaymentIntentPayload } from './create-payment-intent-payload-hash';
import type { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { PaymentsV2Service } from './payments-v2.service';
import { PAYMENT_V2_STATUS, unsupportedPersistedProviderLifecycleMessage } from './domain/payment-status';
import { ProviderResult } from './providers/payment-provider.interface';
import { Prisma } from '../generated/prisma/client';

function eurIntent(amount: number, extra: Partial<CreatePaymentIntentDto> = {}): CreatePaymentIntentDto {
  return {
    amount,
    currency: 'EUR',
    channel: 'ONLINE',
    language: 'EN',
    orderId: 'ord-test',
    description: 'test',
    notificationUrl: 'https://example.com/n',
    returnUrl: 'https://example.com/r',
    cancelUrl: 'https://example.com/c',
    customer: { firstName: 'A', lastName: 'B', email: 'a@b.co', country: 'ES' },
    ...extra,
  };
}

describe('PaymentsV2Service', () => {
  const config = {
    get: jest.fn((key: string) => process.env[key]),
  };

  const prisma = {
    $queryRaw: jest.fn(),
    payment: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    paymentLink: {
      findFirst: jest.fn(),
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
      count: jest.fn(),
    },
    providerLog: {
      findMany: jest.fn(),
    },
    paymentNotificationDelivery: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      aggregate: jest.fn(),
      create: jest.fn(),
    },
    merchant: {
      findUnique: jest.fn().mockResolvedValue({ isActive: true }),
      findUniqueOrThrow: jest.fn(),
    },
    merchantPaymentMethod: {
      findFirst: jest.fn().mockResolvedValue({
        definition: { code: 'mock_card', category: 'card' },
      }),
    },
    paymentFeeQuote: {
      create: jest.fn(),
    },
    paymentSettlement: {
      create: jest.fn(),
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
    tryAcquirePaymentsV2HalfOpenProbe: jest.fn().mockResolvedValue(true),
    releasePaymentsV2HalfOpenProbe: jest.fn().mockResolvedValue(undefined),
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
    getRegisteredProviderNames: jest.fn().mockReturnValue(['stripe', 'mock']),
  };

  const observability = {
    registerAttempt: jest.fn(),
    registerAttemptPersistFailure: jest.fn(),
    logProviderEvent: jest.fn(),
    snapshot: jest.fn(),
    recordMerchantIsActiveFreshAssertion: jest.fn(),
    merchantIsActiveFreshSnapshot: jest.fn().mockReturnValue({
      total: 0,
      passed: 0,
      blocked: 0,
      passRate: 0,
      blockRate: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
    }),
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

  const fxRates = {
    convertMinorToUsdSnapshot: jest
      .fn()
      .mockResolvedValue({ ok: true, usdMinor: 1, snapshotId: 'snap', rateDecimal: '1' }),
    getUsdSnapshotsAtOrBeforeForBases: jest.fn().mockResolvedValue(new Map()),
    convertMinorToUsdWithPreloadedUsdSnapshots: jest
      .fn()
      .mockReturnValue({ ok: true, usdMinor: 1, snapshotId: 'snap', rateDecimal: '1' }),
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
      fee as never,
      merchantRateLimit as never,
      correlationContext as never,
      fxRates as never,
    );

  afterEach(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PAYMENTS_PROVIDER_CB_HALF_OPEN;
    process.env.PAYMENTS_V2_ENABLED_MERCHANTS = '*';
    process.env.PAYMENTS_PROVIDER_MAX_RETRIES = '1';
    process.env.PAYMENTS_PROVIDER_CB_FAILURES = '3';
    process.env.PAYMENTS_PROVIDER_CB_COOLDOWN_MS = '60000';
    process.env.PAYMENTS_PROVIDER_RETRY_BASE_MS = '0';
    process.env.PAYMENTS_PROVIDER_RETRY_MAX_MS = '3000';
    process.env.PAYMENTS_V2_TOLERATE_ATTEMPT_PERSIST_FAILURE = 'true';
    service = buildService();
    prisma.merchant.findUnique.mockResolvedValue({ isActive: true });
    prisma.merchantPaymentMethod.findFirst.mockResolvedValue({
      definition: { code: 'mock_card', category: 'card' },
    });
    prisma.$transaction.mockImplementation(async (fn: (trx: unknown) => Promise<unknown>) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([{ n: BigInt(0) }]);
    prisma.payment.findFirst.mockResolvedValue(null);
    redis.getClient.mockReturnValue(null);
    redis.getIdempotency.mockResolvedValue(null);
    redis.setIdempotency.mockResolvedValue(true);
    redis.incrementPaymentsV2ProviderCircuitFailure.mockReset();
    redis.resetPaymentsV2ProviderCircuit.mockReset();
    redis.getPaymentsV2ProviderCircuitState.mockReset();
    redis.tryAcquirePaymentsV2HalfOpenProbe.mockReset();
    redis.releasePaymentsV2HalfOpenProbe.mockReset();
    redis.tryAcquirePaymentsV2HalfOpenProbe.mockResolvedValue(true);
    redis.releasePaymentsV2HalfOpenProbe.mockResolvedValue(undefined);
    prisma.paymentAttempt.aggregate.mockResolvedValue({ _max: { attemptNo: 0 } });
    prisma.paymentAttempt.create.mockResolvedValue(undefined);
    prisma.paymentAttempt.findMany.mockResolvedValue([]);
    prisma.paymentAttempt.count.mockResolvedValue(0);
    prisma.providerLog.findMany.mockResolvedValue([]);
    prisma.paymentNotificationDelivery.findMany.mockResolvedValue([]);
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
    prisma.paymentFeeQuote.create.mockResolvedValue(undefined);
    prisma.paymentSettlement.create.mockResolvedValue(undefined);
    stripeAdapter.retrievePaymentIntent.mockReset();
    stripeAdapter.retrievePaymentIntent.mockResolvedValue({
      status: PAYMENT_V2_STATUS.FAILED,
      reasonCode: 'provider_error',
      reasonMessage: 'retrieve stub',
    });
    const defaultRateTable = {
      id: 'rt_default',
      percentageBps: 0,
      fixedMinor: 0,
      minimumMinor: 0,
      settlementMode: 'NET',
      payoutScheduleType: 'T_PLUS_N',
      payoutScheduleParam: 1,
    };
    fee.findActiveRateTable.mockResolvedValue(defaultRateTable);
    fee.hasActiveRateTableForAnyProvider.mockResolvedValue(true);
    fee.resolveActiveRateTable.mockResolvedValue(defaultRateTable);
    fee.calculate.mockReturnValue({
      grossMinor: 1000,
      feeMinor: 0,
      netMinor: 1000,
      percentageMinor: 0,
    });
  });

  it('rechaza Idempotency-Key demasiado larga', async () => {
    const longKey = 'a'.repeat(257);
    await expect(
      service.createIntent('m_1', eurIntent(10), longKey),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza Idempotency-Key con caracteres fuera del charset permitido', async () => {
    await expect(
      service.createIntent('m_1', eurIntent(10), 'key with space'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza amount decimal que al convertir a minor supera el límite INTEGER (EUR)', async () => {
    let thrown: unknown;
    try {
      await service.createIntent('m_1', eurIntent(21_474_836.48));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
    const res = (thrown as BadRequestException).getResponse();
    const msg = typeof res === 'string' ? res : (res as { message?: string }).message;
    expect(msg).toBe(
      'amount exceeds maximum allowed for payment storage after conversion to minor units (INT32)',
    );
  });

  it('rechaza importe demasiado pequeño que redondea a 0 minor units (EUR)', async () => {
    let thrown: unknown;
    try {
      await service.createIntent('m_1', eurIntent(0.001));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
    const res = (thrown as BadRequestException).getResponse();
    const msg = typeof res === 'string' ? res : (res as { message?: string }).message;
    expect(msg).toBe('amount too small after conversion to minor units');
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

    await service.createIntent('m_1', eurIntent(5), ['first-key', 'ignored']);

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'first-key',
          createPayloadHash: hashCreatePaymentIntentPayload(eurIntent(5)),
        }),
      }),
    );
  });

  it('rechaza merchant no habilitado para rollout v2', async () => {
    process.env.PAYMENTS_V2_ENABLED_MERCHANTS = 'm_enabled';
    service = buildService();
    prisma.merchant.findUnique.mockClear();
    await expect(
      service.createIntent('m_other', eurIntent(10), 'idem_1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.merchant.findUnique).not.toHaveBeenCalled();
  });

  it('cachea isActive: dos getPayment del mismo merchant solo consultan Merchant una vez', async () => {
    prisma.merchant.findUnique.mockClear();
    prisma.paymentAttempt.findMany.mockResolvedValue([]);
    prisma.payment.findFirst
      .mockResolvedValueOnce({
        id: 'p_a',
        merchantId: 'm_1',
        status: PAYMENT_V2_STATUS.SUCCEEDED,
        amountMinor: 1,
        currency: 'EUR',
        selectedProvider: 'mock',
        providerRef: null,
        statusReason: null,
        paymentLinkId: null,
      })
      .mockResolvedValueOnce({
        id: 'p_b',
        merchantId: 'm_1',
        status: PAYMENT_V2_STATUS.SUCCEEDED,
        amountMinor: 1,
        currency: 'EUR',
        selectedProvider: 'mock',
        providerRef: null,
        statusReason: null,
        paymentLinkId: null,
      });
    await service.getPayment('m_1', 'p_a');
    await service.getPayment('m_1', 'p_b');
    expect(prisma.merchant.findUnique).toHaveBeenCalledTimes(1);
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

    const result = await service.createIntent('m_1', eurIntent(12));

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

    const result = await service.createIntent('m_1', eurIntent(10));

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

    const result = await service.createIntent('m_1', eurIntent(12), 'idem-race');

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
    const result = await service.createIntent('m_1', eurIntent(12), 'idem-action');

    expect(result.payment.id).toBe('pay_action');
    expect(result.payment.status).toBe(PAYMENT_V2_STATUS.REQUIRES_ACTION);
    expect(result.nextAction).toEqual({ type: '3ds' });
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(stripeProvider.run).not.toHaveBeenCalled();
    expect(mockProvider.run).not.toHaveBeenCalled();
  });

  it('rechaza replay idempotente si difiere paymentLinkId (misma clave)', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    links.findForMerchant.mockResolvedValue({
      amountMinor: 1000,
      currency: 'EUR',
    } as never);
    prisma.paymentLink.findFirst.mockResolvedValue({
      amountMinor: 1000,
      currency: 'EUR',
      status: 'active',
      expiresAt: null,
      merchant: { isActive: true },
    } as never);
    const firstPayload = eurIntent(10, { paymentLinkId: 'plink_a' });
    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay_idem_plink',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'pi_x',
      statusReason: null,
      paymentLinkId: 'plink_a',
      createPayloadHash: hashCreatePaymentIntentPayload(firstPayload),
    });

    await expect(
      service.createIntent('m_1', eurIntent(10, { paymentLinkId: 'plink_b' }), 'idem-plink-mismatch'),
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

    const result = await service.createIntent('m_1', eurIntent(15));

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

    const result = await service.createIntent('m_1', eurIntent(15));

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

    const result = await service.createIntent('m_1', eurIntent(15));

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

    const result = await service.createIntent('m_1', eurIntent(15));

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

    await service.createIntent('m_1', eurIntent(5));

    expect(observability.registerAttempt).toHaveBeenCalledTimes(1);
  });

  it('Error genérico del adapter no es transitorio: un solo intento en runWithRetry', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    prisma.payment.create.mockResolvedValue({
      id: 'pay_generic_throw',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.PROCESSING,
      amountMinor: 500,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: null,
      paymentLinkId: null,
    });
    mockProvider.run.mockRejectedValueOnce(new Error('logic bug'));
    prisma.payment.update.mockResolvedValue({
      id: 'pay_generic_throw',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.FAILED,
      amountMinor: 500,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: 'provider_error',
      paymentLinkId: null,
    });

    await service.createIntent('m_1', eurIntent(5));

    expect(mockProvider.run).toHaveBeenCalledTimes(1);
  });

  it('ErrnoException ECONNRESET del adapter es transitorio: reintenta hasta agotar maxRetries', async () => {
    process.env.PAYMENTS_PROVIDER_MAX_RETRIES = '2';
    service = buildService();
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    prisma.payment.create.mockResolvedValue({
      id: 'pay_econn',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.PROCESSING,
      amountMinor: 500,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: null,
      paymentLinkId: null,
    });
    const econn = new Error('read ECONNRESET') as NodeJS.ErrnoException;
    econn.code = 'ECONNRESET';
    mockProvider.run
      .mockRejectedValueOnce(econn)
      .mockRejectedValueOnce(econn)
      .mockResolvedValueOnce({
        status: PAYMENT_V2_STATUS.AUTHORIZED,
        providerPaymentId: 'mock_pi_econn',
        nextAction: { type: 'none' },
      });
    prisma.payment.update.mockResolvedValue({
      id: 'pay_econn',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 500,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'mock_pi_econn',
      statusReason: null,
      paymentLinkId: null,
    });

    const result = await service.createIntent('m_1', eurIntent(5));

    expect(mockProvider.run).toHaveBeenCalledTimes(3);
    expect(result.payment.status).toBe(PAYMENT_V2_STATUS.AUTHORIZED);
  });

  it('computeProviderRetryBackoffMs: exponencial acotada por max y jitter en [0.5,1) del cap por intento', () => {
    process.env.PAYMENTS_PROVIDER_RETRY_BASE_MS = '100';
    process.env.PAYMENTS_PROVIDER_RETRY_MAX_MS = '250';
    service = buildService();
    const backoff = (service as unknown as { computeProviderRetryBackoffMs: (i: number) => number })
      .computeProviderRetryBackoffMs.bind(service);
    for (let trial = 0; trial < 25; trial += 1) {
      const v0 = backoff(0);
      expect(v0).toBeGreaterThanOrEqual(50);
      expect(v0).toBeLessThanOrEqual(100);
      const v1 = backoff(1);
      expect(v1).toBeGreaterThanOrEqual(100);
      expect(v1).toBeLessThanOrEqual(200);
      const v2 = backoff(2);
      expect(v2).toBeGreaterThanOrEqual(125);
      expect(v2).toBeLessThanOrEqual(250);
    }
  });

  it('computeProviderRetryBackoffMs: con PAYMENTS_PROVIDER_RETRY_BASE_MS=0 no hay espera', () => {
    process.env.PAYMENTS_PROVIDER_RETRY_BASE_MS = '0';
    process.env.PAYMENTS_PROVIDER_RETRY_MAX_MS = '3000';
    service = buildService();
    const backoff = (service as unknown as { computeProviderRetryBackoffMs: (i: number) => number })
      .computeProviderRetryBackoffMs.bind(service);
    expect(backoff(0)).toBe(0);
    expect(backoff(5)).toBe(0);
  });

  it('con PAYMENTS_PROVIDER_RETRY_BASE_MS=0 y fake timers, reintento transitorio completa sin avanzar el reloj', async () => {
    jest.useFakeTimers();
    process.env.PAYMENTS_PROVIDER_RETRY_BASE_MS = '0';
    process.env.PAYMENTS_PROVIDER_MAX_RETRIES = '1';
    service = buildService();
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    prisma.payment.create.mockResolvedValue({
      id: 'pay_no_backoff_timer',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.PROCESSING,
      amountMinor: 100,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: null,
      paymentLinkId: null,
    });
    mockProvider.run
      .mockResolvedValueOnce({
        status: PAYMENT_V2_STATUS.FAILED,
        transientError: true,
        reasonCode: 'provider_timeout',
      })
      .mockResolvedValueOnce({
        status: PAYMENT_V2_STATUS.AUTHORIZED,
        providerPaymentId: 'mock_pi_nt',
        nextAction: { type: 'none' },
      });
    prisma.payment.update.mockResolvedValue({
      id: 'pay_no_backoff_timer',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 100,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'mock_pi_nt',
      statusReason: null,
      paymentLinkId: null,
    });

    const p = service.createIntent('m_1', eurIntent(1));
    const result = await p;

    expect(result.payment.status).toBe(PAYMENT_V2_STATUS.AUTHORIZED);
    expect(mockProvider.run).toHaveBeenCalledTimes(2);
  });

  it('con PAYMENTS_PROVIDER_RETRY_BASE_MS>0 y fake timers, runAllTimersAsync desbloquea el backoff entre reintentos', async () => {
    jest.useFakeTimers();
    process.env.PAYMENTS_PROVIDER_RETRY_BASE_MS = '10';
    process.env.PAYMENTS_PROVIDER_RETRY_MAX_MS = '50';
    process.env.PAYMENTS_PROVIDER_MAX_RETRIES = '1';
    service = buildService();
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    prisma.payment.create.mockResolvedValue({
      id: 'pay_backoff_timer',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.PROCESSING,
      amountMinor: 100,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: null,
      paymentLinkId: null,
    });
    mockProvider.run
      .mockResolvedValueOnce({
        status: PAYMENT_V2_STATUS.FAILED,
        transientError: true,
        reasonCode: 'provider_timeout',
      })
      .mockResolvedValueOnce({
        status: PAYMENT_V2_STATUS.AUTHORIZED,
        providerPaymentId: 'mock_pi_bt',
        nextAction: { type: 'none' },
      });
    prisma.payment.update.mockResolvedValue({
      id: 'pay_backoff_timer',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 100,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'mock_pi_bt',
      statusReason: null,
      paymentLinkId: null,
    });

    const p = service.createIntent('m_1', eurIntent(1));
    await jest.runAllTimersAsync();
    const result = await p;

    expect(result.payment.status).toBe(PAYMENT_V2_STATUS.AUTHORIZED);
    expect(mockProvider.run).toHaveBeenCalledTimes(2);
  });

  it('createIntent propaga 429 + retryAfter cuando merchant rate limit lo indica', async () => {
    merchantRateLimit.consumeIfNeeded.mockRejectedValueOnce(
      new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Merchant rate limit exceeded',
          retryAfter: 55,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );
    try {
      await service.createIntent('m_1', eurIntent(1));
      throw new Error('expected HttpException');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect((e as HttpException).getResponse()).toEqual(
        expect.objectContaining({ message: 'Merchant rate limit exceeded', retryAfter: 55 }),
      );
    }
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('aplica backoff entre reintentos por fallo transitorio del adapter', async () => {
    const sleepSpy = jest.spyOn(PaymentsV2Service.prototype as never, 'sleep' as never);
    try {
      process.env.PAYMENTS_PROVIDER_RETRY_BASE_MS = '2';
      process.env.PAYMENTS_PROVIDER_RETRY_MAX_MS = '50';
      process.env.PAYMENTS_PROVIDER_MAX_RETRIES = '1';
      service = buildService();
      registry.orderedProviders.mockReturnValue(['mock']);
      registry.getProvider.mockReturnValue(mockProvider);
      prisma.payment.create.mockResolvedValue({
        id: 'pay_backoff',
        merchantId: 'm_1',
        status: PAYMENT_V2_STATUS.PROCESSING,
        amountMinor: 1000,
        currency: 'EUR',
        selectedProvider: 'mock',
        providerRef: null,
        statusReason: null,
        paymentLinkId: null,
      });
      mockProvider.run
        .mockResolvedValueOnce({
          status: PAYMENT_V2_STATUS.FAILED,
          transientError: true,
          reasonCode: 'provider_timeout',
        })
        .mockResolvedValueOnce({
          status: PAYMENT_V2_STATUS.AUTHORIZED,
          providerPaymentId: 'mock_pi_backoff',
        });
      prisma.payment.update.mockResolvedValue({
        id: 'pay_backoff',
        merchantId: 'm_1',
        status: PAYMENT_V2_STATUS.AUTHORIZED,
        amountMinor: 1000,
        currency: 'EUR',
        selectedProvider: 'mock',
        providerRef: 'mock_pi_backoff',
        statusReason: null,
        paymentLinkId: null,
      });

      const result = await service.createIntent('m_1', eurIntent(10));

      expect(mockProvider.run).toHaveBeenCalledTimes(2);
      expect(result.payment.status).toBe(PAYMENT_V2_STATUS.AUTHORIZED);
      expect(sleepSpy).toHaveBeenCalledTimes(1);
      const [backoffMs] = sleepSpy.mock.calls[0] as [number];
      expect(backoffMs).toBeGreaterThanOrEqual(1);
      expect(backoffMs).toBeLessThanOrEqual(50);
    } finally {
      sleepSpy.mockRestore();
    }
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

  it('capture usa rate table por provider y persiste fee quote snapshot', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_fee_quote',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'pi_fee',
      statusReason: null,
      paymentLinkId: null,
    });
    mockProvider.run.mockResolvedValue({
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      providerPaymentId: 'pi_fee',
      nextAction: { type: 'none' },
    });
    prisma.payment.updateMany.mockResolvedValue({ count: 1 });
    prisma.payment.findUniqueOrThrow.mockResolvedValue({
      id: 'pay_fee_quote',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.SUCCEEDED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'pi_fee',
      statusReason: null,
      paymentLinkId: null,
    });
    fee.resolveActiveRateTable.mockResolvedValue({
      id: 'rt_1',
      percentageBps: 150,
      fixedMinor: 25,
      minimumMinor: 50,
      settlementMode: 'NET',
      payoutScheduleType: 'T_PLUS_N',
      payoutScheduleParam: 1,
    });
    fee.calculate.mockReturnValue({
      grossMinor: 1000,
      feeMinor: 50,
      netMinor: 950,
      percentageMinor: 15,
    });

    await service.capture('m_1', 'pay_fee_quote');

    expect(fee.resolveActiveRateTable).toHaveBeenCalledWith('m_1', 'EUR', 'mock');
    expect(ledger.recordSuccessfulCapture).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        merchantId: 'm_1',
        paymentId: 'pay_fee_quote',
        grossMinor: 1000,
        feeMinor: 50,
        netMinor: 950,
        currency: 'EUR',
      }),
    );
    expect(prisma.paymentFeeQuote.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentId: 'pay_fee_quote',
        merchantId: 'm_1',
        rateTableId: 'rt_1',
        provider: 'mock',
        grossMinor: 1000,
        feeMinor: 50,
        netMinor: 950,
      }),
    });
  });

  it('createIntent responde 409 si no hay MerchantRateTable para la divisa con ningún proveedor', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    fee.hasActiveRateTableForAnyProvider.mockResolvedValue(false);

    await expect(
      service.createIntent('m_1', eurIntent(10, { currency: 'USD' })),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(fee.hasActiveRateTableForAnyProvider).toHaveBeenCalledWith('m_1', 'USD', ['mock']);
  });

  it('capture no invoca al proveedor si falta tarifa activa para la divisa y el proveedor', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    fee.findActiveRateTable.mockResolvedValue(null);
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_no_fee',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 1000,
      currency: 'USD',
      selectedProvider: 'mock',
      providerRef: 'pi_nf',
      statusReason: null,
      paymentLinkId: null,
    });
    prisma.payment.update.mockResolvedValue({
      id: 'pay_no_fee',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.FAILED,
      amountMinor: 1000,
      currency: 'USD',
      selectedProvider: 'mock',
      providerRef: 'pi_nf',
      statusReason: 'fee_configuration_missing',
      paymentLinkId: null,
    });

    await service.capture('m_1', 'pay_no_fee');

    expect(mockProvider.run).not.toHaveBeenCalled();
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_no_fee' },
        data: expect.objectContaining({
          status: PAYMENT_V2_STATUS.FAILED,
          statusReason: 'fee_configuration_missing',
        }),
      }),
    );
  });

  it('capture no invoca al proveedor si la tarifa activa implicaría comisión mayor que el bruto', async () => {
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    fee.findActiveRateTable.mockResolvedValue({
      id: 'rt_bad',
      percentageBps: 0,
      fixedMinor: 0,
      minimumMinor: 5000,
      settlementMode: 'NET',
      payoutScheduleType: 'T_PLUS_N',
      payoutScheduleParam: 1,
    });
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay_fee_gt_gross',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'pi_big_fee',
      statusReason: null,
      paymentLinkId: null,
    });
    prisma.payment.update.mockResolvedValue({
      id: 'pay_fee_gt_gross',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.FAILED,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'pi_big_fee',
      statusReason: 'fee_exceeds_gross',
      paymentLinkId: null,
    });

    await service.capture('m_1', 'pay_fee_gt_gross');

    expect(mockProvider.run).not.toHaveBeenCalled();
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_fee_gt_gross' },
        data: expect.objectContaining({
          status: PAYMENT_V2_STATUS.FAILED,
          statusReason: 'fee_exceeds_gross',
        }),
      }),
    );
  });

  type CbSvc = {
    registerProviderFailure: (p: 'stripe' | 'mock') => Promise<void>;
    resetProviderFailure: (p: 'stripe' | 'mock') => Promise<void>;
    resolveProviderCircuitGate: (
      p: 'stripe' | 'mock',
    ) => Promise<{ block: boolean; blockReason?: string; probeAcquired: boolean }>;
    getCircuitBreakerSnapshot: () => Promise<
      Record<
        string,
        {
          failures: number;
          open: boolean;
          openedUntil: number;
          halfOpen?: boolean;
          circuitState?: string;
        }
      >
    >;
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
    expect(redis.resetPaymentsV2ProviderCircuit).toHaveBeenCalledWith('stripe', expect.any(Number));
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

    const result = await service.createIntent('m_1', eurIntent(7));

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

  it('con Redis y PAYMENTS_PROVIDER_CB_HALF_OPEN: si la sonda NX no se obtiene, no se llama al adapter', async () => {
    process.env.PAYMENTS_PROVIDER_CB_HALF_OPEN = 'true';
    redis.getClient.mockReturnValue({});
    redis.getPaymentsV2ProviderCircuitState.mockResolvedValue({ failures: 3, openedUntil: 0 });
    redis.tryAcquirePaymentsV2HalfOpenProbe.mockResolvedValue(false);
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    prisma.payment.create.mockResolvedValue({
      id: 'pay_half_busy',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.PROCESSING,
      amountMinor: 800,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: null,
      paymentLinkId: null,
    });
    prisma.payment.update.mockResolvedValue({
      id: 'pay_half_busy',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.FAILED,
      amountMinor: 800,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: 'provider_unavailable',
      paymentLinkId: null,
    });
    service = buildService();

    const result = await service.createIntent('m_1', eurIntent(8));

    expect(result.payment.status).toBe(PAYMENT_V2_STATUS.FAILED);
    expect(mockProvider.run).not.toHaveBeenCalled();
    expect(redis.tryAcquirePaymentsV2HalfOpenProbe).toHaveBeenCalledWith('mock', expect.any(Number));
    expect(redis.releasePaymentsV2HalfOpenProbe).not.toHaveBeenCalled();
  });

  it('con Redis y half-open: error Redis en tryAcquire de sonda bloquea (no fail-open a tráfico pleno)', async () => {
    process.env.PAYMENTS_PROVIDER_CB_HALF_OPEN = 'true';
    redis.getClient.mockReturnValue({});
    redis.getPaymentsV2ProviderCircuitState.mockResolvedValue({ failures: 3, openedUntil: 0 });
    redis.tryAcquirePaymentsV2HalfOpenProbe.mockRejectedValue(new Error('redis unavailable'));
    service = buildService();
    const gate = await (service as unknown as CbSvc).resolveProviderCircuitGate('mock');
    expect(gate.block).toBe(true);
    expect(gate.probeAcquired).toBe(false);
    expect(gate.blockReason).toContain('half-open');
  });

  it('con Redis y half-open: dos resoluciones concurrentes del gate: solo una gana la sonda NX', async () => {
    process.env.PAYMENTS_PROVIDER_CB_HALF_OPEN = 'true';
    redis.getClient.mockReturnValue({});
    redis.getPaymentsV2ProviderCircuitState.mockResolvedValue({ failures: 3, openedUntil: 0 });
    let probeTaken = false;
    redis.tryAcquirePaymentsV2HalfOpenProbe.mockImplementation(async () => {
      if (probeTaken) return false;
      probeTaken = true;
      return true;
    });
    service = buildService();
    const s = service as unknown as CbSvc;
    const [a, b] = await Promise.all([s.resolveProviderCircuitGate('mock'), s.resolveProviderCircuitGate('mock')]);
    const winners = [a, b].filter((g) => !g.block && g.probeAcquired);
    const blocked = [a, b].filter((g) => g.block);
    expect(winners).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].blockReason).toContain('half-open');
  });

  it('con Redis y PAYMENTS_PROVIDER_CB_HALF_OPEN: tras sonda exitosa se libera la clave probe', async () => {
    process.env.PAYMENTS_PROVIDER_CB_HALF_OPEN = 'true';
    redis.getClient.mockReturnValue({});
    redis.getPaymentsV2ProviderCircuitState.mockResolvedValue({ failures: 3, openedUntil: 0 });
    redis.tryAcquirePaymentsV2HalfOpenProbe.mockResolvedValue(true);
    registry.orderedProviders.mockReturnValue(['mock']);
    registry.getProvider.mockReturnValue(mockProvider);
    prisma.payment.create.mockResolvedValue({
      id: 'pay_half_release',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.PROCESSING,
      amountMinor: 900,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: null,
      statusReason: null,
      paymentLinkId: null,
    });
    mockProvider.run.mockResolvedValue({
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      providerPaymentId: 'mock_pi_half',
      nextAction: { type: 'none' },
    });
    prisma.payment.update.mockResolvedValue({
      id: 'pay_half_release',
      merchantId: 'm_1',
      status: PAYMENT_V2_STATUS.AUTHORIZED,
      amountMinor: 900,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'mock_pi_half',
      statusReason: null,
      paymentLinkId: null,
    });
    service = buildService();

    await service.createIntent('m_1', eurIntent(9));

    expect(mockProvider.run).toHaveBeenCalled();
    expect(redis.releasePaymentsV2HalfOpenProbe).toHaveBeenCalledWith('mock');
  });

  it('con Redis y flag half-open: snapshot expone circuitState half_open cuando aplica', async () => {
    process.env.PAYMENTS_PROVIDER_CB_HALF_OPEN = 'true';
    redis.getClient.mockReturnValue({});
    redis.getPaymentsV2ProviderCircuitState.mockImplementation(async (p: string) =>
      p === 'stripe' ? { failures: 3, openedUntil: 0 } : { failures: 0, openedUntil: 0 },
    );
    service = buildService();
    const cb = service as unknown as CbSvc;

    const snap = await cb.getCircuitBreakerSnapshot();

    expect(snap.stripe.halfOpen).toBe(true);
    expect(snap.stripe.circuitState).toBe('half_open');
    expect(snap.mock.circuitState).toBe('closed');
  });

  describe('getOpsPaymentDetail', () => {
    const paymentRowBase = {
      id: 'pay_ops',
      merchantId: 'm_1',
      merchant: { name: 'Test Merchant' },
      status: 'succeeded',
      statusReason: null,
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'mock',
      providerRef: 'ref_1',
      idempotencyKey: 'idem_1',
      paymentLinkId: null,
      rail: 'fiat',
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
      updatedAt: new Date('2020-01-02T00:00:00.000Z'),
      lastAttemptAt: null,
      succeededAt: null,
      failedAt: null,
      canceledAt: null,
      notificationUrl: 'https://merchant.example/hook',
      actionSnapshot: { action: { type: 'redirect', url: 'https://example.com/pay' } },
    };

    beforeEach(() => {
      prisma.payment.findUnique.mockResolvedValue(paymentRowBase);
      prisma.paymentAttempt.count.mockResolvedValue(0);
      prisma.paymentAttempt.findMany.mockResolvedValue([]);
      prisma.providerLog.findMany.mockResolvedValue([]);
      prisma.paymentNotificationDelivery.findMany.mockResolvedValue([]);
    });

    it('devuelve payment anidado, listas y acción parseada', async () => {
      const out = await service.getOpsPaymentDetail('pay_ops', {});
      expect(out.payment.id).toBe('pay_ops');
      expect(out.payment.merchantName).toBe('Test Merchant');
      expect(out.payment.notificationUrl).toBe('https://merchant.example/hook');
      expect(out.providerLogs).toEqual([]);
      expect(out.notificationDeliveries).toEqual([]);
      expect(out.action).toEqual({ type: 'redirect', url: 'https://example.com/pay' });
    });

    it('alcance merchant devuelve 404 si el pago es de otro merchant', async () => {
      await expect(
        service.getOpsPaymentDetail('pay_ops', { backofficeMerchantScopeId: 'other' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getOpsPaymentAction', () => {
    beforeEach(() => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'pay_ops',
        merchantId: 'm_1',
        actionSnapshot: { type: 'bank_transfer', clabe: '123' },
      });
    });

    it('devuelve acción desde snapshot', async () => {
      await expect(service.getOpsPaymentAction('pay_ops', {})).resolves.toEqual({
        action: { type: 'bank_transfer', clabe: '123' },
      });
    });
  });

  describe('resendPaymentNotificationDelivery', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('crea entrega de reenvío y hace POST al notificationUrl', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 202,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"ok":true}'));
            controller.close();
          },
        }),
      });
      prisma.payment.findUnique.mockResolvedValue({
        id: 'pay_1',
        merchantId: 'm_1',
        notificationUrl: 'https://example.com/notify',
      });
      prisma.paymentNotificationDelivery.findFirst.mockResolvedValue({
        id: 'del_1',
        paymentId: 'pay_1',
        statusSnapshot: 'PAID',
        requestBodyMasked: { amount: 1 },
        attemptNo: 1,
      } as never);
      prisma.paymentNotificationDelivery.aggregate.mockResolvedValue({ _max: { attemptNo: 1 } });
      prisma.paymentNotificationDelivery.create.mockResolvedValue({
        id: 'del_2',
        attemptNo: 2,
        httpStatus: 202,
        createdAt: new Date(),
        isResend: true,
        originalDeliveryId: 'del_1',
      });

      const out = await service.resendPaymentNotificationDelivery('pay_1', 'del_1', {});
      expect(out.id).toBe('del_2');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/notify',
        expect.objectContaining({ method: 'POST', redirect: 'manual' }),
      );
    });

    it('no persiste responseBodyMasked cuando hay alcance merchant (defensa en profundidad)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"secret":"nope"}'));
            controller.close();
          },
        }),
      });
      prisma.payment.findUnique.mockResolvedValue({
        id: 'pay_1',
        merchantId: 'm_1',
        notificationUrl: 'https://example.com/notify',
      });
      prisma.paymentNotificationDelivery.findFirst.mockResolvedValue({
        id: 'del_1',
        paymentId: 'pay_1',
        statusSnapshot: 'PAID',
        requestBodyMasked: { amount: 1 },
        attemptNo: 1,
      } as never);
      prisma.paymentNotificationDelivery.aggregate.mockResolvedValue({ _max: { attemptNo: 1 } });
      prisma.paymentNotificationDelivery.create.mockResolvedValue({
        id: 'del_2',
        attemptNo: 2,
        httpStatus: 200,
        createdAt: new Date(),
        isResend: true,
        originalDeliveryId: 'del_1',
      });

      await service.resendPaymentNotificationDelivery('pay_1', 'del_1', {
        backofficeMerchantScopeId: 'm_1',
      });

      expect(prisma.paymentNotificationDelivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            responseBodyMasked: Prisma.JsonNull,
          }),
        }),
      );
    });
  });

  describe('selectedProvider persistido no reconocido (legacy)', () => {
    afterEach(() => {
      delete process.env.PAYMENTS_V2_ASSERT_NO_LEGACY_STRIPE_ROWS;
    });

    const legacyPaymentBase = {
      id: 'pay_legacy',
      merchantId: 'm_1',
      amountMinor: 1000,
      currency: 'EUR',
      selectedProvider: 'stripe',
      providerRef: 'pi_stripe',
      statusReason: null,
      paymentLinkId: null,
    };

    it('capture: ConflictException y no enruta por PAYMENTS_PROVIDER_ORDER', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        ...legacyPaymentBase,
        status: PAYMENT_V2_STATUS.AUTHORIZED,
      });

      try {
        await service.capture('m_1', 'pay_legacy');
        throw new Error('expected ConflictException');
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(ConflictException);
        const res = (e as ConflictException).getResponse();
        const msg =
          typeof res === 'string' ? res : (res as { message?: string }).message ?? String(res);
        expect(msg).toEqual(unsupportedPersistedProviderLifecycleMessage('capture', 'stripe'));
      }
      expect(registry.orderedProviders).not.toHaveBeenCalled();
      expect(prisma.paymentOperation.create).not.toHaveBeenCalled();
    });

    it('cancel: ConflictException y no enruta por orden de proveedores', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        ...legacyPaymentBase,
        status: PAYMENT_V2_STATUS.PROCESSING,
      });

      try {
        await service.cancel('m_1', 'pay_legacy');
        throw new Error('expected ConflictException');
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(ConflictException);
        const res = (e as ConflictException).getResponse();
        const msg =
          typeof res === 'string' ? res : (res as { message?: string }).message ?? String(res);
        expect(msg).toEqual(unsupportedPersistedProviderLifecycleMessage('cancel', 'stripe'));
      }
      expect(registry.orderedProviders).not.toHaveBeenCalled();
    });

    it('refund: ConflictException y no enruta por orden de proveedores', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        ...legacyPaymentBase,
        status: PAYMENT_V2_STATUS.SUCCEEDED,
      });

      try {
        await service.refund('m_1', 'pay_legacy');
        throw new Error('expected ConflictException');
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(ConflictException);
        const res = (e as ConflictException).getResponse();
        const msg =
          typeof res === 'string' ? res : (res as { message?: string }).message ?? String(res);
        expect(msg).toEqual(unsupportedPersistedProviderLifecycleMessage('refund', 'stripe'));
      }
      expect(registry.orderedProviders).not.toHaveBeenCalled();
    });

    it('onApplicationBootstrap falla si PAYMENTS_V2_ASSERT_NO_LEGACY_STRIPE_ROWS y quedan filas', async () => {
      process.env.PAYMENTS_V2_ASSERT_NO_LEGACY_STRIPE_ROWS = 'true';
      config.get.mockImplementation((key: string) => process.env[key]);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ has_legacy: true }])
        .mockResolvedValueOnce([{ n: BigInt(2) }]);
      const svc = buildService();
      await expect(svc.onApplicationBootstrap()).rejects.toThrow(/PAYMENTS_V2_ASSERT_NO_LEGACY_STRIPE_ROWS/);
    });
  });
});
