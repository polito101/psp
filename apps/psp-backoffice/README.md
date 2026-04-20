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
- `BACKOFFICE_ADMIN_SECRET`: credencial de login **admin** (debe ser distinta de `PSP_INTERNAL_API_SECRET`).
- `BACKOFFICE_SESSION_JWT_SECRET`: firma del JWT de sesión en cookie HttpOnly (distinta de `PSP_INTERNAL_API_SECRET` y de `BACKOFFICE_ADMIN_SECRET`).
- `BACKOFFICE_MERCHANT_PORTAL_SECRET`: clave HMAC para validar login **merchant** junto con `merchantId`.
- `NEXT_PUBLIC_TRANSACTIONS_REFRESH_MS`: intervalo de auto-refresh del monitor.

Login merchant (token esperado por el servidor):

```bash
# merchantId = por ejemplo mrc_abc
node -e "const c=require('crypto');const id=process.argv[1];const s=process.env.BACKOFFICE_MERCHANT_PORTAL_SECRET;console.log(c.createHmac('sha256',s).update(id,'utf8').digest('hex'))" "mrc_abc"
```

(Ejecutar con `BACKOFFICE_MERCHANT_PORTAL_SECRET` igual que en `.env.local`.)

## Rutas principales

- `/login` — Establece sesión (cookie HttpOnly `backoffice_session` con JWT). Modo admin valida `BACKOFFICE_ADMIN_SECRET`; modo merchant valida HMAC-SHA256(hex) de `merchantId` con `BACKOFFICE_MERCHANT_PORTAL_SECRET`. Sin sesión válida, `/api/internal/*` responde **401/403**.
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
- Los endpoints `src/app/api/internal/*` exigen `Authorization: Bearer <JWT_de_sesión>` o cookie HttpOnly `backoffice_session=<JWT>`.
- En local, usa **`/login`** o `POST /api/auth/session` con JSON `{ "mode": "admin", "token": "..." }` o `{ "mode": "merchant", "merchantId": "...", "merchantToken": "..." }`; el cliente en `src/lib/api/client.ts` envía `credentials: "include"` en las peticiones al BFF.
- En producción, no exponer el backoffice sin un gateway/SSO delante que inyecte la credencial (header o cookie) para usuarios autenticados/autorizados.
