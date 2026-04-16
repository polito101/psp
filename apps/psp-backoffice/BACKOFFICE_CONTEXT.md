# BACKOFFICE_CONTEXT — PSP Backoffice

Ultima actualizacion: 2026-04-16

Documento **local** del app `apps/psp-backoffice` (nombre distinto de `PROJECT_CONTEXT.md` en la raíz para evitar confusion). El monorepo mantiene visión global y API en **`PROJECT_CONTEXT.md`** (raíz); aquí se detalla solo el panel administrativo.

## 1) Proposito

Frontend operativo (MVP) para supervisar pagos y salud de proveedores contra `psp-api`, sin exponer secretos internos al navegador. Patron **BFF**: el browser llama a rutas Next ` /api/internal/*`; el servidor inyecta cabeceras hacia la API.

## 2) Stack

| Area        | Eleccion |
|------------|----------|
| Framework  | Next.js **16.2** (App Router) |
| UI         | React **19**, Tailwind CSS **4**, utilidades estilo shadcn (`components.json`, `class-variance-authority`, `clsx`, `tailwind-merge`) |
| Datos UI   | `@tanstack/react-query` **5**, `@tanstack/react-table` **8** |
| Validacion | `zod` **4** |
| Iconos     | `lucide-react` |
| Tipos API  | Opcional: `openapi-typescript` → `src/lib/api/generated/openapi.d.ts` (`npm run gen:api-types` con Swagger en API) |

Puerto dev por defecto: **3005** (`next dev -p 3005`). API local típica: **3003**.

## 3) Estructura (`src/`)

```text
src/
├── app/
│   ├── layout.tsx, page.tsx          # `/` inicio (stats + volumen hoy vs ayer)
│   ├── transactions/page.tsx         # `/transactions` listado ops
│   ├── monitor/page.tsx              # `/monitor`
│   ├── payments/[paymentId]/page.tsx # detalle pago
│   └── api/internal/                 # BFF (solo servidor)
│       ├── transactions/route.ts
│       ├── transactions/counts/route.ts
│       ├── transactions/volume-hourly/route.ts
│       ├── payments/[paymentId]/route.ts
│       └── provider-health/route.ts
├── components/                       # UI por feature
└── lib/                              # clientes API, utilidades
```

Cliente browser → `src/lib/api/client.ts` → fetch relativo a `/api/internal/...` (misma origin).

## 4) Variables de entorno

Definidas en `.env.example`; copia a `.env.local`.

| Variable | Uso |
|----------|-----|
| `PSP_API_BASE_URL` | Base URL de `psp-api` (solo servidor) |
| `PSP_INTERNAL_API_SECRET` | Secreto interno API; **nunca** al cliente |
| `BACKOFFICE_ADMIN_SECRET` | Obligatorio para autorizar llamadas a `/api/internal/*` (Bearer o cookie HttpOnly); debe ser **distinto** de `PSP_INTERNAL_API_SECRET` |
| `NEXT_PUBLIC_TRANSACTIONS_REFRESH_MS` | Intervalo de auto-refresh del monitor (publico) |

## 5) Rutas de producto

- **`/`** — Inicio: tarjetas de conteo del día (UTC) y bloque **Volumen bruto**: totales succeeded hoy vs ayer (EUR) encima del gráfico; líneas acumuladas por hora UTC con hover que compara el volumen bruto de cada hora frente al mismo tramo de ayer (incluye %).
- **`/transactions`** — Dashboard de transacciones (lista ops, filtros, export CSV de pagina visible, conteos por estado, cursores).
- **`/monitor`** — Vista compacta + health de proveedores.
- **`/payments/[paymentId]`** — Detalle de pago (intentos acotados a los 200 más recientes si el historial crece; aviso en UI si `attemptsTruncated`), metadatos, enlaces operativos.

## 6) BFF y seguridad

- Las rutas `app/api/internal/*` reenvian a endpoints internos de Nest (`/api/v2/payments/ops/...`, health, etc.) con `X-Internal-Secret` solo en servidor. El listado ops va a `.../ops/transactions`; los conteos agregados por estado del dashboard a `.../ops/transactions/counts` (`GET /api/internal/transactions/counts`); la serie de volumen horario a `.../ops/transactions/volume-hourly` (`GET /api/internal/transactions/volume-hourly`).
- Detalle de pago: `GET /api/internal/payments/:paymentId` hace proxy a `.../ops/payments/:id`. Por defecto **no** se incluye `responsePayload` por intento (menos payload y menos metadata de proveedor en el navegador). Solo si la peticion al BFF lleva `?includePayload=true` se reenvia ese flag a la API (uso depuracion).
- Cada request al BFF debe llevar auth explícita: header `Authorization: Bearer <BACKOFFICE_ADMIN_SECRET>` o cookie HttpOnly `backoffice_admin_token` (valor igual al secreto configurado). Sin eso: `401`/`403`.
- No leer secretos desde `NEXT_PUBLIC_*` salvo decision documentada; el patron actual mantiene secretos server-only.

## 7) Convenciones de implementacion

- Componentes y paginas: TypeScript estricto; preferir datos vía React Query con claves estables.
- Tablas y filtros: alineados con parametros soportados por la API (ver raiz `PROJECT_CONTEXT.md` para paginacion cursor/keyset y `includeTotal`).
- Estilo visual: acento de marca `--primary: #635bff`, fuente Inter (`next/font`) — coherente con resumen en `PROJECT_CONTEXT.md` raíz.
- Tras cambiar contratos consumidos, actualizar este archivo (`BACKOFFICE_CONTEXT.md`) y, si aplica, ejecutar `gen:api-types` y mencionarlo aqui.

## 8) Comandos utiles

```bash
npm run dev          # http://localhost:3005
npm run lint
npm run typecheck
npm run build
npm run gen:api-types   # requiere API + Swagger
```

## 9) Lecturas relacionadas

- `README.md` en este mismo directorio (arranque rapido).
- `PROJECT_CONTEXT.md` (raíz del repo) — pagos v2, endpoints ops, ledger, webhooks, CI.
