-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "status_reason" TEXT,
ADD COLUMN "selected_provider" TEXT,
ADD COLUMN "last_attempt_at" TIMESTAMP(3),
ADD COLUMN "succeeded_at" TIMESTAMP(3),
ADD COLUMN "failed_at" TIMESTAMP(3),
ADD COLUMN "canceled_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "latency_ms" INTEGER,
    "request_payload" JSONB,
    "response_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_merchant_id_selected_provider_idx" ON "Payment"("merchant_id", "selected_provider");

-- CreateIndex
CREATE INDEX "PaymentAttempt_payment_id_created_at_idx" ON "PaymentAttempt"("payment_id", "created_at");

-- CreateIndex
CREATE INDEX "PaymentAttempt_merchant_id_created_at_idx" ON "PaymentAttempt"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "PaymentAttempt_provider_provider_payment_id_idx" ON "PaymentAttempt"("provider", "provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_payment_id_operation_attempt_no_key" ON "PaymentAttempt"("payment_id", "operation", "attempt_no");

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
