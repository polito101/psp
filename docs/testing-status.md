# Estado de tests

Ultima actualizacion: 2026-05-04

## Objetivo

Este documento es el estado operativo de cobertura de tests del repo.  
Debe actualizarse en el mismo cambio cuando se agreguen, modifiquen o eliminen tests.

## Tipos de suite

- `unit` (API): specs co-localizados en `apps/psp-api/src/**/*.spec.ts` (`npm run test` desde `apps/psp-api`).
- `unit` (backoffice): libs solo servidor en `apps/psp-backoffice/src/**/*.spec.ts` (`npm run test` desde `apps/psp-backoffice`, Vitest).
- `integration-local`: tests de integracion con app Nest local + Supertest en `apps/psp-api/test/integration/**/*.spec.ts` (`npm run test:integration` desde `apps/psp-api`).
- `smoke`: tests HTTP contra entorno desplegado/base URL en `apps/psp-api/test/smoke/**/*.spec.ts` (`npm run test:smoke:sandbox`). Volumen demo backoffice (no incluido en sandbox por defecto): `npm run test:smoke:backoffice-demo` (`backoffice-volume-demo.smoke.spec.ts`).

La CI del monorepo incluye `api-ci` (lint/test/build API), `backoffice-ci` (lint, typecheck, Vitest, Playwright con **`psp-api`** levantado en el mismo job vía Postgres/Redis + migraciones en `127.0.0.1:3003`, validación del proxy a `/api/internal/merchants/ops/directory`, y build del panel), y `web-finara-ci` (typecheck vía `next typegen` + `tsc --noEmit`, y build de la landing en `apps/web-finara`).

## Matriz de cobertura por dominio

| Dominio | Unit | Integration local | Smoke | Estado | Notas |
| --- | --- | --- | --- | --- | --- |
| `payments-v2` | Si | Si | Si | Cubierto | Unit `payments-v2.service.spec`: mocks `merchant.findUnique` + `merchantPaymentMethod` tras `clearAllMocks`; idempotencia 3DS espera `nextAction` mínimo `{ type: '3ds' }`; asserts `ConflictException.getResponse()` toleran cuerpo objeto Nest; `onApplicationBootstrap` legacy stripe usa doble `$queryRaw`. Create v2 sin `provider` en body: ruteo vía `PAYMENTS_PROVIDER_ORDER` + registry inyectable (`PAYMENT_PROVIDERS`); integration setup con `mock`. Flujos create/get/capture/cancel/refund + idempotencia + `paymentLink` + ops. Unit: `ProviderRegistryService`, adapter Acme stub, CB v2 (Redis/fallback, half-open NX con validación env solo si `PAYMENTS_PROVIDER_CB_HALF_OPEN` + `REDIS_URL`, snapshot `circuitState`/`halfOpen`, backoff), reintento transitorio unit valida ms vía spy de `sleep` (no wall-clock `Date.now`); cuota merchant (`payments-v2-merchant-rate-limit*.spec.ts`, `PaymentsV2MerchantRateLimitService`; incluye deduplicación heap/indice por bucket), correlación HTTP (`src/common/correlation/correlation-id.spec.ts`, cabeceras `X-Request-Id`/`X-Correlation-Id`). Integration `jest.integration.setup` fuerza `PAYMENTS_PROVIDER_RETRY_BASE_MS=0`. Integration `volume-hourly`: totales/serie como string. Integration dedicada `payments-v2-merchant-rate-limit.integration.spec.ts` (429 + idempotencia sin consumo extra; incluida en `test:integration:critical`). Integration `payments-v2.integration.spec.ts`: aserciones de cabecera `X-Request-Id` en create. |
| `merchants` | No | Si | Parcial | Parcial | Integration cubre create+guard, ciclo revoke/rotate via servicio, y ops `GET .../ops/:id/detail` + `PATCH .../ops/:id/account` (normalización email, 409 duplicado). Falta spec unitario del controller/service. |
| `merchant-onboarding` | Si | No | No | Parcial | Unit `merchant-onboarding.service.spec.ts`: creación pública con `409` si email de expediente o `Merchant.email` ya existe (y P2002 equivalente); perfil negocio `companyName`/`industry`/`websiteUrl` + sync `Merchant`; checklist, token, eventos; approve/reject (email decisión); `listApplications` con `q`; barrera advisory + lock; portal login; `merchant-onboarding.controller.spec.ts`. Unit email/token. Integración HTTP pendiente. |
| `payment-links` | No | Si | No | Parcial | Sin endpoint HTTP activo; cobertura via `PaymentLinksService.findForMerchant`. |
| `ledger` | Si | Si | Si | Cubierto | Unit de servicio + integration/smoke de `/api/v1/balance`, incluyendo transición `pending/available` y compatibilidad con asientos legacy `available`. |
| `fees` | Si | Si | No | Cubierto | Unit `FeeService` (fixed/percentage/minimum + resolve active rate table) e integración de endpoints internos para rate tables por merchant/currency/provider. |
| `settlements` | Si | Si | No | Parcial | Unit `SettlementService` (ventanas T+N/WEEKLY, agrupación e idempotencia de payout) e integración `settlements.integration.spec.ts`. Workflow **SettlementRequest** (controller + BFF approve/reject) sin suite dedicada aún. Falta cobertura de chargeback/refund post-payout y estados `SENT/FAILED` del payout. |
| `fx` | Si | Parcial | No | Parcial | Unit `fx-rates.service.spec.ts`; integration `fx.integration.spec.ts` (salta si falta migración/tabla). |
| `backoffice BFF` | Si (proxy + guards + login RL + portal mode) | No | Playwright smoke | Parcial | Vitest: proxy (`proxy.spec.ts`: merchant vs admin login path, sesión con `onboardingStatus`, `/merchant-status` vs páginas operativas, sesión cruzada ignorada, `/onboarding/*` público sin sesión en modos merchant y admin), BFF proxy (`backoffice-api.spec.ts`: fail-closed RBAC para payments/settlements/merchants ops y `merchant-onboarding/ops` excepto `merchant-login`; `proxyPublicGet/Post` sin `X-Internal-Secret`, redirect manual y errores seguros), mutación interna (`internal-mutation-guard.spec.ts`: `Origin` vs `nextUrl`; sin trust forward (`TRUST_BACKOFFICE_FORWARDED_ORIGIN_HEADERS` ausente y runtime `VERCEL`/`CF_PAGES`/`RENDER` off) no se valida `Origin` vía cabeceras `X-Forwarded-*`; con `TRUST_BACKOFFICE_FORWARDED_ORIGIN_HEADERS=true` o `RENDER=true`, `Host` + último segmento de `X-Forwarded-Proto` y fallback último segmento de `X-Forwarded-Host`), rate limit login (`login-rate-limit.spec.ts`: multi-clave, dedupe, barrido/evicción; sin IP + fingerprint comparte bucket global `LOGIN_RATE_LIMIT_UNRESOLVED_KEY` para anti-bypass por UA), resolución IP (`client-ip.spec.ts`: XFF/X-Real-IP solo con `TRUST_X_FORWARDED_FOR`; `x-vercel-forwarded-for` / `cf-connecting-ip` ignoradas por defecto salvo `VERCEL=1`, `CF_PAGES=1` u opt-in `TRUST_PLATFORM_IP_HEADERS` / flags granulares; `console.warn` throttled ~60s si llegan esas cabeceras pero trust off → misconfiguration detrás de proxy; clave RL sin IP = fingerprint `__psp_bo_login_rl_fp:…` o sentinel global), `portal-mode.spec.ts` (fail-fast si `BACKOFFICE_PORTAL_MODE` y `NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE` discrepan), `enforceInternalRouteAuth` con `BACKOFFICE_PORTAL_MODE` y bloqueo merchant no `ACTIVE` (`internal-route-auth.spec.ts`), `session-claims.spec.ts` (`rejectionReason` en JWT recortado por bytes UTF-8 para no romper cookies), decodificación segura de segmentos de path (`decode-route-path-segment.spec.ts`; percent-encoding inválido → 400 en rutas onboarding BFF), rutas API (`provider-health`, `payments`, `auth/session` con mock de `proxyInternalPost` para login merchant, onboarding público business-profile: body inválido 400, body válido usa proxy público, upstream error seguro; **`internal/merchants/ops/[merchantId]/account`** (PATCH cuenta: 400 si body inválido, éxito con `proxyInternalPatch` + alcance admin); `route.spec` sentinela vs fingerprint + 429 al rotar UA; mismatch env → 500 en session). E2E: `e2e/auth-and-rbac.spec.ts` usa portal **admin** (redirect `/admin/login` sin cookie; login API admin + `/merchants` + enlace **Admin** → pestañas Account / Application Form / Payment Methods). |
| `web-finara` (marketing) | No | No | No | Solo CI build | Landing estática enlazando login merchant configurado por env; `.env.example` con `NEXT_PUBLIC_MERCHANT_BACKOFFICE_URL`; `web-finara-ci` ejecuta `npm run typecheck` (`next typegen` + `tsc --noEmit`) y `npm run build`. |
| `health` | Si | Si | Si | Cubierto | Unit + integration `/health` + smoke readiness. |
| `webhooks` | Si | Si | Si | Cubierto | Unit worker/outbox + integration retry interno + smoke backlog/métricas. |
| `internal endpoints` | Si (guards) | Si | Si | Cubierto | Ops `GET/POST/PATCH` en `/api/v2/payments/ops/*`, `/api/v1/settlements/*`, `/api/v1/merchants/ops/*`: con `X-Internal-Secret` válido exige también `X-Backoffice-Role` (`admin` o `merchant`); rol `merchant` exige `X-Backoffice-Merchant-Id` alineado con path/query (incl. inbox/approve solo admin). `/api/v1/merchant-onboarding/ops/*` es admin-only fail-closed salvo ruta **`.../ops/merchant-login`** exacta al final del path (no substring; rutas tipo `merchant-login-*` siguen admin-only). Solo secreto interno en ese login, sin rol admin. Script CI `scripts/ci/check-ops-metrics.mjs` envía `X-Backoffice-Role: admin`. Detalle pago scoped: `404` cross-merchant. Backoffice: proxy fail-closed (`backoffice-api.spec.ts`; mismas reglas de exención exacta para `merchant-login`), middleware por rol, sesión merchant con `onboardingStatus` en JWT. |

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

- `src/payments-v2/providers/provider-registry.service.spec.ts`
- `src/payments-v2/providers/acme/acme-provider.adapter.spec.ts`
- `src/payments-v2/payments-v2-merchant-rate-limit.spec.ts`
- `src/payments-v2/payments-v2-merchant-rate-limit.service.spec.ts`
- `src/config/env.validation.spec.ts` (incl. `MERCHANT_ONBOARDING_BASE_URL`, loopback `http` en `NODE_ENV=test`, obligatoriedad fuera de dev/test)
- `src/common/guards/internal-secret.guard.spec.ts`
- `src/common/correlation/correlation-id.spec.ts`
- `src/merchant-onboarding/merchant-onboarding.controller.spec.ts`
- `src/merchant-onboarding/merchant-onboarding.service.spec.ts`
- `src/fees/fee.service.spec.ts`
- `src/ledger/ledger.service.spec.ts`
- `src/settlements/settlement.service.spec.ts`
- `src/merchant-onboarding/onboarding-email.service.spec.ts`
- `src/merchant-onboarding/onboarding-token.service.spec.ts`

### Smoke (`test/smoke`)

- `test/smoke/sandbox.smoke.spec.ts`
- `test/smoke/backoffice-volume-demo.smoke.spec.ts` (solo `npm run test:smoke:backoffice-demo` o `SMOKE_BACKOFFICE_VOLUME_DEMO=1`)
- `test/smoke/orchestrator.integration.spec.ts`
- `test/smoke/check-ops-metrics-ci.spec.ts`

### E2E backoffice (`apps/psp-backoffice/e2e`)

- `e2e/auth-and-rbac.spec.ts`

## Comandos de verificacion

Desde `apps/psp-api`:

- `npm run lint`
- `npm run test`
- `npm run test:integration`
- `npm run test:integration:critical`
- `npm run test:ci:ops-metrics`
- `npm run test:smoke:sandbox`
- `npm run test:smoke:backoffice-demo`

Desde `apps/psp-backoffice`:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run test:e2e` (Playwright; requiere Chromium: `npm run playwright:install` o CI `npm run playwright:install`; el smoke de merchants exige **`psp-api`** en `PSP_API_BASE_URL`, p. ej. el job `backoffice-ci` lo arranca en el puerto 3003)

## Regla de mantenimiento

Cuando cambie cualquier test o config de tests (`*.spec.ts`, `test/**`, `jest*.config.*`), actualizar:

1. Matriz de cobertura (estado/notas por dominio).
2. Inventario de archivos.
3. Fecha de ultima actualizacion.
