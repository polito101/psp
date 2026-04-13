# Sandbox Runbook

## 1. Deploy estándar

1. Hacer merge a `sandbox`.
2. Verificar workflow `CI` en GitHub Actions.
3. Confirmar ejecución de:
   - Build de imagen Docker (`psp-api:sandbox`)
   - Trigger de deploy (hook)
   - `Prisma migrate deploy`
   - Health check `/health`
   - `test:smoke:sandbox`

## 2. Rollback

1. Revertir commit en `sandbox`.
2. Re-disparar pipeline.
3. Validar `/health` y smoke tests.

Si la migración de DB fue no compatible hacia atrás, aplicar rollback de esquema según política de migraciones (evitar cambios destructivos en sandbox compartido sin ventana de coordinación).

## 3. Rotación de secretos

- Secretos críticos:
  - `INTERNAL_API_SECRET`
  - `APP_ENCRYPTION_KEY`
  - credenciales en `DATABASE_URL`
  - credenciales en `REDIS_URL`
- Pasos:
  1. actualizar secreto en environment `sandbox`,
  2. redeploy,
  3. validar health + smoke.

## 4. Diagnóstico rápido

- `401` generalizado: revisar `INTERNAL_API_SECRET` y `X-API-Key`.
- `500` en arranque: validar `DATABASE_URL` / `APP_ENCRYPTION_KEY`.
- `health` degradado: revisar conectividad de Redis o PostgreSQL.
- Smoke fallando en `merchants`: validar secreto interno y CORS/origen si aplica frontend.

## 5. Evidencias mínimas por release

- URL del workflow exitoso.
- Hora de deploy.
- Resultado de smoke tests.
- Responsable de aprobación interna.
