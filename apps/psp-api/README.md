# PSP API (MVP)

Servicio NestJS: Single API REST v1, ledger, webhooks y checkout Pay-by-link.

## Requisitos

- Node.js 20+
- Docker (PostgreSQL + Redis) o credenciales propias

## Arranque local

```bash
# Desde la raíz del repo
docker compose up -d

cd apps/psp-api
cp .env.example .env
npx prisma migrate deploy
npx prisma generate
npm run start:dev
```

- Documentación OpenAPI: http://localhost:3000/api/docs
- Health check: http://localhost:3000/health

### Crear comercio (bootstrap)

En Windows, se recomienda PowerShell. Nota: en PowerShell `curl` puede ser un alias de `Invoke-WebRequest`; si quieres usar curl igualmente, usa `curl.exe` explícitamente.

PowerShell:

```powershell
Invoke-RestMethod -Method Post "http://localhost:3000/api/v1/merchants" `
  -Headers @{ "Content-Type"="application/json"; "X-Internal-Secret"="change-me-in-production" } `
  -Body '{"name":"Demo"}'
```

Git Bash / WSL / macOS / Linux:

```bash
curl -s -X POST http://localhost:3000/api/v1/merchants \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: change-me-in-production" \
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
- Para un merchant comprometido, revoca/rota creando nueva credencial y dejando de usar la anterior.
- Nunca compartas `X-API-Key` por chat, capturas ni logs.
- El backend responde `401 Unauthorized` de forma uniforme para evitar filtrado de pistas.

### Rotación manual (demo)

1. Crea un merchant nuevo con `POST /api/v1/merchants` y guarda su nueva `apiKey`.
2. Actualiza consumidores para usar la nueva key.
3. Deja de usar la key previa en scripts y Swagger.
4. Si compartiste una key por error, rota inmediatamente.

## Troubleshooting rápido (PowerShell + Swagger)

- `401 Unauthorized` en `/merchants`: reinicia la API tras cambiar `.env` y revisa `INTERNAL_API_SECRET`.
- `401 Unauthorized` en endpoints protegidos: usa el `apiKey` real devuelto al crear merchant.
- `404 Payment link not found`: `paymentLinkId` debe ser el `id` real del link, no el `slug` ni `"string"`.
- `400 Amount/currency must match payment link`: usa el mismo `amountMinor` y `currency` del link.
- `400 Expected property name...`: JSON mal formado en body (evita escapados manuales complejos y usa `ConvertTo-Json`).
- `409 Idempotency-Key already used with different payload`: genera una nueva key para una nueva intención de cobro.
- `429 Too Many Requests`: espera a la ventana de rate limit o reduce ráfagas de requests.

## Webhooks

- En `capture`, el evento `payment.succeeded` se encola y un worker en segundo plano hace el `POST` al `webhookUrl` del merchant (no bloquea la respuesta del API).
- Cuerpo JSON: `id` es el **id estable** de la fila `webhook_deliveries` (mismo valor en todos los reintentos de esa entrega); `created_at` es la marca de creación de esa fila (también estable). `data` lleva el payload del evento (p. ej. datos del pago). `type` es el nombre del evento (p. ej. `payment.succeeded`).
- Cabecera `X-PSP-Delivery-Id`: mismo id que `id` en el body, útil para deduplicar sin parsear JSON.
- La firma va en `X-PSP-Signature` con formato `t=<unix>,v1=<hmac_sha256>`. El `t` es **nuevo en cada intento** (anti-replay); el body firmado es idéntico entre reintentos salvo que cambies datos en servidor.
- Reintentos automáticos con backoff hasta 3 intentos antes de `failed` en `webhook_deliveries`.
- Operación interna: `POST /api/v1/webhooks/deliveries/{id}/retry` con `X-Internal-Secret` reencola una entrega fallida (mismo `id`/`created_at` de evento que antes).

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

Workflow dedicado para este servicio:

- `.github/workflows/psp-api-ci.yml`
- ejecuta `npm run -s lint` y `npm test --silent` cuando cambian archivos de `apps/psp-api`

## Variables

Ver [.env.example](./.env.example). `APP_ENCRYPTION_KEY` debe tener al menos 32 caracteres.

## Tests

```bash
npm run test
```
