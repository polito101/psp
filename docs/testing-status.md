# Estado de tests

Ultima actualizacion: 2026-04-30

## Objetivo

Este documento es el estado operativo de cobertura de tests del repo.  
Debe actualizarse en el mismo cambio cuando se agreguen, modifiquen o eliminen tests.

## Tipos de suite

- `unit` (API): specs co-localizados en `apps/psp-api/src/**/*.spec.ts` (`npm run test` desde `apps/psp-api`).
- `unit` (backoffice): libs solo servidor en `apps/psp-backoffice/src/**/*.spec.ts` (`npm run test` desde `apps/psp-backoffice`, Vitest).
- `integration-local`: tests de integracion con app Nest local + Supertest en `apps/psp-api/test/integration/**/*.spec.ts` (`npm run test:integration` desde `apps/psp-api`).
- `smoke`: tests HTTP contra entorno desplegado/base URL en `apps/psp-api/test/smoke/**/*.spec.ts` (`npm run test:smoke:sandbox`).

La CI del monorepo incluye `api-ci` (lint/test/build API), `backoffice-ci` (lint, typecheck, Vitest, Playwright con **`psp-api`** levantado en el mismo job vía Postgres/Redis + migraciones en `127.0.0.1:3003`, validación del proxy a `/api/internal/merchants/ops/directory`, y build del panel), y `web-finara-ci` (solo build estático de la landing en `apps/web-finara`).

## Matriz de cobertura por dominio

| Dominio | Unit | Integration local | Smoke | Estado | Notas |
| --- | --- | --- | --- | --- | --- |
| `payments-v2` | Si | Si | Si | Cubierto | Unit `payments-v2.service.spec`: mocks `merchant.findUnique` + `merchantPaymentMethod` tras `clearAllMocks`; idempotencia 3DS espera `nextAction` mínimo `{ type: '3ds' }`; asserts `ConflictException.getResponse()` toleran cuerpo objeto Nest; `onApplicationBootstrap` legacy stripe usa doble `$queryRaw`. Create v2 sin `provider` en body: ruteo vía `PAYMENTS_PROVIDER_ORDER` + registry inyectable (`PAYMENT_PROVIDERS`); integration setup con `mock`. Flujos create/get/capture/cancel/refund + idempotencia + `paymentLink` + ops. Unit: `ProviderRegistryService`, adapter Acme stub, CB v2 (Redis/fallback, half-open NX con validación env solo si `PAYMENTS_PROVIDER_CB_HALF_OPEN` + `REDIS_URL`, snapshot `circuitState`/`halfOpen`, backoff), cuota merchant (`payments-v2-merchant-rate-limit*.spec.ts`, `PaymentsV2MerchantRateLimitService`; incluye deduplicación heap/indice por bucket), correlación HTTP (`src/common/correlation/correlation-id.spec.ts`, cabeceras `X-Request-Id`/`X-Correlation-Id`). Integration `jest.integration.setup` fuerza `PAYMENTS_PROVIDER_RETRY_BASE_MS=0`. Integration `volume-hourly`: totales/serie como string. Integration dedicada `payments-v2-merchant-rate-limit.integration.spec.ts` (429 + idempotencia sin consumo extra; incluida en `test:integration:critical`). Integration `payments-v2.integration.spec.ts`: aserciones de cabecera `X-Request-Id` en create. |
| `merchants` | No | Si | Parcial | Parcial | Integration cubre create+guard y ciclo revoke/rotate via servicio. Falta spec unitario del controller/service. |
| `payment-links` | No | Si | No | Parcial | Sin endpoint HTTP activo; cobertura via `PaymentLinksService.findForMerchant`. |
| `ledger` | Si | Si | Si | Cubierto | Unit de servicio + integration/smoke de `/api/v1/balance`, incluyendo transición `pending/available` y compatibilidad con asientos legacy `available`. |
| `fees` | Si | Si | No | Cubierto | Unit `FeeService` (fixed/percentage/minimum + resolve active rate table) e integración de endpoints internos para rate tables por merchant/currency/provider. |
| `settlements` | Si | Si | No | Parcial | Unit `SettlementService` (ventanas T+N/WEEKLY, agrupación e idempotencia de payout) e integración `settlements.integration.spec.ts`. Workflow **SettlementRequest** (controller + BFF approve/reject) sin suite dedicada aún. Falta cobertura de chargeback/refund post-payout y estados `SENT/FAILED` del payout. |
| `fx` | Si | Parcial | No | Parcial | Unit `fx-rates.service.spec.ts`; integration `fx.integration.spec.ts` (salta si falta migración/tabla). |
| `backoffice BFF` | Si (proxy + guards + login RL) | No | Playwright smoke | Parcial | Vitest: proxy (`backoffice-api.spec.ts`, mensajes 4xx saneados; `PSP_API_BASE_URL` obligatorio fuera de dev), mutación interna (`internal-mutation-guard.spec.ts`), rate limit login (`login-rate-limit.spec.ts`, barrido/evicción), resolución IP (`client-ip.spec.ts`), rutas API (`provider-health`, `payments`, `auth/session`: RL solo con IP válida + 429 por IP). E2E: `e2e/auth-and-rbac.spec.ts` (redirect login + sesión admin + `/merchants` con `GET /api/internal/merchants/ops/directory` **200** y cabecera de tabla). Cobertura UI ampliada opcional. |
| `web-finara` (marketing) | No | No | No | Solo CI build | Landing estática; sin tests dedicados; build verificado en `web-finara-ci`. |
| `health` | Si | Si | Si | Cubierto | Unit + integration `/health` + smoke readiness. |
| `webhooks` | Si | Si | Si | Cubierto | Unit worker/outbox + integration retry interno + smoke backlog/métricas. |
| `internal endpoints` | Si (guards) | Si | Si | Cubierto | Ops `GET/POST/PATCH` en `/api/v2/payments/ops/*`, `/api/v1/settlements/*`, `/api/v1/merchants/ops/*`: con `X-Internal-Secret` válido exige también `X-Backoffice-Role` (`admin` o `merchant`); rol `merchant` exige `X-Backoffice-Merchant-Id` alineado con path/query (incl. inbox/approve solo admin). Script CI `scripts/ci/check-ops-metrics.mjs` envía `X-Backoffice-Role: admin`. Detalle pago scoped: `404` cross-merchant. Backoffice: proxy fail-closed (`backoffice-api.spec.ts`), middleware por rol, token merchant con `exp`. |

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
- `src/lib/server/merchant-finance-internal-routes.spec.ts`
- `src/lib/server/auth/session-claims.spec.ts`
- `src/proxy.spec.ts`
- `src/app/api/auth/session/route.spec.ts`
- `src/app/api/internal/provider-health/route.spec.ts`
- `src/app/api/internal/payments/[paymentId]/route.spec.ts`

### Unit relevantes API (`apps/psp-api/src`)

- `src/payments-v2/providers/provider-registry.service.spec.ts`
- `src/payments-v2/providers/acme/acme-provider.adapter.spec.ts`
- `src/payments-v2/payments-v2-merchant-rate-limit.spec.ts`
- `src/payments-v2/payments-v2-merchant-rate-limit.service.spec.ts`
- `src/config/env.validation.spec.ts`
- `src/common/correlation/correlation-id.spec.ts`
- `src/fees/fee.service.spec.ts`
- `src/ledger/ledger.service.spec.ts`
- `src/settlements/settlement.service.spec.ts`

### Smoke (`test/smoke`)

- `test/smoke/sandbox.smoke.spec.ts`
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
