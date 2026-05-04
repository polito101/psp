# API_CONTEXT — PSP API (`apps/psp-api`)

Ultima actualizacion: 2026-05-04

Documento **local** del servicio NestJS en este directorio. Visión global del monorepo, contratos entre apps y decisiones **transversales o prioritarias** siguen en **`PROJECT_CONTEXT.md`** (raíz): si algo cambia allí a nivel producto/infra/seguridad cruzada, actualizar también ese archivo (resumen o sección correspondiente).

## Proposito

- Convenciones y detalle **solo de esta API**: módulos bajo `src/`, Prisma bajo `prisma/`, tests en `src/**/*.spec.ts` y `test/`.
- Arranque, variables y flujos de desarrollo: **`README.md`** en este mismo directorio (comandos, sandbox, Prisma 7).

## Mantenimiento

- Tras cambios relevantes en dominios, rutas versionadas, idempotencia, guards internos o modelo de datos **propios del API**, actualizar **este** `API_CONTEXT.md` en el mismo diff.
- Si el cambio es **estratégico** (nuevo contrato público mayor, política de seguridad que afecta a más apps, CI/deploy, decisiones que un nuevo dev debe ver primero), documentar la decisión en **`PROJECT_CONTEXT.md`** (raíz), no solo aquí.
