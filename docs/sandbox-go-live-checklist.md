# Sandbox Go-Live Checklist

## CI/CD

- [ ] Workflow único activo (`.github/workflows/ci.yml`).
- [ ] Job `api-ci` verde (lint, test, build).
- [ ] Job `sandbox-deploy` verde en branch `sandbox` (incluye build Docker + hook + migrate + smoke).
- [ ] Migrations ejecutadas con `prisma migrate deploy` tras el deploy hook.

## Seguridad mínima

- [ ] `ENABLE_SWAGGER` controlado por entorno.
- [ ] `CORS_ALLOWED_ORIGINS` definido (no wildcard).
- [ ] `INTERNAL_API_SECRET` y `APP_ENCRYPTION_KEY` configurados como secretos.
- [ ] `APP_ENCRYPTION_KEY` con longitud >= 32.

## Operación

- [ ] `/health` responde `ok` o `degraded` controlado.
- [ ] Smoke tests de flujo crítico en verde.
- [ ] Runbook actualizado (`docs/sandbox-runbook.md`).
- [ ] Matriz de variables actualizada (`docs/sandbox-env.md`).

## Aprobación

- [ ] Responsable técnico valida release.
- [ ] QA interno valida flujo principal de pagos.
- [ ] Registro de release guardado (fecha + commit + pipeline).
