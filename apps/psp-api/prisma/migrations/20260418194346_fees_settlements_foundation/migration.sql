-- CreateEnum
CREATE TYPE "SettlementMode" AS ENUM ('NET', 'GROSS');

-- CreateEnum
CREATE TYPE "PayoutScheduleType" AS ENUM ('T_PLUS_N', 'WEEKLY');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'AVAILABLE', 'PAID', 'REVERSED');

-- CreateTable
CREATE TABLE "MerchantRateTable" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "percentage_bps" INTEGER NOT NULL,
    "fixed_minor" INTEGER NOT NULL DEFAULT 0,
    "minimum_minor" INTEGER NOT NULL DEFAULT 0,
    "settlement_mode" "SettlementMode" NOT NULL DEFAULT 'NET',
    "payout_schedule_type" "PayoutScheduleType" NOT NULL DEFAULT 'T_PLUS_N',
    "payout_schedule_param" INTEGER NOT NULL DEFAULT 1,
    "contract_ref" TEXT,
    "active_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantRateTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentFeeQuote" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "rate_table_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "percentage_bps" INTEGER NOT NULL,
    "fixed_minor" INTEGER NOT NULL,
    "minimum_minor" INTEGER NOT NULL,
    "gross_minor" INTEGER NOT NULL,
    "fee_minor" INTEGER NOT NULL,
    "net_minor" INTEGER NOT NULL,
    "settlement_mode" "SettlementMode" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentFeeQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MerchantRateTable_merchant_id_currency_provider_active_from_idx" ON "MerchantRateTable"("merchant_id", "currency", "provider", "active_from");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentFeeQuote_payment_id_key" ON "PaymentFeeQuote"("payment_id");

-- CreateIndex
CREATE INDEX "PaymentFeeQuote_merchant_id_created_at_idx" ON "PaymentFeeQuote"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "PaymentFeeQuote_provider_created_at_idx" ON "PaymentFeeQuote"("provider", "created_at");

-- CreateIndex
CREATE INDEX "Payment_created_at_id_idx" ON "Payment"("created_at", "id");

-- CreateIndex
CREATE INDEX "Payment_status_created_at_id_idx" ON "Payment"("status", "created_at", "id");

-- CreateIndex
CREATE INDEX "Payment_status_currency_succeeded_at_idx" ON "Payment"("status", "currency", "succeeded_at");

-- CreateIndex
CREATE INDEX "Payment_selected_provider_created_at_id_idx" ON "Payment"("selected_provider", "created_at", "id");

-- CreateIndex
CREATE INDEX "Payment_merchant_id_created_at_id_idx" ON "Payment"("merchant_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "Payment_selected_provider_provider_ref_idx" ON "Payment"("selected_provider", "provider_ref");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantRateTable_active_merchant_currency_provider_uniq"
ON "MerchantRateTable"("merchant_id", "currency", "provider")
WHERE "active_to" IS NULL;

-- Seed existing merchant bps fees into provider-specific default contracts.
WITH providers("provider") AS (
    VALUES ('stripe'), ('mock'), ('acme')
)
INSERT INTO "MerchantRateTable" (
    "id",
    "merchant_id",
    "currency",
    "provider",
    "percentage_bps",
    "fixed_minor",
    "minimum_minor",
    "settlement_mode",
    "payout_schedule_type",
    "payout_schedule_param",
    "active_from"
)
SELECT
    'mrt_' || m."id" || '_' || p."provider",
    m."id",
    'EUR',
    p."provider",
    m."fee_bps",
    0,
    0,
    'NET'::"SettlementMode",
    'T_PLUS_N'::"PayoutScheduleType",
    1,
    CURRENT_TIMESTAMP
FROM "Merchant" m
CROSS JOIN providers p
WHERE NOT EXISTS (
    SELECT 1
    FROM "MerchantRateTable" r
    WHERE r."merchant_id" = m."id"
      AND r."currency" = 'EUR'
      AND r."provider" = p."provider"
      AND r."active_to" IS NULL
);

-- AddForeignKey
ALTER TABLE "MerchantRateTable" ADD CONSTRAINT "MerchantRateTable_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentFeeQuote" ADD CONSTRAINT "PaymentFeeQuote_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentFeeQuote" ADD CONSTRAINT "PaymentFeeQuote_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentFeeQuote" ADD CONSTRAINT "PaymentFeeQuote_rate_table_id_fkey" FOREIGN KEY ("rate_table_id") REFERENCES "MerchantRateTable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
