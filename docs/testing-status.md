# Estado de tests

Ultima actualizacion: 2026-04-18

## Objetivo

Este documento es el estado operativo de cobertura de tests del repo.  
Debe actualizarse en el mismo cambio cuando se agreguen, modifiquen o eliminen tests.

## Tipos de suite

- `unit`: specs co-localizados en `src/**/*.spec.ts` (`npm run test`).
- `integration-local`: tests de integracion con app Nest local + Supertest en `test/integration/**/*.spec.ts` (`npm run test:integration`).
- `smoke`: tests HTTP contra entorno desplegado/base URL en `test/smoke/**/*.spec.ts` (`npm run test:smoke:sandbox`, `npm run test:smoke:stripe`).

## Matriz de cobertura por dominio

| Dominio | Unit | Integration local | Smoke | Estado | Notas |
| --- | --- | --- | --- | --- | --- |
| `payments-v2` | Si | Si | Si | Cubierto | Create v2 sin `provider` en body: ruteo vía `PAYMENTS_PROVIDER_ORDER` + registry inyectable (`PAYMENT_PROVIDERS`); integration setup `mock,stripe`; smoke sandbox/stripe según orden en host. Flujos create/get/capture/cancel/refund + idempotencia + `paymentLink` + ops + webhooks Stripe (incl. disputas, `SMOKE_STRIPE_DISPUTE_PM_MATRIX`) + outbound E2E. Unit: `ProviderRegistryService`, adapter Acme stub, Stripe en `providers/stripe/`, CB v2 (Redis/fallback, half-open NX con validación env solo si `PAYMENTS_PROVIDER_CB_HALF_OPEN` + `REDIS_URL`, snapshot `circuitState`/`halfOpen`, backoff), cuota merchant (`payments-v2-merchant-rate-limit*.spec.ts`, `PaymentsV2MerchantRateLimitService`), correlación HTTP (`src/common/correlation/correlation-id.spec.ts`, cabeceras `X-Request-Id`/`X-Correlation-Id` + metadata Stripe). Integration `jest.integration.setup` fuerza `PAYMENTS_PROVIDER_RETRY_BASE_MS=0`. Integration `volume-hourly`: totales/serie como string. Integration dedicada `payments-v2-merchant-rate-limit.integration.spec.ts` (429 + idempotencia sin consumo extra; incluida en `test:integration:critical`). Integration `payments-v2.integration.spec.ts`: aserciones de cabecera `X-Request-Id` en create. |
| `merchants` | No | Si | Parcial | Parcial | Integration cubre create+guard y ciclo revoke/rotate via servicio. Falta spec unitario del controller/service. |
| `payment-links` | No | Si | No | Parcial | Sin endpoint HTTP activo; cobertura via `PaymentLinksService.findForMerchant`. |
| `ledger` | Si | Si | Si | Cubierto | Unit de servicio + integration/smoke de `/api/v1/balance`. |
| `health` | Si | Si | Si | Cubierto | Unit + integration `/health` + smoke readiness. |
| `webhooks` | Si | Si | Si | Cubierto | Unit worker/outbox + integration retry interno + inbound Stripe firmado (firma/tolerancia/json/payload) + outbound a receptor real con worker + smoke backlog/métricas. |
| `internal endpoints` | Si (guards) | Si | Si | Cubierto | `/api/v2/payments/ops/metrics`, `/api/v2/payments/ops/transactions` (cursor por `createdAt/id`; `includeTotal=false` sin COUNT), `/api/v2/payments/ops/transactions/counts` (`groupBy` status), `/api/v2/payments/ops/transactions/volume-hourly` (volumen succeeded acumulado por hora UTC hoy vs ayer según `succeeded_at`; payload con enteros minor como string), guard `X-Internal-Secret`, hardening del script CI ante redirects/URL insegura y spec dedicada bloqueante en `api-ci`. |

## Inventario actual de archivos

### Integration local (`test/integration`)

- `test/integration/health.integration.spec.ts`
- `test/integration/merchants.integration.spec.ts`
- `test/integration/payments-v2.integration.spec.ts`
- `test/integration/payments-v2-merchant-rate-limit.integration.spec.ts`
- `test/integration/ledger.integration.spec.ts`
- `test/integration/internal-webhooks.integration.spec.ts`
- `test/integration/stripe-webhooks.integration.spec.ts`
- `test/integration/stripe-webhooks-outbound.integration.spec.ts`
- `test/integration/payment-links.integration.spec.ts`
- `test/integration/helpers/integration-app.ts`
- `test/integration/jest.integration.setup.ts`

### Unit relevantes (`src`)

- `src/payments-v2/payments-v2.service.spec.ts`
- `src/payments-v2/providers/provider-registry.service.spec.ts`
- `src/payments-v2/providers/stripe/stripe-provider.adapter.spec.ts`
- `src/payments-v2/providers/acme/acme-provider.adapter.spec.ts`
- `src/payments-v2/stripe-webhook.controller.spec.ts`
- `src/payments-v2/payments-v2-merchant-rate-limit.spec.ts`
- `src/payments-v2/payments-v2-merchant-rate-limit.service.spec.ts`
- `src/config/env.validation.spec.ts`
- `src/common/correlation/correlation-id.spec.ts`

### Smoke (`test/smoke`)

- `test/smoke/sandbox.smoke.spec.ts`
- `test/smoke/stripe.smoke.spec.ts`
- `test/smoke/stripe-dispute-payment-methods.smoke.spec.ts` (matriz `pm_card_createDispute*`, gated por `SMOKE_STRIPE_DISPUTE_PM_MATRIX=true`)
- `test/smoke/orchestrator.integration.spec.ts`
- `test/smoke/check-ops-metrics-ci.spec.ts`

## Comandos de verificacion

Desde `apps/psp-api`:

- `npm run lint`
- `npm run test`
- `npm run test:integration`
- `npm run test:integration:critical`
- `npm run test:ci:ops-metrics`
- `npm run test:smoke:sandbox`
- `npm run test:smoke:stripe`

## Regla de mantenimiento

Cuando cambie cualquier test o config de tests (`*.spec.ts`, `test/**`, `jest*.config.*`), actualizar:

1. Matriz de cobertura (estado/notas por dominio).
2. Inventario de archivos.
3. Fecha de ultima actualizacion.
