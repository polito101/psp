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

- `PSP_API_BASE_URL`: URL base de `psp-api`.
- `PSP_INTERNAL_API_SECRET`: secreto interno usado solo en server-side BFF.
- `BACKOFFICE_ADMIN_SECRET`: secreto obligatorio para autorizar requests a `/api/internal/*` (debe ser distinto de `PSP_INTERNAL_API_SECRET`).
- `NEXT_PUBLIC_TRANSACTIONS_REFRESH_MS`: intervalo de auto-refresh del monitor.

## Rutas principales

- `/login` — Establece sesión en el navegador (cookie HttpOnly) con el mismo valor que `BACKOFFICE_ADMIN_SECRET`. Sin esto, las llamadas a `/api/internal/*` responden **401**.
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
- Los endpoints `src/app/api/internal/*` exigen autenticación explícita: `Authorization: Bearer <BACKOFFICE_ADMIN_SECRET>` o cookie HttpOnly `backoffice_admin_token=<BACKOFFICE_ADMIN_SECRET>`.
- En local, usa **`/login`** (o `POST /api/auth/session` con JSON `{ "token": "..." }`) para fijar la cookie; el cliente en `src/lib/api/client.ts` envía `credentials: "include"` en las peticiones al BFF.
- En producción, no exponer el backoffice sin un gateway/SSO delante que inyecte la credencial (header o cookie) para usuarios autenticados/autorizados.
