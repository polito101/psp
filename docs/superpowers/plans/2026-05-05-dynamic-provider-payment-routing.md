# Dynamic Provider Payment Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current static Payments V2 provider flow with dynamic provider/method configuration, weighted routing, real provider callbacks, merchant notifications, and admin backoffice CRUD.

**Architecture:** Add a persistent configuration domain around `PaymentProvider`, `PaymentMethodRoute`, route currencies, and merchant provider rates, then cut over `/api/v2/payments` to a new contract where merchants send amount/currency/channel/customer and the PSP selects a provider+method route by global weight. Provider calls go through a generic HTTP adapter with code-controlled templates; provider logs and merchant notifications keep encrypted raw payloads plus masked UI payloads.

**Tech Stack:** NestJS 11, Prisma ORM 7, PostgreSQL, Jest/Supertest, Next.js 16 App Router, TanStack Query/Table, Vitest, Playwright.

---

## File Structure

### API Schema And Domain

- **Modify:** `apps/psp-api/prisma/schema.prisma`
- **Create:** `apps/psp-api/prisma/migrations/20260505120000_dynamic_provider_routing/migration.sql`
- **Create:** `apps/psp-api/src/payments-v2/domain/dynamic-payment-types.ts`
- **Create:** `apps/psp-api/src/payments-v2/domain/payment-payload-masking.ts`
- **Create:** `apps/psp-api/src/payments-v2/domain/payment-action-normalizer.ts`
- **Create:** `apps/psp-api/src/payments-v2/domain/payment-routing.service.ts`
- **Create:** `apps/psp-api/src/payments-v2/domain/payment-routing.service.spec.ts`

### API Configuration CRUD

- **Create:** `apps/psp-api/src/payments-v2/dto/create-payment-provider.dto.ts`
- **Create:** `apps/psp-api/src/payments-v2/dto/update-payment-provider.dto.ts`
- **Create:** `apps/psp-api/src/payments-v2/dto/create-payment-method-route.dto.ts`
- **Create:** `apps/psp-api/src/payments-v2/dto/update-payment-method-route.dto.ts`
- **Create:** `apps/psp-api/src/payments-v2/dto/upsert-merchant-provider-rate.dto.ts`
- **Create:** `apps/psp-api/src/payments-v2/payment-configuration.service.ts`
- **Create:** `apps/psp-api/src/payments-v2/payment-configuration.service.spec.ts`
- **Create:** `apps/psp-api/src/payments-v2/payment-configuration.controller.ts`
- **Modify:** `apps/psp-api/src/payments-v2/payments-v2.module.ts`

### API Runtime

- **Modify:** `apps/psp-api/src/payments-v2/dto/create-payment-intent.dto.ts`
- **Create:** `apps/psp-api/src/payments-v2/dto/provider-notification-token-param.dto.ts`
- **Create:** `apps/psp-api/src/payments-v2/providers/generic-http-provider.adapter.ts`
- **Create:** `apps/psp-api/src/payments-v2/providers/generic-http-provider.adapter.spec.ts`
- **Create:** `apps/psp-api/src/payments-v2/provider-notifications.controller.ts`
- **Create:** `apps/psp-api/src/payments-v2/payment-notifications.service.ts`
- **Create:** `apps/psp-api/src/payments-v2/payment-notifications.service.spec.ts`
- **Modify:** `apps/psp-api/src/payments-v2/payments-v2.service.ts`
- **Modify:** `apps/psp-api/src/payments-v2/payments-v2.service.spec.ts`
- **Modify:** `apps/psp-api/src/payments-v2/payments-v2.controller.ts`
- **Modify:** `apps/psp-api/src/payments-v2/payments-v2-internal.controller.ts`

### API Integration Tests

- **Create:** `apps/psp-api/test/integration/dynamic-payment-configuration.integration.spec.ts`
- **Create:** `apps/psp-api/test/integration/dynamic-payments-v2.integration.spec.ts`
- **Modify:** `apps/psp-api/test/integration/payments-v2.integration.spec.ts`
- **Modify:** `apps/psp-api/test/integration/helpers/integration-app.ts`

### Backoffice BFF And Client

- **Modify:** `apps/psp-backoffice/src/lib/api/contracts.ts`
- **Modify:** `apps/psp-backoffice/src/lib/api/client.ts`
- **Create:** `apps/psp-backoffice/src/app/api/internal/payment-providers/route.ts`
- **Create:** `apps/psp-backoffice/src/app/api/internal/payment-providers/[providerId]/route.ts`
- **Create:** `apps/psp-backoffice/src/app/api/internal/payment-method-routes/route.ts`
- **Create:** `apps/psp-backoffice/src/app/api/internal/payment-method-routes/[routeId]/route.ts`
- **Create:** `apps/psp-backoffice/src/app/api/internal/payment-method-routes/[routeId]/weight/route.ts`
- **Create:** `apps/psp-backoffice/src/app/api/internal/merchants/ops/[merchantId]/provider-rates/route.ts`
- **Modify:** `apps/psp-backoffice/src/app/api/internal/payments/[paymentId]/route.ts`
- **Create:** `apps/psp-backoffice/src/app/api/internal/payments/[paymentId]/notifications/[deliveryId]/resend/route.ts`
- **Create:** `apps/psp-backoffice/src/app/api/internal/payments/[paymentId]/action/route.ts`
- **Modify:** `apps/psp-backoffice/src/lib/server/backoffice-api.spec.ts`

### Backoffice UI

- **Create:** `apps/psp-backoffice/src/app/payment-providers/page.tsx`
- **Create:** `apps/psp-backoffice/src/app/payment-methods/page.tsx`
- **Create:** `apps/psp-backoffice/src/components/payment-providers/payment-providers-dashboard.tsx`
- **Create:** `apps/psp-backoffice/src/components/payment-methods/payment-method-routes-dashboard.tsx`
- **Create:** `apps/psp-backoffice/src/components/payment-methods/payment-method-route-editor.tsx`
- **Create:** `apps/psp-backoffice/src/components/payment-methods/payment-method-weight-tab.tsx`
- **Create:** `apps/psp-backoffice/src/components/merchants/merchant-provider-rates-panel.tsx`
- **Modify:** `apps/psp-backoffice/src/components/merchants/merchant-admin-panel.tsx`
- **Modify:** `apps/psp-backoffice/src/components/transactions/payment-detail-view.tsx`
- **Modify:** `apps/psp-backoffice/src/components/app-shell.tsx`
- **Modify:** `apps/psp-backoffice/e2e/auth-and-rbac.spec.ts`

### Docs

- **Modify:** `PROJECT_CONTEXT.md`
- **Modify:** `apps/psp-api/README.md`
- **Modify:** `apps/psp-backoffice/BACKOFFICE_CONTEXT.md`
- **Modify:** `docs/testing-status.md`

---

## Task 1: Add Prisma Schema For Dynamic Provider Routing

**Files:**
- Modify: `apps/psp-api/prisma/schema.prisma`
- Create: `apps/psp-api/prisma/migrations/20260505120000_dynamic_provider_routing/migration.sql`
- Test: Prisma validation and API typecheck

- [ ] **Step 1: Add Prisma enums**

Add these enums near existing enum definitions in `apps/psp-api/prisma/schema.prisma`:

```prisma
enum PaymentChannel {
  CASH
  ONLINE
  CREDIT_CARD
  CRYPTO
}

enum PaymentIntegrationMode {
  S2S
  REDIRECTION
  HOSTED_PAGE
}

enum PaymentProviderRequestTemplate {
  REDIRECT_SIMPLE
  SPEI_BANK_TRANSFER
}

enum DynamicPaymentStatus {
  PENDING
  PAID
  FAILED
  EXPIRED
}

enum ProviderLogOperation {
  CREATE
}
```

- [ ] **Step 2: Add configuration models**

Add these models after the current `MerchantPaymentMethod` model. Keep existing models in place during the first migration so existing tests can be updated incrementally.

```prisma
model PaymentProviderConfig {
  id                    String   @id @default(cuid())
  name                  String   @db.VarChar(160)
  description           String?  @db.VarChar(512)
  integrationBaseUrl    String   @map("integration_base_url") @db.VarChar(2048)
  initPaymentResource   String   @map("init_payment_resource") @db.VarChar(2048)
  isConfigured          Boolean  @default(false) @map("is_configured")
  isActive              Boolean  @default(true) @map("is_active")
  isPublished           Boolean  @default(false) @map("is_published")
  configCiphertext      String?  @map("config_ciphertext")
  credentialsCiphertext String?  @map("credentials_ciphertext")
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  routes        PaymentMethodRoute[]
  merchantRates MerchantProviderRate[]
  providerLogs  ProviderLog[]

  @@index([isActive, isPublished])
  @@map("payment_provider_configs")
}

model PaymentMethodRoute {
  id                   String                         @id @default(cuid())
  providerId           String                         @map("provider_id")
  methodCode           String                         @map("method_code") @db.VarChar(64)
  methodName           String                         @map("method_name") @db.VarChar(160)
  countryCode          String                         @map("country_code") @db.VarChar(2)
  countryName          String?                        @map("country_name") @db.VarChar(120)
  countryImageName     String?                        @map("country_image_name") @db.VarChar(120)
  channel              PaymentChannel
  integrationMode      PaymentIntegrationMode         @map("integration_mode")
  requestTemplate      PaymentProviderRequestTemplate @map("request_template")
  integrationCode      String?                        @map("integration_code") @db.VarChar(120)
  checkoutUrlTemplate  String?                        @map("checkout_url_template") @db.VarChar(2048)
  expirationTimeOffset Int                            @default(0) @map("expiration_time_offset")
  weight               Int                            @default(0)
  isActive             Boolean                        @default(true) @map("is_active")
  isPublished          Boolean                        @default(false) @map("is_published")
  isFlagged            Boolean                        @default(false) @map("is_flagged")
  forcePendingInput    Boolean                        @default(false) @map("force_pending_input")
  isVirtual            Boolean                        @default(false) @map("is_virtual")
  riskEvaluation       Boolean                        @default(false) @map("risk_evaluation")
  routeConfigJson      Json?                          @map("route_config_json")
  routeConfigCiphertext String?                       @map("route_config_ciphertext")
  createdAt            DateTime                       @default(now()) @map("created_at")
  updatedAt            DateTime                       @updatedAt @map("updated_at")

  provider PaymentProviderConfig       @relation(fields: [providerId], references: [id], onDelete: Cascade)
  currencies PaymentMethodRouteCurrency[]
  providerLogs ProviderLog[]

  @@index([countryCode, channel, isActive, isPublished])
  @@index([providerId, countryCode])
  @@index([methodCode, countryCode, channel])
  @@map("payment_method_routes")
}

model PaymentMethodRouteCurrency {
  id        String   @id @default(cuid())
  routeId   String   @map("route_id")
  currency  String   @db.VarChar(8)
  minAmount Decimal  @map("min_amount") @db.Decimal(18, 6)
  maxAmount Decimal  @map("max_amount") @db.Decimal(18, 6)
  isDefault Boolean  @default(false) @map("is_default")
  createdAt DateTime @default(now()) @map("created_at")

  route PaymentMethodRoute @relation(fields: [routeId], references: [id], onDelete: Cascade)

  @@unique([routeId, currency])
  @@index([currency])
  @@map("payment_method_route_currencies")
}

model MerchantProviderRate {
  id                         String   @id @default(cuid())
  merchantId                 String   @map("merchant_id")
  providerId                 String   @map("provider_id")
  countryCode                String   @map("country_code") @db.VarChar(2)
  percentage                 Decimal  @db.Decimal(10, 4)
  fixed                      Decimal  @db.Decimal(18, 6)
  minRateDiscount            Decimal  @default(0) @map("min_rate_discount") @db.Decimal(18, 6)
  applyToCustomer            Boolean  @default(false) @map("apply_to_customer")
  fxSpread                   Decimal  @default(0) @map("fx_spread") @db.Decimal(10, 4)
  fxMarkup                   Decimal  @default(0) @map("fx_markup") @db.Decimal(10, 4)
  disableIndustryValidation  Boolean  @default(false) @map("disable_industry_validation")
  cashEnabled                Boolean  @default(true) @map("cash_enabled")
  creditCardEnabled          Boolean  @default(true) @map("credit_card_enabled")
  cryptoEnabled              Boolean  @default(true) @map("crypto_enabled")
  onlineEnabled              Boolean  @default(true) @map("online_enabled")
  cashMinAmount              Decimal  @default(0) @map("cash_min_amount") @db.Decimal(18, 6)
  creditCardMinAmount        Decimal  @default(0) @map("credit_card_min_amount") @db.Decimal(18, 6)
  cryptoMinAmount            Decimal  @default(0) @map("crypto_min_amount") @db.Decimal(18, 6)
  onlineMinAmount            Decimal  @default(0) @map("online_min_amount") @db.Decimal(18, 6)
  isActive                   Boolean  @default(true) @map("is_active")
  createdAt                  DateTime @default(now()) @map("created_at")
  updatedAt                  DateTime @updatedAt @map("updated_at")

  merchant Merchant              @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  provider PaymentProviderConfig @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@unique([merchantId, providerId, countryCode])
  @@index([merchantId, countryCode, isActive])
  @@map("merchant_provider_rates")
}
```

- [ ] **Step 3: Extend `Payment` with dynamic snapshots**

Add nullable fields to `Payment` so migration is backward-compatible while runtime is cut over later:

```prisma
  dynamicStatus              DynamicPaymentStatus? @map("dynamic_status")
  orderId                    String?               @map("order_id") @db.VarChar(128)
  description                String?               @db.VarChar(512)
  language                   String?               @db.VarChar(8)
  notificationUrl            String?               @map("notification_url") @db.VarChar(2048)
  returnUrl                  String?               @map("return_url") @db.VarChar(2048)
  cancelUrl                  String?               @map("cancel_url") @db.VarChar(2048)
  selectedRouteId            String?               @map("selected_route_id")
  providerTransactionId      String?               @map("provider_transaction_id") @db.VarChar(160)
  customerSnapshotMasked     Json?                 @map("customer_snapshot_masked")
  customerSnapshotCiphertext String?               @map("customer_snapshot_ciphertext")
  methodSnapshot             Json?                 @map("method_snapshot")
  feeSnapshot                Json?                 @map("fee_snapshot")
  fxSnapshot                 Json?                 @map("fx_snapshot")
  actionSnapshot             Json?                 @map("action_snapshot")
  routingSnapshot            Json?                 @map("routing_snapshot")
```

Add relations and indexes:

```prisma
  providerLogs          ProviderLog[]
  notificationDeliveries PaymentNotificationDelivery[]

  @@index([dynamicStatus, createdAt])
  @@index([selectedRouteId])
```

- [ ] **Step 4: Add log and delivery models**

Add these models after `PaymentAttempt`:

```prisma
model ProviderLog {
  id                    String               @id @default(cuid())
  paymentId             String               @map("payment_id")
  providerId            String               @map("provider_id")
  routeId               String               @map("route_id")
  operation             ProviderLogOperation
  createdAt             DateTime             @default(now()) @map("created_at")
  httpStatus            Int?                 @map("http_status")
  latencyMs             Int?                 @map("latency_ms")
  providerTransactionId String?              @map("provider_transaction_id") @db.VarChar(160)
  requestMasked         Json?                @map("request_masked")
  requestCiphertext     String?              @map("request_ciphertext")
  responseMasked        Json?                @map("response_masked")
  responseCiphertext    String?              @map("response_ciphertext")
  errorCode             String?              @map("error_code") @db.VarChar(120)
  errorMessage          String?              @map("error_message") @db.VarChar(512)

  payment  Payment               @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  provider PaymentProviderConfig @relation(fields: [providerId], references: [id], onDelete: Restrict)
  route    PaymentMethodRoute    @relation(fields: [routeId], references: [id], onDelete: Restrict)

  @@index([paymentId, createdAt])
  @@index([providerId, createdAt])
  @@map("provider_logs")
}

model PaymentNotificationDelivery {
  id                     String               @id @default(cuid())
  paymentId              String               @map("payment_id")
  statusSnapshot         DynamicPaymentStatus @map("status_snapshot")
  createdAt              DateTime             @default(now()) @map("created_at")
  httpStatus             Int?                 @map("http_status")
  requestBodyMasked      Json?                @map("request_body_masked")
  requestBodyCiphertext  String?              @map("request_body_ciphertext")
  responseBodyMasked     Json?                @map("response_body_masked")
  responseBodyCiphertext String?              @map("response_body_ciphertext")
  attemptNo              Int                  @map("attempt_no")
  isResend               Boolean              @default(false) @map("is_resend")
  originalDeliveryId     String?              @map("original_delivery_id")

  payment Payment @relation(fields: [paymentId], references: [id], onDelete: Cascade)

  @@unique([paymentId, attemptNo])
  @@index([paymentId, createdAt])
  @@map("payment_notification_deliveries")
}
```

- [ ] **Step 5: Create migration SQL**

Run:

```powershell
cd "C:\AA psp\apps\psp-api"
npm run prisma:migrate -- --name dynamic_provider_routing
```

Expected: Prisma creates a migration and regenerates the client. If `prisma migrate dev` cannot run because local DB is not available, create `apps/psp-api/prisma/migrations/20260505120000_dynamic_provider_routing/migration.sql` manually from the schema changes and run validation in Step 6.

- [ ] **Step 6: Validate schema and generated client**

Run:

```powershell
cd "C:\AA psp\apps\psp-api"
npx prisma validate
npx prisma generate
npm run lint
```

Expected: all commands pass. `npm run lint` may fail on code that has not yet been updated to use generated relation fields; fix type errors in the next task if the errors refer to new generated types.

- [ ] **Step 7: Commit schema**

Commit only schema and migration:

```powershell
git add "apps/psp-api/prisma/schema.prisma" "apps/psp-api/prisma/migrations/20260505120000_dynamic_provider_routing/migration.sql"
git commit -m "feat(api): add dynamic payment routing schema"
```

---

## Task 2: Add Shared Dynamic Payment Types, Masking, And Action Normalization

**Files:**
- Create: `apps/psp-api/src/payments-v2/domain/dynamic-payment-types.ts`
- Create: `apps/psp-api/src/payments-v2/domain/payment-payload-masking.ts`
- Create: `apps/psp-api/src/payments-v2/domain/payment-action-normalizer.ts`
- Test: `apps/psp-api/src/payments-v2/domain/payment-payload-masking.spec.ts`
- Test: `apps/psp-api/src/payments-v2/domain/payment-action-normalizer.spec.ts`

- [ ] **Step 1: Write failing masking tests**

Create `apps/psp-api/src/payments-v2/domain/payment-payload-masking.spec.ts`:

```ts
import { maskPaymentPayload } from './payment-payload-masking';

describe('maskPaymentPayload', () => {
  it('masks common PII fields recursively', () => {
    const masked = maskPaymentPayload({
      customer: {
        email: 'ada.lovelace@example.com',
        phone: '+34600000000',
        firstName: 'Ada',
        lastName: 'Lovelace',
        ip: '203.0.113.10',
        identify: { number: '123456789' },
      },
    });

    expect(masked).toEqual({
      customer: {
        email: 'a***********@example.com',
        phone: '*********0000',
        firstName: 'A**',
        lastName: 'L******',
        ip: '203.0.***.***',
        identify: { number: '*****6789' },
      },
    });
  });

  it('leaves non-PII operational fields unchanged', () => {
    expect(
      maskPaymentPayload({
        amount: 200,
        currency: 'USD',
        status: 'PENDING',
        action: { type: 'redirect', url: 'https://example.com/pay' },
      }),
    ).toEqual({
      amount: 200,
      currency: 'USD',
      status: 'PENDING',
      action: { type: 'redirect', url: 'https://example.com/pay' },
    });
  });
});
```

- [ ] **Step 2: Implement dynamic payment types**

Create `apps/psp-api/src/payments-v2/domain/dynamic-payment-types.ts`:

```ts
export const PAYMENT_CHANNELS = ['CASH', 'ONLINE', 'CREDIT_CARD', 'CRYPTO'] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export const PAYMENT_INTEGRATION_MODES = ['S2S', 'REDIRECTION', 'HOSTED_PAGE'] as const;
export type PaymentIntegrationMode = (typeof PAYMENT_INTEGRATION_MODES)[number];

export const PAYMENT_REQUEST_TEMPLATES = ['REDIRECT_SIMPLE', 'SPEI_BANK_TRANSFER'] as const;
export type PaymentRequestTemplate = (typeof PAYMENT_REQUEST_TEMPLATES)[number];

export const DYNAMIC_PAYMENT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'EXPIRED'] as const;
export type DynamicPaymentStatus = (typeof DYNAMIC_PAYMENT_STATUSES)[number];

export type RedirectPaymentAction = {
  type: 'redirect';
  url: string;
};

export type BankTransferPaymentAction = {
  type: 'bank_transfer';
  expiresAt?: string;
  bank?: string;
  merchantName?: string;
  clabe?: string;
  concept?: string;
  token?: string;
  amount?: number;
  currency?: string;
};

export type DynamicPaymentAction = RedirectPaymentAction | BankTransferPaymentAction;

export type MaskableJson =
  | null
  | boolean
  | number
  | string
  | MaskableJson[]
  | { [key: string]: MaskableJson };
```

- [ ] **Step 3: Implement masking helper**

Create `apps/psp-api/src/payments-v2/domain/payment-payload-masking.ts`:

```ts
import { MaskableJson } from './dynamic-payment-types';

const EMAIL_KEYS = new Set(['email', 'customer_email']);
const PHONE_KEYS = new Set(['phone']);
const NAME_KEYS = new Set(['name', 'firstName', 'first_name', 'lastName', 'last_name']);
const ID_KEYS = new Set(['personalId', 'personal_id', 'number', 'pan', 'CPF']);
const IP_KEYS = new Set(['ip']);
const ADDRESS_KEYS = new Set(['address', 'line1', 'postcode', 'zip_code']);

function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return maskGeneric(value);
  return `${value[0]}${'*'.repeat(Math.max(3, at - 1))}${value.slice(at)}`;
}

function maskPhone(value: string): string {
  const visible = value.slice(-4);
  return `${'*'.repeat(Math.max(4, value.length - visible.length))}${visible}`;
}

function maskName(value: string): string {
  if (value.length <= 1) return '*';
  return `${value[0]}${'*'.repeat(Math.max(2, value.length - 1))}`;
}

function maskIp(value: string): string {
  const parts = value.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.***.***`;
  return maskGeneric(value);
}

function maskGeneric(value: string): string {
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${'*'.repeat(Math.max(3, value.length - 4))}${value.slice(-4)}`;
}

function maskAddress(value: string): string {
  if (value.length <= 1) return '*';
  return `${value[0]}***`;
}

function maskValue(key: string, value: string): string {
  if (EMAIL_KEYS.has(key)) return maskEmail(value);
  if (PHONE_KEYS.has(key)) return maskPhone(value);
  if (NAME_KEYS.has(key)) return maskName(value);
  if (IP_KEYS.has(key)) return maskIp(value);
  if (ID_KEYS.has(key)) return maskGeneric(value);
  if (ADDRESS_KEYS.has(key)) return maskAddress(value);
  return value;
}

export function maskPaymentPayload(payload: MaskableJson): MaskableJson {
  if (payload === null || typeof payload === 'boolean' || typeof payload === 'number') return payload;
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload)) return payload.map((item) => maskPaymentPayload(item));

  const masked: Record<string, MaskableJson> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string') {
      masked[key] = maskValue(key, value);
    } else {
      masked[key] = maskPaymentPayload(value);
    }
  }
  return masked;
}
```

- [ ] **Step 4: Write failing action normalizer tests**

Create `apps/psp-api/src/payments-v2/domain/payment-action-normalizer.spec.ts`:

```ts
import { normalizeProviderCreateResponse } from './payment-action-normalizer';

describe('normalizeProviderCreateResponse', () => {
  it('normalizes redirect responses with result.url', () => {
    expect(
      normalizeProviderCreateResponse('REDIRECT_SIMPLE', {
        result: { url: 'https://kudipay.net/ngn-pay/?enc=abc' },
        status: true,
        message: 'Deposit Initiated Successfully!',
      }),
    ).toEqual({
      action: { type: 'redirect', url: 'https://kudipay.net/ngn-pay/?enc=abc' },
      providerTransactionId: null,
      providerStatus: 'PENDING',
    });
  });

  it('normalizes SPEI bank transfer responses', () => {
    expect(
      normalizeProviderCreateResponse('SPEI_BANK_TRANSFER', {
        expired_at: '2026-05-06T06:23:38.051Z',
        merchant_bank: 'tesored',
        merchant_name: 'CLB Payment',
        payment_token: 'token_123',
        transfer_clabe: '703428043000028737',
        transfer_concept: '9187153',
      }),
    ).toEqual({
      action: {
        type: 'bank_transfer',
        expiresAt: '2026-05-06T06:23:38.051Z',
        bank: 'tesored',
        merchantName: 'CLB Payment',
        clabe: '703428043000028737',
        concept: '9187153',
        token: 'token_123',
      },
      providerTransactionId: 'token_123',
      providerStatus: 'PENDING',
    });
  });
});
```

- [ ] **Step 5: Implement action normalizer**

Create `apps/psp-api/src/payments-v2/domain/payment-action-normalizer.ts`:

```ts
import {
  DynamicPaymentAction,
  DynamicPaymentStatus,
  PaymentRequestTemplate,
} from './dynamic-payment-types';

type NormalizedCreateResponse = {
  action: DynamicPaymentAction;
  providerTransactionId: string | null;
  providerStatus: DynamicPaymentStatus;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function normalizeProviderCreateResponse(
  template: PaymentRequestTemplate,
  raw: unknown,
): NormalizedCreateResponse {
  const record = asRecord(raw);
  if (template === 'REDIRECT_SIMPLE') {
    const result = asRecord(record.result);
    const url = readString(result, 'url');
    if (!url) throw new Error('REDIRECT_SIMPLE provider response missing result.url');
    const providerTransactionId =
      readString(record, 'trade_no') ?? readString(record, 'transactionId') ?? null;
    return {
      action: { type: 'redirect', url },
      providerTransactionId,
      providerStatus: 'PENDING',
    };
  }

  if (template === 'SPEI_BANK_TRANSFER') {
    const token = readString(record, 'payment_token') ?? readString(record, 'trade_no') ?? null;
    return {
      action: {
        type: 'bank_transfer',
        expiresAt: readString(record, 'expired_at'),
        bank: readString(record, 'merchant_bank'),
        merchantName: readString(record, 'merchant_name'),
        clabe: readString(record, 'transfer_clabe'),
        concept: readString(record, 'transfer_concept'),
        token: token ?? undefined,
      },
      providerTransactionId: token,
      providerStatus: 'PENDING',
    };
  }

  const exhaustive: never = template;
  throw new Error(`Unsupported request template: ${exhaustive}`);
}
```

- [ ] **Step 6: Run unit tests**

Run:

```powershell
cd "C:\AA psp\apps\psp-api"
npm run test -- --runTestsByPath src/payments-v2/domain/payment-payload-masking.spec.ts src/payments-v2/domain/payment-action-normalizer.spec.ts
```

Expected: both specs pass.

- [ ] **Step 7: Commit domain helpers**

```powershell
git add "apps/psp-api/src/payments-v2/domain"
git commit -m "feat(api): add dynamic payment domain helpers"
```

---

## Task 3: Add API Configuration CRUD

**Files:**
- Create DTOs in `apps/psp-api/src/payments-v2/dto/`
- Create: `apps/psp-api/src/payments-v2/payment-configuration.service.ts`
- Create: `apps/psp-api/src/payments-v2/payment-configuration.controller.ts`
- Modify: `apps/psp-api/src/payments-v2/payments-v2.module.ts`
- Test: `apps/psp-api/src/payments-v2/payment-configuration.service.spec.ts`
- Test: `apps/psp-api/test/integration/dynamic-payment-configuration.integration.spec.ts`

- [ ] **Step 1: Write service tests for provider CRUD**

Create `apps/psp-api/src/payments-v2/payment-configuration.service.spec.ts` with a mocked Prisma service:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentConfigurationService } from './payment-configuration.service';

const prisma = {
  paymentProviderConfig: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  paymentMethodRoute: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  merchantProviderRate: {
    upsert: jest.fn(),
  },
};

describe('PaymentConfigurationService', () => {
  let service: PaymentConfigurationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentConfigurationService(prisma as never);
  });

  it('creates a provider config', async () => {
    prisma.paymentProviderConfig.create.mockResolvedValue({ id: 'prov_1', name: 'AxisPay' });

    await expect(
      service.createProvider({
        name: 'AxisPay',
        integrationBaseUrl: 'https://secure.example.com',
        initPaymentResource: '/api/v1/transactions',
        isConfigured: true,
        isActive: true,
        isPublished: true,
      }),
    ).resolves.toEqual({ id: 'prov_1', name: 'AxisPay' });

    expect(prisma.paymentProviderConfig.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'AxisPay',
        integrationBaseUrl: 'https://secure.example.com',
        initPaymentResource: '/api/v1/transactions',
      }),
    });
  });

  it('throws NotFoundException when updating a missing provider', async () => {
    prisma.paymentProviderConfig.findUnique.mockResolvedValue(null);

    await expect(service.updateProvider('missing', { isActive: false })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects route creation for missing provider', async () => {
    prisma.paymentProviderConfig.findUnique.mockResolvedValue(null);

    await expect(
      service.createRoute({
        providerId: 'missing',
        methodCode: '2000',
        methodName: 'Bank Transfer',
        countryCode: 'NG',
        channel: 'ONLINE',
        integrationMode: 'HOSTED_PAGE',
        requestTemplate: 'REDIRECT_SIMPLE',
        weight: 1,
        currencies: [{ currency: 'USD', minAmount: 1, maxAmount: 5000, isDefault: true }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
```

- [ ] **Step 2: Add DTOs**

Create DTO classes with strict validation. Example for `create-payment-provider.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreatePaymentProviderDto {
  @ApiProperty({ example: 'AxisPay' })
  @IsString()
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @ApiProperty({ example: 'https://secure-sf8zywmmkr.key2pay.io' })
  @IsUrl({ require_tld: false, protocols: ['https'] })
  @MaxLength(2048)
  integrationBaseUrl!: string;

  @ApiProperty({ example: '/api/v1/transactions?providerId=2539a471-73fc-41c9-8b93-6dd45f1b5e5e' })
  @IsString()
  @MaxLength(2048)
  initPaymentResource!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isConfigured?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
```

Create `update-payment-provider.dto.ts` as `PartialType(CreatePaymentProviderDto)` using `@nestjs/swagger`.

Create route DTOs with these properties:

```ts
providerId: string;
methodCode: string;
methodName: string;
countryCode: string;
countryName?: string;
countryImageName?: string;
channel: 'CASH' | 'ONLINE' | 'CREDIT_CARD' | 'CRYPTO';
integrationMode: 'S2S' | 'REDIRECTION' | 'HOSTED_PAGE';
requestTemplate: 'REDIRECT_SIMPLE' | 'SPEI_BANK_TRANSFER';
integrationCode?: string;
checkoutUrlTemplate?: string;
expirationTimeOffset?: number;
weight?: number;
isActive?: boolean;
isPublished?: boolean;
routeConfigJson?: Record<string, unknown>;
currencies: Array<{ currency: string; minAmount: number; maxAmount: number; isDefault?: boolean }>;
```

Create merchant rate DTO with the fields from `MerchantProviderRate`.

- [ ] **Step 3: Implement `PaymentConfigurationService`**

Create methods:

```ts
createProvider(dto: CreatePaymentProviderDto)
updateProvider(providerId: string, dto: UpdatePaymentProviderDto)
listProviders()
createRoute(dto: CreatePaymentMethodRouteDto)
updateRoute(routeId: string, dto: UpdatePaymentMethodRouteDto)
listRoutes(filters: { countryCode?: string; providerId?: string; channel?: PaymentChannel; isActive?: boolean })
updateRouteWeight(routeId: string, weight: number)
upsertMerchantProviderRate(merchantId: string, dto: UpsertMerchantProviderRateDto)
listMerchantProviderRates(merchantId: string)
```

Use Prisma nested writes for route currencies:

```ts
currencies: {
  create: dto.currencies.map((currency) => ({
    currency: currency.currency.trim().toUpperCase(),
    minAmount: currency.minAmount,
    maxAmount: currency.maxAmount,
    isDefault: currency.isDefault ?? false,
  })),
}
```

- [ ] **Step 4: Implement internal controller**

Create `apps/psp-api/src/payments-v2/payment-configuration.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InternalSecretGuard } from '../common/guards/internal-secret.guard';
import { CreatePaymentProviderDto } from './dto/create-payment-provider.dto';
import { CreatePaymentMethodRouteDto } from './dto/create-payment-method-route.dto';
import { UpdatePaymentProviderDto } from './dto/update-payment-provider.dto';
import { UpdatePaymentMethodRouteDto } from './dto/update-payment-method-route.dto';
import { UpsertMerchantProviderRateDto } from './dto/upsert-merchant-provider-rate.dto';
import { PaymentConfigurationService } from './payment-configuration.service';

@ApiTags('payment-configuration')
@ApiSecurity('InternalSecret')
@UseGuards(InternalSecretGuard)
@Controller({ path: 'payments/ops/configuration', version: '2' })
export class PaymentConfigurationController {
  constructor(private readonly config: PaymentConfigurationService) {}

  @Get('providers')
  listProviders() {
    return this.config.listProviders();
  }

  @Post('providers')
  createProvider(@Body() body: CreatePaymentProviderDto) {
    return this.config.createProvider(body);
  }

  @Patch('providers/:providerId')
  updateProvider(@Param('providerId') providerId: string, @Body() body: UpdatePaymentProviderDto) {
    return this.config.updateProvider(providerId, body);
  }

  @Get('routes')
  listRoutes(@Query() query: { countryCode?: string; providerId?: string; channel?: string }) {
    return this.config.listRoutes(query);
  }

  @Post('routes')
  createRoute(@Body() body: CreatePaymentMethodRouteDto) {
    return this.config.createRoute(body);
  }

  @Patch('routes/:routeId')
  updateRoute(@Param('routeId') routeId: string, @Body() body: UpdatePaymentMethodRouteDto) {
    return this.config.updateRoute(routeId, body);
  }

  @Patch('routes/:routeId/weight')
  updateRouteWeight(@Param('routeId') routeId: string, @Body() body: { weight: number }) {
    return this.config.updateRouteWeight(routeId, body.weight);
  }

  @Get('merchants/:merchantId/provider-rates')
  listMerchantProviderRates(@Param('merchantId') merchantId: string) {
    return this.config.listMerchantProviderRates(merchantId);
  }

  @Post('merchants/:merchantId/provider-rates')
  upsertMerchantProviderRate(
    @Param('merchantId') merchantId: string,
    @Body() body: UpsertMerchantProviderRateDto,
  ) {
    return this.config.upsertMerchantProviderRate(merchantId, body);
  }
}
```

- [ ] **Step 5: Wire module**

Modify `apps/psp-api/src/payments-v2/payments-v2.module.ts`:

```ts
import { PaymentConfigurationController } from './payment-configuration.controller';
import { PaymentConfigurationService } from './payment-configuration.service';
```

Add controller and provider:

```ts
controllers: [PaymentsV2Controller, PaymentsV2InternalController, PaymentConfigurationController],
providers: [
  // existing providers
  PaymentConfigurationService,
]
```

- [ ] **Step 6: Run unit and integration tests**

Run:

```powershell
cd "C:\AA psp\apps\psp-api"
npm run test -- --runTestsByPath src/payments-v2/payment-configuration.service.spec.ts
npm run test:integration -- --runTestsByPath test/integration/dynamic-payment-configuration.integration.spec.ts
```

Expected: service spec passes. If the integration command cannot target a single file because of the current npm script, run:

```powershell
npx jest --config jest.integration.config.js --runInBand test/integration/dynamic-payment-configuration.integration.spec.ts
```

- [ ] **Step 7: Commit configuration API**

```powershell
git add "apps/psp-api/src/payments-v2" "apps/psp-api/test/integration/dynamic-payment-configuration.integration.spec.ts"
git commit -m "feat(api): add payment configuration endpoints"
```

---

## Task 4: Implement Routing Service And New Create Payment DTO

**Files:**
- Modify: `apps/psp-api/src/payments-v2/dto/create-payment-intent.dto.ts`
- Create: `apps/psp-api/src/payments-v2/domain/payment-routing.service.ts`
- Test: `apps/psp-api/src/payments-v2/domain/payment-routing.service.spec.ts`

- [ ] **Step 1: Replace create payment DTO tests in `payments-v2.service.spec.ts` setup**

Before modifying runtime code, add a dedicated routing spec that models the new create input. Use Prisma mock rows shaped like `PaymentMethodRoute` with provider and currencies.

Create `apps/psp-api/src/payments-v2/domain/payment-routing.service.spec.ts`:

```ts
import { PaymentRoutingService } from './payment-routing.service';

const prisma = {
  paymentMethodRoute: {
    findMany: jest.fn(),
  },
};

describe('PaymentRoutingService', () => {
  let service: PaymentRoutingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentRoutingService(prisma as never);
  });

  it('filters by merchant rate, country, channel, currency, amount, active provider and supported integration mode', async () => {
    prisma.paymentMethodRoute.findMany.mockResolvedValue([
      {
        id: 'route_1',
        providerId: 'prov_1',
        methodCode: '2000',
        methodName: 'Bank Transfer',
        countryCode: 'NG',
        channel: 'ONLINE',
        integrationMode: 'HOSTED_PAGE',
        requestTemplate: 'REDIRECT_SIMPLE',
        weight: 3,
        provider: { id: 'prov_1', name: 'KudiPay' },
        currencies: [{ currency: 'USD', minAmount: '1', maxAmount: '5000' }],
      },
    ]);

    const result = await service.selectRoute({
      merchantId: 'merchant_1',
      countryCode: 'NG',
      channel: 'ONLINE',
      currency: 'USD',
      amount: 63.09,
      seed: 'stable-seed',
    });

    expect(result.selected.id).toBe('route_1');
    expect(result.routingReasonCode).toBe('only_candidate');
  });

  it('uses deterministic weighted selection', async () => {
    prisma.paymentMethodRoute.findMany.mockResolvedValue([
      {
        id: 'route_a',
        providerId: 'prov_a',
        methodCode: '1012',
        methodName: 'Walmart',
        countryCode: 'MX',
        channel: 'CASH',
        integrationMode: 'HOSTED_PAGE',
        requestTemplate: 'REDIRECT_SIMPLE',
        weight: 1,
        provider: { id: 'prov_a', name: 'Club Pago' },
        currencies: [{ currency: 'USD', minAmount: '1', maxAmount: '10000' }],
      },
      {
        id: 'route_b',
        providerId: 'prov_b',
        methodCode: '1012',
        methodName: 'Walmart',
        countryCode: 'MX',
        channel: 'CASH',
        integrationMode: 'HOSTED_PAGE',
        requestTemplate: 'REDIRECT_SIMPLE',
        weight: 5,
        provider: { id: 'prov_b', name: 'PayCash' },
        currencies: [{ currency: 'USD', minAmount: '1', maxAmount: '10000' }],
      },
    ]);

    const first = await service.selectRoute({
      merchantId: 'merchant_1',
      countryCode: 'MX',
      channel: 'CASH',
      currency: 'USD',
      amount: 200,
      seed: 'same-payment',
    });
    const second = await service.selectRoute({
      merchantId: 'merchant_1',
      countryCode: 'MX',
      channel: 'CASH',
      currency: 'USD',
      amount: 200,
      seed: 'same-payment',
    });

    expect(second.selected.id).toBe(first.selected.id);
    expect(first.routingReasonCode).toBe('weighted_selection');
  });
});
```

- [ ] **Step 2: Replace `CreatePaymentIntentDto`**

Modify `apps/psp-api/src/payments-v2/dto/create-payment-intent.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PAYMENT_CHANNELS, PaymentChannel } from '../domain/dynamic-payment-types';

class CreatePaymentCustomerAddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  line1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  postcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  number?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  neighborhood?: string;
}

class CreatePaymentCustomerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  uid?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  personalId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  lastName!: string;

  @ApiProperty()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  phone?: string;

  @ApiProperty({ example: 'EC' })
  @IsString()
  @Length(2, 2)
  country!: string;

  @ApiPropertyOptional({ type: CreatePaymentCustomerAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePaymentCustomerAddressDto)
  address?: CreatePaymentCustomerAddressDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ip?: string;
}

export class CreatePaymentIntentDto {
  @ApiProperty({ example: 200.0 })
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  amount!: number;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @Length(3, 8)
  currency!: string;

  @ApiProperty({ enum: PAYMENT_CHANNELS })
  @IsIn(PAYMENT_CHANNELS)
  channel!: PaymentChannel;

  @ApiProperty({ example: 'ES' })
  @IsString()
  @Length(2, 8)
  language!: string;

  @ApiProperty({ example: 'merchant-order-123' })
  @IsString()
  @MaxLength(128)
  orderId!: string;

  @ApiProperty({ example: 'Invoice merchant-order-123' })
  @IsString()
  @MaxLength(512)
  description!: string;

  @ApiProperty()
  @IsUrl({ require_tld: false, protocols: ['https', 'http'] })
  @MaxLength(2048)
  notificationUrl!: string;

  @ApiProperty()
  @IsUrl({ require_tld: false, protocols: ['https', 'http'] })
  @MaxLength(2048)
  returnUrl!: string;

  @ApiProperty()
  @IsUrl({ require_tld: false, protocols: ['https', 'http'] })
  @MaxLength(2048)
  cancelUrl!: string;

  @ApiProperty({ type: CreatePaymentCustomerDto })
  @ValidateNested()
  @Type(() => CreatePaymentCustomerDto)
  @IsObject()
  customer!: CreatePaymentCustomerDto;
}
```

- [ ] **Step 3: Implement routing service**

Create `apps/psp-api/src/payments-v2/domain/payment-routing.service.ts` with `selectRoute()` that queries routes and returns `{ selected, candidates, routingReasonCode, seedHash }`. Use deterministic weighted selection:

```ts
import { Injectable, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentChannel } from './dynamic-payment-types';

type SelectRouteParams = {
  merchantId: string;
  countryCode: string;
  channel: PaymentChannel;
  currency: string;
  amount: number;
  seed: string;
};

@Injectable()
export class PaymentRoutingService {
  constructor(private readonly prisma: PrismaService) {}

  async selectRoute(params: SelectRouteParams) {
    const routes = await this.prisma.paymentMethodRoute.findMany({
      where: {
        countryCode: params.countryCode.toUpperCase(),
        channel: params.channel,
        isActive: true,
        isPublished: true,
        integrationMode: { in: ['REDIRECTION', 'HOSTED_PAGE'] },
        provider: {
          isActive: true,
          isConfigured: true,
          isPublished: true,
          merchantRates: {
            some: {
              merchantId: params.merchantId,
              countryCode: params.countryCode.toUpperCase(),
              isActive: true,
            },
          },
        },
        currencies: {
          some: {
            currency: params.currency.toUpperCase(),
            minAmount: { lte: params.amount },
            maxAmount: { gte: params.amount },
          },
        },
      },
      include: { provider: true, currencies: true },
      orderBy: [{ providerId: 'asc' }, { id: 'asc' }],
    });

    if (routes.length === 0) {
      throw new ConflictException({
        message: 'No payment method route is available for this payment',
        reasonCode: 'payment_method_unavailable',
      });
    }

    const positive = routes.filter((route) => route.weight > 0);
    const pool = positive.length > 0 ? positive : routes;
    const routingReasonCode =
      routes.length === 1 ? 'only_candidate' : positive.length > 0 ? 'weighted_selection' : 'zero_weight_fallback';

    const selected = positive.length > 0
      ? pool[this.weightedIndex(pool.map((route) => route.weight), params.seed)]
      : pool[0];

    return {
      selected,
      candidates: routes.map((route) => ({
        routeId: route.id,
        providerId: route.providerId,
        providerName: route.provider.name,
        methodCode: route.methodCode,
        methodName: route.methodName,
        weight: route.weight,
      })),
      routingReasonCode,
      seedHash: createHash('sha256').update(params.seed).digest('hex'),
    };
  }

  private weightedIndex(weights: number[], seed: string): number {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const hash = createHash('sha256').update(seed).digest();
    const value = hash.readUInt32BE(0) / 0xffffffff;
    let target = value * total;
    for (let i = 0; i < weights.length; i += 1) {
      target -= weights[i];
      if (target <= 0) return i;
    }
    return weights.length - 1;
  }
}
```

- [ ] **Step 4: Register routing service**

Add `PaymentRoutingService` to `PaymentsV2Module.providers`.

- [ ] **Step 5: Run tests**

```powershell
cd "C:\AA psp\apps\psp-api"
npm run test -- --runTestsByPath src/payments-v2/domain/payment-routing.service.spec.ts
npm run lint
```

- [ ] **Step 6: Commit routing and DTO**

```powershell
git add "apps/psp-api/src/payments-v2/dto/create-payment-intent.dto.ts" "apps/psp-api/src/payments-v2/domain/payment-routing.service.ts" "apps/psp-api/src/payments-v2/domain/payment-routing.service.spec.ts" "apps/psp-api/src/payments-v2/payments-v2.module.ts"
git commit -m "feat(api): add dynamic payment routing"
```

---

## Task 5: Implement Generic HTTP Provider Adapter And Provider Logs

**Files:**
- Create: `apps/psp-api/src/payments-v2/providers/generic-http-provider.adapter.ts`
- Test: `apps/psp-api/src/payments-v2/providers/generic-http-provider.adapter.spec.ts`
- Modify: `apps/psp-api/src/payments-v2/payments-v2.module.ts`

- [ ] **Step 1: Write adapter tests**

Create tests for redirect and SPEI request construction with a mocked `fetch`.

```ts
import { GenericHttpProviderAdapter } from './generic-http-provider.adapter';

describe('GenericHttpProviderAdapter', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates REDIRECT_SIMPLE provider calls and normalizes result.url', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ result: { url: 'https://kudipay.net/ngn-pay/?enc=abc' }, status: true }),
    });

    const adapter = new GenericHttpProviderAdapter(fetchMock as never);
    const result = await adapter.createPayment({
      provider: {
        integrationBaseUrl: 'https://secure.example.com',
        initPaymentResource: '/api/v1/transactions',
      },
      route: {
        id: 'route_1',
        requestTemplate: 'REDIRECT_SIMPLE',
        routeConfigJson: {},
      },
      payment: {
        uid: 'pm_123',
        amount: 63.09,
        currency: 'USD',
        notificationUrl: 'https://psp.example/provider-notifications/token',
        returnUrl: 'https://merchant.example/success',
        customer: { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' },
      },
    });

    expect(result.action).toEqual({ type: 'redirect', url: 'https://kudipay.net/ngn-pay/?enc=abc' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://secure.example.com/api/v1/transactions',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
```

- [ ] **Step 2: Implement adapter constructor**

Create `GenericHttpProviderAdapter` accepting an injected fetch-compatible function with a default:

```ts
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class GenericHttpProviderAdapter {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}
}
```

- [ ] **Step 3: Implement request builders**

Build `REDIRECT_SIMPLE` body:

```ts
{
  email: payment.customer.email,
  amount: payment.amount,
  order_id: payment.uid,
  last_name: payment.customer.lastName,
  first_name: payment.customer.firstName,
  redirect_url: payment.returnUrl,
  notification_url: payment.notificationUrl
}
```

Build `SPEI_BANK_TRANSFER` body using `route.routeConfigJson`:

```ts
{
  metadata: [{ name: 'orderId', show: true, value: payment.orderId }],
  target_flow: routeConfig.target_flow,
  order_amount: payment.amount,
  merchant_code: routeConfig.merchant_code,
  customer_email: payment.customer.email,
  merchant_order_id: payment.uid,
  external_interface: true,
  merchant_api_token: routeConfig.merchant_api_token,
  payment_webhook_url: payment.notificationUrl
}
```

- [ ] **Step 4: Implement response normalization**

Call `normalizeProviderCreateResponse(route.requestTemplate, json)` and return:

```ts
{
  httpStatus: response.status,
  rawResponse: json,
  action,
  providerTransactionId,
  providerStatus
}
```

- [ ] **Step 5: Run adapter tests**

```powershell
cd "C:\AA psp\apps\psp-api"
npm run test -- --runTestsByPath src/payments-v2/providers/generic-http-provider.adapter.spec.ts
```

- [ ] **Step 6: Commit adapter**

```powershell
git add "apps/psp-api/src/payments-v2/providers/generic-http-provider.adapter.ts" "apps/psp-api/src/payments-v2/providers/generic-http-provider.adapter.spec.ts"
git commit -m "feat(api): add generic HTTP provider adapter"
```

---

## Task 6: Cut Over `POST /api/v2/payments` Runtime

**Files:**
- Modify: `apps/psp-api/src/payments-v2/payments-v2.service.ts`
- Modify: `apps/psp-api/src/payments-v2/payments-v2.controller.ts`
- Modify: `apps/psp-api/src/payments-v2/payments-v2.service.spec.ts`
- Create: `apps/psp-api/test/integration/dynamic-payments-v2.integration.spec.ts`

- [ ] **Step 1: Write failing service test for dynamic create**

In `payments-v2.service.spec.ts`, add a new `describe('dynamic create payment')` and mock:

- `paymentRouting.selectRoute`
- `genericHttpProviderAdapter.createPayment`
- `prisma.payment.create`
- `prisma.providerLog.create`

Expected result:

```ts
expect(result).toEqual({
  uid: 'pm_test',
  status: 'PENDING',
  amount: 200,
  currency: 'USD',
  orderId: 'order-1',
  action: { type: 'redirect', url: 'https://provider.example/pay' },
});
```

- [ ] **Step 2: Add dependencies to service constructor**

Inject:

```ts
private readonly paymentRouting: PaymentRoutingService,
private readonly genericProvider: GenericHttpProviderAdapter,
```

Register both in `PaymentsV2Module`.

- [ ] **Step 3: Implement dynamic create path**

Replace the existing provider registry path in `createIntent()` with:

1. normalize `customer.country`, `currency`, `language`;
2. compute or reuse idempotency response;
3. create a `pm_` uid before routing;
4. call `paymentRouting.selectRoute()`;
5. build provider notification URL token;
6. call `genericProvider.createPayment()`;
7. create `Payment` with `dynamicStatus = PENDING`, method/fee/action/routing snapshots;
8. create `ProviderLog`;
9. return compact public response.

Use existing idempotency helper methods where possible. If old helpers are too coupled to `amountMinor`, split new helpers into small private methods in `PaymentsV2Service` instead of layering compatibility.

- [ ] **Step 4: Persist fee snapshot**

For the first runtime cut, calculate:

```ts
rateDiscount = roundMoney(amount * percentage / 100)
totalDiscount = roundMoney(fixed + Math.max(rateDiscount, minRateDiscount))
```

Persist:

```ts
{
  fixed,
  percentage,
  rateDiscount,
  minRateDiscount,
  totalDiscount,
  applyToCustomer,
}
```

Use `MerchantProviderRate` selected by route provider and `customer.country`.

- [ ] **Step 5: Write integration test**

Create `dynamic-payments-v2.integration.spec.ts` that:

1. creates merchant via internal API helper;
2. inserts provider, route, currency, merchant rate via Prisma;
3. mocks provider HTTP with a local test server or fetch mock injection;
4. calls `POST /api/v2/payments`;
5. asserts `status = PENDING`, `action.type = redirect`, and one `ProviderLog`.

- [ ] **Step 6: Run targeted tests**

```powershell
cd "C:\AA psp\apps\psp-api"
npm run test -- --runTestsByPath src/payments-v2/payments-v2.service.spec.ts
npx jest --config jest.integration.config.js --runInBand test/integration/dynamic-payments-v2.integration.spec.ts
```

- [ ] **Step 7: Commit runtime create**

```powershell
git add "apps/psp-api/src/payments-v2" "apps/psp-api/test/integration/dynamic-payments-v2.integration.spec.ts"
git commit -m "feat(api): route dynamic payment creation"
```

---

## Task 7: Add Provider Callbacks And Merchant Notification Deliveries

**Files:**
- Create: `apps/psp-api/src/payments-v2/provider-notifications.controller.ts`
- Create: `apps/psp-api/src/payments-v2/payment-notifications.service.ts`
- Create: `apps/psp-api/src/payments-v2/payment-notifications.service.spec.ts`
- Modify: `apps/psp-api/src/payments-v2/payments-v2.module.ts`
- Modify: `apps/psp-api/src/payments-v2/payments-v2-internal.controller.ts`
- Modify: `apps/psp-api/test/integration/dynamic-payments-v2.integration.spec.ts`

- [ ] **Step 1: Write notification service tests**

Test:

- `PENDING -> PAID` creates one `PaymentNotificationDelivery`.
- repeated `PAID` does not duplicate financial transition.
- resend uses existing `requestBodyCiphertext` content.

- [ ] **Step 2: Implement provider notification token validation**

Store token material in `Payment.actionSnapshot` during create:

```json
{
  "providerNotificationTokenHash": "sha256 hex",
  "action": { "type": "redirect", "url": "https://..." }
}
```

The public URL contains raw token. The handler hashes and finds the payment by JSON path is not portable in Prisma; instead add a `providerNotificationTokenHash` column to `Payment` if querying JSON becomes awkward. Prefer the column if implementation reaches for raw SQL.

- [ ] **Step 3: Implement `ProviderNotificationsController`**

Endpoint:

```ts
@Post('provider-notifications/:token')
handle(@Param('token') token: string, @Body() body: unknown) {
  return this.notifications.handleProviderNotification(token, body);
}
```

This controller is public and must not use `ApiKeyGuard`.

- [ ] **Step 4: Normalize provider callback statuses**

Implement a conservative status reader:

```ts
PROCESSING -> PENDING
PENDING -> PENDING
PAID -> PAID
SUCCESS -> PAID
FAILED -> FAILED
EXPIRED -> EXPIRED
```

Unknown status returns `202` with no payment status change and logs the masked callback payload.

- [ ] **Step 5: Build merchant notification payload**

Build the normalized JSON shape from the spec, using snapshots from `Payment`. The customer section should use masked snapshot for UI but the outbound merchant payload should use the configured snapshot policy from implementation. For this phase, send masked fields to match the examples and avoid leaking raw PII.

- [ ] **Step 6: Implement resend internal endpoint**

In `PaymentsV2InternalController` add:

```ts
@Post('ops/payments/:paymentId/notifications/:deliveryId/resend')
resendPaymentNotification(@Param('paymentId') paymentId: string, @Param('deliveryId') deliveryId: string) {
  return this.notifications.resendDelivery(paymentId, deliveryId);
}
```

- [ ] **Step 7: Run tests**

```powershell
cd "C:\AA psp\apps\psp-api"
npm run test -- --runTestsByPath src/payments-v2/payment-notifications.service.spec.ts
npx jest --config jest.integration.config.js --runInBand test/integration/dynamic-payments-v2.integration.spec.ts
```

- [ ] **Step 8: Commit callbacks and notifications**

```powershell
git add "apps/psp-api/src/payments-v2" "apps/psp-api/test/integration/dynamic-payments-v2.integration.spec.ts"
git commit -m "feat(api): process provider callbacks and merchant notifications"
```

---

## Task 8: Add Backoffice BFF Contracts And Routes

**Files:**
- Modify: `apps/psp-backoffice/src/lib/api/contracts.ts`
- Modify: `apps/psp-backoffice/src/lib/api/client.ts`
- Create internal route handlers listed in File Structure
- Modify: `apps/psp-backoffice/src/lib/server/backoffice-api.spec.ts`

- [ ] **Step 1: Add TypeScript contracts**

Add:

```ts
export type PaymentProviderConfigRow = {
  id: string;
  name: string;
  description: string | null;
  integrationBaseUrl: string;
  initPaymentResource: string;
  isConfigured: boolean;
  isActive: boolean;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PaymentMethodRouteRow = {
  id: string;
  providerId: string;
  methodCode: string;
  methodName: string;
  countryCode: string;
  channel: 'CASH' | 'ONLINE' | 'CREDIT_CARD' | 'CRYPTO';
  integrationMode: 'S2S' | 'REDIRECTION' | 'HOSTED_PAGE';
  requestTemplate: 'REDIRECT_SIMPLE' | 'SPEI_BANK_TRANSFER';
  weight: number;
  isActive: boolean;
  isPublished: boolean;
  provider?: PaymentProviderConfigRow;
  currencies: Array<{ currency: string; minAmount: string; maxAmount: string; isDefault: boolean }>;
};

export type MerchantProviderRateRow = {
  id: string;
  merchantId: string;
  providerId: string;
  countryCode: string;
  percentage: string;
  fixed: string;
  minRateDiscount: string;
  applyToCustomer: boolean;
  fxSpread: string;
  fxMarkup: string;
  isActive: boolean;
};
```

- [ ] **Step 2: Add client functions**

In `client.ts`, add functions:

```ts
fetchPaymentProviders()
createPaymentProvider(body)
patchPaymentProvider(providerId, body)
fetchPaymentMethodRoutes(filters)
createPaymentMethodRoute(body)
patchPaymentMethodRoute(routeId, body)
patchPaymentMethodRouteWeight(routeId, weight)
fetchMerchantProviderRates(merchantId)
upsertMerchantProviderRate(merchantId, body)
resendPaymentNotification(paymentId, deliveryId)
fetchPaymentAction(paymentId)
```

Use existing `internalBffFetch` and `parseResponse`.

- [ ] **Step 3: Add BFF route handlers**

Each route handler should:

1. call `enforceInternalRouteAuth`;
2. use `proxyInternalGet`, `proxyInternalPost`, or `proxyInternalPatch`;
3. map to `/api/v2/payments/ops/configuration/...` or `/api/v2/payments/ops/payments/...`;
4. keep mutation guard behavior aligned with existing routes.

- [ ] **Step 4: Add BFF tests**

In `backoffice-api.spec.ts`, assert configuration paths require admin role and forward `X-Backoffice-Role: admin`.

- [ ] **Step 5: Run backoffice tests**

```powershell
cd "C:\AA psp\apps\psp-backoffice"
npm run test -- src/lib/server/backoffice-api.spec.ts
npm run typecheck
```

- [ ] **Step 6: Commit BFF**

```powershell
git add "apps/psp-backoffice/src/lib/api" "apps/psp-backoffice/src/app/api/internal" "apps/psp-backoffice/src/lib/server/backoffice-api.spec.ts"
git commit -m "feat(backoffice): proxy dynamic payment configuration"
```

---

## Task 9: Build Backoffice Admin Configuration UI

**Files:**
- Create pages/components listed in File Structure
- Modify: `apps/psp-backoffice/src/components/app-shell.tsx`
- Modify: `apps/psp-backoffice/src/components/merchants/merchant-admin-panel.tsx`
- Test: Vitest component-adjacent server tests and Playwright smoke

- [ ] **Step 1: Add navigation links**

In `app-shell.tsx`, add admin-only links:

```ts
{ href: "/payment-providers", label: "Providers" }
{ href: "/payment-methods", label: "Payment Methods" }
```

Keep merchant portal navigation unchanged.

- [ ] **Step 2: Build `PaymentProvidersDashboard`**

Use TanStack Query:

```tsx
const providersQuery = useQuery({
  queryKey: ["payment-providers"],
  queryFn: fetchPaymentProviders,
});
```

Render table columns: name, base URL, init resource, configured, active, published.

- [ ] **Step 3: Build `PaymentMethodRoutesDashboard`**

Render filters for country, provider, channel, status. Render table columns from the spec: UID, checkout URL template, name, country, channel, provider, code, currencies, weight, status.

- [ ] **Step 4: Build route editor**

Create a form with sections:

- General Information
- Classification
- Provider Settings
- Capabilities
- Options
- Currencies

Submit via `createPaymentMethodRoute` or `patchPaymentMethodRoute`.

- [ ] **Step 5: Build `PaymentMethodWeightTab`**

For a selected route, show routes with same `methodCode + methodName + countryCode + channel` and editable weight inputs. Save each row via `patchPaymentMethodRouteWeight`.

- [ ] **Step 6: Add merchant provider rates panel**

In `merchant-admin-panel.tsx`, replace the current placeholder payment methods tab with `MerchantProviderRatesPanel`. It should include `Add Rates` modal with country, provider, percentage, fixed, min amounts, FX spread/markup, and disable industry validation.

- [ ] **Step 7: Run UI verification**

```powershell
cd "C:\AA psp\apps\psp-backoffice"
npm run typecheck
npm run test
npm run build
```

- [ ] **Step 8: Commit UI**

```powershell
git add "apps/psp-backoffice/src/app/payment-providers" "apps/psp-backoffice/src/app/payment-methods" "apps/psp-backoffice/src/components" "apps/psp-backoffice/src/components/app-shell.tsx"
git commit -m "feat(backoffice): add payment configuration UI"
```

---

## Task 10: Update Payment Detail UI For Details, Provider Logs, Notifications

**Files:**
- Modify: `apps/psp-api/src/payments-v2/payments-v2-internal.controller.ts`
- Modify: `apps/psp-api/src/payments-v2/payments-v2.service.ts`
- Modify: `apps/psp-backoffice/src/components/transactions/payment-detail-view.tsx`
- Modify: `apps/psp-backoffice/src/app/api/internal/payments/[paymentId]/route.ts`
- Create: `apps/psp-backoffice/src/app/api/internal/payments/[paymentId]/action/route.ts`
- Create: `apps/psp-backoffice/src/app/api/internal/payments/[paymentId]/notifications/[deliveryId]/resend/route.ts`

- [ ] **Step 1: Extend ops payment detail API**

Return:

```ts
{
  payment,
  providerLogs,
  notificationDeliveries,
  action
}
```

Do not include raw ciphertext fields in the BFF response. Include masked payloads only.

- [ ] **Step 2: Add retrieve action endpoint**

Add `GET /api/v2/payments/ops/payments/:paymentId/action` returning the persisted `actionSnapshot`. It must not call provider in phase 1.

- [ ] **Step 3: Add UI tabs**

In `payment-detail-view.tsx`, render:

- `Details`
- `Notifications`
- `Provider Logs`

Use the existing card/table components. JSON bodies should render in dark `pre` blocks with horizontal scroll.

- [ ] **Step 4: Wire resend button**

In Notifications tab, add a button that calls `resendPaymentNotification(paymentId, deliveryId)` and invalidates the payment detail query.

- [ ] **Step 5: Run tests**

```powershell
cd "C:\AA psp\apps\psp-api"
npm run test -- --runTestsByPath src/payments-v2/payments-v2.service.spec.ts

cd "C:\AA psp\apps\psp-backoffice"
npm run typecheck
npm run test
```

- [ ] **Step 6: Commit payment detail**

```powershell
git add "apps/psp-api/src/payments-v2" "apps/psp-backoffice/src"
git commit -m "feat(backoffice): show provider logs and notifications"
```

---

## Task 11: Replace Demo, Tests, And Documentation For The New V2 Contract

**Files:**
- Modify: `apps/psp-api/scripts/demo/create-backoffice-demo-payments.mjs`
- Modify: `apps/psp-api/test/smoke/backoffice-volume-demo.smoke.spec.ts`
- Modify: `apps/psp-api/test/smoke/sandbox.smoke.spec.ts`
- Modify: `PROJECT_CONTEXT.md`
- Modify: `apps/psp-api/README.md`
- Modify: `apps/psp-backoffice/BACKOFFICE_CONTEXT.md`
- Modify: `docs/testing-status.md`

- [ ] **Step 1: Update demo seed**

Demo script should create:

1. one provider config;
2. one `REDIRECT_SIMPLE` route;
3. one `SPEI_BANK_TRANSFER` route;
4. route currencies;
5. merchant provider rate;
6. payments using new request shape.

- [ ] **Step 2: Update smoke tests**

Replace old create request:

```json
{ "amountMinor": 1999, "currency": "EUR" }
```

with:

```json
{
  "amount": 19.99,
  "currency": "USD",
  "channel": "ONLINE",
  "language": "EN",
  "orderId": "smoke-order-1",
  "description": "Smoke payment",
  "notificationUrl": "https://example.com/webhook",
  "returnUrl": "https://example.com/success",
  "cancelUrl": "https://example.com/failure",
  "customer": {
    "firstName": "Smoke",
    "lastName": "Tester",
    "email": "smoke@example.com",
    "country": "NG"
  }
}
```

- [ ] **Step 3: Update docs**

Update:

- `PROJECT_CONTEXT.md`: dynamic provider routing, statuses, config models, backoffice UI.
- `apps/psp-api/README.md`: new create payment example and provider notification flow.
- `apps/psp-backoffice/BACKOFFICE_CONTEXT.md`: providers, payment methods, merchant rates, payment detail tabs.
- `docs/testing-status.md`: new unit/integration/smoke inventory and changed coverage.

- [ ] **Step 4: Run full verification**

API:

```powershell
cd "C:\AA psp\apps\psp-api"
npm run lint
npm run test
npm run test:integration
npm run build
```

Backoffice:

```powershell
cd "C:\AA psp\apps\psp-backoffice"
npm run lint
npm run typecheck
npm run test
npm run build
```

- [ ] **Step 5: Commit cleanup and docs**

```powershell
git add "apps/psp-api/scripts/demo/create-backoffice-demo-payments.mjs" "apps/psp-api/test" "PROJECT_CONTEXT.md" "apps/psp-api/README.md" "apps/psp-backoffice/BACKOFFICE_CONTEXT.md" "docs/testing-status.md"
git commit -m "docs: align dynamic payment routing rollout"
```

---

## Self-Review Notes

Spec coverage:

- Provider/method CRUD: Tasks 1, 3, 8, 9.
- Merchant rates: Tasks 1, 3, 8, 9.
- New create contract: Tasks 4 and 6.
- Weighted routing: Task 4.
- Generic adapter templates: Task 5.
- Provider callbacks: Task 7.
- Merchant notifications and resend: Task 7 and Task 10.
- Backoffice payment detail tabs: Task 10.
- Docs and testing status: Task 11.

Type consistency:

- Public channel values use `CASH | ONLINE | CREDIT_CARD | CRYPTO` throughout.
- Runtime status values use `PENDING | PAID | FAILED | EXPIRED` through `DynamicPaymentStatus`.
- Provider templates use `REDIRECT_SIMPLE | SPEI_BANK_TRANSFER`.
- The plan uses Prisma model names with `Config` suffix for provider config to avoid name collision with existing TypeScript `PaymentProvider` adapter interface.

Known implementation decision to resolve in Task 7:

- If querying provider notification token from JSON is awkward or inefficient, add a dedicated `providerNotificationTokenHash` column to `Payment` in the same task before implementing the callback endpoint.
