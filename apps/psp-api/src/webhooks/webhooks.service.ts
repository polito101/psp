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
/** Intervalo base del worker cuando hay entregas pendientes. */
const WORKER_INTERVAL_MS = 5_000;
/**
 * Intervalo máximo de polling en idle.
 * Cuando no hay entregas pendientes el worker dobla el intervalo cada tick
 * hasta alcanzar este techo, reduciendo la carga base en BD en reposo.
 * Al encontrar trabajo (o ante cualquier error) vuelve a WORKER_INTERVAL_MS.
 */
const WORKER_MAX_IDLE_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;
/**
 * Tras reclamar `pending → processing`, `scheduledAt` pasa a representar el inicio del procesamiento.
 * Un reintento manual sobre `processing` solo se permite si esa marca es anterior a este umbral
 * (timeout HTTP + margen), evitando reencolar durante un `fetch` activo y duplicar POSTs.
 */
const PROCESSING_STUCK_MARGIN_MS = 5_000;
const PROCESSING_STUCK_AFTER_MS = FETCH_TIMEOUT_MS + PROCESSING_STUCK_MARGIN_MS;
/** Máximo de fetch HTTP simultáneos por tick. Evita saturar conexiones en picos. */
const WORKER_CONCURRENCY = 10;

/** Estado transitorio: fila reclamada por un worker antes del `fetch` (evita entregas duplicadas). */
const STATUS_PROCESSING = 'processing' as const;

@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WebhooksService.name);
  private workerTimer: NodeJS.Timeout | null = null;
  private workerStopped = false;

  /**
   * Controlado por la variable de entorno `WEBHOOK_WORKER_ENABLED`.
   * - Omitida o `'true'` → worker activo (comportamiento por defecto).
   * - `'false'` → worker desactivado; la instancia solo sirve la API.
   *
   * Útil al escalar horizontalmente: réplicas de API puras ponen
   * `WEBHOOK_WORKER_ENABLED=false`; un deployment dedicado lo deja activo.
   */
  private readonly workerEnabled: boolean;

  constructor(private readonly prisma: PrismaService) {
    this.workerEnabled = process.env.WEBHOOK_WORKER_ENABLED !== 'false';
  }

  onModuleInit() {
    if (this.workerEnabled) {
      this.startWorker();
      this.log.log(JSON.stringify({ event: 'webhook.worker.started', intervalMs: WORKER_INTERVAL_MS }));
    } else {
      this.log.log(JSON.stringify({ event: 'webhook.worker.disabled', reason: 'WEBHOOK_WORKER_ENABLED=false' }));
    }
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
    this.workerStopped = false;
    // Intervalo dinámico: crece en idle, se resetea al encontrar trabajo o ante errores.
    let currentIntervalMs = WORKER_INTERVAL_MS;

    const runTick = async () => {
      if (this.workerStopped) return;
      try {
        const processed = await this.processPendingDeliveries();
        if (processed === 0) {
          const next = Math.min(currentIntervalMs * 2, WORKER_MAX_IDLE_MS);
          if (next !== currentIntervalMs) {
            this.log.debug(
              JSON.stringify({ event: 'webhook.worker.idle_backoff', nextIntervalMs: next }),
            );
          }
          currentIntervalMs = next;
        } else {
          currentIntervalMs = WORKER_INTERVAL_MS;
        }
      } catch (err: unknown) {
        // Ante error, volver al intervalo base para detectar la recuperación rápido.
        currentIntervalMs = WORKER_INTERVAL_MS;
        this.log.error(
          JSON.stringify({
            event: 'webhook.worker.error',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
      if (this.workerStopped) return;
      this.workerTimer = setTimeout(() => void runTick(), currentIntervalMs);
    };
    void runTick();
  }

  private stopWorker() {
    this.workerStopped = true;
    if (this.workerTimer) {
      clearTimeout(this.workerTimer);
      this.workerTimer = null;
    }
  }

  /**
   * Busca entregas pendientes y las procesa con límite de concurrencia.
   * Retorna el número de entregas encontradas (no necesariamente procesadas con éxito)
   * para que el llamador pueda aplicar backoff en idle.
   */
  private async processPendingDeliveries(): Promise<number> {
    const now = new Date();
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: 'pending', scheduledAt: { lte: now } },
      take: 50,
      orderBy: { scheduledAt: 'asc' },
      select: { id: true },
    });

    await this.runWithConcurrency(
      due.map((d) => () => this.tryClaimAndProcess(d.id)),
      WORKER_CONCURRENCY,
    );

    return due.length;
  }

  /**
   * Ejecuta tareas con un límite de concurrencia usando ventana deslizante:
   * en cuanto termina una tarea se inicia la siguiente sin esperar al bloque completo.
   * Equivalente a `p-limit` sin dependencias externas.
   *
   * Las tareas se envuelven en `.catch()` antes de entrar en `executing` para que
   * `Promise.race` **nunca rechace**: un fallo puntual (p. ej. error de red transitorio
   * en `tryClaimAndProcess`) no debe abortar el loop ni dejar el resto del batch sin procesar.
   * El bloque `finally` garantiza que esperamos todas las tareas activas incluso si
   * un error inesperado escapa del bucle.
   *
   * @param tasks Array de funciones que devuelven Promise (thunks).
   * @param limit Número máximo de tareas simultáneas.
   */
  private async runWithConcurrency(
    tasks: Array<() => Promise<void>>,
    limit: number,
  ): Promise<void> {
    const executing = new Set<Promise<void>>();
    try {
      for (const task of tasks) {
        // La tarea absorbe su propio rechazo: tryClaimAndProcess ya maneja todos los
        // errores internamente, pero este .catch es la última red de seguridad por si
        // algún error escapa (bug futuro, OOM, etc.) y evita que Promise.race lance.
        const p: Promise<void> = task()
          .catch((e) => {
            this.log.error(
              JSON.stringify({
                event: 'webhook.worker.unhandled_task_error',
                error: e instanceof Error ? e.message : String(e),
              }),
            );
          })
          .finally(() => executing.delete(p));
        executing.add(p);
        if (executing.size >= limit) {
          await Promise.race(executing);
        }
      }
    } finally {
      await Promise.allSettled(executing);
    }
  }

  /**
   * Reclama la fila con `updateMany` atómico (`pending` → `processing`) y solo entonces hace el HTTP.
   * Otra instancia o el mismo tick en paralelo que pierda la carrera sale sin efecto.
   *
   * Una vez reclamada la fila somos responsables de llevarla a un estado terminal
   * (`delivered`, `failed`) o de re-encolación (`pending`). El bloque try/catch externo
   * actúa como red de seguridad: ante cualquier excepción no prevista (error de BD,
   * bug introducido después, OOM parcial) llama a `scheduleRetryOrFail` para liberar
   * la fila antes de propagar el silencio. Sin él, un error en `merchant.findUnique`,
   * `buildWebhookEnvelope`, `signPayload` o en los propios helpers de transición dejaría
   * la entrega en `processing` indefinidamente, invisible para el worker.
   */
  private async tryClaimAndProcess(deliveryId: string): Promise<void> {
    const now = new Date();
    const claimed = await this.prisma.webhookDelivery.updateMany({
      where: {
        id: deliveryId,
        status: 'pending',
        scheduledAt: { lte: now },
      },
      data: { status: STATUS_PROCESSING, scheduledAt: now },
    });

    if (claimed.count === 0) {
      return;
    }

    // Número de intentos conocidos; se actualiza al cargar el delivery.
    // Lo necesitamos en el catch de seguridad para poder llamar a scheduleRetryOrFail
    // incluso si el findUnique falló antes de que pudiéramos leerlo.
    let currentAttempts = 0;

    try {
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

      if (!delivery || delivery.status !== STATUS_PROCESSING) {
        // No debería ocurrir tras un claim exitoso (la fila fue reclamada por nosotros),
        // pero puede pasar si la fila fue borrada entre el claim y este findUnique, o
        // en entornos con réplicas de lectura con retraso. Liberar como failed.
        await this.finishFromProcessing(deliveryId, currentAttempts + 1, {
          status: 'failed',
          lastError: 'Delivery missing or status inconsistent after claim',
        });
        this.log.warn(
          JSON.stringify({ event: 'webhook.delivery.inconsistent_after_claim', deliveryId }),
        );
        return;
      }

      currentAttempts = delivery.attempts;

      const merchant = await this.prisma.merchant.findUnique({
        where: { id: delivery.merchantId },
        select: { webhookUrl: true, webhookSecretCiphertext: true },
      });

      if (!merchant?.webhookUrl) {
        await this.finishFromProcessing(delivery.id, currentAttempts + 1, {
          status: 'failed',
          lastError: 'Merchant webhook URL removed',
        });
        return;
      }

      let webhookSecret: string;
      try {
        webhookSecret = decryptUtf8(merchant.webhookSecretCiphertext);
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        await this.finishFromProcessing(delivery.id, currentAttempts + 1, {
          status: 'failed',
          lastError: `Decrypt error: ${err}`,
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
      const newAttempts = currentAttempts + 1;

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
          const updated = await this.finishFromProcessing(delivery.id, newAttempts, {
            status: 'delivered',
            lastError: null,
          });
          if (updated) {
            this.log.log(
              JSON.stringify({
                event: 'webhook.delivery.delivered',
                deliveryId,
                merchantId: delivery.merchantId,
                eventType: delivery.eventType,
                attempts: newAttempts,
              }),
            );
          }
          return;
        }

        const lastError = `HTTP ${res.status}`;
        await this.scheduleRetryOrFail(delivery.id, newAttempts, lastError);
      } catch (e) {
        const lastError = e instanceof Error ? e.message : String(e);
        await this.scheduleRetryOrFail(delivery.id, newAttempts, lastError);
      }
    } catch (e) {
      // Red de seguridad: excepción inesperada tras el claim (error de BD, bug, etc.).
      // Intentar liberar la fila para que no quede en `processing` indefinidamente.
      const lastError = e instanceof Error ? e.message : String(e);
      this.log.error(
        JSON.stringify({
          event: 'webhook.delivery.unexpected_error',
          deliveryId,
          error: lastError,
        }),
      );
      try {
        await this.scheduleRetryOrFail(deliveryId, currentAttempts + 1, `Unexpected error: ${lastError}`);
      } catch (cleanupError) {
        // Si el propio cleanup falla (BD caída), loguear y no propagar.
        // La fila quedará en `processing` hasta una recuperación manual o el admin retry.
        this.log.error(
          JSON.stringify({
            event: 'webhook.delivery.cleanup_failed',
            deliveryId,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          }),
        );
      }
    }
  }

  /** Solo transición desde `processing` para no pisar estado ajeno. */
  private async finishFromProcessing(
    deliveryId: string,
    attempts: number,
    data: { status: 'delivered' | 'failed'; lastError: string | null },
  ): Promise<boolean> {
    const result = await this.prisma.webhookDelivery.updateMany({
      where: { id: deliveryId, status: STATUS_PROCESSING },
      data: { status: data.status, attempts, lastError: data.lastError },
    });
    return result.count === 1;
  }

  private async scheduleRetryOrFail(deliveryId: string, attempts: number, lastError: string) {
    if (attempts < MAX_ATTEMPTS) {
      const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempts - 1);
      const scheduledAt = new Date(Date.now() + backoffMs);
      const result = await this.prisma.webhookDelivery.updateMany({
        where: { id: deliveryId, status: STATUS_PROCESSING },
        data: { attempts, lastError, scheduledAt, status: 'pending' },
      });
      if (result.count === 0) {
        return;
      }
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
      const result = await this.prisma.webhookDelivery.updateMany({
        where: { id: deliveryId, status: STATUS_PROCESSING },
        data: { attempts, lastError, status: 'failed' },
      });
      if (result.count === 0) {
        return;
      }
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
   * Reencola una entrega para el próximo tick del worker.
   * - `failed`: siempre permitido.
   * - `processing`: solo si está “atascada” (inicio de procesamiento anterior al umbral
   *   `FETCH_TIMEOUT_MS + margen`), no durante un `fetch` normal.
   *
   * El `updateMany` con `OR` condicional es la parte crítica: `failed` sin más condiciones;
   * `processing` solo si `scheduledAt` (inicio de claim) sigue siendo lo suficientemente antiguo.
   * Si el worker terminó (`delivered`) o aún procesa sin estar atascado, `count === 0` y
   * se lanza `ConflictException`.
   */
  async retryFailedDelivery(deliveryId: string): Promise<{
    deliveryId: string;
    status: string;
    message: string;
  }> {
    const stuckBefore = new Date(Date.now() - PROCESSING_STUCK_AFTER_MS);

    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, status: true, scheduledAt: true },
    });

    if (!delivery) {
      throw new NotFoundException('Webhook delivery not found');
    }

    if (delivery.status === STATUS_PROCESSING && delivery.scheduledAt > stuckBefore) {
      throw new ConflictException(
        'Processing delivery is not stuck yet; wait for the worker or try again later',
      );
    }
    if (delivery.status !== 'failed' && delivery.status !== STATUS_PROCESSING) {
      throw new ConflictException(
        'Only failed or stuck processing deliveries can be requeued',
      );
    }

    const result = await this.prisma.webhookDelivery.updateMany({
      where: {
        id: deliveryId,
        OR: [{ status: 'failed' }, { status: STATUS_PROCESSING, scheduledAt: { lte: stuckBefore } }],
      },
      data: { status: 'pending', scheduledAt: new Date(), attempts: 0, lastError: null },
    });

    if (result.count === 0) {
      throw new ConflictException(
        'Delivery status changed concurrently; check its current status before retrying',
      );
    }

    this.log.log(
      JSON.stringify({
        event: 'webhook.delivery.retry_requested',
        deliveryId,
        previousStatus: delivery.status,
      }),
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
