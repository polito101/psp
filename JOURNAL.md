# Daily Async Log

## 2026-04-10

### 3 puntos clave

1. **Ciclo de vida de API keys:** Migración Prisma con `apiKeyExpiresAt` y `apiKeyRevokedAt` en `Merchant`; `ApiKeyGuard` rechaza keys revocadas o expiradas; `POST /api/v1/merchants` acepta `keyTtlDays` opcional; endpoints internos `POST .../merchants/:id/rotate-key` y `POST .../merchants/:id/revoke-key` (ambos con `X-Internal-Secret`).
2. **Webhooks asíncronos (cola en DB):** `WebhooksService.deliver()` solo encola filas `webhook_deliveries` en `pending` con `scheduledAt`; un worker por `setInterval` procesa, reintenta con backoff y marca `delivered`/`failed`; el retry operativo vuelve a poner el registro en `pending` para el worker.
3. **Corrección de contrato de `deliver()`:** El retorno tras encolar pasa a `status: 'pending'` (alineado con lo persistido), no `delivered`, para no sugerir entrega HTTP síncrona; tests actualizados en `webhooks.service.spec.ts` y `api-key.guard.spec.ts`.

### Siguientes pasos (compañero)

- Aplicar migración en entornos compartidos: `npx prisma migrate deploy` en `apps/psp-api` y `npx prisma generate` si el cliente quedó desfasado (cerrar procesos Node que bloqueen el DLL en Windows).
- Actualizar **README** de `apps/psp-api` con: TTL/`keyTtlDays`, rotate/revoke, y que los webhooks se entregan en background (intervalo ~5s, hasta 3 intentos, backoff; `deliver()` devuelve `pending` al encolar).
- Tras merge: comprobar **CI** (`.github/workflows/psp-api-ci.yml`) y, si hace falta operación, recordar que `POST .../webhooks/deliveries/:id/retry` ya no ejecuta el HTTP al instante, solo reencola.
