-- CreateEnum
CREATE TYPE "SettlementRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID', 'CANCELED');

-- AlterTable Merchant
ALTER TABLE "Merchant" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Merchant" ADD COLUMN "deactivated_at" TIMESTAMP(3);

-- AlterTable Payment
ALTER TABLE "Payment" ADD COLUMN "payer_country" VARCHAR(2);
ALTER TABLE "Payment" ADD COLUMN "payment_method_code" VARCHAR(64);
ALTER TABLE "Payment" ADD COLUMN "payment_method_family" VARCHAR(32);

CREATE INDEX "Payment_payer_country_created_at_idx" ON "Payment"("payer_country", "created_at");
CREATE INDEX "Payment_payment_method_code_created_at_idx" ON "Payment"("payment_method_code", "created_at");

-- PaymentMethodDefinition
CREATE TABLE "PaymentMethodDefinition" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "label" TEXT NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "category" VARCHAR(32) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentMethodDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentMethodDefinition_code_key" ON "PaymentMethodDefinition"("code");
CREATE INDEX "PaymentMethodDefinition_provider_active_idx" ON "PaymentMethodDefinition"("provider", "active");

-- MerchantPaymentMethod
CREATE TABLE "MerchantPaymentMethod" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "definition_id" TEXT NOT NULL,
    "merchant_enabled" BOOLEAN NOT NULL DEFAULT true,
    "admin_enabled" BOOLEAN NOT NULL DEFAULT true,
    "min_amount_minor" INTEGER,
    "max_amount_minor" INTEGER,
    "visible_to_merchant" BOOLEAN NOT NULL DEFAULT true,
    "last_changed_by" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantPaymentMethod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantPaymentMethod_merchant_id_definition_id_key" ON "MerchantPaymentMethod"("merchant_id", "definition_id");
CREATE INDEX "MerchantPaymentMethod_merchant_id_merchant_enabled_admin_enabled_idx" ON "MerchantPaymentMethod"("merchant_id", "merchant_enabled", "admin_enabled");

ALTER TABLE "MerchantPaymentMethod" ADD CONSTRAINT "MerchantPaymentMethod_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantPaymentMethod" ADD CONSTRAINT "MerchantPaymentMethod_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "PaymentMethodDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SettlementRequest (before FK from Payout optional — FK is on this table)
CREATE TABLE "SettlementRequest" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "requested_net_minor" INTEGER NOT NULL,
    "status" "SettlementRequestStatus" NOT NULL DEFAULT 'PENDING',
    "payout_id" TEXT,
    "notes" TEXT,
    "requested_by_role" VARCHAR(16) NOT NULL,
    "reviewed_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SettlementRequest_payout_id_key" ON "SettlementRequest"("payout_id");
CREATE INDEX "SettlementRequest_merchant_id_status_created_at_idx" ON "SettlementRequest"("merchant_id", "status", "created_at");
CREATE INDEX "SettlementRequest_status_created_at_idx" ON "SettlementRequest"("status", "created_at");

ALTER TABLE "SettlementRequest" ADD CONSTRAINT "SettlementRequest_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementRequest" ADD CONSTRAINT "SettlementRequest_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FxRateSnapshot
CREATE TABLE "FxRateSnapshot" (
    "id" TEXT NOT NULL,
    "base_currency" VARCHAR(8) NOT NULL,
    "quote_currency" VARCHAR(8) NOT NULL,
    "rate_decimal" DECIMAL(28,14) NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "external_ref" VARCHAR(256),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRateSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FxRateSnapshot_base_currency_quote_currency_effective_at_idx" ON "FxRateSnapshot"("base_currency", "quote_currency", "effective_at");

-- Seed global payment method definitions (id = cuid-like fixed for idempotency in seeds if needed — use gen_random_uuid via app; SQL uses simple ids)
INSERT INTO "PaymentMethodDefinition" ("id", "code", "label", "provider", "category", "active", "created_at")
VALUES
  ('pmdef_mock_card', 'mock_card', 'Mock Tarjeta', 'mock', 'card', true, CURRENT_TIMESTAMP),
  ('pmdef_mock_transfer', 'mock_transfer', 'Mock Transferencia', 'mock', 'transfer', true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Backfill MerchantPaymentMethod for existing merchants (all methods enabled by default)
INSERT INTO "MerchantPaymentMethod" ("id", "merchant_id", "definition_id", "merchant_enabled", "admin_enabled", "visible_to_merchant", "created_at", "updated_at")
SELECT
  'mpm_' || m."id" || '_mock_card',
  m."id",
  'pmdef_mock_card',
  true,
  true,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Merchant" m
WHERE NOT EXISTS (
  SELECT 1 FROM "MerchantPaymentMethod" x WHERE x."merchant_id" = m."id" AND x."definition_id" = 'pmdef_mock_card'
);

INSERT INTO "MerchantPaymentMethod" ("id", "merchant_id", "definition_id", "merchant_enabled", "admin_enabled", "visible_to_merchant", "created_at", "updated_at")
SELECT
  'mpm_' || m."id" || '_mock_transfer',
  m."id",
  'pmdef_mock_transfer',
  true,
  true,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Merchant" m
WHERE NOT EXISTS (
  SELECT 1 FROM "MerchantPaymentMethod" x WHERE x."merchant_id" = m."id" AND x."definition_id" = 'pmdef_mock_transfer'
);
