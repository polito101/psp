# BACKOFFICE_CONTEXT — PSP Backoffice

Ultima actualizacion: 2026-04-23

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
│   ├── layout.tsx, page.tsx          # `/` inicio (admin vs merchant)
│   ├── transactions/page.tsx         # `/transactions` listado ops
│   ├── operations/page.tsx           # `/operations` inbox settlements (admin)
│   ├── merchants/page.tsx            # directorio merchants (admin)
│   ├── merchants/[merchantId]/overview|payments|settlements|payment-methods|admin|finance/page.tsx
│   ├── monitor/page.tsx              # `/monitor`
│   ├── payments/[paymentId]/page.tsx # detalle pago
│   └── api/internal/                 # BFF (solo servidor)
│       ├── transactions/route.ts
│       ├── transactions/counts/route.ts
│       ├── transactions/summary/route.ts
│       ├── transactions/volume-hourly/route.ts
│       ├── transactions/dashboard-volume-usd/route.ts
│       ├── settlements/...
│       ├── merchants/ops/...
│       ├── merchants/[merchantId]/finance/...
│       ├── payments/[paymentId]/route.ts
│       └── provider-health/route.ts
├── components/                       # UI por feature (home/, merchant-portal/, settlements/, merchants/)
└── lib/                              # clientes API, utilidades
```

Cliente browser → `src/lib/api/client.ts` → fetch relativo a `/api/internal/...` (misma origin).

## 4) Variables de entorno

Definidas en [`.env.example`](.env.example) de este directorio; copia a `.env.local`.

| Variable | Uso |
|----------|-----|
| `PSP_API_BASE_URL` | Base URL de `psp-api` (solo servidor) |
| `PSP_INTERNAL_API_SECRET` | Secreto interno API; **nunca** al cliente |
| `BACKOFFICE_ADMIN_SECRET` | Credencial de login **admin** (solo `POST /api/auth/session` modo admin); distinto de `PSP_INTERNAL_API_SECRET` |
| `BACKOFFICE_SESSION_JWT_SECRET` | Firma del JWT en cookie `backoffice_session` (sesión admin/merchant); distinto de `PSP_INTERNAL_API_SECRET` y de `BACKOFFICE_ADMIN_SECRET` |
| `BACKOFFICE_MERCHANT_PORTAL_SECRET` | Clave HMAC para login **merchant** (token `expUnix:hexHmac` sobre ``merchantId.exp``); distinto de `PSP_INTERNAL_API_SECRET` |
| `NEXT_PUBLIC_TRANSACTIONS_REFRESH_MS` | Intervalo de auto-refresh del monitor (publico) |

## 5) Rutas de producto

- **`/`** — Inicio: **admin** — bloque **Resumen** (intervalo/comparador vía `GET /api/internal/transactions/summary`), tarjetas UTC + volumen EUR + card volumen **USD** (`/ops/dashboard/volume-usd` vía BFF) + accesos a `/merchants` y `/operations`. **Merchant** — resumen scoped + enlaces al portal.
- **`/transactions`** — Dashboard de transacciones (lista ops, filtros, export CSV de pagina visible, conteos por estado, cursores). Filtros extendidos (país, método, weekday, `merchantActive`) se reenvían al BFF.
- **`/merchants`** — Directorio merchants (solo admin); desde aquí **Ver** → overview, **Admin** → panel activación / admin-enabled métodos.
- **`/merchants/[merchantId]/overview`** — Resumen merchant/admin con timeline (detalle ops interno).
- **`/merchants/[merchantId]/payments`** — Mismo listado ops con `merchantId` precargado (`TransactionsDashboard`).
- **`/merchants/[merchantId]/settlements`** — Saldo AVAILABLE + crear solicitud + historial.
- **`/merchants/[merchantId]/payment-methods`** — Tabla métodos y kill-switch merchant.
- **`/merchants/[merchantId]/admin`** — Solo admin: activar/desactivar cuenta y toggles `adminEnabled` por método.
- **`/operations`** — Solo admin: inbox de `SettlementRequest` PENDING (aprobar/rechazar).
- **`/monitor`** — Vista compacta + health de proveedores.
- **`/payments/[paymentId]`** — Detalle de pago (intentos acotados a los 200 más recientes si el historial crece; aviso en UI si `attemptsTruncated`), metadatos, enlaces operativos.
- **`/merchants/[merchantId]/finance`** — Resumen gross/fee/net (EUR), tabla de fee quotes y payouts; enlaces desde transacciones y detalle de pago.

## 6) BFF y seguridad

- El merchant **no** envía proveedor en `POST /api/v2/payments` (ruteo del PSP en API); los filtros por `provider` en este panel son solo operativos sobre datos ya persistidos. Los valores permitidos en BFF/UI siguen `OPS_PAYMENT_PROVIDERS` en `src/lib/api/payment-providers.ts` (debe mantenerse alineado con `PAYMENT_PROVIDER_NAMES` en `psp-api`).
- Las rutas `app/api/internal/*` reenvian a endpoints internos de Nest (`/api/v2/payments/ops/...`, `/api/v1/settlements/...`, `/api/v1/merchants/ops/...`, health, etc.) con `X-Internal-Secret` solo en servidor. El listado ops va a `.../ops/transactions`; los conteos agregados por estado del dashboard a `.../ops/transactions/counts` (`GET /api/internal/transactions/counts`); el resumen comparativo (payments, bruto, neto, errores) a `.../ops/transactions/summary` (`GET /api/internal/transactions/summary`); la serie de volumen horario a `.../ops/transactions/volume-hourly` (`GET /api/internal/transactions/volume-hourly`); volumen agregado en USD a `.../ops/dashboard/volume-usd` (`GET /api/internal/transactions/dashboard-volume-usd`). Finanzas por merchant (resumen gross/fee/net, filas por `PaymentFeeQuote`, payouts): `GET /api/internal/merchants/:merchantId/finance/summary|transactions|payouts` → `.../ops/merchants/:merchantId/finance/...`. Settlements: `.../internal/settlements/merchants/:id/available-balance`, `.../requests` (GET/POST), inbox y approve/reject. Merchants ops: `.../internal/merchants/ops/directory`, `.../ops/:id/detail|active|payment-methods`. El proxy (`lib/server/backoffice-api.ts`) exige `backofficeScope` en cualquier ruta payments ops **o** settlements **o** `merchants/ops` (RBAC fail-closed alineado con `InternalSecretGuard` en API). Soporta `proxyInternalPost` / `proxyInternalPatch` para cuerpos JSON.
- Detalle de pago: `GET /api/internal/payments/:paymentId` hace proxy a `.../ops/payments/:id`. Por defecto **no** se incluye `responsePayload` por intento (menos payload y menos metadata de proveedor en el navegador). Solo si la peticion al BFF lleva `?includePayload=true` se reenvia ese flag a la API (uso depuracion).
- Sesión: cookie HttpOnly `backoffice_session` con JWT (claims `role: admin` o `merchant` y `merchantId` si aplica). El BFF acepta también `Authorization: Bearer <JWT>` (p. ej. tests). Sin sesión válida: `401`/`403`. Faltan `BACKOFFICE_SESSION_JWT_SECRET` o conflictos con otros secretos → `500` (fail-closed).
- Login: `POST /api/auth/session` con `{ "mode": "admin", "token": "<BACKOFFICE_ADMIN_SECRET>" }` o `{ "mode": "merchant", "merchantId": "...", "merchantToken": "<expUnix>:<hmac_hex>" }` (HMAC de ``merchantId.exp`` con caducidad). Ver `README.md`.
- Navegación: rol **merchant** no ve `/monitor` ni `/merchants/lookup`; enlaces a **Mi comercio** (`/merchants/{id}/overview` y subrutas) y **Finanzas**. Admin ve **Merchants**, **Operaciones**, monitor y lookup financiero.
- Detalle de pago: un merchant que pida un `paymentId` de otro comercio recibe **404** (anti-enumeración), en BFF y en API.
- Alcance **merchant** en BFF: rutas con `merchantId` en path o query fuerzan/validan contra el claim; métricas globales (`provider-health` → `ops/metrics`) solo **admin**. El proxy añade cabeceras `X-Backoffice-Role` y `X-Backoffice-Merchant-Id` para que `psp-api` vuelva a validar (defensa en profundidad).
- Proxy (`src/proxy.ts`, Next.js 16+): páginas sin cookie de sesión redirigen a `/login`; rutas `/api/*` no se redirigen (el BFF sigue respondiendo 401/403).
- Errores del proxy hacia `psp-api`: el cliente recibe un mensaje genérico; el detalle del fallo se registra en el servidor, no en el JSON de respuesta.
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
npm run test         # Vitest (libs servidor)
npm run build
npm run gen:api-types   # requiere API + Swagger
```

## 9) Lecturas relacionadas

- `README.md` en este mismo directorio (arranque rapido).
- `PROJECT_CONTEXT.md` (raíz del repo) — pagos v2, endpoints ops, ledger, webhooks, CI.
