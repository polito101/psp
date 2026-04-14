# PROJECT_CONTEXT

Ultima actualizacion: 2026-04-14

## 1) Resumen del proyecto

Repositorio backend-first de un PSP (pasarela de pagos), con API principal en `apps/psp-api`.

La API esta construida con NestJS y expone REST versionado por URI bajo `/api/v1`, con foco en flujo sandbox fiat:
- onboarding de merchants
- creacion de payment links
- creacion/captura de pagos con idempotencia
- ledger/balance
- webhooks asincronos
- checkout y health checks

Ademas del servicio API, el repo incluye:
- infraestructura en `infra/terraform`
- entorno local con PostgreSQL + Redis via `docker-compose.yml`
- documentacion operativa en `docs/` y `apps/psp-api/README.md`

## 2) Stack tecnologico

- Runtime: Node.js LTS (README/CI recomiendan Node 22)
- Lenguaje: TypeScript estricto (`noImplicitAny`, `strictNullChecks`)
- Framework backend: NestJS 11
- ORM/acceso a datos: Prisma ORM 7 + `@prisma/adapter-pg` + `pg`
- Base de datos principal: PostgreSQL
- Cache/soporte operativo: Redis (`ioredis`)
- Seguridad y hardening: `helmet`, CORS, throttling global
- Validacion de entrada: `class-validator` + `class-transformer`
- Documentacion API: Swagger (`@nestjs/swagger`)
- Testing: Jest + ts-jest
- CI/CD: GitHub Actions (`.github/workflows/ci.yml`) + deploy sandbox por hook

## 3) Estructura principal de carpetas

```text
C:/AA psp/
├── .cursor/
│   └── rules/
├── .github/
│   └── workflows/
├── apps/
│   └── psp-api/
│       ├── prisma/
│       │   ├── schema.prisma
│       │   └── migrations/
│       ├── scripts/
│       ├── test/
│       │   └── smoke/
│       ├── src/
│       │   ├── main.ts
│       │   ├── app.module.ts
│       │   ├── common/
│       │   │   ├── decorators/
│       │   │   ├── guards/
│       │   │   └── interceptors/
│       │   ├── prisma/
│       │   ├── redis/
│       │   ├── merchants/
│       │   ├── payment-links/
│       │   ├── payments/
│       │   ├── ledger/
│       │   ├── webhooks/
│       │   ├── checkout/
│       │   ├── health/
│       │   ├── crypto/
│       │   └── generated/   (salida de prisma generate)
│       ├── package.json
│       ├── Dockerfile
│       ├── .dockerignore
│       ├── jest.smoke.config.js
│       ├── prisma.config.ts
│       ├── nest-cli.json
│       └── README.md
├── docs/
├── infra/
│   └── terraform/
├── docker-compose.yml
├── package.json
├── PROJECT_CONTEXT.md
├── JOURNAL.md
└── prisma_migration_v7
```

En `.cursor/rules/` conviven `project-context.mdc`, `vibecoding-master.mdc` y **`agent-behavior.mdc`**: guías de comportamiento del agente (aclarar supuestos ante ambigüedad, simplicidad, cambios mínimos, criterios de éxito verificables).

## 4) Patrones de diseno y convenciones detectadas

- Arquitectura por dominio NestJS: cada dominio separa `module/controller/service/dto`.
- Controladores delgados y logica de negocio concentrada en servicios.
- Validacion global en `main.ts` con `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`).
- Validacion de entorno centralizada con `ConfigModule.forRoot({ validate })` para fail-fast en bootstrap.
- Prefijo global `api` + versionado URI en v1.
- Guardias reutilizables (`ApiKeyGuard`, `InternalSecretGuard`) y decorador `CurrentMerchant`.
- Prisma centralizado en `PrismaService` y cliente generado en `src/generated/prisma`.
- Convencion Prisma: modelos en PascalCase y mapeo SQL snake_case mediante `@map`/`@@map`.
- Modulo `RedisModule/RedisService` para responsabilidades de cache e idempotencia.
- Payments V2 (`/api/v2/payments`) introduce orquestacion multi-proveedor (Stripe + Mock) con `ProviderRegistry`, adapters por proveedor, retries acotados y circuit breaker basico por proveedor.
- Hardening providers: `PAYMENTS_PROVIDER_ORDER` se valida fail-fast (solo `stripe|mock`, sin vacíos, no puede quedar vacío). `mock` queda restringido a `NODE_ENV=sandbox|development` salvo flag explícito `PAYMENTS_ALLOW_MOCK=true`.
- Contrato providers v2: `ProviderResult` es discriminado; si `status !== failed`, `providerPaymentId` es obligatorio. Guardrail en orquestador: si un provider retorna “éxito” sin id y el pago no tenía `providerRef`, se loggea `payments_v2.provider_success_missing_id` y se marca el pago como `failed` con `statusReason=provider_error` (nunca se fabrica `providerRef`).
- Hardening Stripe: `STRIPE_API_BASE_URL` se valida fail-fast y se normaliza a `https://api.stripe.com/v1` para evitar enviar el Bearer token a hosts arbitrarios por mala configuracion.
- Stripe create v2: sin `stripePaymentMethodId` el PI se crea con `automatic_payment_methods[enabled]=true` (sin `confirm`); la respuesta expone `nextAction` con `client_secret` (`confirm_with_stripe_js`) mientras el PI está `pending`. Con `stripePaymentMethodId` se envía `confirm=true` (y `stripeReturnUrl` opcional para redirects). `capture` solo admite pago en estado `authorized` (Stripe `requires_capture`). Repetición idempotente de `create` con Stripe en `pending`/`requires_action` hace GET al PI para devolver `client_secret`/`next_action` actualizados.
- El endpoint de observabilidad `GET /api/v2/payments/ops/metrics` es interno y se protege con `InternalSecretGuard` (`X-Internal-Secret`) para evitar exponer agregados globales por merchant API key.
- Nuevo modelo `PaymentAttempt` para trazabilidad por operacion/proveedor (`create/capture/cancel/refund`) con status, error taxonomy, latencia y payload de respuesta.
- `PaymentAttempt.attemptNo` se asigna de forma atomica con `MAX(attemptNo)+1` dentro de transaccion serializable y retry para `P2002`/`P2034`, manteniendo `@@unique([paymentId, operation, attemptNo])`.
- Concurrencia en operaciones v2: `PaymentOperation` (lock por `paymentId+operation`) evita ejecutar dos veces `capture/refund/cancel` bajo carrera; la fila se crea/actualiza a `processing` y se marca `done` solo cuando `capture`/`cancel`/`refund` terminan **sin excepción** tras adquirir el lock. Errores inesperados (o fallo de proveedor en refund) eliminan la fila y, si hubo `Idempotency-Key` de operación, la clave Redis `payv2op:*`, para reintento inmediato — no se usa `finally` que marque `done` al propagar errores. `capture` y `cancel` validan ownership con `findMerchantPayment` **antes** de reclamar el lock (evita filas `done`/`processing` con `merchantId` erroneo que bloqueaban al dueño). En `claimPaymentOperation`, si el lock existente tiene `merchantId` distinto al solicitante, se elimina y se reintenta (log `payments_v2.operation_lock_merchant_mismatch`); en takeover por lock stale se reescribe `merchantId`. Con lock en `processing`, si llega otra peticion con `payloadHash` distinto (p. ej. otro monto en `refund`), se responde `409 Conflict` con metadata `{ message, paymentId, operation }` en lugar de `proceed: false` silencioso. Si el hash coincide y no es stale, se devuelve `proceed: false` (espera idempotente); si es stale, takeover con CAS (`updateMany` con `status: processing`, mismo `payloadHash`, `processingAt` anterior al umbral stale); solo una peticion obtiene `count===1`; si `count===0` se reintenta el bucle (otra peticion renovo el lock).
- Refund v2: si el proveedor devuelve `failed` (o se agota el orden sin proveedor usable), el pago **permanece** `succeeded`; no se toca `statusReason`/`failedAt` del pago salvo actualizar `lastAttemptAt`/`selectedProvider`. La API responde `409 Conflict` con `{ message, paymentId, reasonCode }`; se elimina la fila `PaymentOperation` de refund y, si hubo `Idempotency-Key`, la clave Redis `payv2op:*` correspondiente, para permitir reintento. El detalle del fallo sigue en `PaymentAttempt` y métricas.
- Robustez adapter v2: throws en `getProvider`/`adapter.run` se convierten a `ProviderResult` FAILED (`provider_error`), con `transientError` heurístico (p. ej. `TypeError`/`SyntaxError` sin reintento; `ECONNRESET`/etc. transitorio); se persisten intentos, métricas y reglas de circuit breaker igual que fallos normales.
- Rollout progresivo de Payments V2 por merchant con feature flag de entorno `PAYMENTS_V2_ENABLED_MERCHANTS` (CSV o `*`).
- Idempotencia v2: cabecera `Idempotency-Key` opcional con máximo 256 caracteres y charset `[A-Za-z0-9._:-]`; inválida → `400` con mensaje `Invalid Idempotency-Key`. En Redis, claves `payv2:*` y `payv2op:*` usan sufijo `sha256(key)`; el valor canónico sigue en `Payment.idempotencyKey` para unicidad y comparación de payload.
- Webhooks outbox: en el claim atomico `pending → processing` se escribe `scheduledAt = now` como inicio de procesamiento. El reintento operativo (`POST .../deliveries/:id/retry`) acepta `failed` siempre y `processing` solo si ese `scheduledAt` es anterior a `FETCH_TIMEOUT_MS + 5s` (fila atascada), para no reencolar durante un `fetch` activo ni duplicar POST al merchant.
- Swagger condicionado por `ENABLE_SWAGGER`; CORS por `CORS_ALLOWED_ORIGINS` (obligatorio en `production`; en dev/sandbox sin lista se usa `origin: true` como compatibilidad). Cada entrada se valida como URL http(s) sin path/query/hash y se normaliza a `URL.origin` (p. ej. barra final eliminada).
- Logs HTTP en JSON por petición (`HttpLoggingInterceptor` como `APP_INTERCEPTOR`): excluye `GET /health`; el campo `path` es plantilla (prioridad: Express `baseUrl`+`route.path`, si no metadata Nest `@Controller`/handler, si no redacción por prefijos sensibles bajo `/api/v1/pay/`, `/api/v1/payments/`, etc.); modo por env (`HTTP_LOG_MODE`: default `errors` en `production`, `all` en el resto; `sample`/`off`; `HTTP_LOG_SKIP_PATH_PREFIXES` con prefijos normalizados sin barra final) + prefijo por defecto `/api/v1/pay` en `sandbox`/`production` — esos prefijos omiten solo respuestas exitosas; 4xx/5xx se registran siempre. Guardrail activo: `"/"` en `HTTP_LOG_SKIP_PATH_PREFIXES` se ignora y genera `warn` al arranque para evitar un skip-all accidental de logs 2xx.
- Testing co-localizado por dominio (`*.spec.ts` junto al codigo del modulo).
- Smoke tests de sandbox en `test/smoke/sandbox.smoke.spec.ts`.

## 5) Estado actual (que estamos haciendo ahora)

- Se consolidó CI en `.github/workflows/ci.yml` (lint/test/build + deploy sandbox + migrate + health + smoke).
- Se agrego contenedorizacion de API (`Dockerfile`, `.dockerignore`) para ejecucion reproducible.
- Se agregaron documentos operativos para sandbox:
  - `docs/sandbox-env.md`
  - `docs/sandbox-runbook.md`
  - `docs/sandbox-go-live-checklist.md`
- Se agrego el dominio `payments-v2/` con contrato no retrocompatible para evolucionar de gateway simple a orquestador multi-proveedor.
- Se extendio `Payment` con campos de lifecycle de orquestacion (`selected_provider`, `status_reason`, timestamps por estado) y se incorporo `PaymentAttempt`.

## Regla de mantenimiento vivo (activo desde hoy)

Este archivo se actualiza en cada cambio estructural relevante, sin esperar pedido explicito, especialmente cuando haya:
- nueva dependencia clave
- nueva entidad/modelo o cambio relevante de schema
- nueva ruta principal o nuevo modulo de dominio
- decision de arquitectura transversal

Objetivo operativo: archivo breve, factual y alineado al estado real del codigo.
