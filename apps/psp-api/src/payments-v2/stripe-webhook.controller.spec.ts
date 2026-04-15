import { createHmac } from 'crypto';
import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { StripeWebhookController } from './stripe-webhook.controller';

function buildStripeSignatureHeader(payload: string, secret: string, timestamp?: number): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${digest}`;
}

describe('StripeWebhookController', () => {
  const config = {
    get: jest.fn((key: string) => process.env[key]),
  };
  const payments = {
    applyStripeWebhookEvent: jest.fn(),
  };

  let controller: StripeWebhookController;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_controller_unit_test';
    process.env.STRIPE_WEBHOOK_TOLERANCE_SEC = '300';
    payments.applyStripeWebhookEvent.mockResolvedValue({
      handled: true,
      paymentId: 'pay_123',
      reason: undefined,
    });
    controller = new StripeWebhookController(config as never, payments as never);
  });

  it('procesa webhook válido y delega en applyStripeWebhookEvent', async () => {
    const payload = JSON.stringify({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', object: 'payment_intent' } },
    });
    const req = { rawBody: Buffer.from(payload, 'utf8') } as RawBodyRequest<Request>;
    const signature = buildStripeSignatureHeader(payload, process.env.STRIPE_WEBHOOK_SECRET ?? '');

    const result = await controller.handleStripeWebhook(signature, req);

    expect(payments.applyStripeWebhookEvent).toHaveBeenCalledWith(
      'payment_intent.succeeded',
      expect.objectContaining({ id: 'pi_1' }),
    );
    expect(result).toEqual({
      received: true,
      eventId: 'evt_1',
      eventType: 'payment_intent.succeeded',
      handled: true,
      paymentId: 'pay_123',
      reason: null,
    });
  });

  it('rechaza cuando falta Stripe-Signature', async () => {
    const payload = JSON.stringify({
      id: 'evt_no_sig',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_2' } },
    });
    const req = { rawBody: Buffer.from(payload, 'utf8') } as RawBodyRequest<Request>;

    await expect(controller.handleStripeWebhook(undefined, req)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rechaza cuando el header de firma está mal formado', async () => {
    const payload = JSON.stringify({
      id: 'evt_bad_header',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_3' } },
    });
    const req = { rawBody: Buffer.from(payload, 'utf8') } as RawBodyRequest<Request>;

    await expect(controller.handleStripeWebhook('v1=deadbeef', req)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rechaza firma fuera de tolerancia temporal', async () => {
    const payload = JSON.stringify({
      id: 'evt_old',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_old' } },
    });
    const req = { rawBody: Buffer.from(payload, 'utf8') } as RawBodyRequest<Request>;
    const staleTs = Math.floor(Date.now() / 1000) - 301;
    const signature = buildStripeSignatureHeader(
      payload,
      process.env.STRIPE_WEBHOOK_SECRET ?? '',
      staleTs,
    );

    await expect(controller.handleStripeWebhook(signature, req)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rechaza JSON inválido', async () => {
    const malformed = '{"id":"evt_bad_json","type":"payment_intent.succeeded"';
    const req = { rawBody: Buffer.from(malformed, 'utf8') } as RawBodyRequest<Request>;
    const signature = buildStripeSignatureHeader(malformed, process.env.STRIPE_WEBHOOK_SECRET ?? '');

    await expect(controller.handleStripeWebhook(signature, req)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rechaza payload incompleto sin data.object', async () => {
    const payload = JSON.stringify({
      id: 'evt_incomplete',
      type: 'payment_intent.succeeded',
      data: {},
    });
    const req = { rawBody: Buffer.from(payload, 'utf8') } as RawBodyRequest<Request>;
    const signature = buildStripeSignatureHeader(payload, process.env.STRIPE_WEBHOOK_SECRET ?? '');

    await expect(controller.handleStripeWebhook(signature, req)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('lanza 500 cuando no hay secret configurado', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = '';
    controller = new StripeWebhookController(config as never, payments as never);
    const payload = JSON.stringify({
      id: 'evt_no_secret',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_4' } },
    });
    const req = { rawBody: Buffer.from(payload, 'utf8') } as RawBodyRequest<Request>;
    const signature = buildStripeSignatureHeader(payload, 'whsec_any');

    await expect(controller.handleStripeWebhook(signature, req)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
