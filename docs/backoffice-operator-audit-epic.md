# Epic posterior: operadores nombrados y auditoría persistente

Este documento **no** forma parte del alcance implementado en la mejora MVP del backoffice; resume lo necesario para sustituir `BACKOFFICE_ADMIN_SECRET` compartido por identidades auditables.

## Objetivo

- Login admin por **usuario** (email/sub) con contraseña u OTP/SSO, no un único secreto global.
- **Audit log** inmutable de acciones sensibles (aprobar/rechazar settlements, toggles merchant/payment-method, cambios de configuración).
- Posible **revocación** de sesión y rotación de credenciales por operador.

## Dependencias (psp-api / DB)

- Tablas sugeridas: `BackofficeOperator`, `BackofficeSession` (opcional), `BackofficeAuditEvent` (actor, acción, recurso, payload hash, timestamp, IP opcional).
- Migración Prisma en `apps/psp-api/prisma/migrations/`.
- Endpoints internos protegidos con `InternalSecretGuard` + nuevo guard para JWT/sesión operador (o reuse de patrón OAuth/OIDC si se adopta SSO).

## Cambios en backoffice

- `POST /api/auth/session`: modo admin orientado a usuario/contraseña (o flujo OIDC callback) que emite JWT con `sub` estable (id operador).
- BFF: propagar identidad operador en cabeceras hacia `psp-api` si la API valida auditoría (`X-Backoffice-Operator-Id`, etc.).
- UI: pantalla `/operations/audit` (solo admin) listando eventos recientes con filtros.

## Criterios de aceptación

- Ningún secreto global único para todos los admins en producción.
- Cada mutación sensible genera fila de auditoría consultable con actor y correlación (`X-Request-Id` si existe).
- Tests de integración API + tests Vitest BFF para claims nuevos.
