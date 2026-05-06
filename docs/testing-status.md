# Estado de tests

Ultima actualizacion: 2026-05-06

## Objetivo

Este documento es el estado operativo de cobertura de tests del repo.  
Debe actualizarse en el mismo cambio cuando se agreguen, modifiquen o eliminen tests.

## Tipos de suite

- `unit` (API): specs co-localizados en `apps/psp-api/src/**/*.spec.ts` (`npm run test` desde `apps/psp-api`).
- `unit` (backoffice): libs solo servidor en `apps/psp-backoffice/src/**/*.spec.ts` (`npm run test` desde `apps/psp-backoffice`, Vitest).
- `integration-local`: tests de integracion con app Nest local + Supertest en `apps/psp-api/test/integration/**/*.spec.ts` (`npm run test:integration` desde `apps/psp-api`).
- `smoke`: tests HTTP contra entorno desplegado/base URL en `apps/psp-api/test/smoke/**/*.spec.ts` (`npm run test:smoke:sandbox`). Volumen demo backoffice (no incluido en sandbox por defecto): `npm run test:smoke:backoffice-demo` (`backoffice-volume-demo.smoke.spec.ts`).

La CI del monorepo incluye `api-ci` (lint/test/build API), `backoffice-ci` (lint, typecheck, Vitest, Playwright con **`psp-api`** levantado en el mismo job vía Postgres/Redis + migraciones en `127.0.0.1:3003`, **POST** previo a Playwright a `/api/v1/merchants` con `X-Internal-Secret` para dejar al menos un merchant en el directorio ops — el E2E `auth-and-rbac` necesita filas con enlace **Admin** —, validación del proxy a `/api/internal/merchants/ops/directory`, y build del panel), y `web-finara-ci` (typecheck vía `next typegen` + `tsc --noEmit`, y build de la landing en `apps/web-finara`).

## Matriz de cobertura por dominio

| Dominio | Unit | Integration local | Smoke | Estado | Notas |
| --- | --- | --- | --- | --- | --- |
| `payments-v2` | Si | Si | Si | Cubierto | Unit `payments-v2.service.spec`: … Create v2: contrato **v2** (`amount` decimal + `customer` + URLs + `channel`) con hash de idempotencia `v:2` (JSON con claves ordenadas + normalización de URLs/`customer`/textos; **legacy** `amountMinor` `v:1`). `create-payment-intent-payload-hash.spec.ts`: estabilidad del hash ante orden de claves y trim. `decimal-amount-to-minor.spec.ts` + guards en DTO/service: minor ≤ INT32 y safe integer. … Tablas de configuración de enrutado `payment_provider_configs` / `payment_method_routes` / `payment_method_route_currencies` / `merchant_provider_rates` (migración `20260506120000_dynamic_payment_routing_config`). … |
| `merchants` | Si (MID) | Si | Parcial | Parcial | Unit `allocate-unique-merchant-mid.spec.ts`: MID vía secuencia Postgres `merchant_mid_seq` (`nextval`) + reintento solo ante P2002 con jitter; agotamiento o fila vacía → `MerchantMidAllocationFailedError`; fallos `$queryRaw` clasificados como **infra** (p. ej. Postgres `42P01`) → se propaga el error original; fallos **no** infra sin clasificar → `MerchantMidAllocationFailedError('sequence_unavailable', { cause })`. `mid-allocation-conflict-log.spec.ts`: cadena `Error`/`.cause` serializada para logs (mensajes sanitizados, `prismaCode`, `postgresSqlState`). `MerchantsService.create`: log `error` con contexto antes de `retries_exhausted` → `409`, `sequence_unavailable` → `503` (mensajes `MERCHANT_MID_ALLOCATION_*` en español). Migración `20260504220000_merchant_mid_sequence`. Integration cubre create+guard, ciclo revoke/rotate via servicio, y ops `GET .../ops/:id/detail` + `PATCH .../ops/:id/account` (normalización email, 409 duplicado); `mid` en API es cadena numérica 6–15 caracteres (`VARCHAR(16)` en DB). Falta spec unitario amplio del controller/service. |
| `merchant-onboarding` | Si | No | No | Parcial | Unit `merchant-onboarding.service.spec.ts`: creación pública con respuesta neutral `2xx` si email de expediente o `Merchant.email` ya existe (detectado tras advisory lock en TX, no antes — mitiga fuga por timing frente a trabajo `bcrypt`/token); incl. P2002 carrera; P2002 de `mid` en borde de transacción → `ConflictException`; `MerchantMidAllocationFailedError`: `retries_exhausted` → `409`, `sequence_unavailable` → `503` (mensajes genéricos en español); errores MID infra propagados desde allocate (p. ej. Postgres `42P01`) no son esa clase y se re-lanzan; log `error` con resumen + `midAllocationConflictDiagnostics` (causa/prisma/postgres) antes de esos mapeos; perfil negocio `companyName`/`industry`/`websiteUrl` + sync `Merchant`; checklist, token, eventos; approve/reject (email decisión); approve preflight (`findUnique` id/status) antes de `bcrypt.hash` para evitar CPU en `404`/`409`; `listApplications` con `q`; barrera advisory + lock; portal login; `merchant-onboarding.controller.spec.ts`. Unit email/token. Integración HTTP pendiente. |
| `payment-links` | No | Si | No | Parcial | Sin endpoint HTTP activo; cobertura via `PaymentLinksService.findForMerchant`. |
| `ledger` | Si | Si | Si | Cubierto | Unit de servicio + integration/smoke de `/api/v1/balance`, incluyendo transición `pending/available` y compatibilidad con asientos legacy `available`. |
| `fees` | Si | Si | No | Cubierto | Unit `FeeService` (fixed/percentage/minimum + resolve active rate table) e integración de endpoints internos para rate tables por merchant/currency/provider. |
| `settlements` | Si | Si | No | Parcial | Unit `SettlementService` (ventanas T+N/WEEKLY, agrupación e idempotencia de payout) e integración `settlements.integration.spec.ts`. Workflow **SettlementRequest** (controller + BFF approve/reject) sin suite dedicada aún. Falta cobertura de chargeback/refund post-payout y estados `SENT/FAILED` del payout. |
| `fx` | Si | Parcial | No | Parcial | Unit `fx-rates.service.spec.ts`; integration `fx.integration.spec.ts` (salta si falta migración/tabla). |
| `backoffice BFF` | Si (proxy + guards + login RL + portal mode) | No | Playwright smoke | Parcial | Vitest: proxy (`proxy.spec.ts`: merchant vs admin login path, sesión con `onboardingStatus`, `/merchant-status` vs páginas operativas, sesión cruzada ignorada, `/onboarding/*` público sin sesión en modos merchant y admin), BFF proxy (`backoffice-api.spec.ts`: fail-closed RBAC para payments/settlements/merchants ops y `merchant-onboarding/ops` excepto `merchant-login`; `proxyPublicGet/Post` sin `X-Internal-Secret`, redirect manual y errores seguros), mutación interna (`internal-mutation-guard.spec.ts`: `Origin` vs `nextUrl`; sin trust forward (`TRUST_BACKOFFICE_FORWARDED_ORIGIN_HEADERS` ausente y runtime `VERCEL`/`CF_PAGES`/`RENDER` off) no se valida `Origin` vía cabeceras `X-Forwarded-*`; con `TRUST_BACKOFFICE_FORWARDED_ORIGIN_HEADERS=true` o `RENDER=true`, `Host` + último segmento de `X-Forwarded-Proto` y fallback último segmento de `X-Forwarded-Host`), rate limit login (`login-rate-limit.spec.ts`: multi-clave, dedupe, barrido/evicción; sin IP + fingerprint comparte bucket global `LOGIN_RATE_LIMIT_UNRESOLVED_KEY` para anti-bypass por UA), resolución IP (`client-ip.spec.ts`: XFF/X-Real-IP solo con `TRUST_X_FORWARDED_FOR`; `x-vercel-forwarded-for` / `cf-connecting-ip` ignoradas por defecto salvo `VERCEL=1`, `CF_PAGES=1` u opt-in `TRUST_PLATFORM_IP_HEADERS` / flags granulares; `console.warn` throttled ~60s si llegan esas cabeceras pero trust off → misconfiguration detrás de proxy; clave RL sin IP = fingerprint `__psp_bo_login_rl_fp:…` o sentinel global), `portal-mode.spec.ts` (fail-fast si `BACKOFFICE_PORTAL_MODE` y `NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE` discrepan), `enforceInternalRouteAuth` con `BACKOFFICE_PORTAL_MODE` y bloqueo merchant no `ACTIVE` (`internal-route-auth.spec.ts`), `session-claims.spec.ts` (`rejectionReason` en JWT recortado por bytes UTF-8 sin partir pares sustitutos; límite alineado con tamaño de cookie), decodificación segura de segmentos de path (`decode-route-path-segment.spec.ts`; percent-encoding inválido → 400 en rutas onboarding BFF), rutas API (`provider-health`, `internal/payments/[paymentId]` con payload anidado y filtro defensivo de claves `*ciphertext*`, `internal/payments/[paymentId]/action`, `internal/payments/.../notifications/.../resend`, `payments`, `auth/session` con mock de `proxyInternalPost` para login merchant, onboarding público business-profile: body inválido 400, body válido usa proxy público, upstream error seguro; **`internal/merchants/ops/[merchantId]/account`** (PATCH cuenta: 400 si `merchantId` con percent-encoding inválido; 400 si body inválido; éxito con `proxyInternalPatch` + alcance admin; opcionales vacíos/`null` → no reenvían claves en blanco al upstream); `route.spec` sentinela vs fingerprint + 429 al rotar UA; mismatch env → 500 en session). E2E: `e2e/auth-and-rbac.spec.ts` usa portal **admin** (redirect `/admin/login` sin cookie; login API admin + `/merchants` + enlace **Admin** → pestañas Account / Application Form / Provider rates + panel de tarifas proveedor). |
| `web-finara` (marketing) | No | No | No | Solo CI build | Landing estática enlazando login merchant configurado por env; `.env.example` con `NEXT_PUBLIC_MERCHANT_BACKOFFICE_URL`; `web-finara-ci` ejecuta `npm run typecheck` (`next typegen` + `tsc --noEmit`) y `npm run build`. |
| `health` | Si | Si | Si | Cubierto | Unit + integration `/health` + smoke readiness. |
| `webhooks` | Si | Si | Si | Cubierto | Unit worker/outbox + integration retry interno + smoke backlog/métricas. |
| `internal endpoints` | Si (guards) | Si | Si | Cubierto | Ops `GET/POST/PATCH` en `/api/v2/payments/ops/*`, `/api/v1/settlements/*`, `/api/v1/merchants/ops/*`: con `X-Internal-Secret` válido exige también `X-Backoffice-Role` (`admin` o `merchant`); rol `merchant` exige `X-Backoffice-Merchant-Id` alineado con path/query (incl. inbox/approve solo admin). **`/api/v2/payments/ops/configuration/*`** (proveedores, rutas, tasas por merchant) es **solo `admin`** (fail-closed). **`POST …/payments/ops/payments/:id/notifications/:id/resend`** exige rol **`admin`** (merchant queda fuera). `/api/v1/merchant-onboarding/ops/*` es admin-only fail-closed salvo ruta **`.../ops/merchant-login`** exacta al final del path (no substring; rutas tipo `merchant-login-*` siguen admin-only). Solo secreto interno en ese login, sin rol admin. Script CI `scripts/ci/check-ops-metrics.mjs` envía `X-Backoffice-Role: admin`. Detalle pago scoped: `404` cross-merchant. Backoffice: proxy fail-closed (`backoffice-api.spec.ts`; mismas reglas de exención exacta para `merchant-login`), middleware por rol, sesión merchant con `onboardingStatus` en JWT. Unit API policy DNS SSRF (`merchant-notification-url.policy.spec.ts`) + guard (`internal-secret.guard.spec.ts`, incl. configuración ops admin-only). |

## Inventario actual de archivos

### Integration local (`test/integration`)

- `test/integration/health.integration.spec.ts`
- `test/integration/merchants.integration.spec.ts`
- `test/integration/payments-v2.integration.spec.ts`
- `test/integration/payments-v2-merchant-rate-limit.integration.spec.ts`
- `test/integration/ledger.integration.spec.ts`
- `test/integration/internal-webhooks.integration.spec.ts`
- `test/integration/payment-links.integration.spec.ts`
- `test/integration/rate-tables.integration.spec.ts`
- `test/integration/settlements.integration.spec.ts`
- `test/integration/fx.integration.spec.ts`
- `test/integration/helpers/integration-app.ts`
- `test/integration/jest.integration.setup.ts`

### Unit backoffice (`apps/psp-backoffice/src`)

- `src/components/payment-methods/payment-method-weight-tab.spec.ts`
- `src/lib/server/internal-route-auth.spec.ts`
- `src/lib/server/internal-route-scope.spec.ts`
- `src/lib/server/backoffice-api.spec.ts`
- `src/lib/server/internal-mutation-guard.spec.ts`
- `src/lib/server/login-rate-limit.spec.ts`
- `src/lib/server/client-ip.spec.ts`
- `src/lib/server/decode-route-path-segment.spec.ts`
- `src/lib/server/merchant-finance-internal-routes.spec.ts`
- `src/lib/server/auth/session-claims.spec.ts`
- `src/proxy.spec.ts`
- `src/app/api/auth/session/route.spec.ts`
- `src/app/api/internal/provider-health/route.spec.ts`
- `src/app/api/internal/payments/[paymentId]/route.spec.ts`
- `src/app/api/internal/merchants/ops/[merchantId]/account/route.spec.ts`
- `src/app/api/public/onboarding/[token]/business-profile/route.spec.ts`

### Unit relevantes API (`apps/psp-api/src`)

- `src/payments-v2/create-payment-intent-payload-hash.spec.ts` (hash idempotencia create: claves ordenadas, trim URLs/textos, email minúsculas)
- `src/payments-v2/decimal-amount-to-minor.spec.ts` (conversión a minor + límite INT32 alineado con `Payment.amountMinor`)
- `src/payments-v2/providers/provider-registry.service.spec.ts`
- `src/payments-v2/providers/acme/acme-provider.adapter.spec.ts`
- `src/payments-v2/payments-v2-merchant-rate-limit.spec.ts`
- `src/payments-v2/payments-v2-merchant-rate-limit.service.spec.ts`
- `src/payments-v2/domain/merchant-notification-url.policy.spec.ts` (URLs merchant para create/resend: HTTPS en prod, hostname multi-etiqueta en prod, sandbox `PSP_ALLOW_HTTP_MERCHANT_CALLBACKS`, rangos privados/metadata en literal IPv4/IPv6 incl. embebidos; **`assertSafeMerchantNotificationOutboundUrl`**: DNS + rechazo si todas las resoluciones son no públicas)
- `src/config/env.validation.spec.ts` (incl. `MERCHANT_ONBOARDING_BASE_URL`, loopback `http` en `NODE_ENV=test`, obligatoriedad fuera de dev/test)
- `src/common/guards/internal-secret.guard.spec.ts`
- `src/common/correlation/correlation-id.spec.ts`
- `src/merchant-onboarding/merchant-onboarding.controller.spec.ts`
- `src/merchant-onboarding/merchant-onboarding.service.spec.ts`
- `src/fees/fee.service.spec.ts`
- `src/ledger/ledger.service.spec.ts`
- `src/merchants/allocate-unique-merchant-mid.spec.ts`
- `src/merchants/mid-allocation-conflict-log.spec.ts`
- `src/settlements/settlement.service.spec.ts`
- `src/merchant-onboarding/onboarding-email.service.spec.ts`
- `src/merchant-onboarding/onboarding-token.service.spec.ts`

### Smoke (`test/smoke`)

- `test/smoke/sandbox.smoke.spec.ts` — `POST /api/v2/payments` con cuerpo v2 (`amount` EUR + `customer` ES + URLs); env opcional `SMOKE_PAYMENT_AMOUNT` / `SMOKE_REQUIRES_ACTION_AMOUNT` (decimales).
- `test/smoke/backoffice-volume-demo.smoke.spec.ts` (solo `npm run test:smoke:backoffice-demo` o `SMOKE_BACKOFFICE_VOLUME_DEMO=1`) — mismo contrato v2; variables de importe `SMOKE_PAYMENT_AMOUNT` / `SMOKE_REQUIRES_ACTION_AMOUNT`. Sin pausa entre create y siguiente POST salvo `SMOKE_BACKOFFICE_DEMO_CREATE_GAP_MS` (p. ej. `2100` si hay `429` por throttle).
- `test/smoke/orchestrator.integration.spec.ts`
- `test/smoke/check-ops-metrics-ci.spec.ts`

### E2E backoffice (`apps/psp-backoffice/e2e`)

- `e2e/auth-and-rbac.spec.ts`

## Comandos de verificacion

Desde `apps/psp-api`:

- `npm run lint`
- `npm run test`
- `npm run test:integration` — requiere `DATABASE_URL` en `apps/psp-api/.env` (o shell); en este entorno de agente **no** se ejecutó por ausencia de variable.
- `npm run test:integration:critical`
- `npm run test:ci:ops-metrics`
- `npm run test:smoke:sandbox`
- `npm run test:smoke:backoffice-demo`

Desde `apps/psp-backoffice`:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run test:e2e` (Playwright; requiere Chromium: `npm run playwright:install` o CI `npm run playwright:install`; **`psp-api`** en `PSP_API_BASE_URL` (p. ej. puerto 3003) y al menos un merchant en DB para que el listado `/merchants` muestre el enlace **Admin**; en CI se crea vía API interna antes del job E2E)

## Regla de mantenimiento

Cuando cambie cualquier test o config de tests (`*.spec.ts`, `test/**`, `jest*.config.*`), actualizar:

1. Matriz de cobertura (estado/notas por dominio).
2. Inventario de archivos.
3. Fecha de ultima actualizacion.
