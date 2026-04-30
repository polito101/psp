# Merchant Onboarding CRM Design

Fecha: 2026-04-30

## Objetivo

Construir el primer módulo de un CRM completo orientado a merchants, integrado en el backoffice existente. El alcance inicial prioriza onboarding y seguimiento de estado: un merchant puede solicitar trabajar con la plataforma desde la web pública, recibir un link temporal, completar datos básicos de negocio y quedar en revisión para aprobación o rechazo desde el CRM interno.

El diseño debe permitir crecer después hacia un CRM completo con operadores, notas, tareas, documentos reales, pipeline comercial, soporte y auditoría persistente, sin mezclar esa información con la entidad operativa de pagos.

## Alcance Inicial

El primer flujo funcional cubre:

1. Registro público desde `apps/web-finara` con nombre, email y teléfono.
2. Creación de un `Merchant` real, inicialmente inactivo.
3. Creación de un expediente de onboarding/CRM separado.
4. Creación de checklist inicial e historial de eventos.
5. Generación de link temporal de onboarding.
6. Envío del link por email usando Resend.
7. En `development`/`sandbox`, exposición del link en la respuesta para pruebas.
8. Formulario público de onboarding en `apps/psp-backoffice` bajo una ruta previa al login.
9. Revisión, aprobación o rechazo desde el backoffice admin.
10. Activación del merchant solo al aprobar el expediente.

Fuera del alcance de esta primera fase:

- KYC externo.
- Subida real de documentos.
- Usuarios operadores individuales con login nominal.
- Tareas, calendario, pipeline comercial y tickets de soporte.
- Email templates complejos o campañas.

## Arquitectura

Se añade un dominio NestJS nuevo en `apps/psp-api/src/merchant-onboarding`.

Responsabilidades del dominio:

- Recibir solicitudes públicas de merchants.
- Crear `Merchant` inactivo y expediente asociado.
- Gestionar tokens de onboarding.
- Persistir checklist e historial.
- Enviar email de onboarding por Resend.
- Recibir datos de negocio enviados desde el link.
- Exponer endpoints internos para CRM admin.
- Ejecutar aprobación/rechazo y activar el merchant cuando corresponda.

El `Merchant` sigue siendo la entidad operativa para pagos. El expediente de onboarding es la entidad CRM que captura workflow, estado, datos de negocio, checklist e historial.

## Modelo De Datos

### Merchant

Se reutiliza el modelo existente de merchants. La solicitud pública crea un merchant técnico con `active=false`.

Al aprobar el expediente, el sistema actualiza `Merchant.active=true`. Al rechazarlo, permanece inactivo.

### MerchantOnboardingApplication

Expediente principal del CRM de onboarding.

Campos esperados:

- `id`
- `merchantId`
- `status`
- `contactName`
- `contactEmail`
- `contactPhone`
- `tradeName`
- `legalName`
- `country`
- `website`
- `businessType`
- `rejectionReason`
- `submittedAt`
- `reviewedAt`
- `approvedAt`
- `rejectedAt`
- `activatedAt`
- `createdAt`
- `updatedAt`

Estados iniciales:

- `account_created`
- `documentation_pending`
- `in_review`
- `approved`
- `rejected`
- `active`

### MerchantOnboardingChecklistItem

Checklist visible en CRM para saber qué falta o qué ya ocurrió.

Campos esperados:

- `id`
- `applicationId`
- `key`
- `label`
- `status`
- `completedAt`
- `createdAt`
- `updatedAt`

Checklist inicial:

- `basic_contact_created`
- `business_profile_submitted`
- `internal_review`
- `approval_decision`
- `merchant_activation`

Estados de item:

- `pending`
- `completed`
- `blocked`

### MerchantOnboardingEvent

Historial/audit trail del expediente.

Campos esperados:

- `id`
- `applicationId`
- `type`
- `actorType`
- `actorId`
- `message`
- `metadata`
- `createdAt`

`actorType` inicial:

- `system`
- `merchant`
- `admin`

Eventos iniciales:

- `application_created`
- `onboarding_link_created`
- `onboarding_email_sent`
- `onboarding_email_failed`
- `business_profile_submitted`
- `application_approved`
- `application_rejected`
- `merchant_activated`
- `onboarding_link_resent`

### MerchantOnboardingToken

Token temporal para acceder al formulario de onboarding.

Campos esperados:

- `id`
- `applicationId`
- `tokenHash`
- `expiresAt`
- `usedAt`
- `revokedAt`
- `createdAt`

El token en claro solo se muestra o envía en el momento de creación. La base de datos guarda únicamente el hash.

## Flujo Público De Captación

### Registro En Web Finara

`apps/web-finara` incorpora una ruta o sección pública, por ejemplo `/merchant-signup`, con un formulario de tres campos:

- nombre
- email
- teléfono

El frontend llama a un endpoint público de `psp-api`, por ejemplo:

`POST /api/v1/merchant-onboarding/applications`

La API valida los datos, crea el merchant inactivo, crea el expediente, crea el checklist, genera el token y envía el email por Resend.

Respuesta esperada:

- En `development`/`sandbox`: incluye una URL de onboarding para facilitar pruebas.
- En producción: no incluye el token si el email fue enviado correctamente.

Si Resend falla, la solicitud no se revierte: el expediente queda creado, se registra `onboarding_email_failed` y el CRM puede reintentar el envío.

### Link De Onboarding

El link apunta al portal merchant/backoffice, por ejemplo:

`https://<merchant-backoffice>/onboarding/<token>`

La ruta vive en `apps/psp-backoffice`, fuera de sesión, antes del login. El formulario valida el token contra la API antes de mostrar los campos.

Campos del formulario:

- nombre comercial
- razón social
- país
- web
- tipo de negocio

Al enviar, el backoffice llama a la API para guardar esos datos y mover el expediente a `in_review`. El token queda usado o invalidado para evitar reutilización.

## CRM En Backoffice Admin

Se añade una sección CRM al portal admin de `apps/psp-backoffice`.

Rutas propuestas:

- `/crm/onboarding`
- `/crm/onboarding/[applicationId]`

La lista muestra:

- merchant
- contacto
- email
- teléfono
- estado
- fecha de creación
- fecha de envío a revisión
- acciones rápidas

La vista detalle muestra:

- datos de contacto
- datos de empresa
- estado actual
- checklist
- historial
- acciones admin

Acciones iniciales:

- aprobar expediente
- rechazar expediente con motivo
- reenviar link de onboarding
- consultar checklist

La aprobación debe ejecutar una transición atómica:

1. Marcar expediente como `approved`.
2. Marcar checklist `approval_decision` como completado.
3. Activar el merchant (`Merchant.active=true`).
4. Marcar expediente como `active`.
5. Marcar checklist `merchant_activation` como completado.
6. Registrar eventos `application_approved` y `merchant_activated`.

El rechazo debe:

1. Marcar expediente como `rejected`.
2. Guardar `rejectionReason`.
3. Mantener `Merchant.active=false`.
4. Marcar checklist `approval_decision` como completado o bloqueado, según implementación.
5. Registrar `application_rejected`.

## API Y BFF

### Endpoints Públicos

Endpoints candidatos en `psp-api`:

- `POST /api/v1/merchant-onboarding/applications`
- `GET /api/v1/merchant-onboarding/tokens/:token`
- `POST /api/v1/merchant-onboarding/tokens/:token/business-profile`

Estos endpoints no usan sesión backoffice. Deben tener validación DTO, rate limiting y respuestas seguras.

### Endpoints Internos Admin

Endpoints candidatos:

- `GET /api/v1/merchant-onboarding/ops/applications`
- `GET /api/v1/merchant-onboarding/ops/applications/:applicationId`
- `POST /api/v1/merchant-onboarding/ops/applications/:applicationId/approve`
- `POST /api/v1/merchant-onboarding/ops/applications/:applicationId/reject`
- `POST /api/v1/merchant-onboarding/ops/applications/:applicationId/resend-link`

Estos endpoints se protegen con `InternalSecretGuard`. El BFF del backoffice añade `X-Internal-Secret` server-side y exige sesión admin.

### BFF Backoffice

Rutas candidatas en `apps/psp-backoffice`:

- `GET /api/public/onboarding/[token]`
- `POST /api/public/onboarding/[token]/business-profile`
- `GET /api/internal/crm/onboarding`
- `GET /api/internal/crm/onboarding/[applicationId]`
- `POST /api/internal/crm/onboarding/[applicationId]/approve`
- `POST /api/internal/crm/onboarding/[applicationId]/reject`
- `POST /api/internal/crm/onboarding/[applicationId]/resend-link`

Las rutas públicas no requieren cookie de sesión. Las rutas internas siguen el patrón actual:

- JWT `backoffice_session`
- rol admin
- cabecera `X-Backoffice-Mutation: 1` en mutaciones
- validación de `Origin`
- secretos solo server-side

## Email Con Resend

`psp-api` añade un servicio de email con interfaz interna para no acoplar el caso de uso a Resend directamente.

Variables de entorno candidatas:

- `RESEND_API_KEY`
- `ONBOARDING_EMAIL_FROM`
- `MERCHANT_ONBOARDING_BASE_URL`
- `MERCHANT_ONBOARDING_TOKEN_TTL_HOURS`

Comportamiento:

- Si Resend está configurado, se envía email real.
- Si falta configuración en desarrollo/sandbox, se registra el link y se devuelve en respuesta cuando el entorno lo permita.
- En producción, una configuración incompleta debe fallar de forma explícita al intentar enviar y dejar evento `onboarding_email_failed`.

## Seguridad

- Tokens con suficiente entropía, guardados como hash.
- Expiración inicial sugerida: 7 días.
- Token usado no puede reutilizarse.
- Reenvío de link crea un token nuevo y revoca tokens anteriores activos.
- Endpoint público con rate limit por IP y email.
- No se exponen secretos Resend ni internos al navegador.
- Admin CRM solo disponible en portal `BACKOFFICE_PORTAL_MODE=admin`.
- El merchant no queda activo hasta aprobación explícita.

## Errores Y Estados

Casos esperados:

- Email ya registrado: responder con mensaje neutro para evitar enumeración, pero registrar evento interno si aplica.
- Token expirado: mostrar pantalla de link expirado con opción de contactar soporte o solicitar reenvío más adelante.
- Token usado: mostrar pantalla de enlace ya usado.
- Expediente rechazado: impedir submit posterior del token.
- Reenvío de email fallido: registrar evento y permitir reintento desde CRM.

## Testing

API:

- Crear application crea merchant inactivo, expediente, checklist, token y eventos.
- Crear application intenta enviar Resend y registra éxito/fallo.
- Submit con token válido guarda business profile y pasa a `in_review`.
- Token expirado/usado/revocado falla.
- Aprobar activa merchant y registra eventos.
- Rechazar mantiene merchant inactivo y registra motivo.
- Reenviar link revoca tokens anteriores y crea nuevo.

Backoffice:

- Ruta pública `/onboarding/[token]` no exige sesión.
- CRM `/crm/onboarding` exige sesión admin.
- Mutaciones CRM exigen `X-Backoffice-Mutation: 1`.
- BFF no filtra secretos ni errores crudos de upstream.

Web Finara:

- Formulario valida nombre, email y teléfono.
- Éxito en sandbox muestra link si la API lo devuelve.
- Error muestra mensaje seguro.

Documentación viva:

- Actualizar `PROJECT_CONTEXT.md` al añadir dominio, rutas y variables relevantes.
- Actualizar `apps/psp-backoffice/BACKOFFICE_CONTEXT.md` al añadir rutas CRM, BFF y onboarding público.
- Actualizar `docs/testing-status.md` si se agregan o modifican tests.

## Criterios De Aceptación

- Un visitante puede registrar nombre, email y teléfono desde la web.
- El sistema crea un merchant inactivo y un expediente onboarding separado.
- El sistema genera link temporal y lo envía por Resend.
- En sandbox/dev se puede probar el link sin depender del email.
- El merchant puede completar datos de empresa desde `/onboarding/[token]`.
- El expediente queda en `in_review`.
- Un admin puede ver expedientes en el CRM del backoffice.
- Un admin puede aprobar o rechazar con historial visible.
- Al aprobar, el merchant queda activo.
- Al rechazar, el merchant permanece inactivo.
- Checklist e historial existen desde el primer expediente.

## Preguntas Pendientes Para Implementación

- Nombre final de rutas públicas: `/merchant-signup` y `/onboarding/[token]` quedan como propuesta.
- Tiempo exacto de expiración del token: recomendado 7 días.
- Política ante email duplicado: recomendado mensaje neutro y no revelar si ya existe.
- Template exacto del email de Resend: puede definirse en implementación con copy simple.
