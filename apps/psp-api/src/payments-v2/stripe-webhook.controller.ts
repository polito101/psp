import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  InternalServerErrorException,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { PaymentsV2Service } from './payments-v2.service';

type StripeWebhookEvent = {
  id?: string;
  type?: string;
  data?: {
    object?: Record<string, unknown>;
  };
};

@ApiTags('payments-v2')
@Controller({ path: 'stripe', version: '1' })
export class StripeWebhookController {
  private readonly signatureToleranceSec: number;

  constructor(
    private readonly config: ConfigService,
    private readonly payments: PaymentsV2Service,
  ) {
    const rawTolerance = Number(this.config.get<string>('STRIPE_WEBHOOK_TOLERANCE_SEC') ?? '300');
    this.signatureToleranceSec =
      Number.isInteger(rawTolerance) && rawTolerance >= 30 && rawTolerance <= 900
        ? rawTolerance
        : 300;
  }

  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Inbound Stripe webhook (firma Stripe-Signature)',
  })
  async handleStripeWebhook(
    @Headers('stripe-signature') stripeSignature: string | undefined,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const rawBody = this.resolveRawBody(req);
    this.verifyStripeSignature(rawBody, stripeSignature);

    const event = this.parseEvent(rawBody);
    const eventType = typeof event.type === 'string' ? event.type : '';
    const object = event.data?.object;
    if (!eventType || !object || typeof object !== 'object') {
      throw new BadRequestException('Invalid Stripe event payload');
    }

    const result = await this.payments.applyStripeWebhookEvent(eventType, object);
    return {
      received: true,
      eventId: event.id ?? null,
      eventType,
      handled: result.handled,
      paymentId: result.paymentId ?? null,
      reason: result.reason ?? null,
    };
  }

  private resolveRawBody(req: RawBodyRequest<Request>): string {
    const raw = req.rawBody;
    if (raw) {
      return Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    }
    if (typeof req.body === 'string') return req.body;
    if (req.body && typeof req.body === 'object') {
      return JSON.stringify(req.body);
    }
    throw new InternalServerErrorException('Request body is required for Stripe signature verification');
  }

  private parseEvent(rawBody: string): StripeWebhookEvent {
    try {
      return JSON.parse(rawBody) as StripeWebhookEvent;
    } catch {
      throw new BadRequestException('Invalid JSON payload');
    }
  }

  private verifyStripeSignature(rawBody: string, header: string | undefined): void {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    if (!secret) {
      throw new InternalServerErrorException('Stripe webhook secret is not configured');
    }
    if (!header) {
      throw new UnauthorizedException('Missing Stripe signature');
    }

    const signatureParts = header
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const timestamp = signatureParts.find((part) => part.startsWith('t='))?.slice(2);
    const signatures = signatureParts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));

    if (!timestamp || signatures.length === 0 || !/^\d+$/.test(timestamp)) {
      throw new UnauthorizedException('Invalid Stripe signature header');
    }

    const currentTs = Math.floor(Date.now() / 1000);
    const signedTs = Number(timestamp);
    if (Math.abs(currentTs - signedTs) > this.signatureToleranceSec) {
      throw new UnauthorizedException('Stripe signature timestamp is outside tolerance');
    }

    const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const valid = signatures.some((candidate) => {
      if (!/^[0-9a-fA-F]{64}$/.test(candidate)) return false;
      const candidateBuffer = Buffer.from(candidate, 'hex');
      return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
    });

    if (!valid) {
      throw new UnauthorizedException('Invalid Stripe signature');
    }
  }
}
