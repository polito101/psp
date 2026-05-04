# PROJECT_CONTEXT

Ultima actualizacion: 2026-05-04

## 1) Resumen del proyecto

Repositorio backend-first de un PSP (pasarela de pagos), con API principal en `apps/psp-api`.

**Jerarquia de contexto (SSOT):** cada app tiene su documento local (`apps/psp-api/API_CONTEXT.md`, `apps/web-finara/WEB_FINARA_CONTEXT.md`, `apps/psp-backoffice/BACKOFFICE_CONTEXT.md`). Las decisiones **más relevantes o transversales** (varias apps, contratos críticos, seguridad e infra compartida) deben quedar **reflejadas en este `PROJECT_CONTEXT.md` de la raíz** (resumen ejecutivo), además del detalle en el contexto del app cuando aplique.

La API esta construida con NestJS y expone REST versionado por URI, con foco operativo en `/api/v2/payments` (orquestador):
- onboarding de merchants
- creacion de payment links
- create/capture/cancel/refund de pagos con idempotencia por operacion
- ledger/balance
- webhooks asincronos
- health checks

Ademas del servicio API, el repo incluye:
- sitio marketing Next.js (landing Finara) en `apps/web-finara` (**`apps/web-finara/WEB_FINARA_CONTEXT.md`**; deploy Render: servicio `web-finara` en `render.yaml`). El CTA «Create account» enlaza a **`/merchant-signup`** (formulario que llama al Route Handler `POST /api/merchant-onboarding`, proxy servidor → `POST {PSP_API_BASE_URL}/api/v1/merchant-onboarding/applications`). **`PSP_API_BASE_URL` en Render debe coincidir con la URL pública del servicio `psp-api` en el Dashboard** (hostname único tipo `psp-api-xxxx.onrender.com`); el blueprint del repo puede sobrescribir variables si se sincroniza. Ese proxy aplica rate limit por IP (o fingerprint) y reenvío controlado de `X-Forwarded-For` / `X-Real-IP` hacia la API; en Render `RENDER=true` habilita la lectura segura de cabeceras de borde. El login merchant público sigue en `NEXT_PUBLIC_MERCHANT_BACKOFFICE_URL` (mismo código `psp-backoffice` en modo merchant). Esa URL se valida en `getMerchantBackofficeLoginUrl` (absoluta, solo `https`, sin credenciales en userinfo, path normalizado a `/login`; si falla, fallback `https://psp-backoffice.onrender.com/login` y un único `console.warn`). La API debe tener `TRUST_PROXY=true` (p. ej. en `render.yaml`) para que el `ThrottlerGuard` use esa IP.
- panel PSP en `apps/psp-backoffice`: **dos despliegues** del mismo app (merchant vs admin) vía `BACKOFFICE_PORTAL_MODE`/`NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE` (`/login` vs `/admin/login`); detalle en **`apps/psp-backoffice/BACKOFFICE_CONTEXT.md`** y **`render.yaml`** (`psp-backoffice`, `psp-backoffice-admin`).
- infraestructura en `infra/terraform`
- entorno local con PostgreSQL + Redis via `docker-compose.yml` (Postgres expuesto en el host en **5433** para no chocar con un PostgreSQL local en 5432; credenciales `psp` / `psp_dev_password` / DB `psp`)
- documentacion operativa en `docs/`, `apps/psp-api/README.md` y **`apps/psp-api/API_CONTEXT.md`** (SSOT del app API)

## 2) Stack tecnologico

- Runtime: Node.js LTS (README/CI recomiendan Node 22)
- Lenguaje: TypeScript estricto (`noImplicitAny`, `strictNullChecks`)
- Framework backend: NestJS 11
- Framework frontend administrativo: Next.js 16 (App Router)
- Sitio marketing (landing): Next.js 16 en `apps/web-finara` (Tailwind 4; BFF mínimo `POST /api/merchant-onboarding/applications` → `psp-api` con RL e identidad de cliente)
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
│   │   ├── API_CONTEXT.md          (SSOT del app API; decisiones globales también en PROJECT_CONTEXT raíz)
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
│   │   │   ├── merchant-onboarding/
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
│   ├── web-finara/
│   │   ├── WEB_FINARA_CONTEXT.md     (SSOT del app landing)
│   │   ├── app/, components/, lib/   (landing Next.js 16; `/merchant-signup`, `POST /api/merchant-onboarding`; Analytics Vercel opcional)
│   │   └── package.json
│   └── psp-backoffice/
│       ├── src/
│       │   ├── app/ (Next: `/`, `/transactions`, `/merchants/*`, `/operations`, `/monitor`, `/payments/[paymentId]`, `/onboarding/[token]` (onboarding público por token), `/crm/onboarding` y `/crm/onboarding/[applicationId]` (CRM admin); `/login` merchant portal, `/admin/login` admin portal; BFF `/api/internal/*` incl. settlements, merchants ops y CRM onboarding)
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

- **npm (raíz):** el `package.json` de la raíz es solo metadatos (`private`, sin dependencias de aplicación). Las dependencias y sus `package-lock.json` viven en `apps/psp-api`, `apps/psp-backoffice` y `apps/web-finara`; la CI incluye `api-ci` y `sandbox-deploy` con `npm ci` desde `apps/psp-api/package-lock.json`, **`backoffice-ci`** (lint, typecheck, test Vitest, Playwright `npm run test:e2e` contra `psp-api` real levantado en el job con Postgres/Redis + migraciones, build del panel), y **`web-finara-ci`** (`npm ci` + `npm run typecheck` con `next typegen` + `tsc --noEmit` + `npm run build` del sitio marketing) con caché npm por `package-lock.json` de cada app.

En `.cursor/rules/` se mantiene una capa mínima: `reglas-generales.mdc` (entry point del agente: flujo de trabajo, superpowers, SSOT y prioridades), `api-context.mdc`, `web-finara-context.mdc` y `psp-backoffice-context.mdc` (enrutadores por app), y `testing-status.mdc` (mantenimiento del SSOT de pruebas). El detalle por app vive en `API_CONTEXT.md`, `WEB_FINARA_CONTEXT.md`, `BACKOFFICE_CONTEXT.md`; la visión global y las decisiones más importantes en `PROJECT_CONTEXT.md` (raíz); estado de tests en `docs/testing-status.md`.

## 4) Patrones de diseno y convenciones detectadas

- Arquitectura por dominio NestJS: cada dominio separa `module/controller/service/dto`.
- Controladores delgados y logica de negocio concentrada en servicios.
- Validacion global en `main.ts` con `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`).
- Validacion de entorno centralizada con `ConfigModule.forRoot({ validate })` para fail-fast en bootstrap (`apps/psp-api/src/config/env.validation.ts`). `MERCHANT_ONBOARDING_BASE_URL`: fuera de `development`/`test` es obligatoria (origen `https` del backoffice con `/onboarding/[token]`); en dev/test el default es `http://localhost:3005` y se permite `http` solo en hosts loopback (`localhost`, `127.0.0.1`, `::1` / `[::1]` en hostname WHATWG). El blueprint `render.yaml` define `MERCHANT_ONBOARDING_BASE_URL` para `psp-api`.
- Prefijo global `api` + versionado URI en v1.
- Guardias reutilizables (`ApiKeyGuard`, `InternalSecretGuard`) y decorador `CurrentMerchant`.
- Prisma centralizado en `PrismaService` y cliente generado en `src/generated/prisma`.
- Convencion Prisma: modelos en PascalCase y mapeo SQL snake_case mediante `@map`/`@@map`.
- Onboarding CRM (merchants): modelos `MerchantOnboardingApplication` / `MerchantOnboardingToken` / checklist / eventos; **unicidad** en `contact_email` (email normalizado en servicio). Hasta que exista el índice UNIQUE de ops, `createApplication` serializa por email con `pg_advisory_xact_lock` dentro de la misma transacción que crea merchant/aplicación (evita filas duplicadas bajo carrera y el fallo del `CREATE UNIQUE INDEX CONCURRENTLY`). Con índice aplicado, P2002 sigue siendo red de seguridad; `createApplication` interpreta `P2002` sobre ese campo como éxito neutral (misma forma que un alta válida) y no filtra estado interno.
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
- Hardening backoffice: `/api/internal/*` requiere JWT de sesión válido (`Authorization: Bearer <session JWT>` o cookie HttpOnly `backoffice_session`) alineado con `BACKOFFICE_PORTAL_MODE` (**`403`** si el rol JWT no coincide con el portal); configuración inválida de secretos JWT → **`500`** (fail-closed). El proxy BFF no reenvía al navegador JSON 4xx crudo del upstream: mensajes seguros en cliente y preview acotado en logs (`console.error`). Mutaciones `POST`/`PATCH` bajo `/api/internal/*` exigen cabecera `X-Backoffice-Mutation: 1` y mismo `Origin` cuando aplica (coincidencia adicional con origen reconstruido desde cabeceras forward **solo** con `TRUST_BACKOFFICE_FORWARDED_ORIGIN_HEADERS=true` o runtime `VERCEL=1` / `CF_PAGES=1` / `RENDER=true`); `POST /api/auth/session` acepta solo el `mode` del portal actual (**`404`** para el otro modo; **`500`** si `BACKOFFICE_PORTAL_MODE` y `NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE` están ambos en `admin`/`merchant` y discrepan — fail-fast vía `getBackofficePortalMode()`) e incluye rate limit best-effort siempre (IP desde `request.ip`; `x-vercel-forwarded-for` / `cf-connecting-ip` solo con señal de runtime (`VERCEL=1` / `CF_PAGES=1`) o `TRUST_PLATFORM_IP_HEADERS` / flags granulares; **`X-Forwarded-For` y `X-Real-IP` solo con `TRUST_X_FORWARDED_FOR=true`**; sin IP, clave `__psp_bo_login_rl_fp:` + hash SHA-256 de `User-Agent` + `Accept-Language` o, si faltan, `LOGIN_RATE_LIMIT_UNRESOLVED_KEY` y log throttled); buckets acotados + barrido de expirados en proceso. En deploy admin, `BACKOFFICE_ADMIN_SECRET` debe existir y ser distinto de `PSP_INTERNAL_API_SECRET`; en deploy merchant suele omitirse.
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
- Optimizacion DB (webhooks inbound + panel ops): `Payment` indexa `(@@index([selectedProvider, providerRef]))` para lookup por `(selectedProvider, providerRef)` sin scans bajo volumen; y `(@@index([status, currency, succeededAt]))` para la serie de volumen horario (`getOpsVolumeHourlySeries`, polling backoffice). El índice único `contact_email` de `merchant_onboarding_applications` (onboarding CRM) sigue el mismo camino operacional para no bloquear escrituras durante el build. En deploy, estos índices se crean con `CREATE INDEX CONCURRENTLY` / `CREATE UNIQUE INDEX CONCURRENTLY` como paso operacional (`npm -w apps/psp-api run prisma:ops:indexes`): el script `scripts/ops/create-indexes-concurrently.mjs` aplica `prisma/ops/create-indexes-concurrently.sql` con el cliente `pg` (una sentencia por query en autocommit). `PSP_PRISMA_INDEX_LOCK_TIMEOUT` solo rodea `DROP INDEX CONCURRENTLY` (no los `CREATE`, para no dejar índices inválidos si el timeout corta un build concurrente); tras un pase OK valida `pg_index.indisvalid` en los índices esperados y, si alguno es inválido, hace hasta `PSP_PRISMA_INDEX_INVALID_REMEDIATION_ROUNDS` pasadas de `DROP INDEX CONCURRENTLY` + reaplicación inmediata (sin backoff); índice esperado ausente o remediación agotada → fallo inmediato (`[prisma:ops:indexes:missing]` / `[prisma:ops:indexes:remediation-exhausted]`) sin reintentos con espera. **Topes en código (clamp):** valores mayores en Helm/CI no se aplican tal cual — `PSP_PRISMA_INDEX_RETRIES` máx. **20**, `PSP_PRISMA_INDEX_RETRY_BASE_DELAY_MS` máx. **300_000** ms, `PSP_PRISMA_INDEX_INVALID_REMEDIATION_ROUNDS` máx. **10**, `PSP_PRISMA_INDEX_LOCK_TIMEOUT` máx. **120_000** ms (valores mayores se clampan con aviso; **0** se rechaza porque en Postgres desactiva el timeout); entre reintentos con espera, el `sleep` por iteración queda acotado a **600_000** ms. No se usa `prisma db execute` para ese SQL porque envuelve el script en una transacción y Postgres rechaza `CONCURRENTLY` dentro de transacciones; las migraciones de `prisma migrate deploy` siguen yendo en transacción (la migración correspondiente solo valida duplicados y documenta el paso; el DDL concurrente va en el SQL de ops).
- Swagger condicionado por `ENABLE_SWAGGER`; CORS por `CORS_ALLOWED_ORIGINS` (obligatorio en `production`; en dev/sandbox sin lista se usa `origin: true` como compatibilidad). Cada entrada se valida como URL http(s) sin path/query/hash y se normaliza a `URL.origin` (p. ej. barra final eliminada).
- Logs HTTP en JSON por petición (`HttpLoggingInterceptor` como `APP_INTERCEPTOR`): excluye `GET /health`; el campo `path` es plantilla (prioridad: Express `baseUrl`+`route.path`, si no metadata Nest `@Controller`/handler, si no redacción por prefijos sensibles bajo `/api/v1/pay/`, `/api/v1/payments/`, etc.); modo por env (`HTTP_LOG_MODE`: default `errors` en `production`, `all` en el resto; `sample`/`off`; `HTTP_LOG_SKIP_PATH_PREFIXES` con prefijos normalizados sin barra final) + prefijo por defecto `/api/v1/pay` en `sandbox`/`production` — esos prefijos omiten solo respuestas exitosas; 4xx/5xx se registran siempre. Guardrail activo: `"/"` en `HTTP_LOG_SKIP_PATH_PREFIXES` se ignora y genera `warn` al arranque para evitar un skip-all accidental de logs 2xx.
- **Correlación HTTP (Payments v2 y rutas del mismo módulo):** middleware `CorrelationIdMiddleware` (`AsyncLocalStorage` en `apps/psp-api/src/common/correlation/`) aplicado a `PaymentsV2Controller` (API comercio `/api/v2/payments`) y `PaymentsV2InternalController` (ops interno bajo el mismo prefijo). Entrada: cabeceras opcionales **`X-Request-Id`** (prioritaria) y **`X-Correlation-Id`** (solo si falta la primera); valores inválidos o ausentes → **UUID v4** generado por petición. Salida: siempre **`X-Request-Id`** en la respuesta (el valor aceptado o el generado). El id se propaga a `PaymentsV2Service` vía `CorrelationContextService`, se añade como `correlationId` en logs JSON `payments_v2.*` relevantes, en `payments_v2.provider_attempt` y en `http.request` cuando el contexto existe. Alcance: **misma petición HTTP y mismo proceso Node** (reintentos de adapter y varios `PaymentAttempt` comparten el id); propagación a workers u otros servicios queda fuera de esta fase.
- Testing co-localizado por dominio (`*.spec.ts` junto al codigo del modulo).
- Integration-local con Supertest en `apps/psp-api/test/integration/` para contratos HTTP y servicios con DB real.
- Smoke tests de sandbox en `test/smoke/sandbox.smoke.spec.ts`; volumen de demo para el panel (≥60 `succeeded` + otros estados) en `test/smoke/backoffice-volume-demo.smoke.spec.ts` vía `npm run test:smoke:backoffice-demo` (no entra en `test:smoke:sandbox` salvo `SMOKE_BACKOFFICE_VOLUME_DEMO=1`).
- Estado vivo de cobertura en `docs/testing-status.md` (actualización obligatoria al cambiar tests/config de tests).

## 5) Estado actual (que estamos haciendo ahora)

- Se consolidó CI en `.github/workflows/ci.yml`: `api-ci` (lint/test/build/Docker API), `backoffice-ci` (lint/typecheck/test Vitest/Playwright e2e contra `psp-api` local en el job + build del panel), `web-finara-ci` (`npm run typecheck` = `next typegen` + `tsc --noEmit`, luego build del sitio marketing en `apps/web-finara`), `terraform-validate`, y en rama `sandbox` deploy + migrate + readiness estricto de `/health` [status/db/redis en `ok`] + gate de métricas operativas en `/api/v2/payments/ops/metrics` + smoke.
- `api-ci` ahora trata `test:integration:critical` como bloqueante, agrega `test:ci:ops-metrics` para hardening del gate de métricas internas y valida build Docker (`psp-api:ci`) en cada corrida.
- `sandbox-deploy` define umbrales explícitos de readiness operativo (`READINESS_*`) para reducir falsos verdes y alinear promoción con SLO operativo de canary.
- Se agrego contenedorizacion de API (`Dockerfile`, `.dockerignore`) para ejecucion reproducible; en produccion el entrypoint (`docker-entrypoint.sh`) ejecuta `prisma migrate deploy` antes de `node dist/main` para que Postgres tenga tablas como `WebhookDelivery` al levantar el servicio. Los reintentos ante fallos transitorios y el tiempo maximo total estan acotados por variables `PRISMA_MIGRATE_*` (ver comentarios en el script); errores de migracion no recuperables (p. ej. P3009/P3018) cortan sin esperar el maximo de tiempo.
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

Cada app mantiene su contexto local: **`apps/psp-api/API_CONTEXT.md`**, **`apps/web-finara/WEB_FINARA_CONTEXT.md`**, **`apps/psp-backoffice/BACKOFFICE_CONTEXT.md`**. Al cambiar solo detalle interno del app, actualizar ese archivo en el mismo diff. Si el cambio es **transversal o prioritario** (nuevo contrato entre servicios, política de seguridad compartida, CI, despliegue, decisión arquitectónica que afecte a más de un app), actualizar también **`PROJECT_CONTEXT.md`** (raíz) para que siga siendo la visión ejecutiva única.
