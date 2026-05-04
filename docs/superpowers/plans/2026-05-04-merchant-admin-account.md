# Merchant Admin Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la pantalla admin tabulada de merchant, respaldada por nuevos campos administrativos en `Merchant` y por un onboarding simplificado que alimenta esos campos.

**Architecture:** `Merchant` será la fuente de verdad para `Account`; onboarding conserva el expediente y los eventos para auditoría. La API Nest expone detalle y PATCH internos bajo `merchants/ops`, y el backoffice Next consume esos contratos vía BFF same-origin.

**Tech Stack:** NestJS 11, Prisma 7/PostgreSQL, Next.js 16 App Router, React 19, TanStack Query, Zod, Jest, Vitest y Playwright.

---

## Scope Check

Este plan implementa una sola fase cohesiva: cuenta admin de merchant + onboarding simplificado + UI tabulada. La tabla de `Payment Methods` se deja con estructura final usando datos actuales; país por método, límites por moneda y rates editables quedan fuera de esta fase y tendrán su propio plan.

No crear entidad `Shop`. No añadir reseller. No exponer credenciales API/webhook.

## File Structure

### API

- Modify: `apps/psp-api/prisma/schema.prisma`
  - Añade enums `MerchantRegistrationStatus` y `MerchantIndustry`.
  - Añade campos administrativos a `Merchant`.
- Create: `apps/psp-api/prisma/migrations/20260504143000_merchant_admin_account/migration.sql`
  - SQL revisable para enums, columnas, backfill de `mid` e índices.
- Modify: `apps/psp-api/src/merchants/merchants.service.ts`
  - Genera `mid`, selecciona campos extendidos, devuelve onboarding más reciente y aplica `PATCH account`.
- Modify: `apps/psp-api/src/merchants/merchants.controller.ts`
  - Añade `PATCH /ops/:id/account`.
- Create: `apps/psp-api/src/merchants/dto/patch-merchant-account.dto.ts`
  - Valida payload admin de `Account`.
- Modify: `apps/psp-api/src/merchant-onboarding/dto/submit-business-profile.dto.ts`
  - Sustituye razón social/país/tipo genérico por `companyName`, `industry`, `websiteUrl`.
- Modify: `apps/psp-api/src/merchant-onboarding/merchant-onboarding.service.ts`
  - Rechaza email ya usado.
  - Crea merchant con campos administrativos.
  - Actualiza merchant al enviar business profile.
- Modify: `apps/psp-api/src/merchant-onboarding/merchant-onboarding.service.spec.ts`
  - Actualiza expectativas del onboarding.
- Modify: `apps/psp-api/src/merchant-onboarding/merchant-onboarding.controller.spec.ts`
  - Actualiza delegación DTO del business profile.
- Modify: `apps/psp-api/test/integration/merchants.integration.spec.ts`
  - Añade cobertura HTTP interna de detalle/PATCH account si el setup actual ya cubre merchants.

### Backoffice

- Modify: `apps/psp-backoffice/src/lib/api/contracts.ts`
  - Añade enums/tipos de `MerchantAccount`.
  - Amplía `MerchantsOpsDetailResponse`.
- Modify: `apps/psp-backoffice/src/lib/api/client.ts`
  - Añade `patchMerchantOpsAccount`.
- Create: `apps/psp-backoffice/src/app/api/internal/merchants/ops/[merchantId]/account/route.ts`
  - BFF PATCH admin con Zod y `proxyInternalPatch`.
- Modify: `apps/psp-backoffice/src/app/api/internal/merchants/ops/[merchantId]/detail/route.ts`
  - Usa el contrato extendido.
- Modify: `apps/psp-backoffice/src/components/merchants/merchant-admin-panel.tsx`
  - Sustituye tarjetas actuales por pantalla tabulada.
- Modify: `apps/psp-backoffice/src/components/onboarding/merchant-onboarding-form.tsx`
  - Elimina razón social/país.
  - Añade industry enum.
- Modify: `apps/psp-backoffice/src/app/api/public/onboarding/[token]/business-profile/route.ts`
  - Valida nuevo payload público.
- Modify: `apps/psp-backoffice/src/app/api/public/onboarding/[token]/business-profile/route.spec.ts`
  - Actualiza tests de validación/proxy.
- Modify: `apps/psp-backoffice/e2e/auth-and-rbac.spec.ts`
  - Añade smoke admin de `/merchants` → `Admin` → tabs.

### Documentación

- Modify: `PROJECT_CONTEXT.md`
- Modify: `apps/psp-backoffice/BACKOFFICE_CONTEXT.md`
- Modify: `docs/testing-status.md`

## Implementation Tasks

### Task 1: Prisma schema and migration

**Files:**
- Modify: `apps/psp-api/prisma/schema.prisma`
- Create: `apps/psp-api/prisma/migrations/20260504143000_merchant_admin_account/migration.sql`

- [ ] **Step 1: Add Prisma enums and fields**

In `apps/psp-api/prisma/schema.prisma`, add these enums after `MerchantOnboardingActorType`:

```prisma
enum MerchantRegistrationStatus {
  LEAD
  IN_REVIEW
  APPROVED
  REJECTED
  ACTIVE
}

enum MerchantIndustry {
  CLOUD_COMPUTING
  CRYPTO
  FOREX
  GAMBLING
  PSP
  OTHER
}
```

Then update `model Merchant` to include the new fields:

```prisma
model Merchant {
  id                         String                     @id @default(cuid())
  name                       String
  email                      String?                    @unique @db.VarChar(320)
  contactName                String?                    @map("contact_name") @db.VarChar(160)
  contactPhone               String?                    @map("contact_phone") @db.VarChar(64)
  websiteUrl                 String?                    @map("website_url") @db.VarChar(2048)
  mid                        String                     @unique @db.VarChar(6)
  registrationNumber         String?                    @map("registration_number") @db.VarChar(64)
  registrationStatus         MerchantRegistrationStatus @default(LEAD) @map("registration_status")
  industry                   MerchantIndustry           @default(OTHER)
  apiKeyHash                 String                     @map("api_key_hash")
  apiKeyExpiresAt            DateTime?                  @map("api_key_expires_at")
  apiKeyRevokedAt            DateTime?                  @map("api_key_revoked_at")
  webhookUrl                 String?                    @map("webhook_url")
  webhookSecretCiphertext    String                     @map("webhook_secret_ciphertext")
  feeBps                     Int                        @default(290) @map("fee_bps")
  isActive                   Boolean                    @default(true) @map("is_active")
  deactivatedAt              DateTime?                  @map("deactivated_at")
  merchantPortalPasswordHash String?                    @map("merchant_portal_password_hash")
  createdAt                  DateTime                   @default(now()) @map("created_at")

  paymentLinks            PaymentLink[]
  payments                Payment[]
  ledgerLines             LedgerLine[]
  webhooks                WebhookDelivery[]
  rateTables              MerchantRateTable[]
  feeQuotes               PaymentFeeQuote[]
  settlements             PaymentSettlement[]
  payouts                 Payout[]
  merchantPaymentMethods  MerchantPaymentMethod[]
  settlementRequests      SettlementRequest[]
  onboardingApplications  MerchantOnboardingApplication[]
}
```

- [ ] **Step 2: Create migration SQL**

Create `apps/psp-api/prisma/migrations/20260504143000_merchant_admin_account/migration.sql` with:

```sql
CREATE TYPE "MerchantRegistrationStatus" AS ENUM (
  'LEAD',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'ACTIVE'
);

CREATE TYPE "MerchantIndustry" AS ENUM (
  'CLOUD_COMPUTING',
  'CRYPTO',
  'FOREX',
  'GAMBLING',
  'PSP',
  'OTHER'
);

ALTER TABLE "Merchant"
  ADD COLUMN "email" VARCHAR(320),
  ADD COLUMN "contact_name" VARCHAR(160),
  ADD COLUMN "contact_phone" VARCHAR(64),
  ADD COLUMN "website_url" VARCHAR(2048),
  ADD COLUMN "mid" VARCHAR(6),
  ADD COLUMN "registration_number" VARCHAR(64),
  ADD COLUMN "registration_status" "MerchantRegistrationStatus" NOT NULL DEFAULT 'LEAD',
  ADD COLUMN "industry" "MerchantIndustry" NOT NULL DEFAULT 'OTHER';

WITH numbered AS (
  SELECT
    "id",
    LPAD((100000 + ROW_NUMBER() OVER (ORDER BY "created_at", "id"))::text, 6, '0') AS generated_mid
  FROM "Merchant"
  WHERE "mid" IS NULL
)
UPDATE "Merchant" AS m
SET "mid" = numbered.generated_mid
FROM numbered
WHERE m."id" = numbered."id";

ALTER TABLE "Merchant"
  ALTER COLUMN "mid" SET NOT NULL;

CREATE UNIQUE INDEX "Merchant_email_key" ON "Merchant"("email");
CREATE UNIQUE INDEX "Merchant_mid_key" ON "Merchant"("mid");
```

- [ ] **Step 3: Review migration shape**

Run from `apps/psp-api`:

```bash
npm run prisma:generate
```

Expected: Prisma client generation succeeds and generated enums are available from `src/generated/prisma/enums`.

- [ ] **Step 4: Run API typecheck**

Run from `apps/psp-api`:

```bash
npm run lint
```

Expected: this can fail before service/controller code is updated because generated fields are not used yet; record the first error if it fails. Do not change unrelated files.

### Task 2: Merchant account DTO and service contract

**Files:**
- Create: `apps/psp-api/src/merchants/dto/patch-merchant-account.dto.ts`
- Modify: `apps/psp-api/src/merchants/merchants.service.ts`
- Modify: `apps/psp-api/src/merchants/merchants.controller.ts`

- [ ] **Step 1: Create DTO**

Create `apps/psp-api/src/merchants/dto/patch-merchant-account.dto.ts`:

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { MerchantIndustry, MerchantRegistrationStatus } from '../../generated/prisma/enums';

export class PatchMerchantAccountDto {
  @ApiPropertyOptional({ example: 'Levels Ltd' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ example: 'support@levelssocials.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ example: 'Jean Pierre Zannotti' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  contactName?: string;

  @ApiPropertyOptional({ example: '+34600000000' })
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'https://levels.example' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  websiteUrl?: string | null;

  @ApiPropertyOptional({ enum: MerchantRegistrationStatus })
  @IsOptional()
  @IsEnum(MerchantRegistrationStatus)
  registrationStatus?: MerchantRegistrationStatus;

  @ApiPropertyOptional({ example: '2024-00069' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  registrationNumber?: string | null;

  @ApiPropertyOptional({ enum: MerchantIndustry })
  @IsOptional()
  @IsEnum(MerchantIndustry)
  industry?: MerchantIndustry;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
```

- [ ] **Step 2: Add imports and helper types in service**

At the top of `apps/psp-api/src/merchants/merchants.service.ts`, update imports:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { encryptUtf8 } from '../crypto/secret-box';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentProviderName } from '../payments-v2/domain/payment-provider-names';
import { PAYMENT_PROVIDER_NAMES } from '../payments-v2/domain/payment-provider-names';
import { MerchantIndustry, MerchantRegistrationStatus, PayoutScheduleType, SettlementMode } from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
```

Add this type near `CreateRateTableInput`:

```ts
type PatchMerchantAccountInput = {
  name?: string;
  email?: string;
  contactName?: string;
  contactPhone?: string;
  websiteUrl?: string | null;
  registrationStatus?: MerchantRegistrationStatus;
  registrationNumber?: string | null;
  industry?: MerchantIndustry;
  isActive?: boolean;
};
```

- [ ] **Step 3: Add email and MID helpers**

Add these private helpers inside `MerchantsService`:

```ts
  private normalizeMerchantEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private generateMidCandidate(): string {
    return String(randomInt(100000, 1000000));
  }

  private async generateUniqueMid(tx: Prisma.TransactionClient): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const mid = this.generateMidCandidate();
      const existing = await tx.merchant.findUnique({
        where: { mid },
        select: { id: true },
      });
      if (!existing) {
        return mid;
      }
    }
    throw new ConflictException('Could not allocate merchant MID');
  }
```

- [ ] **Step 4: Update direct merchant creation**

In `create`, before `tx.merchant.create`, generate `mid`:

```ts
      const mid = await this.generateUniqueMid(tx);
      const merchant = await tx.merchant.create({
        data: {
          name: dto.name,
          mid,
          apiKeyHash: placeholderHash,
          webhookUrl: dto.webhookUrl ?? null,
          webhookSecretCiphertext,
        },
      });
```

Update the returned payload:

```ts
    return {
      id: merchant.id,
      mid: merchant.mid,
      name: merchant.name,
      apiKey: apiKeyPlain,
      apiKeyExpiresAt,
      webhookSecret: webhookSecretPlain,
      message: 'Guarda apiKey y webhookSecret de forma segura; no se volverán a mostrar.',
    };
```

- [ ] **Step 5: Update onboarding shell creation signature**

Change `createInactiveShellForOnboarding` signature:

```ts
  async createInactiveShellForOnboarding(
    tx: Prisma.TransactionClient,
    input: {
      companyName: string;
      email: string;
      contactName: string;
      contactPhone: string;
      websiteUrl?: string | null;
      industry?: MerchantIndustry;
    },
  ): Promise<{ id: string }> {
```

Update the create data:

```ts
    const mid = await this.generateUniqueMid(tx);
    const merchant = await tx.merchant.create({
      data: {
        name: input.companyName,
        email: this.normalizeMerchantEmail(input.email),
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        websiteUrl: input.websiteUrl ?? null,
        industry: input.industry ?? MerchantIndustry.OTHER,
        mid,
        apiKeyHash: placeholderHash,
        webhookUrl: null,
        webhookSecretCiphertext,
        isActive: false,
        deactivatedAt: now,
      },
    });
```

- [ ] **Step 6: Extend `listOpsDirectory` selection**

Update `listOpsDirectory` select:

```ts
      select: {
        id: true,
        mid: true,
        name: true,
        email: true,
        isActive: true,
        deactivatedAt: true,
        registrationStatus: true,
        industry: true,
        apiKeyExpiresAt: true,
        apiKeyRevokedAt: true,
        createdAt: true,
      },
```

- [ ] **Step 7: Extend `getOpsDetail`**

Replace the `merchant` select in `getOpsDetail` with:

```ts
      select: {
        id: true,
        mid: true,
        name: true,
        email: true,
        contactName: true,
        contactPhone: true,
        websiteUrl: true,
        isActive: true,
        deactivatedAt: true,
        registrationNumber: true,
        registrationStatus: true,
        industry: true,
        apiKeyExpiresAt: true,
        apiKeyRevokedAt: true,
        createdAt: true,
      },
```

Replace the `Promise.all` block with:

```ts
    const [recentPayments, settlementRequests, paymentMethods, latestOnboardingApplication] = await Promise.all([
      this.prisma.payment.findMany({
        where: { merchantId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          amountMinor: true,
          currency: true,
          createdAt: true,
        },
      }),
      this.prisma.settlementRequest.findMany({
        where: { merchantId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.merchantPaymentMethod.findMany({
        where: { merchantId },
        include: { definition: true },
      }),
      this.prisma.merchantOnboardingApplication.findFirst({
        where: { merchantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          events: { orderBy: { createdAt: 'asc' } },
        },
      }),
    ]);

    return {
      merchant,
      recentPayments,
      settlementRequests,
      paymentMethods,
      latestOnboardingApplication,
      onboardingEvents: latestOnboardingApplication?.events ?? [],
    };
```

- [ ] **Step 8: Add `patchMerchantAccount`**

Add this method to `MerchantsService`:

```ts
  async patchMerchantAccount(merchantId: string, patch: PatchMerchantAccountInput) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    const normalizedEmail = patch.email !== undefined ? this.normalizeMerchantEmail(patch.email) : undefined;
    if (normalizedEmail !== undefined) {
      const existing = await this.prisma.merchant.findFirst({
        where: { email: normalizedEmail, NOT: { id: merchantId } },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException('Merchant email already exists');
      }
    }

    return this.prisma.merchant.update({
      where: { id: merchantId },
      data: {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
        ...(patch.contactName !== undefined ? { contactName: patch.contactName.trim() } : {}),
        ...(patch.contactPhone !== undefined ? { contactPhone: patch.contactPhone.trim() } : {}),
        ...(patch.websiteUrl !== undefined ? { websiteUrl: patch.websiteUrl } : {}),
        ...(patch.registrationStatus !== undefined ? { registrationStatus: patch.registrationStatus } : {}),
        ...(patch.registrationNumber !== undefined ? { registrationNumber: patch.registrationNumber } : {}),
        ...(patch.industry !== undefined ? { industry: patch.industry } : {}),
        ...(patch.isActive !== undefined
          ? {
              isActive: patch.isActive,
              deactivatedAt: patch.isActive ? null : new Date(),
            }
          : {}),
      },
      select: {
        id: true,
        mid: true,
        name: true,
        email: true,
        contactName: true,
        contactPhone: true,
        websiteUrl: true,
        isActive: true,
        deactivatedAt: true,
        registrationNumber: true,
        registrationStatus: true,
        industry: true,
        createdAt: true,
      },
    });
  }
```

- [ ] **Step 9: Add controller route**

In `apps/psp-api/src/merchants/merchants.controller.ts`, add import:

```ts
import { PatchMerchantAccountDto } from './dto/patch-merchant-account.dto';
```

Add route after `opsSetActive`:

```ts
  @Patch('ops/:id/account')
  @ApiOperation({ summary: 'Actualizar cuenta administrativa del merchant (interno admin)' })
  @ApiParam({ name: 'id', description: 'ID del merchant' })
  @ApiBody({ type: PatchMerchantAccountDto })
  @ApiSecurity('InternalSecret')
  @UseGuards(InternalSecretGuard)
  opsPatchAccount(@Param('id') id: string, @Body() body: PatchMerchantAccountDto) {
    return this.merchants.patchMerchantAccount(id, body);
  }
```

- [ ] **Step 10: Run focused API typecheck**

Run from `apps/psp-api`:

```bash
npm run lint
```

Expected: TypeScript passes for API files touched in this task. If generated Prisma types are stale, run `npm run prisma:generate` once and rerun.

### Task 3: Onboarding API simplification

**Files:**
- Modify: `apps/psp-api/src/merchant-onboarding/dto/submit-business-profile.dto.ts`
- Modify: `apps/psp-api/src/merchant-onboarding/merchant-onboarding.service.ts`
- Modify: `apps/psp-api/src/merchant-onboarding/merchant-onboarding.service.spec.ts`
- Modify: `apps/psp-api/src/merchant-onboarding/merchant-onboarding.controller.spec.ts`

- [ ] **Step 1: Replace business profile DTO**

Replace `SubmitBusinessProfileDto` with:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { MerchantIndustry } from '../../generated/prisma/enums';

export class SubmitBusinessProfileDto {
  @ApiProperty({ example: 'Levels Ltd' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  companyName!: string;

  @ApiProperty({ enum: MerchantIndustry, example: MerchantIndustry.FOREX })
  @IsEnum(MerchantIndustry)
  industry!: MerchantIndustry;

  @ApiPropertyOptional({ example: 'https://levels.example' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  websiteUrl?: string;
}
```

- [ ] **Step 2: Update createApplication duplicate behavior**

In `createApplication`, replace the existing duplicate branch:

```ts
    if (existing) {
      return this.publicCreateResponse();
    }
```

with:

```ts
    if (existing) {
      throw new ConflictException('Merchant email already exists');
    }
```

Inside the transaction, replace duplicate-after-lock:

```ts
        if (existingAfterLock) {
          return { kind: 'duplicate' };
        }
```

with:

```ts
        if (existingAfterLock) {
          throw new ConflictException('Merchant email already exists');
        }
```

Replace the `catch` branch for `isContactEmailUniqueViolation` with:

```ts
      if (isContactEmailUniqueViolation(error)) {
        throw new ConflictException('Merchant email already exists');
      }
```

Replace the `CreateApplicationTxResult` type near the top of the service with:

```ts
type CreateApplicationTxResult = { kind: 'created'; applicationId: string };
```

Delete this branch after the transaction because duplicates now throw `ConflictException`:

```ts
    if (txResult.kind === 'duplicate') {
      this.logger.debug('merchant_onboarding.create_application.duplicate_after_contact_email_lock');
      return this.publicCreateResponse();
    }
```

- [ ] **Step 3: Add onboarding-local MID helpers**

In `apps/psp-api/src/merchant-onboarding/merchant-onboarding.service.ts`, update the crypto import:

```ts
import { createHash, randomBytes, randomInt } from 'crypto';
```

Add these helpers near `contactEmailOnboardingAdvisoryKeys`:

```ts
function generateMidCandidate(): string {
  return String(randomInt(100000, 1000000));
}

async function generateUniqueMerchantMid(tx: OnboardingTransaction): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const mid = generateMidCandidate();
    const existing = await tx.merchant.findUnique({
      where: { mid },
      select: { id: true },
    });
    if (!existing) {
      return mid;
    }
  }
  throw new ConflictException('Could not allocate merchant MID');
}
```

- [ ] **Step 4: Populate merchant shell with contact fields**

In the transaction where `tx.merchant.create` currently creates a shell, generate `mid` before the create:

```ts
        const mid = await generateUniqueMerchantMid(tx);
```

Use this merchant create data:

```ts
        const merchant = await tx.merchant.create({
          data: {
            name: dto.name,
            email: contactEmail,
            contactName: dto.name,
            contactPhone: dto.phone,
            mid,
            apiKeyHash: placeholderHash,
            webhookSecretCiphertext,
            isActive: false,
            deactivatedAt: now,
          },
        });
```

- [ ] **Step 5: Update submitBusinessProfile**

In `submitBusinessProfile`, replace application update data:

```ts
          status: MerchantOnboardingStatus.IN_REVIEW,
          tradeName: dto.companyName,
          legalName: null,
          country: null,
          website: dto.websiteUrl ?? null,
          businessType: dto.industry,
          submittedAt: now,
```

After updating the application and before checklist update, update the merchant:

```ts
      await tx.merchant.update({
        where: { id: application.merchantId },
        data: {
          name: dto.companyName,
          industry: dto.industry,
          websiteUrl: dto.websiteUrl ?? null,
        },
      });
```

- [ ] **Step 6: Preserve merchant email on approval**

In `approveApplication`, keep `merchantPortalPasswordHash` update and do not overwrite `email`. The login email stays `updated.contactEmail`, and the merchant row already has the same normalized email from creation.

- [ ] **Step 7: Update unit tests**

In `apps/psp-api/src/merchant-onboarding/merchant-onboarding.service.spec.ts`, update test data for business profile calls to:

```ts
const businessProfileDto = {
  companyName: 'Levels Ltd',
  industry: 'FOREX',
  websiteUrl: 'https://levels.example',
} as const;
```

Update assertions that previously checked `tradeName/legalName/country/businessType` to:

```ts
expect(tx.merchantOnboardingApplication.update).toHaveBeenCalledWith(
  expect.objectContaining({
    data: expect.objectContaining({
      tradeName: 'Levels Ltd',
      legalName: null,
      country: null,
      website: 'https://levels.example',
      businessType: 'FOREX',
    }),
  }),
);
expect(tx.merchant.update).toHaveBeenCalledWith(
  expect.objectContaining({
    data: expect.objectContaining({
      name: 'Levels Ltd',
      industry: 'FOREX',
      websiteUrl: 'https://levels.example',
    }),
  }),
);
```

Add a duplicate email test:

```ts
it('rejects createApplication when contact email is already in use', async () => {
  prisma.merchantOnboardingApplication.findFirst.mockResolvedValue({ id: 'app_existing' });

  await expect(
    service.createApplication({ name: 'Ada', email: 'ADA@EXAMPLE.COM', phone: '+34600000000' }),
  ).rejects.toThrow(ConflictException);
});
```

- [ ] **Step 8: Run onboarding unit tests**

Run from `apps/psp-api`:

```bash
npm run test -- src/merchant-onboarding/merchant-onboarding.service.spec.ts src/merchant-onboarding/merchant-onboarding.controller.spec.ts
```

Expected: both specs pass.

### Task 4: API integration tests for merchant account

**Files:**
- Modify: `apps/psp-api/test/integration/merchants.integration.spec.ts`

- [ ] **Step 1: Add test for detail shape**

Add a test that creates a merchant through the existing helper/API, calls `GET /api/v1/merchants/ops/:id/detail` with internal secret + admin role, and expects:

```ts
expect(res.body.merchant).toEqual(
  expect.objectContaining({
    id: merchantId,
    mid: expect.stringMatching(/^\d{6}$/),
    name: expect.any(String),
    registrationStatus: 'LEAD',
    industry: 'OTHER',
  }),
);
expect(res.body).toEqual(
  expect.objectContaining({
    latestOnboardingApplication: null,
    onboardingEvents: [],
    paymentMethods: expect.any(Array),
  }),
);
```

Use a merchant created without onboarding in this test, so `latestOnboardingApplication` is `null` and `onboardingEvents` is `[]`.

- [ ] **Step 2: Add test for PATCH account success**

Add a test that sends:

```ts
const patch = {
  name: 'Levels Ltd',
  email: 'Support@LevelsSocials.com',
  contactName: 'Support Team',
  contactPhone: '+34600000000',
  websiteUrl: 'https://levelssocials.com',
  isActive: true,
  registrationStatus: 'LEAD',
  registrationNumber: '2024-00069',
  industry: 'FOREX',
};
```

Assert:

```ts
expect(res.status).toBe(200);
expect(res.body).toEqual(
  expect.objectContaining({
    name: 'Levels Ltd',
    email: 'support@levelssocials.com',
    contactName: 'Support Team',
    contactPhone: '+34600000000',
    websiteUrl: 'https://levelssocials.com',
    isActive: true,
    registrationStatus: 'LEAD',
    registrationNumber: '2024-00069',
    industry: 'FOREX',
  }),
);
expect(res.body.mid).toMatch(/^\d{6}$/);
```

- [ ] **Step 3: Add test for duplicate email conflict**

Create two merchants. Patch merchant A with `email: 'dupe@example.com'`, then patch merchant B with the same email. Assert:

```ts
expect(res.status).toBe(409);
expect(res.body.message).toBeDefined();
```

- [ ] **Step 4: Run merchants integration test**

Run from `apps/psp-api`:

```bash
npm run test:integration -- test/integration/merchants.integration.spec.ts
```

Expected: merchants integration passes.

### Task 5: Backoffice contracts, client and BFF route

**Files:**
- Modify: `apps/psp-backoffice/src/lib/api/contracts.ts`
- Modify: `apps/psp-backoffice/src/lib/api/client.ts`
- Create: `apps/psp-backoffice/src/app/api/internal/merchants/ops/[merchantId]/account/route.ts`
- Modify: `apps/psp-backoffice/src/app/api/public/onboarding/[token]/business-profile/route.ts`
- Modify: `apps/psp-backoffice/src/app/api/public/onboarding/[token]/business-profile/route.spec.ts`

- [ ] **Step 1: Update contracts**

In `contracts.ts`, add:

```ts
export type MerchantRegistrationStatus = "LEAD" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "ACTIVE";

export type MerchantIndustry =
  | "CLOUD_COMPUTING"
  | "CRYPTO"
  | "FOREX"
  | "GAMBLING"
  | "PSP"
  | "OTHER";

export type MerchantAccountStatus = "ENABLED" | "DISABLED";
```

Extend `MerchantsOpsDirectoryRow`:

```ts
export type MerchantsOpsDirectoryRow = {
  id: string;
  mid: string;
  name: string;
  email: string | null;
  isActive: boolean;
  deactivatedAt: string | null;
  registrationStatus: MerchantRegistrationStatus;
  industry: MerchantIndustry;
  apiKeyExpiresAt: string | null;
  apiKeyRevokedAt: string | null;
  createdAt: string;
};
```

Extend `MerchantsOpsMerchantSummary`:

```ts
export type MerchantsOpsMerchantSummary = {
  id: string;
  mid: string;
  name: string;
  email: string | null;
  contactName: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  isActive: boolean;
  deactivatedAt: string | null;
  registrationNumber: string | null;
  registrationStatus: MerchantRegistrationStatus;
  industry: MerchantIndustry;
  createdAt?: string;
};
```

Extend `MerchantsOpsDetailResponse`:

```ts
export type MerchantsOpsDetailResponse = {
  merchant: MerchantsOpsMerchantSummary & {
    apiKeyExpiresAt: string | null;
    apiKeyRevokedAt: string | null;
    createdAt: string;
  };
  recentPayments: MerchantsOpsRecentPayment[];
  settlementRequests: SettlementRequestRow[];
  paymentMethods: MerchantPaymentMethodRow[];
  latestOnboardingApplication: MerchantOnboardingApplicationDetail | null;
  onboardingEvents: MerchantOnboardingEvent[];
};
```

- [ ] **Step 2: Add client patch body and function**

In `client.ts`, include `MerchantIndustry` and `MerchantRegistrationStatus` in the existing type import from `@/lib/api/contracts`, then add:

```ts
export type PatchMerchantAccountBody = {
  name?: string;
  email?: string;
  contactName?: string;
  contactPhone?: string;
  websiteUrl?: string | null;
  isActive?: boolean;
  registrationStatus?: MerchantRegistrationStatus;
  registrationNumber?: string | null;
  industry?: MerchantIndustry;
};

export async function patchMerchantOpsAccount(
  merchantId: string,
  body: PatchMerchantAccountBody,
): Promise<MerchantsOpsMerchantSummary> {
  const encoded = encodeURIComponent(merchantId);
  const response = await internalBffFetch(`/api/internal/merchants/ops/${encoded}/account`, {
    ...internalBffInit,
    method: "PATCH",
    headers: backofficeMutationHeaders,
    body: JSON.stringify(body),
  });
  return parseResponse<MerchantsOpsMerchantSummary>(response);
}
```

- [ ] **Step 3: Create BFF account route**

Create `apps/psp-backoffice/src/app/api/internal/merchants/ops/[merchantId]/account/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { MerchantsOpsMerchantSummary } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalPatch } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { enforceInternalMutationRequest } from "@/lib/server/internal-mutation-guard";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

type RouteContext = { params: Promise<{ merchantId: string }> };

const registrationStatusSchema = z.enum(["LEAD", "IN_REVIEW", "APPROVED", "REJECTED", "ACTIVE"]);
const industrySchema = z.enum(["CLOUD_COMPUTING", "CRYPTO", "FOREX", "GAMBLING", "PSP", "OTHER"]);

const bodySchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  email: z.string().trim().email().max(320).optional(),
  contactName: z.string().trim().min(2).max(160).optional(),
  contactPhone: z.string().trim().min(6).max(64).optional(),
  websiteUrl: z.string().trim().url().max(2048).nullable().optional().or(z.literal("").transform(() => null)),
  isActive: z.boolean().optional(),
  registrationStatus: registrationStatusSchema.optional(),
  registrationNumber: z.string().trim().max(64).nullable().optional().or(z.literal("").transform(() => null)),
  industry: industrySchema.optional(),
});

export async function PATCH(request: NextRequest, context: RouteContext) {
  const mutation = enforceInternalMutationRequest(request);
  if (!mutation.ok) {
    return mutation.response;
  }

  const auth = await enforceInternalRouteAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const adminBlock = requireAdminClaims(auth.claims);
  if (adminBlock) {
    return adminBlock;
  }

  const { merchantId: rawMerchantId } = await context.params;
  const merchantId = decodeURIComponent(rawMerchantId);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ message: "Expected JSON body" }, { status: 400 });
  }

  const bodyParse = bodySchema.safeParse(json);
  if (!bodyParse.success) {
    return NextResponse.json({ message: "Invalid body", issues: bodyParse.error.issues }, { status: 400 });
  }

  try {
    const encoded = encodeURIComponent(merchantId);
    const data = await proxyInternalPatch<MerchantsOpsMerchantSummary>({
      path: `/api/v1/merchants/ops/${encoded}/account`,
      body: bodyParse.data,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
```

- [ ] **Step 4: Update public onboarding BFF route**

In `apps/psp-backoffice/src/app/api/public/onboarding/[token]/business-profile/route.ts`, replace schema:

```ts
const industrySchema = z.enum(["CLOUD_COMPUTING", "CRYPTO", "FOREX", "GAMBLING", "PSP", "OTHER"]);

const businessProfileSchema = z.object({
  companyName: z.string().trim().min(2).max(160),
  industry: industrySchema,
  websiteUrl: z.string().trim().url().max(2048).optional().or(z.literal("").transform(() => undefined)),
});
```

- [ ] **Step 5: Update public onboarding route spec**

Update valid body test payload:

```ts
body: JSON.stringify({
  companyName: "Ada Shop",
  industry: "FOREX",
  websiteUrl: "",
}),
```

Update expected proxy body:

```ts
body: {
  companyName: "Ada Shop",
  industry: "FOREX",
  websiteUrl: undefined,
},
```

Update invalid body test so omitted `industry` fails:

```ts
body: JSON.stringify({ companyName: "A" }),
```

- [ ] **Step 6: Run backoffice unit tests for routes**

Run from `apps/psp-backoffice`:

```bash
npm run test -- src/app/api/public/onboarding/[token]/business-profile/route.spec.ts
```

Expected: route spec passes.

### Task 6: Backoffice onboarding form

**Files:**
- Modify: `apps/psp-backoffice/src/components/onboarding/merchant-onboarding-form.tsx`

- [ ] **Step 1: Replace submit payload**

In `handleSubmit`, replace form data body with:

```ts
    const body = {
      companyName: String(formData.get("companyName") ?? "").trim(),
      industry: String(formData.get("industry") ?? "").trim(),
      websiteUrl: String(formData.get("websiteUrl") ?? "").trim(),
    };
```

- [ ] **Step 2: Replace form fields**

Replace the current `tradeName`, `legalName`, `country`, `businessType`, `website` form fields with:

```tsx
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className={labelClass} htmlFor="companyName">
                    Company name
                  </label>
                  <Input
                    id="companyName"
                    name="companyName"
                    minLength={2}
                    maxLength={160}
                    required
                    autoComplete="organization"
                    className={fieldClass}
                  />
                </div>
                <div className="space-y-2">
                  <label className={labelClass} htmlFor="industry">
                    Industry type
                  </label>
                  <Select
                    id="industry"
                    name="industry"
                    required
                    defaultValue=""
                    className={cn(fieldClass, "py-0")}
                  >
                    <option value="" disabled className="bg-[#111118] text-slate-200">
                      Selecciona una opción
                    </option>
                    <option value="CLOUD_COMPUTING" className="bg-[#111118]">
                      Cloud computing
                    </option>
                    <option value="CRYPTO" className="bg-[#111118]">
                      Crypto
                    </option>
                    <option value="FOREX" className="bg-[#111118]">
                      Forex
                    </option>
                    <option value="GAMBLING" className="bg-[#111118]">
                      Gambling
                    </option>
                    <option value="PSP" className="bg-[#111118]">
                      PSP
                    </option>
                    <option value="OTHER" className="bg-[#111118]">
                      Other
                    </option>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <label className={labelClass} htmlFor="websiteUrl">
                  Website URL <span className="font-normal text-[#8b8baa]">(opcional)</span>
                </label>
                <Input
                  id="websiteUrl"
                  name="websiteUrl"
                  type="url"
                  maxLength={2048}
                  placeholder="https://example.com"
                  autoComplete="url"
                  className={fieldClass}
                />
              </div>
```

- [ ] **Step 3: Run backoffice typecheck**

Run from `apps/psp-backoffice`:

```bash
npm run typecheck
```

Expected: typecheck passes for onboarding form and route contracts.

### Task 7: Merchant admin tabbed UI

**Files:**
- Modify: `apps/psp-backoffice/src/components/merchants/merchant-admin-panel.tsx`

- [ ] **Step 1: Replace imports**

Use these imports:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchMerchantsOpsDetail,
  patchMerchantOpsAccount,
} from "@/lib/api/client";
import type {
  MerchantIndustry,
  MerchantRegistrationStatus,
  MerchantsOpsDetailResponse,
} from "@/lib/api/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
} from "@/components/ui/table";
```

- [ ] **Step 2: Add constants and form type**

Add:

```tsx
type MerchantAdminTab = "account" | "application-form" | "payment-methods";

type AccountFormState = {
  name: string;
  email: string;
  contactName: string;
  contactPhone: string;
  websiteUrl: string;
  isActive: boolean;
  registrationStatus: MerchantRegistrationStatus;
  registrationNumber: string;
  industry: MerchantIndustry;
};

const registrationStatusOptions: Array<{ value: MerchantRegistrationStatus; label: string }> = [
  { value: "LEAD", label: "Lead" },
  { value: "IN_REVIEW", label: "In review" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "ACTIVE", label: "Active" },
];

const industryOptions: Array<{ value: MerchantIndustry; label: string }> = [
  { value: "CLOUD_COMPUTING", label: "Cloud computing" },
  { value: "CRYPTO", label: "Crypto" },
  { value: "FOREX", label: "Forex" },
  { value: "GAMBLING", label: "Gambling" },
  { value: "PSP", label: "PSP" },
  { value: "OTHER", label: "Other" },
];

function accountFormFromDetail(data: MerchantsOpsDetailResponse): AccountFormState {
  return {
    name: data.merchant.name,
    email: data.merchant.email ?? "",
    contactName: data.merchant.contactName ?? "",
    contactPhone: data.merchant.contactPhone ?? "",
    websiteUrl: data.merchant.websiteUrl ?? "",
    isActive: data.merchant.isActive,
    registrationStatus: data.merchant.registrationStatus,
    registrationNumber: data.merchant.registrationNumber ?? "",
    industry: data.merchant.industry,
  };
}
```

- [ ] **Step 3: Replace component body**

Replace `MerchantAdminPanel` body with a tabbed implementation:

```tsx
export function MerchantAdminPanel({ merchantId }: { merchantId: string }) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<MerchantAdminTab>("account");
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState<AccountFormState | null>(null);

  const detailQuery = useQuery({
    queryKey: ["merchant-ops-detail-admin", merchantId],
    queryFn: () => fetchMerchantsOpsDetail(merchantId),
    staleTime: 15_000,
  });

  useEffect(() => {
    if (detailQuery.data) {
      setForm(accountFormFromDetail(detailQuery.data));
    }
  }, [detailQuery.data]);

  const patchAccount = useMutation({
    mutationFn: (body: AccountFormState) =>
      patchMerchantOpsAccount(merchantId, {
        name: body.name,
        email: body.email,
        contactName: body.contactName,
        contactPhone: body.contactPhone,
        websiteUrl: body.websiteUrl || null,
        isActive: body.isActive,
        registrationStatus: body.registrationStatus,
        registrationNumber: body.registrationNumber || null,
        industry: body.industry,
      }),
    onSuccess: async () => {
      setNote("Cuenta actualizada.");
      await qc.invalidateQueries({ queryKey: ["merchant-ops-detail-admin", merchantId] });
      await qc.invalidateQueries({ queryKey: ["merchants-ops-directory"] });
    },
    onError: (e: Error) => setNote(e.message),
  });

  const data = detailQuery.data;
  const merchant = data?.merchant;
  const tabs: Array<{ id: MerchantAdminTab; label: string }> = [
    { id: "account", label: "Account" },
    { id: "application-form", label: "Application Form" },
    { id: "payment-methods", label: "Payment Methods" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Edit Merchant</h1>
          <p className="mt-1 text-sm text-slate-600">{merchant?.name ?? merchantId}</p>
        </div>
        {merchant?.mid ? (
          <p className="text-lg font-semibold text-slate-700">MID: {merchant.mid}</p>
        ) : null}
      </div>

      <div className="border-b border-slate-200">
        <nav className="-mb-px flex flex-wrap gap-6" aria-label="Merchant admin tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={
                activeTab === tab.id
                  ? "border-b-2 border-[var(--primary)] px-1 py-3 text-sm font-semibold text-[var(--primary)]"
                  : "border-b-2 border-transparent px-1 py-3 text-sm font-medium text-slate-500 hover:text-slate-700"
              }
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {note ? <p className="text-sm text-slate-700">{note}</p> : null}
      {detailQuery.isLoading ? <p className="text-sm text-slate-500">Cargando...</p> : null}
      {detailQuery.isError ? <p className="text-sm text-rose-700">{(detailQuery.error as Error).message}</p> : null}

      {data && activeTab === "account" && form ? (
        <AccountTab
          form={form}
          setForm={setForm}
          mid={data.merchant.mid}
          saving={patchAccount.isPending}
          onCancel={() => setForm(accountFormFromDetail(data))}
          onSave={() => patchAccount.mutate(form)}
        />
      ) : null}
      {data && activeTab === "application-form" ? <ApplicationFormTab data={data} /> : null}
      {data && activeTab === "payment-methods" ? <PaymentMethodsTab data={data} /> : null}
    </div>
  );
}
```

- [ ] **Step 4: Add AccountTab component**

Add below `MerchantAdminPanel`:

```tsx
function AccountTab({
  form,
  setForm,
  mid,
  saving,
  onCancel,
  onSave,
}: {
  form: AccountFormState;
  setForm: (next: AccountFormState) => void;
  mid: string;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Account</CardTitle>
        <CardDescription>Datos administrativos principales del merchant.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-3">
          <InputField label="Company name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <InputField label="E-mail" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
          <InputField label="Contact name" value={form.contactName} onChange={(contactName) => setForm({ ...form, contactName })} />
          <InputField label="Contact phone" value={form.contactPhone} onChange={(contactPhone) => setForm({ ...form, contactPhone })} />
          <InputField label="Website URL" type="url" value={form.websiteUrl} onChange={(websiteUrl) => setForm({ ...form, websiteUrl })} />
          <InputField label="MID" value={mid} readOnly onChange={() => undefined} />
          <SelectField
            label="Status"
            value={form.isActive ? "ENABLED" : "DISABLED"}
            options={[
              { value: "ENABLED", label: "Enabled" },
              { value: "DISABLED", label: "Disabled" },
            ]}
            onChange={(value) => setForm({ ...form, isActive: value === "ENABLED" })}
          />
          <SelectField
            label="Registration status"
            value={form.registrationStatus}
            options={registrationStatusOptions}
            onChange={(registrationStatus) => setForm({ ...form, registrationStatus: registrationStatus as MerchantRegistrationStatus })}
          />
          <InputField
            label="Registration number"
            value={form.registrationNumber}
            onChange={(registrationNumber) => setForm({ ...form, registrationNumber })}
          />
          <SelectField
            label="Industry type"
            value={form.industry}
            options={industryOptions}
            onChange={(industry) => setForm({ ...form, industry: industry as MerchantIndustry })}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="button" disabled={saving} onClick={onSave}>
            Save changes
          </Button>
          <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Add helper input/select components**

Add:

```tsx
function InputField({
  label,
  value,
  onChange,
  type = "text",
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  readOnly?: boolean;
}) {
  const id = useMemo(() => label.toLowerCase().replaceAll(" ", "-"), [label]);
  return (
    <label className="space-y-1.5 text-sm">
      <span className="block text-xs font-medium text-slate-600">{label}</span>
      <Input
        id={id}
        type={type}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={readOnly ? "bg-slate-50 text-slate-500" : undefined}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5 text-sm">
      <span className="block text-xs font-medium text-slate-600">{label}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );
}
```

- [ ] **Step 6: Add ApplicationFormTab**

Add:

```tsx
function ApplicationFormTab({ data }: { data: MerchantsOpsDetailResponse }) {
  if (data.onboardingEvents.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Application Form</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">No hay historial de onboarding para este merchant.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Application Form</CardTitle>
        <CardDescription>Historial cronológico del expediente más reciente.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {data.onboardingEvents.map((event) => (
            <div key={event.id} className="rounded-lg border border-slate-100 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{event.type}</span>
                <span className="text-xs text-slate-500">{new Date(event.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 text-slate-600">{event.message}</p>
              <p className="mt-1 text-xs text-slate-400">Actor: {event.actorType}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: Add PaymentMethodsTab**

Add:

```tsx
function PaymentMethodsTab({ data }: { data: MerchantsOpsDetailResponse }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Payment Methods</CardTitle>
        <CardDescription>Vista inicial; país, límites por moneda y rates se diseñarán en la siguiente fase.</CardDescription>
      </CardHeader>
      <CardContent>
        <TableContainer>
          <Table>
            <THead>
              <tr>
                <TH>UID</TH>
                <TH>Name</TH>
                <TH>Country</TH>
                <TH>Currencies / Limits</TH>
                <TH>Status</TH>
                <TH>Rates</TH>
              </tr>
            </THead>
            <TBody>
              {data.paymentMethods.map((row) => {
                const status = row.adminEnabled && row.merchantEnabled ? "Enabled" : "Disabled";
                const limits =
                  row.minAmountMinor != null || row.maxAmountMinor != null
                    ? `${row.minAmountMinor ?? 0} - ${row.maxAmountMinor ?? "∞"}`
                    : "Not configured";
                return (
                  <tr key={row.id}>
                    <TD className="font-mono text-xs">{row.id}</TD>
                    <TD>{row.definition?.label ?? row.definition?.code ?? row.definitionId}</TD>
                    <TD>Out of scope</TD>
                    <TD>{limits}</TD>
                    <TD>{status}</TD>
                    <TD>Out of scope</TD>
                  </tr>
                );
              })}
            </TBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 8: Run backoffice typecheck**

Run from `apps/psp-backoffice`:

```bash
npm run typecheck
```

Expected: typecheck passes.

### Task 8: Backoffice route tests and Playwright smoke

**Files:**
- Create: `apps/psp-backoffice/src/app/api/internal/merchants/ops/[merchantId]/account/route.spec.ts`
- Modify: `apps/psp-backoffice/e2e/auth-and-rbac.spec.ts`

- [ ] **Step 1: Add account route spec**

Create `route.spec.ts` beside the account route. Follow the existing route spec pattern and mock `proxyInternalPatch`. Include:

```ts
it("returns 400 for invalid account body", async () => {
  const req = new NextRequest("http://localhost:3005/api/internal/merchants/ops/m_123/account", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Backoffice-Mutation": "1",
      Origin: "http://localhost:3005",
    },
    body: JSON.stringify({ email: "not-email" }),
  });

  const res = await PATCH(req, { params: Promise.resolve({ merchantId: "m_123" }) });

  expect(res.status).toBe(400);
  expect(proxyInternalPatchMock).not.toHaveBeenCalled();
});
```

Add a success test with:

```ts
expect(proxyInternalPatchMock).toHaveBeenCalledWith({
  path: "/api/v1/merchants/ops/m_123/account",
  body: {
    name: "Levels Ltd",
    email: "support@levels.test",
    contactName: "Support Team",
    contactPhone: "+34600000000",
    websiteUrl: null,
    isActive: true,
    registrationStatus: "LEAD",
    registrationNumber: "2024-00069",
    industry: "FOREX",
  },
  backofficeScope: expect.objectContaining({ role: "admin" }),
});
```

- [ ] **Step 2: Extend Playwright smoke**

In `apps/psp-backoffice/e2e/auth-and-rbac.spec.ts`, after existing admin login/merchants assertions, add:

```ts
await page.getByRole("link", { name: "Admin" }).first().click();
await expect(page.getByRole("heading", { name: "Edit Merchant" })).toBeVisible();
await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
await expect(page.getByRole("button", { name: "Application Form" })).toBeVisible();
await expect(page.getByRole("button", { name: "Payment Methods" })).toBeVisible();
await page.getByRole("button", { name: "Payment Methods" }).click();
await expect(page.getByText("Currencies / Limits")).toBeVisible();
```

- [ ] **Step 3: Run Vitest**

Run from `apps/psp-backoffice`:

```bash
npm run test -- src/app/api/internal/merchants/ops/[merchantId]/account/route.spec.ts
```

Expected: route spec passes.

- [ ] **Step 4: Run Playwright when API test stack is available**

Run from `apps/psp-backoffice`:

```bash
npm run test:e2e
```

Expected: Playwright admin flow passes. When local API/Postgres is unavailable, record the environment blocker and rely on CI for this command.

### Task 9: Documentation and verification

**Files:**
- Modify: `PROJECT_CONTEXT.md`
- Modify: `apps/psp-backoffice/BACKOFFICE_CONTEXT.md`
- Modify: `docs/testing-status.md`

- [ ] **Step 1: Update root context**

In `PROJECT_CONTEXT.md`, add a concise note in the patterns/status sections:

```md
- Merchant admin account: `Merchant` now stores admin account fields (`email`, contact name/phone, website URL, `mid`, registration status/number, industry). The admin backoffice `/merchants/:merchantId/admin` uses these fields directly; shops/multi-shop remain out of scope.
```

- [ ] **Step 2: Update backoffice context**

In `apps/psp-backoffice/BACKOFFICE_CONTEXT.md`, update route description for `/merchants/[merchantId]/admin`:

```md
- `/merchants/[merchantId]/admin` — Solo admin: pantalla tabulada `Account` / `Application Form` / `Payment Methods`. `Account` edita datos administrativos del merchant; `Application Form` muestra eventos cronológicos del onboarding más reciente; `Payment Methods` muestra tabla inicial con UID/name/status y columnas objetivo para país, límites y rates.
```

- [ ] **Step 3: Update testing status**

In `docs/testing-status.md`, update `merchants`, `merchant-onboarding` and `backoffice BFF` notes with the new tests added. Add any new spec filenames under the inventory sections.

- [ ] **Step 4: Run final verification**

Run from `apps/psp-api`:

```bash
npm run lint
npm run test -- src/merchant-onboarding/merchant-onboarding.service.spec.ts src/merchant-onboarding/merchant-onboarding.controller.spec.ts
npm run test:integration -- test/integration/merchants.integration.spec.ts
```

Run from `apps/psp-backoffice`:

```bash
npm run typecheck
npm run test
```

Expected: all commands pass. If Playwright infrastructure is available, also run `npm run test:e2e`.

## Self-Review

### Spec Coverage

- `Merchant` fields and enums: Task 1, Task 2.
- MID generation and backfill: Task 1, Task 2.
- Onboarding simplification and data copy to `Merchant`: Task 3, Task 6.
- Duplicate email rejection: Task 3, Task 4.
- Internal detail and PATCH account: Task 2, Task 4, Task 5.
- Backoffice BFF: Task 5, Task 8.
- Tabbed admin UI: Task 7, Task 8.
- Application Form chronological events: Task 2, Task 7.
- Payment Methods placeholder table: Task 7.
- Docs and test status: Task 9.

### Type Consistency

Canonical names:

- `websiteUrl` in `Merchant`, API DTO, BFF schema and UI.
- `companyName` only in onboarding business profile DTO/UI; it maps to `Merchant.name` and onboarding `tradeName`.
- `industry` uses `MerchantIndustry`.
- `registrationStatus` uses `MerchantRegistrationStatus`.
- UI status `ENABLED` / `DISABLED` maps to boolean `isActive`.

### Execution Notes

- Do not commit unless the user explicitly requests commits.
- Keep imports at module top; no inline imports.
- Use exhaustive handling if adding switches over `MerchantIndustry` or `MerchantRegistrationStatus`.
- Review the migration SQL before applying it to any shared database.
