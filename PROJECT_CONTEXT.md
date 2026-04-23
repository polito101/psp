# PROJECT_CONTEXT

Ultima actualizacion: 2026-04-23

## 1) Resumen del proyecto

Repositorio backend-first de un PSP (pasarela de pagos), con API principal en `apps/psp-api`.

La API esta construida con NestJS y expone REST versionado por URI, con foco operativo en `/api/v2/payments` (orquestador):
- onboarding de merchants
- creacion de payment links
- create/capture/cancel/refund de pagos con idempotencia por operacion
- ledger/balance
- webhooks asincronos
- health checks

Ademas del servicio API, el repo incluye:
- panel administrativo Next.js en `apps/psp-backoffice` (detalle en **`apps/psp-backoffice/BACKOFFICE_CONTEXT.md`**; aqui solo el resumen operativo)
- infraestructura en `infra/terraform`
- entorno local con PostgreSQL + Redis via `docker-compose.yml` (Postgres expuesto en el host en **5433** para no chocar con un PostgreSQL local en 5432; credenciales `psp` / `psp_dev_password` / DB `psp`)
- documentacion operativa en `docs/` y `apps/psp-api/README.md`

## 2) Stack tecnologico

- Runtime: Node.js LTS (README/CI recomiendan Node 22)
- Lenguaje: TypeScript estricto (`noImplicitAny`, `strictNullChecks`)
- Framework backend: NestJS 11
- Framework frontend administrativo: Next.js 16 (App Router)
- ORM/acceso a datos: Prisma ORM 7 + `@prisma/adapter-pg` + `pg`
- Base de datos principal: PostgreSQL
- Cache/soporte operativo: Redis (`ioredis`)
- Seguridad y hardening: `helmet`, CORS, throttling global
- Validacion de entrada: `class-validator` + `class-transformer`
- Documentacion API: Swagger (`@nestjs/swagger`)
- UI backoffice: Tailwind CSS 4 + componentes estilo shadcn + TanStack Query/Table; acento de marca `--primary: #635bff` (panel demo); fuente principal Inter (`next/font`)
- Testing: Jest + ts-jest + Supertest (integration-local)
- CI/CD: GitHub Actions (`.github/workflows/ci.yml`) + deploy sandbox por hook

## 3) Estructura principal de carpetas

```text
C:/AA psp/
├── .cursor/
│   └── rules/
├── .github/
│   └── workflows/
├── apps/
│   ├── psp-api/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   ├── scripts/
│   │   ├── test/
│   │   │   ├── integration/
│   │   │   └── smoke/
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/
│   │   │   │   ├── decorators/
│   │   │   │   ├── guards/
│   │   │   │   └── interceptors/
│   │   │   ├── prisma/
│   │   │   ├── redis/
│   │   │   ├── merchants/
│   │   │   ├── payment-links/
│   │   │   ├── ledger/
│   │   │   ├── webhooks/
│   │   │   ├── payments-v2/
│   │   │   ├── health/
│   │   │   ├── crypto/
│   │   │   └── generated/   (salida de prisma generate)
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   ├── .dockerignore
│   │   ├── jest.smoke.config.js
│   │   ├── prisma.config.ts
│   │   ├── nest-cli.json
│   │   └── README.md
│   └── psp-backoffice/
│       ├── src/
│       │   ├── app/ (Next: `/`, `/transactions`, `/merchants/*`, `/operations`, `/monitor`, `/payments/[paymentId]`; BFF `/api/internal/*` incl. settlements y merchants ops)
│       │   ├── components/
│       │   └── lib/
│       ├── package.json
│       ├── components.json
│       ├── BACKOFFICE_CONTEXT.md   (SSOT del app backoffice)
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

- **npm (raíz):** el `package.json` de la raíz es solo metadatos (`private`, sin dependencias de aplicación). Las dependencias y sus `package-lock.json` viven en `apps/psp-api` y `apps/psp-backoffice`; la CI incluye `api-ci` y `sandbox-deploy` con `npm ci` desde `apps/psp-api/package-lock.json`, y **`backoffice-ci`** (lint, typecheck, test Vitest, build) con caché npm sobre `apps/psp-backoffice/package-lock.json`.

En `.cursor/rules/` conviven `project-context.mdc`, `vibecoding-master.mdc`, `testing-status.mdc`, **`psp-backoffice-context.mdc`** (al editar `apps/psp-backoffice/**`) y **`agent-behavior.mdc`**: guías de comportamiento del agente (aclarar supuestos ante ambigüedad, simplicidad, cambios mínimos, criterios de éxito verificables) y mantenimiento vivo de cobertura de tests.

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
- Payments V2 (`/api/v2/payments`) introduce orquestacion multi-proveedor con **registry inyectable**: el token Nest `PAYMENT_PROVIDERS` recibe los adapters registrados en `PaymentsV2Module` (`useFactory`: `mock` y opcionalmente `acme` si `PAYMENTS_ACME_ENABLED=true`). `ProviderRegistryService` valida al arranque que cada entrada de `PAYMENTS_PROVIDER_ORDER` exista en ese conjunto. Los códigos de proveedor tipados viven en `PAYMENT_PROVIDER_NAMES` / `PaymentProviderName` (`apps/psp-api/src/payments-v2/domain/payment-provider-names.ts`, SSOT compartido con `env.validation` para el CSV). Retries acotados y circuit breaker por proveedor con estado compartido en Redis (HASH `payv2:cb:{provider}`: campos `failures`, `openedUntil` ms; sin `REDIS_URL` el servicio degrada a Map en proceso y registra una vez por proceso Node `payments_v2.circuit_breaker_redis_unavailable`). Opcionalmente, con Redis y `PAYMENTS_PROVIDER_CB_HALF_OPEN=true`, tras el cooldown solo una petición a la vez obtiene la sonda `SET payv2:cb:{provider}:probe NX` (mitiga thundering herd en recuperación); con el flag en false el comportamiento es el anterior. Entre reintentos internos del mismo adapter ante `transientError`, backoff exponencial acotado con jitter (`PAYMENTS_PROVIDER_RETRY_BASE_MS` default 100, `0` = sin espera; `PAYMENTS_PROVIDER_RETRY_MAX_MS` default 3000; si `MAX < BASE` se normaliza `MAX` a `BASE`).
- Hardening providers: `PAYMENTS_PROVIDER_ORDER` se valida fail-fast contra `PAYMENT_PROVIDER_NAMES` (sin vacíos, no puede quedar vacío). `mock` queda restringido a `NODE_ENV=sandbox|development` salvo flag explícito `PAYMENTS_ALLOW_MOCK=true`.
- Create intent v2: el comercio **no** envía proveedor en el body; el primer intento sigue `PAYMENTS_PROVIDER_ORDER` (y fallbacks/circuitos).
- Contrato providers v2: `ProviderResult` es discriminado; si `status !== failed`, `providerPaymentId` es obligatorio. Guardrail en orquestador: si un provider retorna “éxito” sin id y el pago no tenía `providerRef`, se loggea `payments_v2.provider_success_missing_id` y se marca el pago como `failed` con `statusReason=provider_error` (nunca se fabrica `providerRef`).
- El endpoint de observabilidad `GET /api/v2/payments/ops/metrics` es interno y se protege con `InternalSecretGuard` (`X-Internal-Secret`) para evitar exponer agregados globales por merchant API key; el snapshot combina métricas v2 por proveedor, estado de circuit breakers (Redis global o fallback en proceso si no hay cliente Redis) y backlog de la cola de webhooks (`pending/processing/failed` + antigüedad de pending más vieja).
- Nuevo endpoint interno `GET /api/v2/payments/ops/transactions` para monitor operativo filtrable (merchant, estado, provider, rango de fechas) con último `PaymentAttempt` y `routingReasonCode`. Paginación **por cursor real** (keyset estable `createdAt desc, id desc`) vía `cursorCreatedAt + cursorId` (y `direction` opcional); `page>1` ya no se soporta para evitar O(offset) en páginas profundas. Query opcional `includeTotal=false` omite el `COUNT` global (`total`/`totalPages` en `null`) para reducir carga en DB con polling; el backoffice lo usa en auto-refresh y pide totales al cambiar filtros o al pulsar Refrescar.
- Finanzas por merchant (interno, `InternalSecretGuard`): `GET /api/v2/payments/ops/merchants/:merchantId/finance/summary` (agregado gross/fee/net desde `PaymentFeeQuote`, montos como string minor), `GET .../finance/transactions` y `GET .../finance/payouts` (paginación offset `page`/`pageSize`, `page.total`/`totalPages`). El backoffice expone BFF equivalente bajo `GET /api/internal/merchants/:merchantId/finance/{summary,transactions,payouts}`.
- Endpoint interno `GET /api/v2/payments/ops/transactions/counts`: mismos filtros base que el listado ops (merchant, `paymentId` por prefijo sobre el id interno — `startsWith` —, provider, rango de fechas) **sin** filtro por estado; responde `total` y `byStatus` vía un solo `groupBy` en DB para las tarjetas de conteo del backoffice (evita N×`payment.count()`).
- Endpoint interno `GET /api/v2/payments/ops/transactions/volume-hourly`: serie horaria UTC (24 buckets) de volumen acumulado (`amount_minor`) de pagos `succeeded` para **hoy vs ayer**, agrupando por **`succeeded_at`** (captura/éxito), no por `created_at`; filtros opcionales `merchantId`, `provider`, `currency` (default EUR). Los acumulados y totales se serializan como **strings decimales** (enteros en minor) para no perder precisión al superar `Number.MAX_SAFE_INTEGER`. Expuesto al panel vía BFF `GET /api/internal/transactions/volume-hourly`.
- Endpoint interno `GET /api/v2/payments/ops/payments/:paymentId`: detalle operativo de un pago por id interno con hasta **200** `PaymentAttempt` más recientes (orden cronológico ascendente en payload), más `attemptsTotal` y `attemptsTruncated` cuando el historial supera ese tope. Metadatos: `idempotencyKey`, `paymentLinkId`, `rail`, timestamps. Por defecto los intentos **no** incluyen `responsePayload` (menos volumen y evita filtrar metadata cruda de proveedor al cliente). Query opcional `includePayload=true` restaura ese campo por intento solo para depuración. Consumido por el backoffice vía BFF `GET /api/internal/payments/:paymentId` (el BFF reenvía `includePayload` solo cuando vale `true`).
- Backoffice MVP en `apps/psp-backoffice`: arquitectura BFF con route handlers (`/api/internal/*`) que inyectan `X-Internal-Secret` en server-side y evitan exponer secretos al navegador. Copy de ayuda al comercio aclara que el ruteo de proveedor en create v2 es del PSP, no un campo del POST merchant.
- Hardening backoffice: `/api/internal/*` requiere auth explícita por request (`Authorization: Bearer BACKOFFICE_ADMIN_SECRET` o cookie HttpOnly `backoffice_admin_token`) y devuelve `401/403` en ausencia/credencial inválida; si la configuración de secretos es inválida (falta `BACKOFFICE_ADMIN_SECRET` o coincide con `PSP_INTERNAL_API_SECRET`), responde `500` (fail-closed) en cualquier entorno. El proxy BFF no reenvía al navegador el cuerpo de error crudo del upstream; el detalle queda en logs de servidor (`console.error`). `BACKOFFICE_ADMIN_SECRET` debe ser distinto de `PSP_INTERNAL_API_SECRET` para defensa en profundidad.
- El script CI de readiness operativo `scripts/ci/check-ops-metrics.mjs` endurece seguridad: valida `SMOKE_BASE_URL` (https, o http solo localhost), usa `origin` al construir URL final y rechaza redirects para no reenviar `X-Internal-Secret` fuera del host esperado.
- Nuevo modelo `PaymentAttempt` para trazabilidad por operacion/proveedor (`create/capture/cancel/refund`) con status, error taxonomy, latencia y payload de respuesta.
- `PaymentAttempt.attemptNo` se asigna de forma atomica con `MAX(attemptNo)+1` dentro de transaccion serializable y retry para `P2002`/`P2034`, manteniendo `@@unique([paymentId, operation, attemptNo])`.
- Concurrencia en operaciones v2: `PaymentOperation` (lock por `paymentId+operation`) evita ejecutar dos veces `capture/refund/cancel` bajo carrera; la fila se crea/actualiza a `processing` y se marca `done` solo cuando `capture`/`cancel`/`refund` terminan **sin excepción** tras adquirir el lock. Errores inesperados (o fallo de proveedor en refund) eliminan la fila y, si hubo `Idempotency-Key` de operación, la clave Redis `payv2op:*`, para reintento inmediato — no se usa `finally` que marque `done` al propagar errores. `capture` y `cancel` validan ownership con `findMerchantPayment` **antes** de reclamar el lock (evita filas `done`/`processing` con `merchantId` erroneo que bloqueaban al dueño). En `claimPaymentOperation`, si el lock existente tiene `merchantId` distinto al solicitante, se elimina y se reintenta (log `payments_v2.operation_lock_merchant_mismatch`); en takeover por lock stale se reescribe `merchantId`. Con lock en `processing`, si llega otra peticion con `payloadHash` distinto (p. ej. otro monto en `refund`), se responde `409 Conflict` con metadata `{ message, paymentId, operation }` en lugar de `proceed: false` silencioso. Si el hash coincide y no es stale, se devuelve `proceed: false` (espera idempotente); si es stale, takeover con CAS (`updateMany` con `status: processing`, mismo `payloadHash`, `processingAt` anterior al umbral stale); solo una peticion obtiene `count===1`; si `count===0` se reintenta el bucle (otra peticion renovo el lock).
- Refund v2: si el proveedor devuelve `failed` (o se agota el orden sin proveedor usable), el pago **permanece** `succeeded`; no se toca `statusReason`/`failedAt` del pago salvo actualizar `lastAttemptAt`/`selectedProvider`. La API responde `409 Conflict` con `{ message, paymentId, reasonCode }`; se elimina la fila `PaymentOperation` de refund y, si hubo `Idempotency-Key`, la clave Redis `payv2op:*` correspondiente, para permitir reintento. El detalle del fallo sigue en `PaymentAttempt` y métricas.
- Robustez adapter v2: throws en `getProvider`/`adapter.run` se convierten a `ProviderResult` FAILED (`provider_error`), con `transientError` heurístico (p. ej. `TypeError`/`SyntaxError` sin reintento; `ECONNRESET`/etc. transitorio); se persisten intentos, métricas y reglas de circuit breaker igual que fallos normales.
- Rollout progresivo de Payments V2 por merchant con feature flag de entorno `PAYMENTS_V2_ENABLED_MERCHANTS` (CSV o `*`).
- Idempotencia v2: cabecera `Idempotency-Key` opcional con máximo 256 caracteres y charset `[A-Za-z0-9._:-]`; inválida → `400` con mensaje `Invalid Idempotency-Key`. En Redis, claves `payv2:*` y `payv2op:*` usan sufijo `sha256(key)`; el valor canónico sigue en `Payment.idempotencyKey` para unicidad y comparación de payload.
- Fairness por merchant (opcional): `PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED` (default `false`) activa cuotas cortas en Redis por `merchantId` y operación (`create` obligatorio si está on: `PAYMENTS_V2_MERCHANT_CREATE_LIMIT` + `PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC`; opcional `PAYMENTS_V2_MERCHANT_CAPTURE_*` y `PAYMENTS_V2_MERCHANT_REFUND_*` en pares). Ventana fija por bucket (`INCR` + `EXPIRE` atómico vía Lua en `RedisService.incrWithExpireOnFirst`); claves `payv2:rl:{merchantId}:{op}:{bucket}`. El check de `create` corre tras resolver idempotencia existente y antes de `prisma.payment.create`; `capture`/`refund` tras el hit idempotente de operación y antes del trabajo costoso (lock/proveedor). Exceso → `429` con `{ message, retryAfter }`. Sin cliente Redis o error de Redis: **fail-open** (no bloquea pagos; log único `payments_v2.merchant_rate_limit_redis_unavailable` por proceso). En exceso de cuota: log estructurado `payments_v2.merchant_rate_limited` (sin spam por request OK). El throttling global Nest (`@Throttle` en `payments-v2.controller.ts`) se mantiene independiente.
- Webhooks outbox: en el claim atomico `pending → processing` se escribe `scheduledAt = now` como inicio de procesamiento. El reintento operativo (`POST .../deliveries/:id/retry`) acepta `failed` siempre y `processing` solo si ese `scheduledAt` es anterior a `FETCH_TIMEOUT_MS + 5s` (fila atascada), para no reencolar durante un `fetch` activo ni duplicar POST al merchant.
- Optimizacion DB (webhooks inbound + panel ops): `Payment` indexa `(@@index([selectedProvider, providerRef]))` para lookup por `(selectedProvider, providerRef)` sin scans bajo volumen; y `(@@index([status, currency, succeededAt]))` para la serie de volumen horario (`getOpsVolumeHourlySeries`, polling backoffice). En deploy, estos índices se crean con `CREATE INDEX CONCURRENTLY` como paso operacional (`npm -w apps/psp-api run prisma:ops:indexes`): el script `scripts/ops/create-indexes-concurrently.mjs` aplica `prisma/ops/create-indexes-concurrently.sql` con el cliente `pg` (una sentencia por query en autocommit). `PSP_PRISMA_INDEX_LOCK_TIMEOUT` solo rodea `DROP INDEX CONCURRENTLY` (no los `CREATE`, para no dejar índices inválidos si el timeout corta un build concurrente); tras un pase OK valida `pg_index.indisvalid` en los índices esperados. No se usa `prisma db execute` para ese SQL porque envuelve el script en una transacción y Postgres rechaza `CONCURRENTLY` dentro de transacciones; las migraciones de `prisma migrate deploy` siguen yendo en transacción.
- Swagger condicionado por `ENABLE_SWAGGER`; CORS por `CORS_ALLOWED_ORIGINS` (obligatorio en `production`; en dev/sandbox sin lista se usa `origin: true` como compatibilidad). Cada entrada se valida como URL http(s) sin path/query/hash y se normaliza a `URL.origin` (p. ej. barra final eliminada).
- Logs HTTP en JSON por petición (`HttpLoggingInterceptor` como `APP_INTERCEPTOR`): excluye `GET /health`; el campo `path` es plantilla (prioridad: Express `baseUrl`+`route.path`, si no metadata Nest `@Controller`/handler, si no redacción por prefijos sensibles bajo `/api/v1/pay/`, `/api/v1/payments/`, etc.); modo por env (`HTTP_LOG_MODE`: default `errors` en `production`, `all` en el resto; `sample`/`off`; `HTTP_LOG_SKIP_PATH_PREFIXES` con prefijos normalizados sin barra final) + prefijo por defecto `/api/v1/pay` en `sandbox`/`production` — esos prefijos omiten solo respuestas exitosas; 4xx/5xx se registran siempre. Guardrail activo: `"/"` en `HTTP_LOG_SKIP_PATH_PREFIXES` se ignora y genera `warn` al arranque para evitar un skip-all accidental de logs 2xx.
- **Correlación HTTP (Payments v2 y rutas del mismo módulo):** middleware `CorrelationIdMiddleware` (`AsyncLocalStorage` en `apps/psp-api/src/common/correlation/`) aplicado a `PaymentsV2Controller` (API comercio `/api/v2/payments`) y `PaymentsV2InternalController` (ops interno bajo el mismo prefijo). Entrada: cabeceras opcionales **`X-Request-Id`** (prioritaria) y **`X-Correlation-Id`** (solo si falta la primera); valores inválidos o ausentes → **UUID v4** generado por petición. Salida: siempre **`X-Request-Id`** en la respuesta (el valor aceptado o el generado). El id se propaga a `PaymentsV2Service` vía `CorrelationContextService`, se añade como `correlationId` en logs JSON `payments_v2.*` relevantes, en `payments_v2.provider_attempt` y en `http.request` cuando el contexto existe. Alcance: **misma petición HTTP y mismo proceso Node** (reintentos de adapter y varios `PaymentAttempt` comparten el id); propagación a workers u otros servicios queda fuera de esta fase.
- Testing co-localizado por dominio (`*.spec.ts` junto al codigo del modulo).
- Integration-local con Supertest en `apps/psp-api/test/integration/` para contratos HTTP y servicios con DB real.
- Smoke tests de sandbox en `test/smoke/sandbox.smoke.spec.ts`.
- Estado vivo de cobertura en `docs/testing-status.md` (actualización obligatoria al cambiar tests/config de tests).

## 5) Estado actual (que estamos haciendo ahora)

- Se consolidó CI en `.github/workflows/ci.yml`: `api-ci` (lint/test/build/Docker API), `backoffice-ci` (lint/typecheck/test Vitest/build del panel), `terraform-validate`, y en rama `sandbox` deploy + migrate + readiness estricto de `/health` [status/db/redis en `ok`] + gate de métricas operativas en `/api/v2/payments/ops/metrics` + smoke.
- `api-ci` ahora trata `test:integration:critical` como bloqueante, agrega `test:ci:ops-metrics` para hardening del gate de métricas internas y valida build Docker (`psp-api:ci`) en cada corrida.
- `sandbox-deploy` define umbrales explícitos de readiness operativo (`READINESS_*`) para reducir falsos verdes y alinear promoción con SLO operativo de canary.
- Se agrego contenedorizacion de API (`Dockerfile`, `.dockerignore`) para ejecucion reproducible.
- Se agregaron documentos operativos para sandbox:
  - `docs/sandbox-env.md`
  - `docs/sandbox-runbook.md`
  - `docs/sandbox-go-live-checklist.md`
- Se reforzó cobertura smoke de sandbox:
  - `test/smoke/sandbox.smoke.spec.ts` ahora valida también conflicto de idempotencia (`409`), `cancel` y ruta `requires_action` (mock).
- Se agregó runbook de rollout productivo gradual en `docs/production-canary-rollout.md` (canary, fallback y rollback).
- Se agrego el dominio `payments-v2/` con contrato no retrocompatible para evolucionar de gateway simple a orquestador multi-proveedor.
- Se extendio `Payment` con campos de lifecycle de orquestacion (`selected_provider`, `status_reason`, timestamps por estado) y se incorporo `PaymentAttempt`.
- Se retiro la superficie v1 de pagos y checkout (`src/payments/*`, `src/checkout/*`) del bootstrap y del codigo para mantener una estrategia v2-only en el API.
- Se incorporo `apps/psp-backoffice` (Next.js 16 + Tailwind + Query/Table). La ruta `/` muestra el **panel de transacciones** conectado a `GET .../ops/transactions` vía BFF (tabla, tarjetas de conteo por estado, cursores, export CSV de la página visible, filtros servidor en fecha/merchant/paymentId/proveedor y filtros locales opcionales en importe/divisa sobre la página cargada). El **monitor técnico** (misma API, vista compacta + health) sigue en `/monitor`. Detalle de pago en `/payments/[paymentId]` (clic en fila o enlace): importe, estado, actividad por intentos y panel lateral con datos reales del pago (`providerRef`, método enmascarado heurístico, idempotencia / link, merchant en extracto simulado, proveedor, fondos si hay `succeededAt`, enlace «Ver saldos» a inicio). Vista **`/merchants/[merchantId]/finance`**: resumen gross/fee/net y tablas fee quote + payouts vía BFF `GET /api/internal/merchants/.../finance/*`.
- Se agrego en API el endpoint interno `GET /api/v2/payments/ops/transactions` para consumo del backoffice y monitoreo de ruteo/intentos.
- Se incorporó base del motor de fees y liquidaciones merchant: tablas `MerchantRateTable` (tarifa por `merchant+currency+provider`, versionado temporal) y `PaymentFeeQuote` (snapshot inmutable por pago); `captureSucceeded` calcula comisión desde rate table activa y persiste quote/ledger.
- El ledger pasó a exponer balance por moneda en dos buckets (`pendingMinor`, `availableMinor`) con compatibilidad transicional para asientos legacy `available`; refunds ahora revierten contra `merchant_pending` cuando aplica (si el pago ya está en modelo nuevo).
- Se añadió dominio `settlements/` con `SettlementService` y modelos `PaymentSettlement` / `Payout` / `PayoutItem`: liberación `pending -> available` por ventana (`T_PLUS_N`/`WEEKLY`) y creación idempotente de payout por merchant/divisa.

## Regla de mantenimiento vivo (activo desde hoy)

Este archivo se actualiza en cada cambio estructural relevante, sin esperar pedido explicito, especialmente cuando haya:
- nueva dependencia clave
- nueva entidad/modelo o cambio relevante de schema
- nueva ruta principal o nuevo modulo de dominio
- decision de arquitectura transversal

Objetivo operativo: archivo breve, factual y alineado al estado real del codigo.

El backoffice mantiene su propio **`apps/psp-backoffice/BACKOFFICE_CONTEXT.md`**; al cambiar rutas, BFF, auth o stack UI del panel, actualizar ese archivo en el mismo diff y reflejar aqui solo lo que deba ser visible a nivel monorepo (API, seguridad cruzada, resumen de rutas).
