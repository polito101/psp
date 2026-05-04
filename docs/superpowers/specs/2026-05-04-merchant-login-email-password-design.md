# Diseño — Login merchant por email y contraseña

## Contexto y objetivo

Actualmente el portal merchant de `apps/psp-backoffice` autentica con `merchantId + merchantToken` (HMAC temporal).  
Se requiere un cambio directo a `email + contraseña`, enviando credenciales por email cuando el merchant crea su solicitud de onboarding.

Objetivo funcional:

1. El merchant inicia sesión con el correo indicado en la solicitud y una contraseña enviada por email.
2. Si el merchant no está aprobado (`DOCUMENTATION_PENDING` o `IN_REVIEW`) o fue rechazado (`REJECTED`), no puede ver datos del portal.
3. Para estados no activos, se muestra solo una pantalla bloqueante:
   - Pendiente: "pendiente de revisión de documentación".
   - Rechazado: "rechazado por el siguiente motivo: <motivo>".

Decisiones confirmadas:

- Envío de contraseña al crear la solicitud (no esperar aprobación).
- Bloqueo total mientras no esté activo.
- Corte directo: se elimina el login antiguo `merchantId + token`.

## Alcance

Incluye:

- API (`apps/psp-api`): generación y validación de credenciales merchant basadas en email.
- Backoffice (`apps/psp-backoffice`): login por email+contraseña y bloqueo total por estado.
- Tests de API y backoffice para el nuevo flujo.
- Actualización de SSOT (`PROJECT_CONTEXT.md`, `BACKOFFICE_CONTEXT.md`, `docs/testing-status.md`) al cerrar implementación.

No incluye:

- Flujo de recuperación de contraseña.
- Rotación de contraseña por parte del merchant.
- Compatibilidad temporal con login legacy.

## Arquitectura propuesta

### 1) Autenticación centralizada en API

Se añade un endpoint interno en `psp-api` para validar credenciales merchant por email+contraseña.  
El backoffice no consulta DB directa; delega validación en API (mantiene patrón BFF y separación actual).

Respuesta del endpoint interno:

- `merchantId`
- `onboardingStatus` (`DOCUMENTATION_PENDING`, `IN_REVIEW`, `ACTIVE`, `REJECTED`)
- `rejectionReason` (solo si aplica)

### 2) Sesión de backoffice con estado embebido

`POST /api/auth/session` en backoffice, modo merchant:

- recibe `email + password`,
- consulta API interna,
- firma JWT de sesión merchant con claims:
  - `role: "merchant"`
  - `merchantId`
  - `onboardingStatus`
  - `rejectionReason?`

### 3) Bloqueo total por estado en dos capas

1. **Capa navegación (`proxy.ts`)**  
   Si la sesión merchant no está en `ACTIVE`, se redirige a una ruta bloqueante única.

2. **Capa BFF (`/api/internal/*`)**  
   Si la sesión merchant no está en `ACTIVE`, responder `403` para evitar filtrado de datos por llamadas directas.

## Diseño de dominio de credenciales

### Fuente de identidad

- Usuario de login merchant: `contactEmail` de `MerchantOnboardingApplication` (normalizado en minúsculas y trim).
- Cuenta vinculada al `merchantId` de la aplicación.

### Contraseña inicial

- Generación aleatoria segura en creación de solicitud.
- Persistencia exclusivamente como hash (bcrypt).
- Envío en email solo en texto (primera entrega).
- No loggear ni persistir la contraseña en claro.

### Persistencia

Se añade un campo hash de contraseña para login portal merchant (en entidad ya existente, preferiblemente `Merchant` para no duplicar identidad).  
El diseño de implementación deberá elegir el nombre definitivo y la migración Prisma correspondiente.

## Flujos

### Flujo A: creación de solicitud

1. Merchant solicita alta (`POST /api/v1/merchant-onboarding/applications`).
2. API crea merchant inactivo + aplicación.
3. API genera contraseña inicial y guarda hash.
4. API envía email con:
   - correo de acceso (el mismo contacto),
   - contraseña temporal/inicial,
   - URL de login merchant.

### Flujo B: login merchant

1. Merchant envía `email + password` en `/api/auth/session` (backoffice).
2. Backoffice llama endpoint interno de API para validar.
3. API responde resultado:
   - credenciales válidas/inválidas,
   - estado onboarding para ese merchant.
4. Backoffice crea cookie JWT de sesión con estado.
5. Proxy decide:
   - `ACTIVE`: acceso normal,
   - no activo: redirección a pantalla bloqueada.

### Flujo C: acceso con estado no activo

- UI muestra solo estado y acción de cerrar sesión.
- No se renderiza AppShell operativo ni menú de navegación.
- BFF bloquea acceso a recursos internos aunque se intente forzar URL/API.

## Comportamiento de estados

- `ACTIVE`: acceso total al portal merchant vigente.
- `DOCUMENTATION_PENDING` o `IN_REVIEW`: bloqueo total con mensaje "pendiente de revisión de documentación".
- `REJECTED`: bloqueo total con mensaje "rechazado por el siguiente motivo: <rejectionReason>".

Si `rejectionReason` no existe por datos legacy, mostrar fallback seguro: "rechazado por el siguiente motivo: no especificado".

## Seguridad y hardening

- Mensajes de autenticación genéricos para evitar enumeración de emails (`Invalid credentials`).
- Mantener rate limiting actual en `POST /api/auth/session`.
- No exponer secretos internos al cliente.
- Evitar diferencia observable entre "email no existe" y "password incorrecta".
- Verificación server-side del estado en BFF además de la navegación.

## Manejo de errores

- API interna de login merchant:
  - `401` para credenciales inválidas.
  - `500` para error interno/misconfiguración.
- Backoffice:
  - mantiene mensaje seguro y genérico en login.
  - no reenvía detalles internos de upstream al navegador.
- En pantalla bloqueada:
  - texto de estado determinista según claim de sesión.

## Impacto en UI/UX

- Reemplazo de formulario merchant login:
  - antes: `merchantId + merchantToken`,
  - después: `email + password`.
- Nueva ruta/pantalla de bloqueo merchant (single-purpose).
- Logout disponible desde pantalla bloqueada.

## Estrategia de pruebas (TDD)

### API (`apps/psp-api`)

1. Test que falla: al crear solicitud, se genera contraseña inicial y se persiste hash.
2. Test que falla: email de onboarding incluye credenciales de acceso.
3. Test que falla: endpoint interno autentica `email + password` y devuelve estado.
4. Test que falla: credenciales inválidas devuelven `401` con respuesta genérica.

### Backoffice (`apps/psp-backoffice`)

1. Test que falla: `POST /api/auth/session` modo merchant acepta `email + password`.
2. Test que falla: JWT de sesión incluye `onboardingStatus` y `rejectionReason`.
3. Test que falla: proxy redirige a pantalla bloqueada cuando estado no es `ACTIVE`.
4. Test que falla: `/api/internal/*` devuelve `403` para merchant no activo.
5. Test que falla: merchant `ACTIVE` mantiene flujo actual de acceso.

## Riesgos y mitigaciones

- **Riesgo:** divergencia entre estado en DB y claim de sesión.
  - **Mitigación:** estado validado al iniciar sesión y enforcement en cada request BFF.
- **Riesgo:** envío de contraseña en email.
  - **Mitigación:** contraseña aleatoria fuerte, hash-only persistido, copy recomendando cambio futuro (cuando exista flujo).
- **Riesgo:** regresión en login admin/portal mode.
  - **Mitigación:** tests existentes de admin intactos + tests nuevos específicos de merchant.

## Plan de rollout

Rollout directo en un release:

1. Deploy API con endpoint interno + generación de password en onboarding.
2. Deploy backoffice con formulario nuevo y bloqueo por estado.
3. Invalidar/retirar soporte del login antiguo en la misma release.

No hay periodo de convivencia.

## Criterios de aceptación

1. Merchant recibe email con contraseña tras crear solicitud.
2. Login merchant funciona con `email + password`.
3. Merchant en `DOCUMENTATION_PENDING` o `IN_REVIEW` ve solo mensaje de pendiente.
4. Merchant en `REJECTED` ve solo mensaje de rechazo con motivo.
5. Merchant en `ACTIVE` accede normalmente.
6. No hay acceso a `/api/internal/*` para merchant no activo.
7. Suite de tests actualizada y en verde para cambios afectados.
