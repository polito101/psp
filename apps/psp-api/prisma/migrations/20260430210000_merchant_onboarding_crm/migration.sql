-- CreateEnum
CREATE TYPE "MerchantOnboardingStatus" AS ENUM ('ACCOUNT_CREATED', 'DOCUMENTATION_PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ACTIVE');

-- CreateEnum
CREATE TYPE "MerchantOnboardingChecklistStatus" AS ENUM ('PENDING', 'COMPLETED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "MerchantOnboardingActorType" AS ENUM ('SYSTEM', 'MERCHANT', 'ADMIN');

-- CreateTable
CREATE TABLE "merchant_onboarding_applications" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "status" "MerchantOnboardingStatus" NOT NULL DEFAULT 'ACCOUNT_CREATED',
    "contact_name" VARCHAR(160) NOT NULL,
    "contact_email" VARCHAR(320) NOT NULL,
    "contact_phone" VARCHAR(64) NOT NULL,
    "trade_name" VARCHAR(160),
    "legal_name" VARCHAR(200),
    "country" VARCHAR(2),
    "website" VARCHAR(2048),
    "business_type" VARCHAR(120),
    "rejection_reason" TEXT,
    "submitted_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_onboarding_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_onboarding_checklist_items" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "status" "MerchantOnboardingChecklistStatus" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_onboarding_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_onboarding_events" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "actor_type" "MerchantOnboardingActorType" NOT NULL,
    "actor_id" VARCHAR(160),
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_onboarding_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_onboarding_tokens" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_onboarding_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_onboarding_applications_status_created_at_idx" ON "merchant_onboarding_applications"("status", "created_at");

-- CreateIndex
CREATE INDEX "merchant_onboarding_applications_contact_email_idx" ON "merchant_onboarding_applications"("contact_email");

-- CreateIndex
CREATE INDEX "merchant_onboarding_applications_merchant_id_idx" ON "merchant_onboarding_applications"("merchant_id");

-- CreateIndex
CREATE INDEX "merchant_onboarding_checklist_items_application_id_status_idx" ON "merchant_onboarding_checklist_items"("application_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_onboarding_checklist_items_application_id_key_key" ON "merchant_onboarding_checklist_items"("application_id", "key");

-- CreateIndex
CREATE INDEX "merchant_onboarding_events_application_id_created_at_idx" ON "merchant_onboarding_events"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "merchant_onboarding_events_type_created_at_idx" ON "merchant_onboarding_events"("type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_onboarding_tokens_token_hash_key" ON "merchant_onboarding_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "merchant_onboarding_tokens_application_id_created_at_idx" ON "merchant_onboarding_tokens"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "merchant_onboarding_tokens_expires_at_idx" ON "merchant_onboarding_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "merchant_onboarding_applications" ADD CONSTRAINT "merchant_onboarding_applications_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_onboarding_checklist_items" ADD CONSTRAINT "merchant_onboarding_checklist_items_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "merchant_onboarding_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_onboarding_events" ADD CONSTRAINT "merchant_onboarding_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "merchant_onboarding_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_onboarding_tokens" ADD CONSTRAINT "merchant_onboarding_tokens_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "merchant_onboarding_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
