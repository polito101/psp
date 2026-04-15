# Estado de tests

Ultima actualizacion: 2026-04-15

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
| `payments-v2` | Si | Si | Si | Cubierto | Flujos create/get/capture/cancel/refund + idempotencia + rechazo de `paymentLink` no activo/expirado + concurrencia/ops en smoke. |
| `merchants` | No | Si | Parcial | Parcial | Integration cubre create+guard y ciclo revoke/rotate via servicio. Falta spec unitario del controller/service. |
| `payment-links` | No | Si | No | Parcial | Sin endpoint HTTP activo; cobertura via `PaymentLinksService.findForMerchant`. |
| `ledger` | Si | Si | Si | Cubierto | Unit de servicio + integration/smoke de `/api/v1/balance`. |
| `health` | Si | Si | Si | Cubierto | Unit + integration `/health` + smoke readiness. |
| `webhooks` | Si | Si | Si | Cubierto | Unit worker/outbox + integration retry interno + smoke backlog/métricas. |
| `internal endpoints` | Si (guards) | Si | Si | Cubierto | `/api/v2/payments/ops/metrics` + `/api/v2/payments/ops/transactions`, guard `X-Internal-Secret`, hardening del script CI ante redirects/URL insegura y spec dedicada bloqueante en `api-ci`. |

## Inventario actual de archivos

### Integration local (`test/integration`)

- `test/integration/health.integration.spec.ts`
- `test/integration/merchants.integration.spec.ts`
- `test/integration/payments-v2.integration.spec.ts`
- `test/integration/ledger.integration.spec.ts`
- `test/integration/internal-webhooks.integration.spec.ts`
- `test/integration/payment-links.integration.spec.ts`
- `test/integration/helpers/integration-app.ts`
- `test/integration/jest.integration.setup.ts`

### Smoke (`test/smoke`)

- `test/smoke/sandbox.smoke.spec.ts`
- `test/smoke/stripe.smoke.spec.ts`
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
