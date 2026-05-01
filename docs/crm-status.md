# CRM Status

Ultima actualizacion: 2026-05-01

## Alcance actual

- CRM orientado a merchants.
- Primer modulo: onboarding y seguimiento de status.
- Flujo aprobado: signup publico -> merchant inactivo + expediente -> link Resend -> formulario negocio -> revision -> aprobado/rechazado -> activo.

## Estado de implementacion

- Diseno aprobado: `docs/superpowers/specs/2026-04-30-merchant-onboarding-crm-design.md`.
- Plan aprobado: `docs/superpowers/plans/2026-04-30-merchant-onboarding-crm.md`.
- API (`psp-api`): onboarding publico (POST aplicaciones, token, perfil negocio) + ops internos + CRM listado/detalle/acciones.
- Backoffice (`psp-backoffice`): onboarding por token `/onboarding/[token]`; CRM admin `/crm/onboarding` y detalle.
- Marketing (`web-finara`): captacion publica `/merchant-signup` con proxy server `POST /api/merchant-onboarding` → `psp-api` (`PSP_API_BASE_URL`).
- Pendiente: revision final de documentacion transversal (`PROJECT_CONTEXT.md`, README/env) y verificacion e2e del flujo completo.

## Proximas extensiones fuera de esta fase

- KYC externo.
- Subida real de documentos.
- Operadores nominales y auditoria persistente.
- Tareas, notas, pipeline comercial y soporte.

## Mantenimiento

Actualizar este archivo cuando cambie el alcance del CRM, rutas, modelo de estados, estado de implementacion o roadmap de siguientes fases.
