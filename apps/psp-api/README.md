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
# Ajusta INTERNAL_API_SECRET y APP_ENCRYPTION_KEY (DATABASE_URL del .env.example ya usa el puerto del compose: Postgres en localhost:5433)

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

Contrato recomendado (importe **decimal** + `customer` + URLs de ciclo de vida). En alta por API interna, el merchant recibe tarifas por defecto solo en **EUR**; usa `currency: EUR` en create hasta tener `MerchantRateTable` para otras divisas.

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
    amount = 19.99
    currency = "EUR"
    channel = "ONLINE"
    language = "EN"
    orderId = "smoke-order-1"
    description = "Demo payment"
    notificationUrl = "https://example.com/webhook"
    returnUrl = "https://example.com/success"
    cancelUrl = "https://example.com/failure"
    customer = @{
      firstName = "Ada"
      lastName = "Lovelace"
      email = "ada@example.com"
      country = "ES"
    }
  } | ConvertTo-Json -Depth 6 -Compress)
```

El proveedor lo elige el PSP vía `PAYMENTS_PROVIDER_ORDER` en runtime (p. ej. `mock` en local/sandbox). Las tablas `payment_provider_configs` / `payment_method_routes` / `merchant_provider_rates` preparan **enrutado por peso** y tarifas por proveedor–país; el script `npm run demo:backoffice-payments` puede sembrarlas con `DATABASE_URL` (migración `20260506120000_dynamic_payment_routing_config`).

`POST /api/v2/payments` solo acepta el contrato vigente (`CreatePaymentIntentDto`): importe **`amount` en decimal** (unidad principal) + **`currency`** ISO 4217 entre los demás campos requeridos. No existe variante de cuerpo con `amountMinor` en ese endpoint; cualquier propiedad no declarada en el DTO (p. ej. `amountMinor`) la rechaza la validación global (`whitelist` + `forbidNonWhitelisted` en `main.ts`), típicamente con **400**.

La conversión `amount` → unidades menores sigue **`src/payments-v2/decimal-amount-to-minor.ts`**: para la mayoría de divisas se usan dos decimales (p. ej. EUR/USD); hay divisas sin fracción (p. ej. JPY) y otras con tres decimales (p. ej. KWD). El minor resultante debe ser **≥ 1** y no superar el tope **INTEGER/INT32** del modelo (`2_147_483_647`); fuera de eso la API responde **400**.

En `mock`, el intent tipicamente queda `authorized` para importes comunes (p. ej. `19.99` EUR → 1999 minor; `20.02` EUR dispara `requires_action`).

**Notificaciones al comercio (importante separar rutas):**
- **`notificationUrl` del create v2:** se persiste en `Payment.notification_url` como URL declarativa (validación al create alineada con las mismas reglas estructurales que el **reenvío** salvo la parte DNS, que solo aplica justo antes del `fetch`). Sandbox/no prod: `http` solo en loopback salvo **`PSP_ALLOW_HTTP_MERCHANT_CALLBACKS=true`**. Hoy sirve sobre todo para extensiones del motor y para el **`POST .../ops/payments/:paymentId/notifications/:deliveryId/resend`** (solo **admin** en ops/backoffice), que hace un `POST` **server-side** con carga enmascarada: HTTPS público en producción; sin credenciales en URL; comprobación de rangos no públicos en IPs literales **y** resolución DNS previa al outbound; lectura del cuerpo de respuesta acotada antes de persistir metadatos; **`fetch`** sin seguir redirects automáticos (`redirect: 'manual'`).
- **Webhooks de negocio (post-capture / refund):** siguen siendo la cola clásica `webhook_deliveries` contra `merchant.webhookUrl` gestionada por `WebhooksService` (véase § **Webhooks** más abajo), **no** un `POST` automático a `notificationUrl` tras cada cambio de estado hasta que exista un pipeline explícito.
- **`PaymentNotificationDelivery`:** audita intentos relacionados con la notificación (p. ej. reenvíos manuales) cuando proceda; puede estar vacío en pagos solo con webhooks hasta que se registren dichas operaciones.

El detalle ops y el backoffice muestran el historial cuando haya datos (máscaras, sin ciphertext bruto por BFF donde aplique).

### 3) Capturar

```powershell
Invoke-RestMethod -Method Post "http://localhost:3000/api/v2/payments/PEGAR_PAYMENT_ID/capture" `
  -Headers @{ "X-API-Key"="PEGAR_APIKEY_COMERCIO" }
```

### 4) Verificar estado y balance

```powershell
Invoke-RestMethod -Method Get "http://localhost:3000/api/v2/payments/PEGAR_PAYMENT_ID" `
  -Headers @{ "X-API-Key"="PEGAR_APIKEY_COMERCIO" }

Invoke-RestMethod -Method Get "http://localhost:3000/api/v1/balance" `
  -Headers @{ "X-API-Key"="PEGAR_APIKEY_COMERCIO" }
```

## Merchant onboarding (captacion publica + CRM)

Superficie versionada bajo `/api/v1/merchant-onboarding/*`: alta desde landing (`POST .../applications`), validacion de token y envio de perfil de negocio. Email transaccional vía **Resend** (`RESEND_API_KEY`, `ONBOARDING_EMAIL_FROM`); enlaces construidos con `MERCHANT_ONBOARDING_BASE_URL` (debe apuntar al host donde existe `/onboarding/[token]` en el backoffice).

Ejemplo local (sin API key; body validado con `class-validator`):

```powershell
Invoke-RestMethod -Method Post "http://localhost:3000/api/v1/merchant-onboarding/applications" `
  -Headers @{ "Content-Type"="application/json" } `
  -Body '{"name":"Demo Merchant","email":"demo@example.com","phone":"+34600000000"}'
```

En `development` y `sandbox`, la respuesta puede incluir `onboardingUrl` para pruebas; en produccion no se expone en JSON (solo email). Estado vivo del modulo: `docs/crm-status.md`.

## Endpoints principales

- `POST /api/v2/payments` (create intent)
- `GET /api/v2/payments/{id}` (incluye attempts)
- `POST /api/v2/payments/{id}/capture`
- `POST /api/v2/payments/{id}/cancel`
- `POST /api/v2/payments/{id}/refund`
- `GET /api/v2/payments/ops/metrics` (interno, requiere `X-Internal-Secret` y `X-Backoffice-Role: admin|merchant`; incluye payments/circuit breakers/webhooks)

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
- Tras un reverse proxy que envía la IP del cliente en `X-Forwarded-For` / `X-Real-IP` (p. ej. `web-finara` → `psp-api`), configura `TRUST_PROXY=true` en la API para que el límite sea por visitante y no por la IP del proxy.

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
- `WEBHOOK_WORKER_ENABLED`
- `MERCHANT_ONBOARDING_BASE_URL`, `MERCHANT_ONBOARDING_TOKEN_TTL_HOURS`
- `RESEND_API_KEY`, `ONBOARDING_EMAIL_FROM`

Matriz operativa sandbox: `docs/sandbox-env.md`.

## Tests

```bash
npm run test
npm run test:integration
npm run test:integration:critical
npm run test:smoke:sandbox
npm run test:smoke:backoffice-demo
```

Para **poblar transacciones de demo** visibles en el backoffice (misma API/DB), con `SMOKE_BASE_URL` o `DEMO_API_BASE_URL` y `INTERNAL_API_SECRET` apuntando al entorno:

```bash
npm run demo:backoffice-payments
```

Volumen aleatorio adicional (40–10 000 flujos create+capture por defecto), mismas variables + `--bulk-random` o `DEMO_BULK_RANDOM=true`; opcional `--bulk-only`. Ver cabecera del script `scripts/demo/create-backoffice-demo-payments.mjs`.

Para **volumen** (por defecto ≥60 `succeeded` y muestras en `canceled` / `refunded` / `requires_action` / `authorized`), con las mismas variables:

```bash
npm run test:smoke:backoffice-demo
```

Ver detalle en `BACKOFFICE_CONTEXT.md` (sección datos de prueba).
