# Sandbox Go-Live Checklist

## CI/CD

- [ ] Workflow único activo (`.github/workflows/ci.yml`).
- [ ] Job `api-ci` verde (lint, test, build).
- [ ] Job `sandbox-deploy` verde en branch `sandbox` (incluye validación de build Docker + migrate + hook + readiness + gate `ops/metrics` + smoke).
- [ ] Migrations ejecutadas con `prisma migrate deploy` antes del deploy hook (exigir migraciones backward-compatible durante rollout).

## Seguridad mínima

- [ ] `ENABLE_SWAGGER` controlado por entorno.
- [ ] `CORS_ALLOWED_ORIGINS` definido (no wildcard).
- [ ] `INTERNAL_API_SECRET` y `APP_ENCRYPTION_KEY` configurados como secretos.
- [ ] `APP_ENCRYPTION_KEY` con longitud >= 32.

## Operación

- [ ] Gate de readiness exige `/health` con `status=ok` y checks `db=ok`, `redis=ok`.
- [ ] Gate de readiness operativo (`/api/v2/payments/ops/metrics`) en verde.
- [ ] Smoke tests de flujo crítico en verde.
- [ ] Runbook actualizado (`docs/sandbox-runbook.md`).
- [ ] Matriz de variables actualizada (`docs/sandbox-env.md`).

## Aprobación

- [ ] Responsable técnico valida release.
- [ ] QA interno valida flujo principal de pagos.
- [ ] Registro de release guardado (fecha + commit + pipeline).
