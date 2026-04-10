import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import { decryptUtf8 } from '../crypto/secret-box';
import { PrismaService } from '../prisma/prisma.service';

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

  async deliver(
    merchantId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { webhookUrl: true, webhookSecretCiphertext: true },
    });
    if (!merchant?.webhookUrl) {
      this.log.debug(`No webhook URL for merchant ${merchantId}`);
      return;
    }

    let webhookSecretPlain: string;
    try {
      webhookSecretPlain = decryptUtf8(merchant.webhookSecretCiphertext);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await this.prisma.webhookDelivery.create({
        data: {
          merchantId,
          eventType,
          payload: { ...payload } as object,
          status: 'failed',
          attempts: 1,
          lastError: `Decrypt webhook secret: ${err}`,
        },
      });
      return;
    }

    const body = JSON.stringify({
      id: randomUUID(),
      type: eventType,
      created_at: new Date().toISOString(),
      data: payload,
    });
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
          await this.prisma.webhookDelivery.create({
            data: {
              merchantId,
              eventType,
              payload: JSON.parse(body) as object,
              status: 'delivered',
              attempts,
              lastError: null,
            },
          });
          return;
        }

        lastError = `HTTP ${res.status}`;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }

      if (attempt < WebhooksService.MAX_DELIVERY_ATTEMPTS) {
        await this.sleep(WebhooksService.RETRY_DELAY_MS * attempt);
      }
    }

    await this.prisma.webhookDelivery.create({
      data: {
        merchantId,
        eventType,
        payload: JSON.parse(body) as object,
        status: 'failed',
        attempts,
        lastError,
      },
    });
    this.log.warn(`Webhook delivery failed after ${attempts} attempts: ${lastError ?? 'unknown'}`);
  }
}
