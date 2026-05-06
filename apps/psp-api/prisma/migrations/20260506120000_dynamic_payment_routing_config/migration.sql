-- Enums and tables for weighted provider/method routing configuration (backoffice + future runtime).

-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('CASH', 'ONLINE', 'CREDIT_CARD', 'CRYPTO');

-- CreateEnum
CREATE TYPE "PaymentIntegrationMode" AS ENUM ('S2S', 'REDIRECTION', 'HOSTED_PAGE');

-- CreateEnum
CREATE TYPE "PaymentProviderRequestTemplate" AS ENUM ('REDIRECT_SIMPLE', 'SPEI_BANK_TRANSFER');

-- CreateTable
CREATE TABLE "payment_provider_configs" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(512),
    "integration_base_url" VARCHAR(2048) NOT NULL,
    "init_payment_resource" VARCHAR(2048) NOT NULL,
    "is_configured" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "config_ciphertext" TEXT,
    "credentials_ciphertext" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_method_routes" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "method_code" VARCHAR(64) NOT NULL,
    "method_name" VARCHAR(160) NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "country_name" VARCHAR(120),
    "country_image_name" VARCHAR(120),
    "channel" "PaymentChannel" NOT NULL,
    "integration_mode" "PaymentIntegrationMode" NOT NULL,
    "request_template" "PaymentProviderRequestTemplate" NOT NULL,
    "integration_code" VARCHAR(120),
    "checkout_url_template" VARCHAR(2048),
    "expiration_time_offset" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "is_flagged" BOOLEAN NOT NULL DEFAULT false,
    "force_pending_input" BOOLEAN NOT NULL DEFAULT false,
    "is_virtual" BOOLEAN NOT NULL DEFAULT false,
    "risk_evaluation" BOOLEAN NOT NULL DEFAULT false,
    "route_config_json" JSONB,
    "route_config_ciphertext" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_method_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_method_route_currencies" (
    "id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "min_amount" DECIMAL(18,6) NOT NULL,
    "max_amount" DECIMAL(18,6) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_method_route_currencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_provider_rates" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "percentage" DECIMAL(10,4) NOT NULL,
    "fixed" DECIMAL(18,6) NOT NULL,
    "min_rate_discount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "apply_to_customer" BOOLEAN NOT NULL DEFAULT false,
    "fx_spread" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "fx_markup" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "disable_industry_validation" BOOLEAN NOT NULL DEFAULT false,
    "cash_enabled" BOOLEAN NOT NULL DEFAULT true,
    "credit_card_enabled" BOOLEAN NOT NULL DEFAULT true,
    "crypto_enabled" BOOLEAN NOT NULL DEFAULT true,
    "online_enabled" BOOLEAN NOT NULL DEFAULT true,
    "cash_min_amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "credit_card_min_amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "crypto_min_amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "online_min_amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_provider_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_provider_configs_is_active_is_published_idx" ON "payment_provider_configs"("is_active", "is_published");

-- CreateIndex
CREATE INDEX "payment_method_routes_country_code_channel_is_active_is_publ_idx" ON "payment_method_routes"("country_code", "channel", "is_active", "is_published");

-- CreateIndex
CREATE INDEX "payment_method_routes_provider_id_country_code_idx" ON "payment_method_routes"("provider_id", "country_code");

-- CreateIndex
CREATE INDEX "payment_method_routes_method_code_country_code_channel_idx" ON "payment_method_routes"("method_code", "country_code", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "payment_method_route_currencies_route_id_currency_key" ON "payment_method_route_currencies"("route_id", "currency");

-- CreateIndex
CREATE INDEX "payment_method_route_currencies_currency_idx" ON "payment_method_route_currencies"("currency");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_provider_rates_merchant_id_provider_id_country_code_key" ON "merchant_provider_rates"("merchant_id", "provider_id", "country_code");

-- CreateIndex
CREATE INDEX "merchant_provider_rates_merchant_id_country_code_is_active_idx" ON "merchant_provider_rates"("merchant_id", "country_code", "is_active");

-- AddForeignKey
ALTER TABLE "payment_method_routes" ADD CONSTRAINT "payment_method_routes_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "payment_provider_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_method_route_currencies" ADD CONSTRAINT "payment_method_route_currencies_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "payment_method_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_provider_rates" ADD CONSTRAINT "merchant_provider_rates_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_provider_rates" ADD CONSTRAINT "merchant_provider_rates_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "payment_provider_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
