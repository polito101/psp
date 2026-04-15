# Production Canary Rollout (Payments V2)

## Objetivo

Activar `payments-v2` en producción de forma gradual y reversible, con observabilidad explícita por provider y gates automáticos de salud operativa.

## Precondiciones

- `PAYMENTS_PROVIDER_ORDER=stripe` en producción (sin `mock`).
- `PAYMENTS_V2_ENABLED_MERCHANTS` inicializado con una lista mínima de merchants canary.
- Secrets de Stripe productivos validados (`STRIPE_SECRET_KEY`) y `STRIPE_API_BASE_URL` en valor seguro por defecto.
- Runbook de incidentes actualizado y ownership on-call definido.

## Plantilla operativa previa al canary (rellenar antes de activar)

- **Merchants canary iniciales (1-2):** `<merchantId1>, <merchantId2>`
- **Ventana de observación fase 1:** `<inicio UTC> -> <fin UTC>`
- **SLO de promoción acordado:**
  - `health`: `status=ok`, `db=ok`, `redis=ok` sostenido.
  - `circuitBreakers`: sin `open` sostenido.
  - `webhooks`: `pending <= 40`, `processing <= 20`, `failed <= 10`, `oldestPendingAgeMs <= 180000`.
  - `payments`: con `total >= 20`, `failRate <= 0.35` por provider/operación.
- **Dueño técnico on-call:** `<nombre>`
- **Aprobador go/no-go:** `<nombre>`

## Fases de activación

1. **Canary cerrado (1-2 merchants)**
   - Agregar merchants piloto a `PAYMENTS_V2_ENABLED_MERCHANTS`.
   - Monitorear durante una ventana fija (por ejemplo 24h):
     - `payments` en `/api/v2/payments/ops/metrics` (successRate y retries).
     - `circuitBreakers` (ninguno en `open` sostenido).
     - `webhooks.counts` y `oldestPendingAgeMs`.

2. **Canary ampliado (5-10 merchants)**
   - Extender allowlist de merchants.
   - Repetir validación de métricas y revisar tendencias de decline/refund vs baseline.

3. **Rollout general**
   - Migrar `PAYMENTS_V2_ENABLED_MERCHANTS` a cobertura total planificada.
   - Mantener guardrails de métricas en CI/CD y alerting de producción.

## Gates de promoción entre fases

- `health` verde (`status=ok`, `db=ok`, `redis=ok`).
- Sin circuit breakers abiertos de forma sostenida.
- Backlog webhook bajo umbral operativo.
- Tasa de fallo por provider/operación dentro de SLO acordado.

## Fallback y contención

Si Stripe degrada o se abre circuit breaker de forma sostenida:

1. **Contención inmediata**
   - Congelar avance de rollout.
   - Reducir allowlist en `PAYMENTS_V2_ENABLED_MERCHANTS` al último grupo estable.

2. **Mitigación funcional**
   - Pausar creación de nuevos intents para merchants afectados si la tasa de fallo supera umbral de negocio.
   - Mantener capacidad de consulta/operaciones seguras sobre pagos ya creados.

3. **Recuperación**
   - Verificar recuperación de métricas (fallo/rate limit/latencia) durante una ventana estable.
   - Reanudar rollout en incrementos pequeños.

## Rollback

- Revertir configuración a última release estable.
- Confirmar recuperación con:
  - `health`
  - `ops/metrics`
  - smoke de sandbox/preprod antes de reintentar promoción.

## Evidencias por cambio de fase

- Commit/config aplicada.
- Ventana temporal observada.
- Snapshot de métricas y decisión (go/no-go).
- Responsable técnico que aprobó.

### Formato mínimo de evidencia (copiar/pegar por fase)

```md
## Fase <cerrado|ampliado|general> - <fecha>

- Config aplicada: `<commit/config>`
- Merchants habilitados: `<lista>`
- Ventana observada: `<inicio UTC> -> <fin UTC>`
- Snapshot health: `<ok|no>`
- Snapshot ops metrics:
  - circuitBreakers abiertos: `<ninguno|detalle>`
  - webhooks pending/processing/failed/oldestMs: `<valores>`
  - failRate por provider/operación (si total>=20): `<valores>`
- Decisión: `<GO|NO-GO>`
- Responsable: `<nombre>`
```
