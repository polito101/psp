# PSP API (MVP)

Servicio NestJS: Single API REST v1, ledger, webhooks y checkout Pay-by-link.

## Requisitos

- **Node.js 22** (recomendado) o **≥ 20.19** (mínimo soportado por Prisma ORM 7)
- Docker (PostgreSQL + Redis) o credenciales propias

## Base de datos y Prisma ORM 7

Este proyecto usa **Prisma ORM 7**. El cliente se genera en `src/generated/prisma/` (TypeScript, compilado por `nest build` → `dist/generated/prisma/`). El directorio `src/generated/` está en `.gitignore`; se crea ejecutando `prisma generate`.

- **`prisma.config.ts`** (junto a `package.json` de este app): define `schema`, ruta de migraciones y `DATABASE_URL` para la CLI. Carga `.env` con `dotenv` (la CLI de Prisma 7 **no** inyecta variables por defecto).
- **Runtime:** `PrismaService` importa `PrismaClient` de `../generated/prisma/client` y usa el adaptador **`@prisma/adapter-pg`** / `pg` (TCP directo a PostgreSQL). Hace falta **`DATABASE_URL`** válida en `.env` al arrancar la API.
- Tras **`npm ci`** o un clone limpio, ejecuta siempre **`npx prisma generate`** antes de `npm run build`, `npm run lint` o `npm run start:dev`.
- Los scripts **`npm run prisma:migrate`** y **`npm run prisma:migrate:deploy`** ejecutan la migración y luego **`prisma generate`**, porque en v7 `migrate` **no** genera el cliente automáticamente.
- En **Windows**, si `prisma generate` falla con error de bloqueo de archivo (p. ej. EPERM), cierra procesos Node que estén usando la API y vuelve a intentar.

## Arranque local

```bash
# Desde la raíz del repo
docker compose up -d

cd apps/psp-api
cp .env.example .env
# Ajusta DATABASE_URL, INTERNAL_API_SECRET y APP_ENCRYPTION_KEY en .env

npm run prisma:migrate:deploy
npm run start:dev
```

Equivalente manual (misma idea que `prisma:migrate:deploy`):

```bash
npx prisma migrate deploy
npx prisma generate
npm run start:dev
```

## Ejecución con Docker (sandbox)

Build de imagen:

```bash
cd apps/psp-api
docker build -t psp-api:sandbox .
```

Run local de la imagen (con variables reales):

La imagen define `NODE_ENV=production` en el Dockerfile; para comportamiento de **sandbox** hay que sobrescribirlo en runtime.

```bash
docker run --rm -p 3000:3000 \
  -e NODE_ENV=sandbox \
  -e DATABASE_URL="postgresql://psp:psp_dev_password@host.docker.internal:5433/psp?schema=public" \
  -e REDIS_URL="redis://host.docker.internal:6379" \
  -e INTERNAL_API_SECRET="replace-with-random-long-secret" \
  -e APP_ENCRYPTION_KEY="replace-with-random-32-plus-chars" \
  -e ENABLE_SWAGGER="true" \
  -e CORS_ALLOWED_ORIGINS="http://localhost:3000" \
  psp-api:sandbox
```

**Equivalente en pipeline / hosting:** en el servicio que ejecuta la API (p. ej. variables de entorno del Web Service en Render, grupo de variables del entorno `sandbox` en el proveedor, o `env:` en un manifiesto de despliegue) definir `NODE_ENV=sandbox`. El job `sandbox-deploy` de GitHub Actions usa `environment: sandbox` para secretos; la app que sirve tráfico debe llevar esta variable en su runtime (ver `docs/sandbox-env.md`).

En `sandbox` recomendado: ejecutar `prisma migrate deploy` en pipeline antes de promover la nueva revisión de la API.

- Documentación OpenAPI: http://localhost:3000/api/docs
- Health check: http://localhost:3000/health

### Crear comercio (bootstrap)

En Windows, se recomienda PowerShell. Nota: en PowerShell `curl` puede ser un alias de `Invoke-WebRequest`; si quieres usar curl igualmente, usa `curl.exe` explícitamente.

PowerShell:

```powershell
# Sustituye SECRET por el valor de INTERNAL_API_SECRET de tu .env
Invoke-RestMethod -Method Post "http://localhost:3000/api/v1/merchants" `
  -Headers @{ "Content-Type"="application/json"; "X-Internal-Secret"="SECRET" } `
  -Body '{"name":"Demo"}'
```

Opcional: caducidad de la API key al crear el comercio (`keyTtlDays`, entre 1 y 3650; sin campo, la key no expira por fecha):

```powershell
Invoke-RestMethod -Method Post "http://localhost:3000/api/v1/merchants" `
  -Headers @{ "Content-Type"="application/json"; "X-Internal-Secret"="SECRET" } `
  -Body '{"name":"Demo","keyTtlDays":90}'
```

Git Bash / WSL / macOS / Linux:

```bash
curl -s -X POST http://localhost:3000/api/v1/merchants \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: SECRET" \
  -d "{\"name\":\"Demo\"}"
```

Guarda `apiKey` y `webhookSecret`. Usa `apiKey` en `X-API-Key` para el resto de llamadas.

### Payment link + checkout

PowerShell:

```powershell
Invoke-RestMethod -Method Post "http://localhost:3000/api/v1/payment-links" `
  -Headers @{ "X-API-Key"="PEGAR_APIKEY_COMERCIO"; "Content-Type"="application/json" } `
  -Body '{"amountMinor":1999,"currency":"EUR"}'
```

Git Bash / WSL / macOS / Linux:

```bash
curl -s -X POST http://localhost:3000/api/v1/payment-links \
  -H "X-API-Key: psp.<id>.<secret>" \
  -H "Content-Type: application/json" \
  -d "{\"amountMinor\":1999,\"currency\":\"EUR\"}"
```

Abre la `url` devuelta en el navegador y completa el pago (POST simulado).

## Flujo recomendado (sandbox fiat)

1. Crear merchant (`POST /api/v1/merchants`) con `X-Internal-Secret`.
2. Crear payment link (`POST /api/v1/payment-links`) con `X-API-Key`.
3. Crear pago pendiente (`POST /api/v1/payments`) usando el `paymentLinkId` real (opcional si cobras sin link).
4. Capturar (`POST /api/v1/payments/{id}/capture`) para mover `pending -> succeeded`.
5. Verificar estado (`GET /api/v1/payments/{id}`) y saldos (`GET /api/v1/balance`).

### Crear pago pendiente con `paymentLinkId` (PowerShell)

```powershell
$idem = [guid]::NewGuid().ToString()
Invoke-RestMethod -Method Post "http://localhost:3000/api/v1/payments" `
  -Headers @{
    "X-API-Key"="PEGAR_APIKEY_COMERCIO"
    "Content-Type"="application/json"
    "Idempotency-Key"=$idem
  } `
  -Body (@{
    amountMinor = 1999
    currency = "EUR"
    paymentLinkId = "PEGAR_PAYMENT_LINK_ID_REAL"
    rail = "fiat"
  } | ConvertTo-Json -Compress)
```

## Idempotencia en pagos

- `Idempotency-Key` es opcional en `POST /api/v1/payments`.
- Si repites la misma request con la misma key, se devuelve el pago existente.
- Si reutilizas la misma key con payload distinto, la API devuelve `409 Conflict`.
- No uses el campo placeholder `"string"` en Swagger: usa IDs reales del sistema.

## API keys (seguridad MVP)

- Formato esperado: `psp.<merchantId>.<secret>`.
- Nunca compartas `X-API-Key` por chat, capturas ni logs.
- El backend responde `401 Unauthorized` de forma uniforme para evitar filtrado de pistas.
- **TTL al crear:** el body de `POST /api/v1/merchants` puede incluir `keyTtlDays` (1–3650). Sin el campo, la key no tiene fecha de caducidad.
- Tras **revocación** o **caducidad**, hace falta **`rotate-key`** para obtener una key nueva en claro (una sola vez en la respuesta).

### Revocar y rotar (endpoints internos)

Ambos usan la cabecera **`X-Internal-Secret`** (mismo secreto que en el alta de merchant).

**Revocar** la key actual (bloquea el comercio hasta rotar; no devuelve key nueva):

```powershell
$mid = "PEGAR_MERCHANT_ID"
Invoke-RestMethod -Method Post "http://localhost:3000/api/v1/merchants/$mid/revoke-key" `
  -Headers @{ "X-Internal-Secret"="SECRET" }
```

**Rotar** y obtener una `apiKey` nueva (opcional: `keyTtlDays` en el body para la nueva key):

```powershell
$mid = "PEGAR_MERCHANT_ID"
Invoke-RestMethod -Method Post "http://localhost:3000/api/v1/merchants/$mid/rotate-key" `
  -Headers @{ "Content-Type"="application/json"; "X-Internal-Secret"="SECRET" } `
  -Body '{}'

# Con TTL de 180 días para la nueva key:
Invoke-RestMethod -Method Post "http://localhost:3000/api/v1/merchants/$mid/rotate-key" `
  -Headers @{ "Content-Type"="application/json"; "X-Internal-Secret"="SECRET" } `
  -Body '{"keyTtlDays":180}'
```

### Rotación manual (solo demo)

Si no usas los endpoints anteriores, en entornos de prueba puedes crear otro merchant y migrar integraciones a su nueva `apiKey`.

## Troubleshooting rápido (PowerShell + Swagger)

- `401 Unauthorized` en `/merchants`: reinicia la API tras cambiar `.env` y revisa `INTERNAL_API_SECRET`.
- `401 Unauthorized` en endpoints protegidos: usa el `apiKey` real devuelto al crear merchant.
- `404 Payment link not found`: `paymentLinkId` debe ser el `id` real del link, no el `slug` ni `"string"`.
- `400 Amount/currency must match payment link`: usa el mismo `amountMinor` y `currency` del link.
- `400 Expected property name...`: JSON mal formado en body (evita escapados manuales complejos y usa `ConvertTo-Json`).
- `409 Idempotency-Key already used with different payload`: genera una nueva key para una nueva intención de cobro.
- `429 Too Many Requests`: espera a la ventana de rate limit o reduce ráfagas de requests.
- Errores de TypeScript del tipo *Cannot find module* hacia `../generated/prisma/client`: ejecuta `npx prisma generate` desde `apps/psp-api` con `DATABASE_URL` definida (p. ej. en `.env`). El directorio `src/generated/` se crea en ese momento.
- Filas `webhook_deliveries` atascadas en **`processing`** tras un corte brusco del proceso (kill -9, OOM): situación rara; recupéralas con el mismo endpoint operativo que los fallidos: `POST /api/v1/webhooks/deliveries/{id}/retry` con `X-Internal-Secret` (reencola como **`pending`** y reinicia intentos).

## Webhooks

- En `capture`, el evento `payment.succeeded` se encola y un **worker en segundo plano** hace el `POST` al `webhookUrl` del merchant; **no bloquea** la respuesta HTTP del API.
- El worker arranca con un intervalo base de **5 s** y aplica **backoff en idle**: cuando no hay entregas pendientes dobla el intervalo (hasta un techo de 30 s); al encontrar trabajo vuelve al intervalo base. Esto reduce la carga base en BD cuando no hay actividad.
- El worker está activo por defecto. Para separar API de worker en despliegues con múltiples réplicas, configurar `WEBHOOK_WORKER_ENABLED=false` en las réplicas de API puras y dejarlo activo (o no setearlo) en el deployment dedicado al worker.
- Cuando hay URL configurada, el alta en cola devuelve estado **`pending`**; la entrega real y los reintentos ocurren en el worker.
- Entre `pending` y `delivered`/`failed` puede verse **`processing`**: es un estado transitorio mientras el worker tiene reclamada la fila (evita entregas duplicadas con varias instancias o ticks solapados). El ciclo del worker **no se solapa**: tras cada barrido programa el siguiente tras esperar el intervalo.
- Cuerpo JSON: `id` es el **id estable** de la fila `webhook_deliveries` (mismo valor en todos los reintentos de esa entrega); `created_at` es la marca de creación de esa fila (también estable). `data` lleva el payload del evento (p. ej. datos del pago). `type` es el nombre del evento (p. ej. `payment.succeeded`).
- Cabecera `X-PSP-Delivery-Id`: mismo id que `id` en el body, útil para deduplicar sin parsear JSON.
- La firma va en `X-PSP-Signature` con formato `t=<unix>,v1=<hmac_sha256>`. El `t` es **nuevo en cada intento** (anti-replay); el body firmado es idéntico entre reintentos salvo que cambies datos en servidor.
- Reintentos automáticos con backoff hasta 3 intentos antes de `failed` en `webhook_deliveries`.
- Operación interna: `POST /api/v1/webhooks/deliveries/{id}/retry` con `X-Internal-Secret` **solo reencola** la fila (`pending` de nuevo); aplica a entregas **`failed`** o **`processing`** (atascadas); **no** ejecuta el `fetch` en la misma petición HTTP del cliente: lo procesará el worker.

### Verificación de firma + anti-replay (receptor)

```ts
import { createHmac, timingSafeEqual } from 'crypto';

function verifyWebhook({
  rawBody,
  signatureHeader,
  secret,
  maxSkewSeconds = 300, // +/- 5 min
}: {
  rawBody: string;
  signatureHeader: string;
  secret: string;
  maxSkewSeconds?: number;
}): boolean {
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((s) => {
      const [k, v] = s.split('=');
      return [k, v];
    }),
  );
  const ts = Number(parts.t);
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > maxSkewSeconds) return false;

  const payload = `${ts}.${rawBody}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  return timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}
```

## Rate limiting

- Se aplica throttling global y límites más estrictos en endpoints sensibles:
  - `POST /api/v1/payments`: 30 requests / 60s
  - `POST /api/v1/payment-links`: 20 requests / 60s
- Si excedes el límite, la API responde `429 Too Many Requests`.

## Checklist de arranque seguro (local/demo)

- Cambia `INTERNAL_API_SECRET` y `APP_ENCRYPTION_KEY` antes de compartir entorno.
- Reinicia la API cada vez que cambies variables en `.env`.
- No guardes secretos reales en capturas, tickets o commits.
- Usa `Idempotency-Key` en `POST /payments` para evitar dobles cobros por reintentos.
- Verifica que `webhookUrl` apunte a HTTPS cuando salgas de entorno local.

## Regresión de seguridad (esperado vs observado)

| Caso | Request | Esperado |
|---|---|---|
| API key inválida | `POST /api/v1/payment-links` con `X-API-Key` falsa | `401 Unauthorized` |
| Internal secret inválido | `POST /api/v1/merchants` con `X-Internal-Secret` incorrecta | `401 Unauthorized` |
| Payment link inexistente | `POST /api/v1/payments` con `paymentLinkId` no válido | `404 Payment link not found` |
| Amount/currency inconsistente | `POST /api/v1/payments` con importe distinto al link | `400 Amount/currency must match payment link` |
| Reuso idempotencia con otro body | `POST /api/v1/payments` misma key y distinto payload | `409 Idempotency-Key already used with different payload` |
| Exceso de ráfaga | muchas requests a `/payments` o `/payment-links` | `429 Too Many Requests` |

## Smoke test (PowerShell)

Script reproducible del flujo completo:

- merchant -> payment-link -> payment -> capture -> balance
- valida estado final y salud de la API

```powershell
cd apps/psp-api
.\scripts\smoke-flow.ps1
```

Opcional con base URL distinta:

```powershell
.\scripts\smoke-flow.ps1 -BaseUrl "http://localhost:3000"
```

## CI

Workflow único del repo:

- `.github/workflows/ci.yml`
- Job `api-ci`: `npm ci` -> `prisma generate` -> `prisma migrate deploy` -> `lint` -> `test` -> `build`.
- Job `sandbox-deploy` (solo branch `sandbox`): build de imagen, migración sobre sandbox, trigger de deploy hook, health check y smoke tests. No inyecta `NODE_ENV` en el contenedor remoto: debe configurarse en el hosting como `NODE_ENV=sandbox` (equivalente al `-e` de Docker).

## Variables

Ver [.env.example](./.env.example). `APP_ENCRYPTION_KEY` debe tener al menos 32 caracteres. **`DATABASE_URL`** debe apuntar a PostgreSQL y es obligatoria para la CLI de Prisma y para el arranque de la API (adaptador `pg`). Para sandbox interno, usar además:

- `NODE_ENV=sandbox` (obligatorio en runtime de sandbox; ver sección Docker y `docs/sandbox-env.md`)
- `ENABLE_SWAGGER=true|false`
- `CORS_ALLOWED_ORIGINS` (lista separada por comas)
- `SMOKE_BASE_URL` (en CI para suite de smoke)

## Tests

```bash
npm run test
npm run test:smoke:sandbox
```
