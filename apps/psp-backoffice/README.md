# PSP Backoffice

Frontend administrativo (MVP) para operación financiera sobre `psp-api`.

Contexto detallado del app (rutas, BFF, env, convenciones): **`BACKOFFICE_CONTEXT.md`** en este directorio. Vision global del monorepo: **`PROJECT_CONTEXT.md`** en la raiz del repo.

## Requisitos

- Node.js 22+
- API Nest corriendo (por defecto en `http://localhost:3003`)

## Variables de entorno

Copiar `.env.example` a `.env.local`:

```bash
cp .env.example .env.local
```

Variables:

- `BACKOFFICE_PORTAL_MODE` / `NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE`: `merchant` (default) o `admin` — determina qué login y qué `POST /api/auth/session` acepta el deploy.
- `PSP_API_BASE_URL`: URL base de `psp-api`.
- `PSP_API_PROXY_TIMEOUT_MS` (opcional): timeout del BFF hacia la API en ms (default 60000); bajar en local si prefieres fallos rápidos cuando la API no está levantada.
- `PSP_INTERNAL_API_SECRET`: secreto interno usado solo en server-side BFF.
- `BACKOFFICE_ADMIN_SECRET`: credencial de login **admin** (solo modo `admin`; omitir en deploy solo-merchant).
- `BACKOFFICE_SESSION_JWT_SECRET`: firma del JWT de sesión en cookie HttpOnly (distinta de `PSP_INTERNAL_API_SECRET` y de `BACKOFFICE_ADMIN_SECRET` si aplica).
- `NEXT_PUBLIC_TRANSACTIONS_REFRESH_MS`: intervalo de auto-refresh del monitor.

Login **merchant**: correo de contacto del onboarding y contraseña inicial enviada por email al crear la solicitud. El BFF valida contra `psp-api` (`merchant-login` interno) y emite JWT con `onboardingStatus` / `rejectionReason`. Si el expediente no está `ACTIVE`, el proxy solo permite la página **`/merchant-status`** hasta activación.

## Rutas principales

- **`/login`** — Portal **merchant**: correo + contraseña del alta.
- **`/admin/login`** — Portal **admin** (`BACKOFFICE_PORTAL_MODE=admin`): formulario mínimo con `BACKOFFICE_ADMIN_SECRET`.
- Sin sesión válida alineada al portal, `/api/internal/*` responde **401/403** y el proxy de página redirige al login del portal.
- `/` — Inicio con estadísticas del día (UTC) y gráfico de volumen hoy vs ayer.
- `/transactions` — Panel de transacciones (lista ops contra la API vía BFF, export y filtros).
- `/monitor` — Monitor operativo compacto (misma fuente + health de proveedores).

## Comandos

```bash
npm install
# Por defecto corre en http://localhost:3005 para no chocar con psp-api (3003)
npm run dev
npm run lint
npm run typecheck
npm run build
```

## Generación de tipos OpenAPI (opcional)

Con Swagger habilitado en API (`ENABLE_SWAGGER=true`):

```bash
npm run gen:api-types
```

Salida esperada: `src/lib/api/generated/openapi.d.ts`.

## Seguridad

- Nunca enviar `X-Internal-Secret` desde el navegador.
- Todos los llamados administrativos pasan por `src/app/api/internal/*`.
- El secreto vive solo en variables server-side de Next.
- Los endpoints `src/app/api/internal/*` exigen `Authorization: Bearer <JWT_de_sesión>` o cookie HttpOnly `backoffice_session=<JWT>`. Hacia `psp-api`, las rutas `/api/v2/payments/ops/*` llevan siempre `X-Backoffice-Role` (y `X-Backoffice-Merchant-Id` si el rol es merchant).
- En local con portal **admin** (`BACKOFFICE_PORTAL_MODE=admin` en `.env.local`), abre **`/admin/login`** o `POST /api/auth/session` con `{ "mode": "admin", "token": "..." }`.
- En local con portal **merchant** (default), usa **`/login`** o `POST /api/auth/session` con `{ "mode": "merchant", "email": "...", "password": "..." }`; el cliente en `src/lib/api/client.ts` envía `credentials: "include"` en las peticiones al BFF.
- Playwright/CI del repo arranca el panel en modo **admin** para el smoke de `/merchants`; ver `playwright.config.ts` y `BACKOFFICE_CONTEXT.md`.
- En producción, no exponer el backoffice sin un gateway/SSO delante que inyecte la credencial (header o cookie) para usuarios autenticados/autorizados.
