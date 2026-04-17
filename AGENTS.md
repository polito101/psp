## Learned User Preferences

- Las respuestas al usuario deben redactarse en español.

## Learned Workspace Facts

- El dominio de pagos v2 vive en `apps/psp-api/src/payments-v2` (servicio, DTOs y `*.spec.ts`).
- La idempotencia de creación de intents en `POST /v2/payments` usa `hashCreatePaymentIntentPayload` en `apps/psp-api/src/payments-v2/create-payment-intent-payload-hash.ts` (SHA-256 sobre un objeto canónico del DTO que incluye parámetros Stripe relevantes para `executeProviderOperation('create')`).
- Trabajo reciente de deduplicación o idempotencia de creación suele tocar `payments-v2.service.ts`, `redis.service.ts`, DTOs de creación y Prisma bajo `apps/psp-api/prisma` (p. ej. migración `20260417120000_payment_create_payload_hash`).
