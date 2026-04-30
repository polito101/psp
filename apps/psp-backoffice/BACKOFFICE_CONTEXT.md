# BACKOFFICE_CONTEXT — PSP Backoffice

Ultima actualizacion: 2026-04-30

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
│   ├── login/page.tsx                # `/login` portal **merchant** (credenciales merchant)
│   ├── admin/login/page.tsx          # `/admin/login` portal **admin**
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

Estaticos en `public/`: favicon PNG (`favicon-16x16.png`, `favicon-32x32.png`, `favicon.png`), `apple-touch-icon.png`, `android-chrome-192x192.png` / `512x512.png`, `site.webmanifest`; enlazados desde `metadata` en `src/app/layout.tsx`.

## 4) Datos de prueba en el panel (transacciones)

El listado `/transactions` lee la misma base que **`psp-api`**. Para generar filas de demo contra sandbox o Render:

1. Desde `apps/psp-api`, con la URL y el secreto interno **del mismo deploy** que consume el backoffice (`PSP_API_BASE_URL` / `PSP_INTERNAL_API_SECRET`):
   - `npm run demo:backoffice-payments`
2. Variables reconocidas por el script: `DEMO_API_BASE_URL` o `SMOKE_BASE_URL`, y `INTERNAL_API_SECRET` o `SMOKE_INTERNAL_API_SECRET`. Opcional: `DEMO_FETCH_TIMEOUT_MS` (default 90000) si el cold start es lento.
3. Alternativa: `npm run test:smoke:sandbox` con las mismas variables (Jest) también persiste pagos v2.

Entrar al backoffice como **admin** y abrir `/` o `/transactions` (sin filtro de fecha por defecto se listan todas las recientes).

### Si el panel se queda en “Cargando…”

- El navegador llama a rutas **`/api/internal/*`** del propio Next; el servidor reenvía a **`PSP_API_BASE_URL`**. Si esa URL no es la del servicio `psp-api` real, o la API está fría y los timeouts son cortos, la petición puede tardar mucho o no completar.
- En Render: `PSP_API_BASE_URL` = URL **https** pública del servicio API (no la del backoffice). `PSP_INTERNAL_API_SECRET` debe coincidir con `INTERNAL_API_SECRET` de la API. Sube **`PSP_API_PROXY_TIMEOUT_MS`** en el backoffice (p. ej. `60000`) para cold start.
- Opcional en el backoffice: **`NEXT_PUBLIC_BFF_FETCH_TIMEOUT_MS`** (default 90000) limita cuánto espera el **cliente** al BFF; si vence, verás error en UI en lugar de carga infinita (`src/lib/api/client.ts`).

## 5) Variables de entorno

Definidas en [`.env.example`](.env.example) de este directorio; copia a `.env.local`.

| Variable | Uso |
|----------|-----|
| `BACKOFFICE_PORTAL_MODE` | **`merchant`** u **`admin`**: en `merchant` solo acepta sesión merchant y login en `/login`; en `admin` solo admin y login en `/admin/login`. Si falta, por defecto **`merchant`** (fail-closed para no exponer admin). |
| `NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE` | Debe coincidir con `BACKOFFICE_PORTAL_MODE` (copia para UI en cliente: rutas de logout / enlace “Iniciar sesión”). Middleware/Edge puede usar este fallback si el server env no está inlined en el bundle. |
| `PSP_API_BASE_URL` | Base URL de `psp-api` (solo servidor); **obligatoria** fuera de `NODE_ENV=development`. En desarrollo local puede omitirse y usar `http://localhost:3000` como valor por defecto. |
| `PSP_API_PROXY_TIMEOUT_MS` | Opcional: timeout ms del `fetch` BFF→API (default **5000**, máx. 120000). Debe ser **solo dígitos** (p. ej. `60000`; sin `60s`, `1e5`, etc.). Valores mal formados usan el default y un **warning** único en logs del servidor. Subir en hosting con cold start largo (p. ej. Render free). |
| `PSP_INTERNAL_API_SECRET` | Secreto interno API; **nunca** al cliente |
| `BACKOFFICE_ADMIN_SECRET` | Credencial de login **admin** (solo deploy admin y `POST /api/auth/session` con `mode: "admin"`); distinto de `PSP_INTERNAL_API_SECRET`. En deploy **solo merchant** suele omitirse. |
| `BACKOFFICE_SESSION_JWT_SECRET` | Firma del JWT en cookie `backoffice_session` (sesión admin/merchant); distinto de `PSP_INTERNAL_API_SECRET` y de `BACKOFFICE_ADMIN_SECRET` |
| `BACKOFFICE_MERCHANT_PORTAL_SECRET` | Clave HMAC para login **merchant** (token `expUnix:hexHmac` sobre ``merchantId.exp``); distinto de `PSP_INTERNAL_API_SECRET`. En deploy **solo admin** puede omitirse. |
| `NEXT_PUBLIC_TRANSACTIONS_REFRESH_MS` | Intervalo de auto-refresh del monitor (publico) |
| `NEXT_PUBLIC_BFF_FETCH_TIMEOUT_MS` | Opcional: timeout ms del **navegador** hacia `/api/internal/*` (default **90000**). Evita carga perpetua si el Route Handler no responde. |

## 6) Rutas de producto

- **`/login`** — Solo **portal merchant** (`BACKOFFICE_PORTAL_MODE=merchant`): formulario merchant ID + token temporal; no admin.
- **`/admin/login`** — Solo **portal admin** (`BACKOFFICE_PORTAL_MODE=admin`): formulario mínimo con secreto admin.
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

## 7) BFF y seguridad

- El merchant **no** envía proveedor en `POST /api/v2/payments` (ruteo del PSP en API); los filtros por `provider` en este panel son solo operativos sobre datos ya persistidos. Los valores permitidos en BFF/UI siguen `OPS_PAYMENT_PROVIDERS` en `src/lib/api/payment-providers.ts` (debe mantenerse alineado con `PAYMENT_PROVIDER_NAMES` en `psp-api`).
- Las rutas `app/api/internal/*` reenvian a endpoints internos de Nest (`/api/v2/payments/ops/...`, `/api/v1/settlements/...`, `/api/v1/merchants/ops/...`, health, etc.) con `X-Internal-Secret` solo en servidor. El listado ops va a `.../ops/transactions`; los conteos agregados por estado del dashboard a `.../ops/transactions/counts` (`GET /api/internal/transactions/counts`); el resumen comparativo (payments, bruto, neto, errores) a `.../ops/transactions/summary` (`GET /api/internal/transactions/summary`); la serie de volumen horario a `.../ops/transactions/volume-hourly` (`GET /api/internal/transactions/volume-hourly`); volumen agregado en USD a `.../ops/dashboard/volume-usd` (`GET /api/internal/transactions/dashboard-volume-usd`). Finanzas por merchant (resumen gross/fee/net, filas por `PaymentFeeQuote`, payouts): `GET /api/internal/merchants/:merchantId/finance/summary|transactions|payouts` → `.../ops/merchants/:merchantId/finance/...`. Settlements: `.../internal/settlements/merchants/:id/available-balance`, `.../requests` (GET/POST), inbox y approve/reject. Merchants ops: `.../internal/merchants/ops/directory`, `.../ops/:id/detail|active|payment-methods`. El proxy (`lib/server/backoffice-api.ts`) exige `backofficeScope` en cualquier ruta payments ops **o** settlements **o** `merchants/ops` (RBAC fail-closed alineado con `InternalSecretGuard` en API). Soporta `proxyInternalPost` / `proxyInternalPatch` para cuerpos JSON.
- Detalle de pago: `GET /api/internal/payments/:paymentId` hace proxy a `.../ops/payments/:id`. Por defecto **no** se incluye `responsePayload` por intento (menos payload y menos metadata de proveedor en el navegador). Solo si la peticion al BFF lleva `?includePayload=true` se reenvia ese flag a la API (uso depuracion).
- Sesión: cookie HttpOnly `backoffice_session` con JWT (claims `role: admin` o `merchant` y `merchantId` si aplica). El BFF acepta también `Authorization: Bearer <JWT>` (p. ej. tests). Sin sesión válida: `401`/`403`. Faltan `BACKOFFICE_SESSION_JWT_SECRET` o conflictos con otros secretos → `500` (fail-closed).
- Alcance portal en BFF (`enforceInternalRouteAuth`): JWT verificado pero con **rol incompatible** con `BACKOFFICE_PORTAL_MODE` → **`403`** (p. ej. cookie admin en deploy merchant).
- Mutaciones BFF (`POST`/`PATCH` bajo `/api/internal/*`): el navegador debe enviar cabecera `X-Backoffice-Mutation: 1`; si existe cabecera `Origin`, debe coincidir con el origen del propio backoffice. La sesión/RBAC sigue aplicándose después.
- Login: `POST /api/auth/session` acepta **solo** el `mode` que coincida con `BACKOFFICE_PORTAL_MODE`: admin `{ "mode":"admin","token":"<BACKOFFICE_ADMIN_SECRET>" }` o merchant `{ "mode":"merchant","merchantId":"...","merchantToken":"<expUnix>:<hmac_hex>" }` (HMAC de ``merchantId.exp``, caducidad acotada). Otro modo → **`404`** (no filtrar existencia por UI). Rate limit best-effort en proceso: clave = IP normalizada resuelta de `request.ip` (si existe), luego primer IP válida en **toda** la lista de `x-vercel-forwarded-for` y `x-forwarded-for` (no solo el primer hop), `x-real-ip`, `cf-connecting-ip`. Si no hay IP válida, se usa una clave interna fija `LOGIN_RATE_LIMIT_UNRESOLVED_KEY` (no deja de aplicar RL; varios clientes sin IP comparten bucket). Normalización con `node:net`/`isIP`. Map de buckets con barrido de ventanas expiradas y tope de entradas; en producción complementar con límite en edge/WAF si hay varias instancias.
- Navegación: rol **merchant** no ve `/monitor` ni `/merchants/lookup`; enlaces a **Mi comercio** (`/merchants/{id}/overview` y subrutas) y **Finanzas**. Admin ve **Merchants**, **Operaciones**, monitor y lookup financiero.
- Detalle de pago: un merchant que pida un `paymentId` de otro comercio recibe **404** (anti-enumeración), en BFF y en API.
- Alcance **merchant** en BFF: rutas con `merchantId` en path o query fuerzan/validan contra el claim; métricas globales (`provider-health` → `ops/metrics`) solo **admin**. El proxy añade cabeceras `X-Backoffice-Role` y `X-Backoffice-Merchant-Id` para que `psp-api` vuelva a validar (defensa en profundidad). Las páginas merchant incluyen `/merchants/[merchantId]/finance` con validación en Server Component vía `ensureMerchantPortalRoute`, además del proxy y el BFF.
- Cabeceras de seguridad globales desde `next.config.ts`: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- Proxy HTTP de páginas (`src/proxy.ts`, Next.js 16 “Proxy Middleware”): sin sesión válida para el portal actual redirige a **`/login`** (merchant) o **`/admin/login`** (admin); bloquea `/admin/*` en portal merchant sin sesión (redirección al login merchant); fuerza **`/login` → `/admin/login`** cuando no hay sesión en portal admin. Rutas **`/api/*`** no redirigen (el BFF responde `401`/`403`).
- Errores del proxy hacia `psp-api`: el servidor registra un preview acotado del cuerpo upstream en logs; el navegador recibe mensajes seguros (`message` + opcional `upstreamStatus`) y **no** se reenvía el JSON 4xx crudo del upstream.
- No leer secretos desde `NEXT_PUBLIC_*` salvo decision documentada; **`NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE`** es la excepción acordada para alinear UI con `BACKOFFICE_PORTAL_MODE` sin exponer secretos.

## 8) Convenciones de implementacion

- Componentes y paginas: TypeScript estricto; preferir datos vía React Query con claves estables.
- Tablas y filtros: alineados con parametros soportados por la API (ver raiz `PROJECT_CONTEXT.md` para paginacion cursor/keyset y `includeTotal`).
- Estilo visual: acento de marca `--primary: #635bff`, fuente Inter (`next/font`) — coherente con resumen en `PROJECT_CONTEXT.md` raíz.
- Tras cambiar contratos consumidos, actualizar este archivo (`BACKOFFICE_CONTEXT.md`) y, si aplica, ejecutar `gen:api-types` y mencionarlo aqui.

## 9) Comandos utiles

```bash
npm run dev          # http://localhost:3005
npm run lint
npm run typecheck
npm run test         # Vitest (libs servidor)
npm run playwright:install   # Chromium para Playwright (también lo usa CI)
npm run test:e2e     # Playwright; el smoke de merchants exige BFF→API (levantar `psp-api` en `PSP_API_BASE_URL`, p. ej. :3003)
npm run build
npm run gen:api-types   # requiere API + Swagger
```

En **GitHub Actions**, el job `backoffice-ci` arranca servicios Postgres/Redis, aplica migraciones de `psp-api`, ejecuta `npm run start:prod` en el puerto **3003** y luego Playwright en **`BACKOFFICE_PORTAL_MODE=admin`** (login en `/admin/login`), de modo que el listado `/merchants` no puede quedar verde si el proxy interno falla.

## 10) Lecturas relacionadas

- `README.md` en este mismo directorio (arranque rapido).
- `PROJECT_CONTEXT.md` (raíz del repo) — pagos v2, endpoints ops, ledger, webhooks, CI.
