import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import { decryptUtf8 } from '../crypto/secret-box';
import { PrismaService } from '../prisma/prisma.service';

type DeliveryResult = {
  status: 'delivered' | 'failed' | 'skipped';
  attempts: number;
  lastError: string | null;
  deliveryId?: string;
};

@Injectable()
export class WebhooksService {
  private readonly log = new Logger(WebhooksService.name);
  private static readonly MAX_DELIVERY_ATTEMPTS = 3;
  private static readonly RETRY_DELAY_MS = 500;

  constructor(private readonly prisma: PrismaService) {}

  signPayload(secret: string, body: string, timestamp: string): string {
    const payload = `${timestamp}.${body}`;
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private buildBody(eventType: string, payload: Record<string, unknown>): string {
    return JSON.stringify({
      id: randomUUID(),
      type: eventType,
      created_at: new Date().toISOString(),
      data: payload,
    });
  }

  async deliver(
    merchantId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<DeliveryResult> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { webhookUrl: true, webhookSecretCiphertext: true },
    });
    if (!merchant?.webhookUrl) {
      this.log.debug(
        JSON.stringify({
          event: 'webhook.delivery.skipped',
          merchantId,
          eventType,
          reason: 'missing_webhook_url',
        }),
      );
      return {
        status: 'skipped',
        attempts: 0,
        lastError: 'Missing webhook URL',
      };
    }

    let webhookSecretPlain: string;
    try {
      webhookSecretPlain = decryptUtf8(merchant.webhookSecretCiphertext);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const delivery = await this.prisma.webhookDelivery.create({
        data: {
          merchantId,
          eventType,
          payload: { ...payload } as object,
          status: 'failed',
          attempts: 1,
          lastError: `Decrypt webhook secret: ${err}`,
        },
      });
      this.log.warn(
        JSON.stringify({
          event: 'webhook.delivery.decrypt_failed',
          merchantId,
          eventType,
          error: err,
        }),
      );
      return {
        status: 'failed',
        attempts: 1,
        lastError: `Decrypt webhook secret: ${err}`,
        deliveryId: delivery.id,
      };
    }

    const body = this.buildBody(eventType, payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.signPayload(webhookSecretPlain, body, timestamp);

    let attempts = 0;
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= WebhooksService.MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      attempts = attempt;
      try {
        const res = await fetch(merchant.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-PSP-Signature': `t=${timestamp},v1=${signature}`,
            'X-PSP-Event': eventType,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });

        if (res.ok) {
          const delivery = await this.prisma.webhookDelivery.create({
            data: {
              merchantId,
              eventType,
              payload: JSON.parse(body) as object,
              status: 'delivered',
              attempts,
              lastError: null,
            },
          });
          this.log.log(
            JSON.stringify({
              event: 'webhook.delivery.delivered',
              merchantId,
              eventType,
              deliveryId: delivery.id,
              attempts,
            }),
          );
          return {
            status: 'delivered',
            attempts,
            lastError: null,
            deliveryId: delivery.id,
          };
        }

        lastError = `HTTP ${res.status}`;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }

      if (attempt < WebhooksService.MAX_DELIVERY_ATTEMPTS) {
        await this.sleep(WebhooksService.RETRY_DELAY_MS * attempt);
      }
    }

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        merchantId,
        eventType,
        payload: JSON.parse(body) as object,
        status: 'failed',
        attempts,
        lastError,
      },
    });
    this.log.warn(
      JSON.stringify({
        event: 'webhook.delivery.failed',
        merchantId,
        eventType,
        attempts,
        lastError: lastError ?? 'unknown',
      }),
    );
    return {
      status: 'failed',
      attempts,
      lastError: lastError ?? 'unknown',
      deliveryId: delivery.id,
    };
  }

  async retryFailedDelivery(deliveryId: string): Promise<{
    sourceDeliveryId: string;
    retried: boolean;
    status: 'delivered' | 'failed' | 'skipped';
    attempts: number;
    lastError: string | null;
    retryDeliveryId?: string;
  }> {
    const source = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        merchantId: true,
        eventType: true,
        payload: true,
        status: true,
      },
    });
    if (!source) {
      throw new NotFoundException('Webhook delivery not found');
    }
    if (source.status !== 'failed') {
      throw new ConflictException('Only failed deliveries can be retried');
    }

    this.log.log(
      JSON.stringify({
        event: 'webhook.delivery.retry_requested',
        sourceDeliveryId: source.id,
        merchantId: source.merchantId,
        eventType: source.eventType,
      }),
    );

    const result = await this.deliver(
      source.merchantId,
      source.eventType,
      source.payload as Record<string, unknown>,
    );

    return {
      sourceDeliveryId: source.id,
      retried: result.status !== 'skipped',
      status: result.status,
      attempts: result.attempts,
      lastError: result.lastError,
      retryDeliveryId: result.deliveryId,
    };
  }
}
