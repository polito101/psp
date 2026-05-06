-- CreateEnum
CREATE TYPE "ProviderLogOperation" AS ENUM ('CREATE');

-- CreateEnum
CREATE TYPE "DynamicPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "notification_url" VARCHAR(2048);
ALTER TABLE "Payment" ADD COLUMN "action_snapshot" JSONB;

-- CreateTable
CREATE TABLE "ProviderLog" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "operation" "ProviderLogOperation" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "http_status" INTEGER,
    "latency_ms" INTEGER,
    "provider_transaction_id" VARCHAR(160),
    "request_masked" JSONB,
    "request_ciphertext" TEXT,
    "response_masked" JSONB,
    "response_ciphertext" TEXT,
    "error_code" VARCHAR(120),
    "error_message" VARCHAR(512),

    CONSTRAINT "ProviderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentNotificationDelivery" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "status_snapshot" "DynamicPaymentStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "http_status" INTEGER,
    "request_body_masked" JSONB,
    "request_body_ciphertext" TEXT,
    "response_body_masked" JSONB,
    "response_body_ciphertext" TEXT,
    "attempt_no" INTEGER NOT NULL,
    "is_resend" BOOLEAN NOT NULL DEFAULT false,
    "original_delivery_id" TEXT,

    CONSTRAINT "PaymentNotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentNotificationDelivery_payment_id_attempt_no_key" ON "PaymentNotificationDelivery"("payment_id", "attempt_no");

-- CreateIndex
CREATE INDEX "PaymentNotificationDelivery_payment_id_created_at_idx" ON "PaymentNotificationDelivery"("payment_id", "created_at");

-- CreateIndex
CREATE INDEX "ProviderLog_payment_id_created_at_idx" ON "ProviderLog"("payment_id", "created_at");

-- AddForeignKey
ALTER TABLE "ProviderLog" ADD CONSTRAINT "ProviderLog_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentNotificationDelivery" ADD CONSTRAINT "PaymentNotificationDelivery_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
