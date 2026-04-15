# PSP Backoffice

Frontend administrativo (MVP) para operación financiera sobre `psp-api`.

## Requisitos

- Node.js 22+
- API Nest corriendo (por defecto en `http://localhost:3000`)

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

## Comandos

```bash
npm install
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
- En producción, no exponer el backoffice sin un gateway/SSO delante que inyecte la credencial (header o cookie) para usuarios autenticados/autorizados.
