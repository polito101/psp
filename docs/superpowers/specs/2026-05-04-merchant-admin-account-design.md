# Diseño — Admin merchant con cuenta, onboarding y métodos

## Contexto y objetivo

El backoffice admin ya tiene un directorio de merchants en `/merchants` y una ruta `/merchants/[merchantId]/admin` para acciones operativas básicas. Se quiere acercar esta vista a un orquestador real observado, pero manteniendo el dominio simplificado del proyecto: trabajaremos directamente con `Merchant`, sin introducir `Shop` ni multi-shop en esta fase.

Objetivo funcional:

1. Mantener `/merchants` como listado actual.
2. Al pulsar `Admin`, abrir una pantalla de edición del merchant con pestañas.
3. Permitir editar datos administrativos de cuenta en `Account`.
4. Mostrar el historial cronológico del onboarding en `Application Form`.
5. Mostrar una tabla inicial de `Payment Methods` con la estructura final, dejando país, límites por moneda y rates para una fase posterior.

Inspiración externa confirmada:

- El orquestador real usa shops por merchant y guarda edición en `processing/shops/:shopId`.
- En este proyecto se descarta `Shop` por ahora.
- Los datos útiles del ejemplo real se traducen a campos propios de `Merchant`.

## Alcance

Incluye:

- Migración del modelo `Merchant` con campos administrativos nuevos.
- Ajustes del onboarding para alimentar esos campos al crear el merchant.
- Simplificación del formulario de onboarding: no pedir razón social ni país.
- Endpoint interno admin para leer detalle extendido de merchant.
- Endpoint interno admin para guardar `Account` en un único PATCH.
- UI tabulada en `/merchants/[merchantId]/admin`.
- Vista cronológica del historial onboarding más reciente.
- Tabla de payment methods con columnas objetivo.
- Tests de API, backoffice y actualización de SSOT de pruebas.

No incluye:

- Entidad `Shop`, multi-shop o shop principal.
- Reseller.
- País por payment method.
- Límites por divisa en payment methods.
- Edición o modelado completo de rates por payment method.
- Exponer o editar credenciales API/webhook desde esta pantalla.

## Decisiones confirmadas

- `Merchant` será la fuente de verdad de la pantalla `Account`.
- `status` se mostrará como `ENABLED` / `DISABLED` y se respaldará con el `isActive` actual.
- `registrationStatus` mantiene valores `LEAD`, `IN_REVIEW`, `APPROVED`, `REJECTED`, `ACTIVE`.
- `mid` se añade como identificador operativo corto, generado automáticamente, único y solo lectura en UI.
- `registrationNumber` es manual, editable y opcional.
- `industry` usa catálogo cerrado: `CLOUD_COMPUTING`, `CRYPTO`, `FOREX`, `GAMBLING`, `PSP`, `OTHER`.
- `email` es el email principal del merchant y, por ahora, también el email de login merchant.
- No se debe permitir registrar un merchant con email ya en uso.
- Si un merchant tuviera más de un expediente onboarding, `Application Form` muestra el más reciente.

## Modelo de datos

### Merchant

Se ampliará `Merchant` con campos administrativos:

- `email`: email principal, normalizado con trim + lowercase, único.
- `contactName`: nombre de contacto administrativo.
- `contactPhone`: teléfono de contacto administrativo.
- `websiteUrl`: URL opcional.
- `mid`: identificador operativo corto, único, generado automáticamente.
- `registrationNumber`: texto opcional editable.
- `registrationStatus`: enum administrativo.
- `industry`: enum administrativo.

Campos existentes que se mantienen:

- `name`: nombre de compañía / company name.
- `isActive`: fuente del status `ENABLED` / `DISABLED`.
- `merchantPortalPasswordHash`: sigue respaldando el login merchant por email + contraseña.

El `merchantId` sigue siendo el identificador técnico de base de datos y APIs internas. `mid` no sustituye a `merchantId`.

### Enums

`MerchantRegistrationStatus`:

- `LEAD`
- `IN_REVIEW`
- `APPROVED`
- `REJECTED`
- `ACTIVE`

`MerchantIndustry`:

- `CLOUD_COMPUTING`
- `CRYPTO`
- `FOREX`
- `GAMBLING`
- `PSP`
- `OTHER`

Labels UI:

- Cloud computing
- Crypto
- Forex
- Gambling
- PSP
- Other

### Generación de MID

`mid` será generado al crear un merchant. Será numérico de 6 dígitos para que soporte pueda dictarlo y buscarlo fácilmente.

Requisitos:

- Único en DB.
- Reintentar generación si hay colisión de unicidad.
- No editable en el backoffice.
- Generado también para merchants creados desde onboarding.
- Para merchants existentes, la migración o un paso de backfill debe asignar un `mid`.

## Onboarding

El onboarding público se simplifica.

Primera petición:

- Mantiene nombre de contacto.
- Mantiene email.
- Mantiene teléfono.
- Rechaza email ya usado por otro merchant o solicitud activa según la regla de unicidad vigente.

Formulario de negocio:

- Pide `companyName`.
- Pide `industry`.
- Pide `websiteUrl` opcional.
- Deja de pedir razón social.
- Deja de pedir país.

Al crear o completar el merchant shell desde onboarding, se copiarán al `Merchant`:

- `name` desde `companyName`.
- `industry` desde el formulario de negocio.
- `websiteUrl` desde la URL opcional.
- `contactName` desde la primera petición.
- `email` desde la primera petición.
- `contactPhone` desde la primera petición.

El expediente de onboarding sigue existiendo para auditoría e historial. La pantalla admin usa `Merchant` para editar cuenta y usa onboarding solo para mostrar eventos cronológicos.

## API interna

### Detalle admin

Ampliar `GET /api/v1/merchants/ops/:id/detail` para devolver:

- `merchant`: campos administrativos completos.
- `latestOnboardingApplication`: expediente onboarding más reciente asociado al merchant, si existe.
- `onboardingEvents`: eventos del expediente más reciente, ordenados cronológicamente.
- `paymentMethods`: configuración actual de métodos de pago del merchant.

La ruta sigue protegida por `InternalSecretGuard` y por la defensa en profundidad actual de `X-Backoffice-Role`.

### Guardar Account

Añadir `PATCH /api/v1/merchants/ops/:id/account`.

Campos aceptados:

- `name`
- `email`
- `contactName`
- `contactPhone`
- `websiteUrl`
- `isActive`
- `registrationStatus`
- `registrationNumber`
- `industry`

Reglas:

- Email normalizado.
- Email duplicado en otro merchant responde `409 Conflict`.
- Merchant inexistente responde `404`.
- Enums inválidos responden `400`.
- El PATCH no permite cambiar `mid`.
- El PATCH no expone ni modifica credenciales API/webhook.

El endpoint actual `PATCH /ops/:id/active` puede mantenerse para compatibilidad interna, pero la nueva UI usará el PATCH único de `Account`.

## Backoffice BFF

El browser seguirá llamando rutas same-origin bajo `/api/internal/*`.

Rutas esperadas:

- `GET /api/internal/merchants/ops/:merchantId/detail`
- `PATCH /api/internal/merchants/ops/:merchantId/account`

La mutación seguirá usando:

- cookie/JWT de sesión admin válido.
- `X-Backoffice-Mutation: 1`.
- validación de `Origin` existente.
- mensajes seguros de error hacia UI.

Solo el portal admin puede usar `/merchants/:merchantId/admin`.

## UI backoffice

### Directorio

`/merchants` se mantiene como listado actual. El enlace `Admin` seguirá apuntando a `/merchants/:merchantId/admin`.

### Pantalla Admin

`/merchants/:merchantId/admin` será una pantalla tabulada:

1. `Account`
2. `Application Form`
3. `Payment Methods`

El encabezado mostrará:

- Título de edición del merchant.
- Nombre de compañía.
- `MID` visible si existe.

### Tab Account

Formulario editable:

- Company name.
- Email.
- Contact name.
- Contact phone.
- Website URL.
- Status: `ENABLED` / `DISABLED`.
- Registration status.
- Registration number.
- Industry.
- MID solo lectura.

Acciones:

- `Save changes`: un único PATCH.
- `Cancel`: revierte el formulario al último dato cargado.

### Tab Application Form

Muestra solo el historial cronológico del onboarding más reciente:

- Fecha/hora.
- Tipo de evento.
- Actor.
- Mensaje.

Si no hay onboarding asociado, mostrar estado vacío claro.

No se incluye checklist ni formulario completo en esta fase.

### Tab Payment Methods

Tabla con columnas objetivo:

- `UID`
- `Name`
- `Country`
- `Currencies / Limits`
- `Status`
- `Rates`

En esta fase:

- `UID`: `MerchantPaymentMethod.id`.
- `Name`: `definition.label` o `definition.code`.
- `Status`: derivado de `merchantEnabled && adminEnabled`.
- `Country`: pendiente.
- `Currencies / Limits`: usar límites globales actuales si existen; si no, pendiente.
- `Rates`: pendiente.

Pendiente para el siguiente plan:

- Añadir país por método.
- Añadir límites por moneda.
- Diseñar rates por método/moneda/proveedor.
- Definir prompt inicial para esa fase: "Diseñar Payment Methods enriquecidos para merchant admin con país, límites por moneda y rates editables, partiendo de la tabla placeholder de `/merchants/:merchantId/admin`."

## Seguridad

- No se exponen `apiKey`, `secretKey`, webhook secret ni hashes.
- `mid` no se acepta como identificador en endpoints internos.
- El email de login queda protegido por unicidad y validación.
- El BFF conserva fail-closed si falta sesión o el rol no es admin.
- Los errores del upstream siguen sanitizados antes de llegar al navegador.

## Errores

Errores esperados:

- `400`: payload inválido, enum inválido, URL inválida.
- `401` / `403`: sesión ausente o rol incompatible.
- `404`: merchant no encontrado.
- `409`: email ya usado por otro merchant.
- `500`: configuración interna inválida.

La UI debe mostrar mensajes seguros y accionables, sin exponer detalles crudos del backend.

## Tests

API:

- Unit/integration para generación de `mid`.
- Unit/integration para unicidad de email en `Merchant`.
- Tests de `PATCH account`: éxito, email duplicado, enums inválidos, merchant inexistente.
- Tests de onboarding para poblar `Merchant` con company name, industry, URL opcional, nombre, email y teléfono.
- Tests que confirmen que razón social y país ya no son requeridos por onboarding.

Backoffice:

- Vitest para cliente/BFF de `PATCH account`.
- Vitest para contrato del detalle extendido si se añade helper.
- Playwright admin smoke: `/merchants` → `Admin` → render de pestañas → guardado de `Account`.

Documentación:

- Actualizar `PROJECT_CONTEXT.md` por cambio de modelo y contrato interno.
- Actualizar `apps/psp-backoffice/BACKOFFICE_CONTEXT.md` por nueva pantalla admin tabulada.
- Actualizar `docs/testing-status.md` si se añaden o modifican tests.

## Planes posteriores

Al terminar esta fase, el siguiente plan debe centrarse en `Payment Methods` enriquecidos:

- Modelo para país por método.
- Límites por moneda.
- Representación y edición de rates.
- Relación con `MerchantRateTable` o nuevo modelo si se necesita granularidad por método.
- Importación/semilla de métodos reales inspirados en el orquestador observado.
