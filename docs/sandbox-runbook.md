# Sandbox Runbook

## 1. Deploy estándar

1. Hacer merge a `sandbox`.
2. Verificar workflow `CI` en GitHub Actions.
3. Confirmar ejecución de (orden canónico):
   - Build de imagen Docker (`psp-api:sandbox`) como validación de build.
   - `Prisma migrate deploy` (antes de deploy hook, con migraciones backward-compatible).
   - Trigger de deploy (hook).
   - Readiness gate: `/health` con `status=ok`, `checks.db=ok`, `checks.redis=ok`.
   - Readiness gate operativo: `/api/v2/payments/ops/metrics` (webhooks backlog, circuit breakers, error rate por provider).
   - `test:smoke:sandbox`.
   - `test:smoke:stripe` (opcional, cuando existan secretos Stripe de smoke).

## 2. Rollback

1. Revertir commit en `sandbox`.
2. Re-disparar pipeline.
3. Validar `/health` y smoke tests.

Si la migración de DB fue no compatible hacia atrás, aplicar rollback de esquema según política de migraciones (evitar cambios destructivos en sandbox compartido sin ventana de coordinación).

## 3. Rotación de secretos

- Secretos críticos:
  - `INTERNAL_API_SECRET`
  - `APP_ENCRYPTION_KEY`
  - credenciales en `DATABASE_URL`
  - credenciales en `REDIS_URL`
- Pasos:
  1. actualizar secreto en environment `sandbox`,
  2. redeploy,
  3. validar health + smoke.

### 3.1 Notas operativas de rotación

- `INTERNAL_API_SECRET`: cualquier valor previo deja de servir inmediatamente para endpoints internos.
- API keys de merchant:
  - `POST /api/v1/merchants/:id/rotate-key` invalida la key anterior al instante.
  - `POST /api/v1/merchants/:id/revoke-key` deja al merchant sin key activa hasta nueva rotación.
- `APP_ENCRYPTION_KEY`: rotación sin plan de re-cifrado puede romper decrypt de secretos existentes (webhooks). Coordinar ventana y validación post-rotación.

## 4. Diagnóstico rápido

- `401` generalizado: revisar `INTERNAL_API_SECRET` y `X-API-Key`.
- `500` en arranque: validar `DATABASE_URL` / `APP_ENCRYPTION_KEY`.
- `health` degradado: revisar conectividad de Redis o PostgreSQL.
- Smoke fallando en `merchants`: validar secreto interno y CORS/origen si aplica frontend.
- Cola de webhooks creciendo: consultar snapshot interno `GET /api/v2/payments/ops/metrics` con `X-Internal-Secret`.
- Lock/circuit breaker de proveedor: revisar `payments.circuitBreakers` y errores `payments_v2.circuit_opened` en logs.
- Tasa de fallo por provider: revisar `payments` en `ops/metrics` (successRate/attemptPersistFailed por operación).

## 5. Worker de webhooks

- `WEBHOOK_WORKER_ENABLED`:
  - omitida o `true`: worker activo.
  - `false`: instancia API sin worker.
- En despliegue con múltiples réplicas, preferir una réplica con worker activo y el resto con worker desactivado.
- Retry manual disponible en `POST /api/v1/webhooks/deliveries/:id/retry` para `failed` y `processing` atascada.

## 6. Evidencias mínimas por release

- URL del workflow exitoso.
- Hora de deploy.
- Resultado de smoke tests.
- Resultado de readiness operativo (`ops/metrics`).
- Responsable de aprobación interna.
