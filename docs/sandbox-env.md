# Sandbox Env Matrix

## Objetivo

Fuente de verdad operativa de variables para el entorno `sandbox` de `apps/psp-api`.

## Variables requeridas para deploy CI (`sandbox-deploy`)

| Variable | Requerida | Dónde vive | Uso principal | Rotación/Notas |
| --- | --- | --- | --- | --- |
| `SANDBOX_DATABASE_URL` | Sí | GitHub Secret (`environment: sandbox`) | `prisma migrate deploy` y runtime DB | Rotar con coordinación de acceso y prueba de migraciones |
| `SANDBOX_REDIS_URL` | Sí | GitHub Secret (`environment: sandbox`) | idempotencia/operación y health | Rotar verificando `checks.redis=ok` en readiness |
| `SANDBOX_INTERNAL_API_SECRET` | Sí | GitHub Secret (`environment: sandbox`) | endpoints internos (`X-Internal-Secret`) y smoke bootstrap | Rotación inmediata: invalida secreto anterior |
| `SANDBOX_APP_ENCRYPTION_KEY` | Sí | GitHub Secret (`environment: sandbox`) | cifrado/descifrado secretos webhook | >= 32 chars; rotación requiere plan de re-cifrado o validación exhaustiva |
| `SANDBOX_DEPLOY_HOOK_URL` | Sí | GitHub Secret (`environment: sandbox`) | disparar deploy remoto | Debe responder HTTP 2xx |
| `SANDBOX_BASE_URL` | Sí | GitHub Variable (`environment: sandbox`) | readiness y smoke (`SMOKE_BASE_URL`) | URL base pública del servicio sandbox |
| `SANDBOX_SMOKE_API_KEY_STRIPE` | Opcional | GitHub Secret (`environment: sandbox`) | smoke Stripe end-to-end sin bootstrap por ejecución | Merchant dedicado para pruebas Stripe |
| `SANDBOX_STRIPE_PAYMENT_METHOD_ID` | Opcional | GitHub Secret (`environment: sandbox`) | método de pago Stripe para create+confirm/capture (`pm_card_visa` recomendado) | usar valor de test mode |

## Variables runtime de `apps/psp-api`

| Variable | Requerida en sandbox | Referencia | Notas |
| --- | --- | --- | --- |
| `NODE_ENV` | Sí | `.env`/runtime | usar `sandbox` |
| `DATABASE_URL` | Sí | `.env`/runtime | misma base usada por migraciones |
| `REDIS_URL` | Sí | `.env`/runtime | validada en bootstrap para sandbox |
| `INTERNAL_API_SECRET` | Sí | `.env`/runtime | no usar placeholder |
| `APP_ENCRYPTION_KEY` | Sí | `.env`/runtime | mínimo 32 caracteres |
| `CORS_ALLOWED_ORIGINS` | Recomendado | `.env`/runtime | definir explícitamente en sandbox compartido |
| `ENABLE_SWAGGER` | Recomendado | `.env`/runtime | habilitar solo cuando proceda operativamente |
| `WEBHOOK_WORKER_ENABLED` | Opcional | `.env`/runtime | `false` desactiva worker en la réplica |
| `PAYMENTS_V2_ENABLED_MERCHANTS` | Sí | `.env`/runtime | `*` para sandbox general |
| `PAYMENTS_PROVIDER_ORDER` | Sí | `.env`/runtime | fallback de proveedores |

## Variables smoke test

| Variable | Requerida | Notas |
| --- | --- | --- |
| `SMOKE_BASE_URL` | Sí | inyectada por CI desde `SANDBOX_BASE_URL` |
| `SMOKE_INTERNAL_API_SECRET` | Opcional | si no existe, usa `INTERNAL_API_SECRET` |
| `SMOKE_API_KEY` | Opcional | si existe, evita crear merchant por ejecución |
| `SMOKE_PAYMENT_AMOUNT_MINOR` | Opcional | default `1999` para flujo mock |
| `SMOKE_REQUIRES_ACTION_AMOUNT_MINOR` | Opcional | default `2002` para ruta `requires_action` en provider `mock` |
| `SMOKE_STRIPE_ENABLED` | Opcional | habilita suite `stripe.smoke.spec.ts` |
| `SMOKE_STRIPE_PAYMENT_METHOD_ID` | Opcional | default `pm_card_visa` para create+confirm Stripe |
| `SMOKE_STRIPE_CREATE_AMOUNT_MINOR` | Opcional | default `1999` para create Stripe sin confirm |
| `SMOKE_STRIPE_CONFIRM_AMOUNT_MINOR` | Opcional | default `2101` para create+confirm Stripe |

## Variables de readiness operativa (`ops/metrics`)

Todas son opcionales (con default en script CI `scripts/ci/check-ops-metrics.mjs`):

- `READINESS_MAX_WEBHOOK_PENDING` (default `200`)
- `READINESS_MAX_WEBHOOK_PROCESSING` (default `100`)
- `READINESS_MAX_WEBHOOK_FAILED` (default `100`)
- `READINESS_MAX_WEBHOOK_OLDEST_PENDING_MS` (default `300000`)
- `READINESS_MAX_ATTEMPT_PERSIST_FAILED` (default `10`)
- `READINESS_MIN_SAMPLES_FOR_FAIL_RATE` (default `10`)
- `READINESS_MAX_PROVIDER_FAIL_RATE` (default `0.8`)
- `READINESS_ALLOWED_OPEN_CIRCUITS` (CSV opcional de proveedores permitidos temporalmente en estado open)

## Checklist rápido de validación

1. `sandbox-deploy` verde en GitHub Actions.
2. Readiness gate con `status=ok`, `db=ok`, `redis=ok`.
3. `npm run test:smoke:sandbox` en verde.
