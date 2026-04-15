import { createHmac, randomUUID } from 'crypto';
import request from 'supertest';
import { INestApplication } from '@nestjs/common/interfaces';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, createMerchantViaHttp, resetIntegrationDb } from './helpers/integration-app';

function buildStripeSignatureHeader(payload: string, secret: string, timestamp?: number): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${digest}`;
}

describe('stripe inbound webhooks integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let originalWebhookSecret: string | undefined;

  beforeAll(async () => {
    originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const setup = await createIntegrationApp();
    app = setup.app;
    prisma = setup.prisma;
  });

  beforeEach(async () => {
    await resetIntegrationDb(prisma);
  });

  afterAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
    await app.close();
  });

  function sendSignedWebhook(payload: string, timestamp?: number) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_integration_test_secret';
    const signature = buildStripeSignatureHeader(payload, secret, timestamp);
    return request(app.getHttpServer())
      .post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(payload);
  }

  it('transitions authorized payment to succeeded and writes ledger once (idempotent replay)', async () => {
    const merchant = await createMerchantViaHttp(app);
    const providerRef = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const payment = await prisma.payment.create({
      data: {
        merchantId: merchant.id,
        amountMinor: 2_000,
        currency: 'EUR',
        status: 'authorized',
        rail: 'fiat',
        selectedProvider: 'stripe',
        providerRef,
      },
    });

    const payload = JSON.stringify({
      id: `evt_${randomUUID().replace(/-/g, '')}`,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: providerRef,
          object: 'payment_intent',
          status: 'succeeded',
        },
      },
    });
    const first = await sendSignedWebhook(payload).expect(200);

    expect(first.body.handled).toBe(true);
    expect(first.body.paymentId).toBe(payment.id);

    const replay = await sendSignedWebhook(payload).expect(200);

    expect(replay.body.handled).toBe(true);
    expect(replay.body.paymentId).toBe(payment.id);

    const updated = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      select: { status: true },
    });
    expect(updated.status).toBe('succeeded');

    const ledgerLines = await prisma.ledgerLine.findMany({
      where: { paymentId: payment.id },
      orderBy: { entryType: 'asc' },
      select: { entryType: true, amountMinor: true },
    });
    expect(ledgerLines).toEqual([
      { entryType: 'available', amountMinor: 1942 },
      { entryType: 'fee', amountMinor: 58 },
    ]);
  });

  it('marks payment as canceled for payment_intent.canceled and replay keeps stable state', async () => {
    const merchant = await createMerchantViaHttp(app);
    const providerRef = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const payment = await prisma.payment.create({
      data: {
        merchantId: merchant.id,
        amountMinor: 1_250,
        currency: 'EUR',
        status: 'authorized',
        rail: 'fiat',
        selectedProvider: 'stripe',
        providerRef,
      },
    });

    const payload = JSON.stringify({
      id: `evt_${randomUUID().replace(/-/g, '')}`,
      type: 'payment_intent.canceled',
      data: { object: { id: providerRef, object: 'payment_intent' } },
    });

    await sendSignedWebhook(payload).expect(200);
    await sendSignedWebhook(payload).expect(200);

    const updated = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      select: { status: true, statusReason: true },
    });
    expect(updated.status).toBe('canceled');
    expect(updated.statusReason).toBeNull();
    const ledgerLines = await prisma.ledgerLine.count({ where: { paymentId: payment.id } });
    expect(ledgerLines).toBe(0);
  });

  it('marks payment as failed for payment_intent.payment_failed and keeps reason on replay', async () => {
    const merchant = await createMerchantViaHttp(app);
    const providerRef = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const payment = await prisma.payment.create({
      data: {
        merchantId: merchant.id,
        amountMinor: 1_500,
        currency: 'EUR',
        status: 'authorized',
        rail: 'fiat',
        selectedProvider: 'stripe',
        providerRef,
      },
    });

    const payload = JSON.stringify({
      id: `evt_${randomUUID().replace(/-/g, '')}`,
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: providerRef,
          object: 'payment_intent',
          last_payment_error: { type: 'card_error' },
        },
      },
    });

    await sendSignedWebhook(payload).expect(200);
    await sendSignedWebhook(payload).expect(200);

    const updated = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      select: { status: true, statusReason: true },
    });
    expect(updated.status).toBe('failed');
    expect(updated.statusReason).toBe('provider_declined');
  });

  it('marks succeeded payment as refunded for charge.refunded and does not duplicate ledger on replay', async () => {
    const merchant = await createMerchantViaHttp(app);
    const providerRef = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const payment = await prisma.payment.create({
      data: {
        merchantId: merchant.id,
        amountMinor: 2_000,
        currency: 'EUR',
        status: 'succeeded',
        rail: 'fiat',
        selectedProvider: 'stripe',
        providerRef,
      },
    });

    const payload = JSON.stringify({
      id: `evt_${randomUUID().replace(/-/g, '')}`,
      type: 'charge.refunded',
      data: {
        object: {
          id: `ch_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
          object: 'charge',
          payment_intent: providerRef,
          refunded: true,
          amount_refunded: 1_200,
        },
      },
    });

    const first = await sendSignedWebhook(payload).expect(200);
    const ledgerAfterFirst = await prisma.ledgerLine.count({ where: { paymentId: payment.id } });
    const replay = await sendSignedWebhook(payload).expect(200);
    const ledgerAfterReplay = await prisma.ledgerLine.count({ where: { paymentId: payment.id } });

    expect(first.body.handled).toBe(true);
    expect(replay.body.handled).toBe(true);
    expect(ledgerAfterFirst).toBeGreaterThan(0);
    expect(ledgerAfterReplay).toBe(ledgerAfterFirst);

    const updated = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      select: { status: true },
    });
    expect(updated.status).toBe('refunded');
  });

  it('returns handled=false when charge.refunded is partial', async () => {
    const merchant = await createMerchantViaHttp(app);
    const providerRef = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const payment = await prisma.payment.create({
      data: {
        merchantId: merchant.id,
        amountMinor: 2_000,
        currency: 'EUR',
        status: 'succeeded',
        rail: 'fiat',
        selectedProvider: 'stripe',
        providerRef,
      },
    });

    const payload = JSON.stringify({
      id: `evt_${randomUUID().replace(/-/g, '')}`,
      type: 'charge.refunded',
      data: {
        object: {
          id: `ch_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
          object: 'charge',
          payment_intent: providerRef,
          refunded: false,
          amount_refunded: 100,
        },
      },
    });

    const response = await sendSignedWebhook(payload).expect(200);
    expect(response.body.handled).toBe(false);
    expect(response.body.reason).toBe('charge_not_fully_refunded');

    const updated = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      select: { status: true },
    });
    expect(updated.status).toBe('succeeded');
  });

  it('returns handled=false with payment_not_found for unknown providerRef', async () => {
    const payload = JSON.stringify({
      id: `evt_${randomUUID().replace(/-/g, '')}`,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
          object: 'payment_intent',
        },
      },
    });

    const response = await sendSignedWebhook(payload).expect(200);
    expect(response.body.handled).toBe(false);
    expect(response.body.reason).toBe('payment_not_found');
  });

  it('returns handled=false with unsupported_event_type when payment exists', async () => {
    const merchant = await createMerchantViaHttp(app);
    const providerRef = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    await prisma.payment.create({
      data: {
        merchantId: merchant.id,
        amountMinor: 990,
        currency: 'EUR',
        status: 'authorized',
        rail: 'fiat',
        selectedProvider: 'stripe',
        providerRef,
      },
    });

    const payload = JSON.stringify({
      id: `evt_${randomUUID().replace(/-/g, '')}`,
      type: 'payment_intent.processing',
      data: {
        object: {
          id: providerRef,
          object: 'payment_intent',
        },
      },
    });

    const response = await sendSignedWebhook(payload).expect(200);
    expect(response.body.handled).toBe(false);
    expect(response.body.reason).toBe('unsupported_event_type');
  });

  it('returns handled=false with missing_provider_ref', async () => {
    const payload = JSON.stringify({
      id: `evt_${randomUUID().replace(/-/g, '')}`,
      type: 'charge.refunded',
      data: {
        object: {
          id: `ch_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
          object: 'charge',
          refunded: true,
        },
      },
    });

    const response = await sendSignedWebhook(payload).expect(200);
    expect(response.body.handled).toBe(false);
    expect(response.body.reason).toBe('missing_provider_ref');
  });

  it('rejects webhook when Stripe-Signature is invalid', async () => {
    const payload = JSON.stringify({
      id: `evt_${randomUUID().replace(/-/g, '')}`,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_nonexistent',
          object: 'payment_intent',
          status: 'succeeded',
        },
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 't=1,v1=deadbeef')
      .send(payload)
      .expect(401);
  });

  it('rejects webhook when Stripe-Signature header is missing', async () => {
    const payload = JSON.stringify({
      id: `evt_${randomUUID().replace(/-/g, '')}`,
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_missing_sig', object: 'payment_intent' } },
    });

    await request(app.getHttpServer())
      .post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(401);
  });

  it('rejects webhook when Stripe signature timestamp is outside tolerance', async () => {
    const payload = JSON.stringify({
      id: `evt_${randomUUID().replace(/-/g, '')}`,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
          object: 'payment_intent',
        },
      },
    });

    const oldTimestamp = Math.floor(Date.now() / 1000) - 301;
    await sendSignedWebhook(payload, oldTimestamp).expect(401);
  });

  it('rejects webhook with invalid JSON payload', async () => {
    const malformedPayload = '{"id":"evt_bad","type":"payment_intent.succeeded","data":{"object":{"id":"pi_1"}}';
    const secret = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_integration_test_secret';
    const signature = buildStripeSignatureHeader(malformedPayload, secret);

    await request(app.getHttpServer())
      .post('/api/v1/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(malformedPayload)
      .expect(400);
  });

  it('rejects webhook with incomplete event payload', async () => {
    const payload = JSON.stringify({
      id: `evt_${randomUUID().replace(/-/g, '')}`,
      type: 'payment_intent.succeeded',
      data: {},
    });

    await sendSignedWebhook(payload).expect(400);
  });

});
