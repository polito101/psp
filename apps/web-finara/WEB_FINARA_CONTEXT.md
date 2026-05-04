# WEB_FINARA_CONTEXT — Landing Finara (`apps/web-finara`)

Ultima actualizacion: 2026-05-04

Documento **local** del sitio marketing Next.js en este directorio. Integración con `psp-api`, despliegues compartidos y decisiones **globales** del monorepo: **`PROJECT_CONTEXT.md`** (raíz).

## Proposito

- Rutas y BFF propios de la landing (p. ej. **`/merchant-signup`**, `POST /api/merchant-onboarding/applications` → API).
- Stack y convenciones **solo de esta app** (Next.js App Router, Tailwind, `app/`, `lib/`).
- Variables: **`.env.example`** en este directorio.

## Mantenimiento

- Tras cambios en flujos de la web, proxy a API, rate limit o UX de captación, actualizar **este** `WEB_FINARA_CONTEXT.md` en el mismo diff.
- Si el cambio afecta contrato con la API, variables compartidas entre servicios o políticas de seguridad **entre apps**, reflejarlo en **`PROJECT_CONTEXT.md`** (raíz).
