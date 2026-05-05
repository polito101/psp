# Diseño - Providers Dinámicos, Métodos De Pago Y Routing Real

## Contexto Y Objetivo

El PSP actual tiene un orquestador `payments-v2` funcional, pero su configuración de providers y métodos sigue siendo principalmente estática: providers por código/env (`mock`, `acme`) y catálogo inicial de métodos (`mock_card`, `mock_transfer`). El objetivo de este diseño es evolucionar `/api/v2/payments` hacia un orquestador real basado en configuración operativa persistida, inspirado en el flujo de un orquestador de pagos real.

La implementación hará un corte directo sobre el contrato actual de `POST /api/v2/payments`. No se mantendrá compatibilidad con el request simple anterior (`amountMinor`, `paymentMethodCode`, estados `requires_action/succeeded`, etc.) si impide diseñar correctamente el flujo real. Una demo nueva se construirá después sobre configuración realista.

Decisiones confirmadas:

- El merchant no elige provider ni payment method.
- El merchant sí envía `channel` obligatorio: `CASH`, `ONLINE`, `CREDIT_CARD` o `CRYPTO`.
- El país de routing sale de `customer.country`.
- El PSP elige automáticamente una ruta `provider + payment method` por `weight` global.
- Fase 1 soporta `REDIRECTION` y `HOSTED_PAGE`; rutas `S2S` pueden existir en catálogo, pero no se enrutan.
- Estados de negocio del nuevo flujo: `PENDING`, `PAID`, `FAILED`, `EXPIRED`.
- Create exitoso con URL, voucher o datos accionables deja el pago en `PENDING`.
- Provider notifications reales forman parte de fase 1.
- Seguridad inicial de provider notifications: token opaco en URL.
- `Provider Logs` muestra solo llamadas PSP -> provider.
- `Notifications` muestra entregas PSP -> merchant; resend reenvía el snapshot exacto.
- Payloads con PII se guardan en dos formas: raw cifrado/restringido y masked para UI.
- Fase 1 opera por `Merchant`; no introduce multi-shop completo, pero no debe bloquear una entidad `Shop` futura.

## Enfoque Aprobado

Se seguirá el enfoque B: crear un nuevo dominio configuracional y de trazabilidad, integrado en `payments-v2`.

No se creará un módulo paralelo completo de pagos. La API seguirá exponiendo `/api/v2/payments`, pero el runtime de create/routing/provider callbacks se reemplazará por el flujo configurado.

Áreas principales:

1. **Configuración operativa**: providers, payment method routes, currencies, weights globales y merchant provider rates.
2. **Runtime de pagos**: create payment con contrato nuevo, routing por candidatos elegibles y selección ponderada.
3. **Adapter HTTP genérico**: plantillas de request/response controladas por código.
4. **Trazabilidad**: provider logs, notification deliveries, snapshots de routing, method, fees y customer.
5. **Backoffice admin**: CRUD completo para configurar providers, methods/routes, weights y rates.

## Modelo De Datos

### PaymentProvider

Representa un provider global, por ejemplo `AxisPay`, `Club Pago`, `PayCash`.

Campos principales:

- `id`
- `description` o `name`
- `integrationBaseUrl`
- `initPaymentResource`
- `isConfigured`
- `isActive`
- `isPublished`
- `credentialsCiphertext` o `configCiphertext` para secretos, headers y credenciales globales
- `createdAt`
- `updatedAt`

El provider puede tener métodos de varios países. El país no vive en `PaymentProvider`; vive en las rutas de método.

### PaymentMethodRoute

Representa una ruta concreta provider + método comercial + país + channel. Ejemplo: `Walmart / CASH / MX / Club Pago`.

Campos principales:

- `id`
- `providerId`
- `methodCode`
- `methodName`
- `countryCode`
- `countryName`
- `countryImageName`
- `channel`: `CASH | ONLINE | CREDIT_CARD | CRYPTO`
- `integrationMode`: `S2S | REDIRECTION | HOSTED_PAGE`
- `requestTemplate`: fase 1 `REDIRECT_SIMPLE` o `SPEI_BANK_TRANSFER`
- `integrationCode`
- `checkoutUrlTemplate`
- `expirationTimeOffset`
- `weight` global
- flags: `isActive`, `isPublished`, `isFlagged`, `forcePendingInput`, `isVirtual`, `riskEvaluationEnabled`
- `routeConfigJson` para parámetros no secretos
- `routeConfigCiphertext` para parámetros secretos específicos de la ruta

`PaymentMethodRoute` sustituye el uso conceptual de un método simple del catálogo para el runtime real. El `PaymentMethodDefinition` actual puede migrarse, adaptarse o quedar como compatibilidad interna durante la implementación, pero no debe ser el centro del nuevo diseño.

### PaymentMethodRouteCurrency

Una fila por currency soportada por una ruta.

Campos:

- `routeId`
- `currency`
- `minAmount`
- `maxAmount`
- `isDefault`

Se evita persistir currencies como string JSON para poder filtrar por DB y validar elegibilidad.

### MerchantProviderRate

Configuración que habilita a un merchant para usar un provider en un país.

Campos:

- `merchantId`
- `providerId`
- `countryCode`
- `percentage`
- `fixed`
- `minRateDiscount`
- `applyToCustomer`
- `fxSpread`
- `fxMarkup`
- `disableIndustryValidation`
- mínimos por channel: `cashMinAmount`, `creditCardMinAmount`, `cryptoMinAmount`, `onlineMinAmount`
- flags de channel habilitado
- `isActive`

Crear o actualizar un rate para `merchant + country + provider` habilita al merchant a usar todas las routes activas/publicadas del provider en ese país que cumplan channel, currency, amount e integration mode soportado.

### Payment

El pago debe guardar snapshot suficiente para auditoría histórica. Las ediciones futuras de rates, provider o method no deben cambiar cómo se ve un pago pasado.

Campos nuevos o extendidos:

- `id`/`uid` con formato tipo `pm_...`
- `status`: `PENDING | PAID | FAILED | EXPIRED`
- `orderId`
- `description`
- `language`
- `notificationUrl`
- `returnUrl`
- `cancelUrl`
- `customerSnapshotMasked`
- `customerSnapshotCiphertext`
- `selectedRouteId`
- snapshot de provider/method: provider name, method code/name, country, channel, integration mode
- fee snapshot: fixed, percentage, rate discount, min rate discount, total discount, apply to customer
- FX snapshot: spread, markup, price/mid price y currencies cuando aplique
- action snapshot: URL o datos bank transfer/voucher devueltos al merchant
- `providerTransactionId`
- routing snapshot: candidates considered, selected route, weights, reason code y seed/hash

### ProviderLog

Una fila por llamada saliente PSP -> provider.

Campos:

- `paymentId`
- `providerId`
- `routeId`
- `operation`: inicialmente `CREATE`
- `createdAt`
- `httpStatus`
- `latencyMs`
- `providerTransactionId`
- `requestMasked`
- `requestCiphertext`
- `responseMasked`
- `responseCiphertext`
- `errorCode`
- `errorMessage`

En fase 1, `Retrieve Voucher URL` no llama al provider: devuelve el action snapshot guardado, incluso si está expirado. Por tanto no genera `ProviderLog`.

### PaymentNotificationDelivery

Representa entregas PSP -> merchant.

Campos:

- `paymentId`
- `statusSnapshot`: `PAID | FAILED | EXPIRED`
- `createdAt`
- `httpStatus`
- `requestBodyMasked`
- `requestBodyCiphertext`
- `responseBodyMasked`
- `responseBodyCiphertext`
- `attemptNo`
- `isResend`
- `originalDeliveryId`

El botón `Re send notification` reenvía exactamente el mismo `requestBody` snapshot de la entrega original.

## Contrato Público De Pagos

`POST /api/v2/payments` usará un contrato nuevo. El merchant no envía provider ni método.

Request:

```json
{
  "amount": 200.0,
  "currency": "USD",
  "channel": "CASH",
  "language": "ES",
  "orderId": "merchant-order-123",
  "description": "Invoice merchant-order-123",
  "notificationUrl": "https://merchant.example/webhooks/payments",
  "returnUrl": "https://merchant.example/payment/success",
  "cancelUrl": "https://merchant.example/payment/failure",
  "customer": {
    "uid": "optional-customer-id",
    "personalId": "optional",
    "firstName": "Ada",
    "lastName": "Lovelace",
    "email": "ada@example.com",
    "phone": "+34600000000",
    "country": "EC",
    "address": {
      "line1": "Street 1",
      "city": "Guayaquil",
      "state": "GU",
      "postcode": "0000",
      "number": null,
      "neighborhood": null
    },
    "ip": "203.0.113.10"
  }
}
```

Reglas:

- `channel` es obligatorio y debe ser uno de `CASH`, `ONLINE`, `CREDIT_CARD`, `CRYPTO`.
- `customer.country` es obligatorio y define el país de routing.
- `notificationUrl`, `returnUrl` y `cancelUrl` son obligatorias para fase 1.
- Campos de control como `paymentMethodCode` o `provider` no están permitidos.
- `Idempotency-Key` se mantiene, pero el hash canónico se recalcula sobre el nuevo contrato.

Response redirect/hosted:

```json
{
  "uid": "pm_...",
  "status": "PENDING",
  "amount": 200.0,
  "currency": "USD",
  "orderId": "merchant-order-123",
  "action": {
    "type": "redirect",
    "url": "https://provider.example/checkout/..."
  }
}
```

Response bank transfer/SPEI:

```json
{
  "uid": "pm_...",
  "status": "PENDING",
  "amount": 312.42,
  "currency": "USD",
  "orderId": "5879876",
  "action": {
    "type": "bank_transfer",
    "expiresAt": "2026-05-06T06:23:38.051Z",
    "bank": "tesored",
    "merchantName": "CLB Payment",
    "clabe": "703428043000028737",
    "concept": "9187153",
    "token": "Aa7q...",
    "amount": 5700.0,
    "currency": "MXN"
  }
}
```

La response pública no devuelve el customer completo ni PII innecesaria.

Errores:

- Sin configuración elegible: `409` con `reasonCode: "payment_method_unavailable"`.
- Solo hay routes `S2S`: `409` con `reasonCode: "integration_mode_not_supported"`.
- Error upstream de provider en create: `502`, con `ProviderLog` persistido.

## Routing Y Selección Por Weight

El runtime construye un único pool de candidatos `PaymentMethodRoute`.

Filtros de elegibilidad:

- `PaymentMethodRoute.countryCode = customer.country`
- `PaymentMethodRoute.channel = request.channel`
- route activa y publicada
- provider activo, configurado y publicado
- `integrationMode IN (REDIRECTION, HOSTED_PAGE)`
- currency soportada
- amount dentro de min/max de la currency
- existe `MerchantProviderRate` activo para `merchantId + providerId + countryCode`
- channel habilitado y min amount válido en `MerchantProviderRate`
- industria compatible, salvo `disableIndustryValidation`

Selección:

- Todos los candidatos elegibles compiten directamente por `weight` global.
- Candidatos con `weight <= 0` quedan fuera, salvo que todos tengan `0`.
- Si todos tienen `0`, se elige determinísticamente por `providerId + routeId`.
- La selección ponderada usa una seed determinista derivada de `payment.uid` o `idempotencyKey + merchantId + orderId`.
- Se guarda snapshot de candidates, weights, selected route, `routingReasonCode` y seed/hash.

Fallback:

- Si el provider falla antes de obtener transaction id o action, fase 1 puede intentar otro candidato una vez.
- Si el provider devuelve transaction id, URL, voucher o estado `PROCESSING`, no se hace fallback para evitar duplicados.
- Errores funcionales del provider no deben disparar fallback automático sin una regla explícita.

## Adapter HTTP Genérico

Habrá un `GenericHttpProviderAdapter` que ejecuta plantillas controladas por código. La DB no tendrá un motor libre de mapping.

Plantillas fase 1:

### REDIRECT_SIMPLE

Construye request con:

- amount
- order id / payment uid
- customer básico
- `redirect_url` / `return_url`
- `notification_url` interno del PSP
- parámetros de provider/route

Normaliza responses tipo:

```json
{
  "result": {
    "url": "https://provider.example/checkout"
  },
  "status": true,
  "message": "Deposit Initiated Successfully!"
}
```

Produce:

```json
{
  "type": "redirect",
  "url": "https://provider.example/checkout"
}
```

### SPEI_BANK_TRANSFER

Construye request con parámetros como:

- `target_flow`
- `merchant_code`
- credential/token del provider
- `payment_webhook_url`
- amount local
- customer email
- payment uid

Normaliza responses con:

- `transfer_clabe`
- `transfer_concept`
- `expired_at`
- `merchant_bank`
- `merchant_name`
- `payment_token`

Produce:

```json
{
  "type": "bank_transfer",
  "expiresAt": "...",
  "bank": "...",
  "merchantName": "...",
  "clabe": "...",
  "concept": "...",
  "token": "...",
  "amount": 5700.0,
  "currency": "MXN"
}
```

## Provider Callbacks

Fase 1 incluye provider callbacks reales.

Endpoint público:

```text
POST /api/v2/provider-notifications/:token
```

El token opaco identifica de forma segura el pago y la route esperada. HMAC y allowlist IP quedan fuera de fase 1.

Flujo:

1. Validar token.
2. Guardar payload entrante masked/raw.
3. Normalizar estado a `PAID`, `FAILED` o `EXPIRED`.
4. Actualizar `Payment` idempotentemente.
5. Registrar evento/callback del provider.
6. Si hay cambio de estado relevante, crear y entregar notification al merchant.

Reglas:

- Repetir un callback terminal no duplica asientos financieros.
- `PAID -> FAILED` o transición terminal conflictiva queda bloqueada o registrada como anomalía, no como cambio normal.
- `PENDING -> PAID/FAILED/EXPIRED` es la transición esperada.

## Notifications Al Merchant

El PSP enviará payload normalizado inspirado en el sistema real:

```json
{
  "uid": "pm_...",
  "status": "PAID",
  "createdAt": "...",
  "updatedStatusAt": "...",
  "description": "...",
  "currency": "USD",
  "amount": 63.09,
  "language": "EN",
  "orderId": "5879883",
  "notificationUrl": "...",
  "returnUrl": "...",
  "cancelUrl": "...",
  "customer": {
    "uid": null,
    "personalId": null,
    "address": "12 ****",
    "city": "Idimu-Ikotun",
    "country": "NG",
    "email": "g**************@gmail.com",
    "firstName": "G*******",
    "lastName": "A****",
    "phone": "******2925",
    "postcode": "10****",
    "number": null,
    "state": "LA",
    "neighborhood": null,
    "ip": "197.210.***.***"
  },
  "paymentMethod": {
    "uid": "2000",
    "name": "Bank Transfer",
    "country": "NG",
    "channel": "ONLINE"
  },
  "merchantDiscountRate": {
    "fixed": 1.0,
    "percentage": 4.5,
    "rateDiscount": 2.84,
    "minRateDiscount": 0.0,
    "totalDiscount": 3.84,
    "applyToCustomer": false
  },
  "sourceInfo": {
    "amount": 90000.0,
    "currency": "NGN"
  },
  "voucherInfo": {
    "amount": 90000.0,
    "currency": "NGN"
  }
}
```

El request exacto enviado al merchant se guarda en `PaymentNotificationDelivery`. La UI puede mostrar versión masked si contiene PII.

Resend:

- Reenvía el snapshot exacto.
- Crea nueva delivery con `isResend = true`.
- Guarda HTTP status y response body del merchant.

## Backoffice Admin

### Payment Providers

CRUD admin:

- listado con description/name, integration base URL, init payment resource, active/configured/published y count de methods;
- crear/editar provider;
- checks `Configured`, `Active`, `Published`;
- secrets protegidos: no se muestran en claro tras guardar.

### Payment Methods / Routes

CRUD admin con filtros por:

- country
- provider
- merchant/shop futuro
- channel
- status
- industry type

Tabla:

- UID
- checkout URL template
- name
- country
- channel
- provider
- code
- currencies
- weight
- status

Pantalla de edición:

- `Details`: general info, classification, provider settings, capabilities, options, currencies.
- `Weight`: routes disponibles para el mismo `methodCode + methodName + country + channel`, con edición de weight global.
- `Mappings`, `Banks`, `Form`, `Rate Schemes`: fuera de fase 1 salvo placeholders o tabs ocultas.

### Merchant Payment Config

En el admin del merchant:

- pestaña `Payment Config`;
- botón `Add Rates`;
- modal con country y provider filtrados por methods disponibles;
- fields: percentage, fixed, disable industry validation, min amounts por channel, fx spread, fx markup, apply to customer;
- guardar crea o actualiza `MerchantProviderRate`.

El portal merchant no puede modificar esta configuración.

### Payment Detail

Tabs:

- `Details`: payment, fees, currency conversion, payment method, customer masked.
- `Notifications`: deliveries PSP -> merchant, request body, response body, HTTP status, resend.
- `Provider Logs`: llamadas PSP -> provider, request body, response body, transaction id.

`Retrieve Voucher URL` devuelve el action snapshot guardado. No llama al provider en fase 1.

## Seguridad Y Privacidad

- CRUD y vistas admin pasan por BFF `/api/internal/*`.
- API interna protegida por `InternalSecretGuard` y RBAC admin/merchant existente.
- Portal merchant solo consulta datos scoped a su merchant.
- Payload raw con PII se cifra o restringe con `APP_ENCRYPTION_KEY`.
- UI normal usa payload masked.
- Secrets de provider no se devuelven en claro tras guardarse.
- Provider callbacks fase 1 usan token opaco en URL; HMAC/IP allowlist quedan para providers específicos o fase posterior.

## Testing

API unit:

- DTO create payment nuevo.
- Routing por filtros.
- Selección por weight determinista.
- Zero-weight fallback.
- Exclusión de `S2S`.
- Fee/rate snapshot.
- Plantillas `REDIRECT_SIMPLE` y `SPEI_BANK_TRANSFER`.
- Provider callback normalization.
- Notification payload snapshot y resend.
- Masking/cifrado de payloads.

Integration local:

- CRUD config con DB real.
- Create payment redirect.
- Create payment SPEI.
- Provider callback `PAID`.
- Provider callback `FAILED` y `EXPIRED`.
- Notifications y resend.
- Endpoints internos backoffice con RBAC.

Backoffice:

- Vitest para BFF routes y mappers de forms.
- Playwright admin para crear provider, route, merchant rate y ver detail de pago con provider logs/notifications.

Docs:

- Actualizar `PROJECT_CONTEXT.md`.
- Actualizar `apps/psp-api/README.md`.
- Actualizar `apps/psp-backoffice/BACKOFFICE_CONTEXT.md`.
- Actualizar `docs/testing-status.md`.

## Fases De Implementación

1. **Schema y dominio de configuración**
   Modelos Prisma, migraciones, DTOs, servicios internos y endpoints CRUD.

2. **Backoffice admin CRUD**
   Providers, payment routes, currencies, weight y merchant add rates.

3. **Runtime create payment**
   Nuevo contrato v2, routing, fee snapshot, action snapshot, adapter genérico y `ProviderLog`.

4. **Provider callbacks y merchant notifications**
   Token opaco, transición de estados, delivery a merchant, resend exacto.

5. **Payment detail backoffice**
   Details, Notifications, Provider Logs y retrieve action URL.

6. **Limpieza del contrato anterior**
   Retirar supuestos de mock v2 anterior, rehacer demo y actualizar tests/docs.

## Riesgos Y Guardrails

- Alcance grande: implementar y revisar por fase.
- Evitar mapping libre desde DB en fase 1.
- No mezclar routing decisions en `Provider Logs`.
- No devolver PII innecesaria en create response.
- No regenerar notification bodies en resend.
- No llamar provider para retrieve voucher URL en fase 1.
- No introducir multi-shop completo todavía.
- Mantener snapshots financieros y de method/provider para que pagos históricos no cambien al editar configuración.
