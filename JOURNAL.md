# Daily Async Log

## 2026-04-10

### 3 puntos clave

1. **Ciclo de vida de API keys:** Migración Prisma con `apiKeyExpiresAt` y `apiKeyRevokedAt` en `Merchant`; `ApiKeyGuard` rechaza keys revocadas o expiradas; `POST /api/v1/merchants` acepta `keyTtlDays` opcional; endpoints internos `POST .../merchants/:id/rotate-key` y `POST .../merchants/:id/revoke-key` (ambos con `X-Internal-Secret`).
2. **Webhooks asíncronos (cola en DB):** `WebhooksService.deliver()` solo encola filas `webhook_deliveries` en `pending` con `scheduledAt`; un worker por `setInterval` procesa, reintenta con backoff y marca `delivered`/`failed`; el retry operativo vuelve a poner el registro en `pending` para el worker.
3. **Corrección de contrato de `deliver()`:** El retorno tras encolar pasa a `status: 'pending'` (alineado con lo persistido), no `delivered`, para no sugerir entrega HTTP síncrona; tests actualizados en `webhooks.service.spec.ts` y `api-key.guard.spec.ts`.

### Contexto ampliado (qué se hizo y por qué)

**Alcance del sprint (respecto a lo planificado antes)**

- **Incluido:** rotación/expiración de API keys (TTL al crear, revocar, rotar con TTL opcional) y desacoplar webhooks del request de `capture` usando la tabla existente como cola (sin BullMQ ni servicios nuevos).
- **Fuera de alcance explícito hoy:** anti-fraude avanzado / scoring (se pospone); no se tocó el flujo de pagos salvo el punto en que se dispara el webhook tras captura.

**Base de datos**

- Migración aplicada en desarrollo: `add_api_key_lifecycle_and_webhook_scheduled_at` (nombre orientativo; carpeta bajo `apps/psp-api/prisma/migrations/`).
- `Merchant`: `api_key_expires_at`, `api_key_revoked_at` (nullable). Sin TTL en create = key sin fecha de caducidad.
- `WebhookDelivery`: `scheduled_at` (default `now`) e índice compuesto `@@index([status, scheduledAt])` para el polling del worker.

**API keys — comportamiento**

- **Guard:** mensaje genérico `401 Unauthorized` (sin filtrar si falla hash, expiración o revocación).
- **Rotar (`rotate-key`):** nueva key en claro en la respuesta (una sola vez); actualiza hash y opcionalmente `apiKeyExpiresAt`; pone `apiKeyRevokedAt` en `null` para la nueva credencial activa.
- **Revocar (`revoke-key`):** marca `apiKeyRevokedAt` y bloquea el comercio hasta que alguien llame a `rotate-key` (no emite key nueva al revocar).
- **DTO:** `CreateMerchantDto` incluye `keyTtlDays` opcional (1–3650). `rotate-key` admite body opcional con el mismo concepto.

**Webhooks — comportamiento**

- **`deliver()`:** si no hay `webhookUrl`, sigue siendo `skipped` y no escribe fila. Si hay URL, crea fila `pending` y retorna de inmediato (el HTTP al merchant ya no bloquea la respuesta del API).
- **Worker:** `WebhooksService` implementa `OnModuleInit` / `OnModuleDestroy`; intervalo ~5 s; hasta 50 filas por tick; hasta 3 intentos de entrega HTTP; backoff exponencial (base 2 s, luego 4 s, 8 s) vía `scheduledAt` manteniendo `status: 'pending'` entre reintentos.
- **Retry interno (`POST .../deliveries/:id/retry`):** solo resetea la fila fallida a `pending` y limpia contadores para que el worker la procese; la respuesta ya no refleja el resultado HTTP inmediato (operación asíncrona).

**Código y tests**

- Archivos principales: `merchants.service.ts`, `merchants.controller.ts`, `create-merchant.dto.ts`, `api-key.guard.ts`, `webhooks.service.ts`, `webhooks.service.spec.ts`, `api-key.guard.spec.ts`.
- Suite de tests y lint pasan en local (`npm test`, `npm run lint` en `apps/psp-api`).

**Documentación**

- El **README** de `apps/psp-api` aún describe webhooks en términos cercanos al modelo síncrono anterior; conviene alinearlo con cola + worker y con los endpoints de keys (véase siguientes pasos).

### Siguientes pasos (compañero)

- Aplicar migración en entornos compartidos: `npx prisma migrate deploy` en `apps/psp-api` y `npx prisma generate` si el cliente quedó desfasado (cerrar procesos Node que bloqueen el DLL en Windows).
- Actualizar **README** de `apps/psp-api` con: TTL/`keyTtlDays`, ejemplos PowerShell de `rotate-key` / `revoke-key`, y sección explícita de webhooks en background (intervalo ~5 s, hasta 3 intentos, backoff; `deliver()` devuelve `pending` al encolar; retry operativo = reencolar).
- Tras merge: comprobar **CI** (`.github/workflows/psp-api-ci.yml`) y, en soporte/ops, recordar que `POST .../webhooks/deliveries/:id/retry` no hace el `fetch` en la misma petición HTTP del cliente.
