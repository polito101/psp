# PSP API (Orchestrator V2)

Servicio NestJS backend-first para orquestacion de pagos.  
La superficie operativa principal es `POST/GET /api/v2/payments*`.

## Requisitos

- **Node.js 22** (recomendado) o **>= 20.19** (minimo soportado por Prisma ORM 7).
- Docker (PostgreSQL + Redis) o credenciales propias.

## Base de datos y Prisma ORM 7

Este proyecto usa **Prisma ORM 7**. El cliente se genera en `src/generated/prisma/` (TypeScript, compilado luego a `dist/generated/prisma/`).

- `prisma.config.ts` define `schema`, ruta de migraciones y `DATABASE_URL` para la CLI.
- Tras `npm ci` (o clone limpio), ejecuta `npx prisma generate` antes de `build/lint/start`.
- `npm run prisma:migrate` y `npm run prisma:migrate:deploy` ejecutan migraciones y luego `prisma generate`.
- En Windows, si `prisma generate` falla por bloqueo de archivo (EPERM), cierra procesos Node y reintenta.

## Arranque local

```bash
# Desde la raiz del repo
docker compose up -d

cd apps/psp-api
cp .env.example .env
# Ajusta DATABASE_URL, INTERNAL_API_SECRET y APP_ENCRYPTION_KEY

npm run prisma:migrate:deploy
npm run start:dev
```

Manual equivalente:

```bash
npx prisma migrate deploy
npx prisma generate
npm run start:dev
```

- Swagger: `http://localhost:3000/api/docs`
- Health: `http://localhost:3000/health`

## Quickstart sandbox (v2)

### 1) Crear merchant (bootstrap interno, v1)

PowerShell:

```powershell
$internalSecret = $env:INTERNAL_API_SECRET
# Si no lo tienes exportado en la shell, pégalo desde tu `.env`:
# $internalSecret = "PEGAR_INTERNAL_API_SECRET_DE_.env"

Invoke-RestMethod -Method Post "http://localhost:3000/api/v1/merchants" `
  -Headers @{ "Content-Type"="application/json"; "X-Internal-Secret"=$internalSecret } `
  -Body '{"name":"Demo","keyTtlDays":90}'
```

Nota: el onboarding operativo (`/api/v1/merchants`) es interno y sigue en v1; el flujo principal de pagos es v2 (`/api/v2/payments*`).

Guarda `apiKey` y `webhookSecret`.

### 2) Crear payment intent v2

PowerShell:

```powershell
$idem = [guid]::NewGuid().ToString()
Invoke-RestMethod -Method Post "http://localhost:3000/api/v2/payments" `
  -Headers @{
    "X-API-Key"="PEGAR_APIKEY_COMERCIO"
    "Content-Type"="application/json"
    "Idempotency-Key"=$idem
  } `
  -Body (@{
    amountMinor = 1999
    currency = "EUR"
    provider = "mock"
  } | ConvertTo-Json -Compress)
```

En `mock`, el intent tipicamente queda `authorized` para importes comunes.

### 3) Capturar

```powershell
Invoke-RestMethod -Method Post "http://localhost:3000/api/v2/payments/PEGAR_PAYMENT_ID/capture" `
  -Headers @{ "X-API-Key"="PEGAR_APIKEY_COMERCIO" }
```

### 4) Verificar estado y balance

```powershell
Invoke-RestMethod -Method Get "http://localhost:3000/api/v2/payments/PEGAR_PAYMENT_ID" `
  -Headers @{ "X-API-Key"="psp.cmo15b24p0034jwkgwrr2irqg.AtB4R56D4wroVnxBjEIqFa1PFSaLCl_1cVMNDu6V93E" }

Invoke-RestMethod -Method Get "http://localhost:3000/api/v1/balance" `
  -Headers @{ "X-API-Key"="PEGAR_APIKEY_COMERCIO" }
```

## Endpoints principales

- `POST /api/v2/payments` (create intent)
- `GET /api/v2/payments/{id}` (incluye attempts)
- `POST /api/v2/payments/{id}/capture`
- `POST /api/v2/payments/{id}/cancel`
- `POST /api/v2/payments/{id}/refund`
- `GET /api/v2/payments/ops/metrics` (interno, requiere `X-Internal-Secret`; incluye payments/circuit breakers/webhooks)
- `POST /api/v1/stripe/webhook` (inbound Stripe, valida `Stripe-Signature`)

## Idempotencia (v2)

- `Idempotency-Key` es opcional en operaciones de v2.
- Maximo 256 caracteres, charset `[A-Za-z0-9._:-]`.
- Misma key + mismo payload => respuesta idempotente.
- Misma key + payload distinto => `409 Conflict`.

## API keys (seguridad)

- Formato: `psp.<merchantId>.<secret>`.
- Guard responde `401 Unauthorized` de forma uniforme.
- `POST /api/v1/merchants` acepta `keyTtlDays` (1-3650).
- Endpoints internos:
  - `POST /api/v1/merchants/:id/rotate-key`
  - `POST /api/v1/merchants/:id/revoke-key`

## Webhooks

- En `capture/refund`, el evento se encola en `webhook_deliveries` y un worker lo entrega en background.
- Reintentos automaticos con backoff (hasta 3 intentos).
- Worker controlable por `WEBHOOK_WORKER_ENABLED` (`false` desactiva procesamiento en esa réplica).
- Retry operativo:
  - `POST /api/v1/webhooks/deliveries/{id}/retry` (requiere `X-Internal-Secret`)
- Inbound Stripe:
  - `POST /api/v1/stripe/webhook` valida `Stripe-Signature` con `STRIPE_WEBHOOK_SECRET`.
  - Eventos soportados: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`.
  - Prueba local con Stripe CLI:
    - `stripe listen --forward-to http://localhost:3000/api/v1/stripe/webhook`
    - usar el `whsec_...` mostrado por CLI en `STRIPE_WEBHOOK_SECRET`.

## Troubleshooting rapido

- `401` en `/merchants`: revisa `INTERNAL_API_SECRET` y reinicia API tras cambiar `.env`.
- `401` en v2: verifica `X-API-Key` real del merchant.
- `409` por idempotencia: usa nueva `Idempotency-Key` para nueva intencion.
- `429`: reduce rafagas y reintenta con backoff.
- Error TS `Cannot find module ../generated/prisma/client`: ejecuta `npx prisma generate`.

## Rate limiting

- Throttling global activo.
- Límite especifico:
  - `POST /api/v2/payments`: 30 requests / 60s.

## Docker (sandbox)

```bash
cd apps/psp-api
docker build -t psp-api:sandbox .

docker run --rm -p 3000:3000 \
  -e NODE_ENV=sandbox \
  -e DATABASE_URL="postgresql://psp:psp_dev_password@host.docker.internal:5433/psp?schema=public" \
  -e REDIS_URL="redis://host.docker.internal:6379" \
  -e INTERNAL_API_SECRET="replace-with-random-long-secret" \
  -e APP_ENCRYPTION_KEY="replace-with-random-32-plus-chars" \
  -e ENABLE_SWAGGER="true" \
  -e CORS_ALLOWED_ORIGINS="http://localhost:3000" \
  psp-api:sandbox
```

## CI

Workflow: `.github/workflows/ci.yml`

- `api-ci`: `npm ci` -> `prisma generate` -> `prisma migrate deploy` -> `lint` -> `test` -> `build`.
- `sandbox-deploy` (branch `sandbox`): build Docker de validación, `prisma migrate deploy`, deploy hook, readiness (`/health` con `status=ok`, `db=ok`, `redis=ok`), gate operativo (`/api/v2/payments/ops/metrics`) y smoke tests.
- Smoke Stripe opcional en sandbox (`test:smoke:stripe`) si existen secretos `SANDBOX_SMOKE_API_KEY_STRIPE` y `SANDBOX_STRIPE_PAYMENT_METHOD_ID`.
- Política de rollout sandbox: mantener migraciones backward-compatible para la ventana entre migración y despliegue efectivo de la nueva revisión.
- Rollout productivo recomendado: ver `docs/production-canary-rollout.md`.

## Variables

Ver `.env.example`. Claves relevantes:

- `DATABASE_URL`
- `REDIS_URL`
- `INTERNAL_API_SECRET`
- `APP_ENCRYPTION_KEY` (>= 32 chars)
- `PAYMENTS_V2_ENABLED_MERCHANTS`
- `PAYMENTS_PROVIDER_ORDER`
- `PAYMENTS_PROVIDER_TIMEOUT_MS`
- `PAYMENTS_PROVIDER_MAX_RETRIES`
- `PAYMENTS_PROVIDER_CB_FAILURES`
- `PAYMENTS_PROVIDER_CB_COOLDOWN_MS`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_WEBHOOK_TOLERANCE_SEC`
- `WEBHOOK_WORKER_ENABLED`

Matriz operativa sandbox: `docs/sandbox-env.md`.

## Tests

```bash
npm run test
npm run test:integration
npm run test:integration:critical
npm run test:smoke:sandbox
npm run test:smoke:stripe
```
