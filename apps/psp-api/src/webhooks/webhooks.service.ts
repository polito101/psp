import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { decryptUtf8 } from '../crypto/secret-box';
import { PrismaService } from '../prisma/prisma.service';

type DeliveryResult = {
  status: 'pending' | 'delivered' | 'failed' | 'skipped';
  attempts: number;
  lastError: string | null;
  deliveryId?: string;
};

const MAX_ATTEMPTS = 3;
/** Backoff base en ms. Intento n espera base * 2^(n-1): 2s, 4s, 8s */
const BACKOFF_BASE_MS = 2_000;
const WORKER_INTERVAL_MS = 5_000;
const FETCH_TIMEOUT_MS = 10_000;

@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WebhooksService.name);
  private workerTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.startWorker();
  }

  onModuleDestroy() {
    this.stopWorker();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Signing helper (público para que el receptor pueda verificar)
  // ──────────────────────────────────────────────────────────────────────────

  signPayload(secret: string, body: string, timestamp: string): string {
    return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Enqueue (fire-and-forget desde capture)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Persiste un registro `pending` en `webhook_deliveries` y retorna de inmediato.
   * La entrega real la hace el worker en background.
   * Si el merchant no tiene webhookUrl, omite la persistencia y retorna `skipped`.
   */
  async deliver(
    merchantId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<DeliveryResult> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { webhookUrl: true },
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
      return { status: 'skipped', attempts: 0, lastError: 'Missing webhook URL' };
    }

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        merchantId,
        eventType,
        payload: { ...payload } as object,
        status: 'pending',
        attempts: 0,
        scheduledAt: new Date(),
      },
    });

    this.log.debug(
      JSON.stringify({ event: 'webhook.delivery.enqueued', deliveryId: delivery.id, merchantId, eventType }),
    );

    return { status: 'pending', attempts: 0, lastError: null, deliveryId: delivery.id };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Worker
  // ──────────────────────────────────────────────────────────────────────────

  private startWorker() {
    this.workerTimer = setInterval(() => {
      this.processPendingDeliveries().catch((err: unknown) => {
        this.log.error(
          JSON.stringify({
            event: 'webhook.worker.error',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      });
    }, WORKER_INTERVAL_MS);
  }

  private stopWorker() {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }
  }

  private async processPendingDeliveries(): Promise<void> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: 'pending', scheduledAt: { lte: new Date() } },
      take: 50,
      orderBy: { scheduledAt: 'asc' },
    });

    await Promise.allSettled(due.map((d) => this.processOne(d.id)));
  }

  private async processOne(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        merchantId: true,
        eventType: true,
        payload: true,
        attempts: true,
        status: true,
        createdAt: true,
      },
    });

    if (!delivery || delivery.status !== 'pending') return;

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: delivery.merchantId },
      select: { webhookUrl: true, webhookSecretCiphertext: true },
    });

    if (!merchant?.webhookUrl) {
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'failed', lastError: 'Merchant webhook URL removed', attempts: delivery.attempts + 1 },
      });
      return;
    }

    let webhookSecret: string;
    try {
      webhookSecret = decryptUtf8(merchant.webhookSecretCiphertext);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'failed', lastError: `Decrypt error: ${err}`, attempts: delivery.attempts + 1 },
      });
      this.log.warn(
        JSON.stringify({ event: 'webhook.delivery.decrypt_failed', deliveryId, error: err }),
      );
      return;
    }

    const body = this.buildWebhookEnvelope(
      delivery.id,
      delivery.createdAt,
      delivery.eventType,
      delivery.payload as Record<string, unknown>,
    );
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.signPayload(webhookSecret, body, timestamp);
    const newAttempts = delivery.attempts + 1;

    try {
      const res = await fetch(merchant.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PSP-Signature': `t=${timestamp},v1=${signature}`,
          'X-PSP-Event': delivery.eventType,
          'X-PSP-Delivery-Id': delivery.id,
        },
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (res.ok) {
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: 'delivered', attempts: newAttempts, lastError: null },
        });
        this.log.log(
          JSON.stringify({
            event: 'webhook.delivery.delivered',
            deliveryId,
            merchantId: delivery.merchantId,
            eventType: delivery.eventType,
            attempts: newAttempts,
          }),
        );
        return;
      }

      const lastError = `HTTP ${res.status}`;
      await this.scheduleRetryOrFail(delivery.id, newAttempts, lastError);
    } catch (e) {
      const lastError = e instanceof Error ? e.message : String(e);
      await this.scheduleRetryOrFail(delivery.id, newAttempts, lastError);
    }
  }

  private async scheduleRetryOrFail(deliveryId: string, attempts: number, lastError: string) {
    if (attempts < MAX_ATTEMPTS) {
      const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempts - 1);
      const scheduledAt = new Date(Date.now() + backoffMs);
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: { attempts, lastError, scheduledAt, status: 'pending' },
      });
      this.log.warn(
        JSON.stringify({
          event: 'webhook.delivery.retry_scheduled',
          deliveryId,
          attempts,
          lastError,
          retryInMs: backoffMs,
        }),
      );
    } else {
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: { attempts, lastError, status: 'failed' },
      });
      this.log.error(
        JSON.stringify({
          event: 'webhook.delivery.failed',
          deliveryId,
          attempts,
          lastError,
        }),
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Reintento manual (endpoint operativo)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Reencola un `WebhookDelivery` fallido para procesarse en el próximo tick del worker.
   * Solo actúa sobre entregas con `status = failed`.
   */
  async retryFailedDelivery(deliveryId: string): Promise<{
    deliveryId: string;
    status: string;
    message: string;
  }> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, status: true },
    });

    if (!delivery) {
      throw new NotFoundException('Webhook delivery not found');
    }
    if (delivery.status !== 'failed') {
      throw new ConflictException('Only failed deliveries can be retried');
    }

    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'pending', scheduledAt: new Date(), attempts: 0, lastError: null },
    });

    this.log.log(
      JSON.stringify({ event: 'webhook.delivery.retry_requested', deliveryId }),
    );

    return {
      deliveryId,
      status: 'pending',
      message: 'Delivery reencolado. El worker lo procesará en el próximo ciclo.',
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers privados
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Construye el JSON del webhook. `id` y `created_at` son estables por fila de entrega
   * (coinciden con `WebhookDelivery.id` y `createdAt`) para que el receptor pueda deduplicar
   * entre reintentos. El `timestamp` de la firma sigue siendo nuevo en cada intento.
   */
  private buildWebhookEnvelope(
    deliveryId: string,
    createdAt: Date,
    eventType: string,
    data: Record<string, unknown>,
  ): string {
    return JSON.stringify({
      id: deliveryId,
      type: eventType,
      created_at: createdAt.toISOString(),
      data,
    });
  }
}
