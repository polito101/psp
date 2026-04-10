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

## Troubleshooting rápido (PowerShell + Swagger)

- `401 Invalid internal secret`: reinicia la API tras cambiar `.env` y revisa `INTERNAL_API_SECRET`.
- `401 Invalid API key`: usa el `apiKey` real devuelto al crear merchant.
- `404 Payment link not found`: `paymentLinkId` debe ser el `id` real del link, no el `slug` ni `"string"`.
- `400 Amount/currency must match payment link`: usa el mismo `amountMinor` y `currency` del link.
- `400 Expected property name...`: JSON mal formado en body (evita escapados manuales complejos y usa `ConvertTo-Json`).
- `409 Idempotency-Key already used with different payload`: genera una nueva key para una nueva intención de cobro.

## Webhooks

- En `capture`, el evento `payment.succeeded` se envía al `webhookUrl` del merchant.
- La firma se envía en `X-PSP-Signature` con formato `t=<unix>,v1=<hmac_sha256>`.
- Si falla la entrega, se reintenta hasta 3 veces antes de marcar `failed` en `webhook_deliveries`.

## Variables

Ver [.env.example](./.env.example). `APP_ENCRYPTION_KEY` debe tener al menos 32 caracteres.

## Tests

```bash
npm run test
```
