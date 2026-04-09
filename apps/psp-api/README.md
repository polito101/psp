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

```bash
curl -s -X POST http://localhost:3000/api/v1/merchants \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: change-me-in-production" \
  -d "{\"name\":\"Demo\"}"
```

Guarda `apiKey` y `webhookSecret`. Usa `apiKey` en `X-API-Key` para el resto de llamadas.

### Payment link + checkout

```bash
curl -s -X POST http://localhost:3000/api/v1/payment-links \
  -H "X-API-Key: psp.<id>.<secret>" \
  -H "Content-Type: application/json" \
  -d "{\"amountMinor\":1999,\"currency\":\"EUR\"}"
```

Abre la `url` devuelta en el navegador y completa el pago (POST simulado).

## Variables

Ver [.env.example](./.env.example). `APP_ENCRYPTION_KEY` debe tener al menos 32 caracteres.

## Tests

```bash
npm run test
```
