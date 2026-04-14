-- CreateTable
CREATE TABLE "PaymentOperation" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "processing_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOperation_payment_id_operation_key" ON "PaymentOperation"("payment_id", "operation");

-- CreateIndex
CREATE INDEX "PaymentOperation_merchant_id_created_at_idx" ON "PaymentOperation"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "PaymentOperation_status_processing_at_idx" ON "PaymentOperation"("status", "processing_at");

-- AddForeignKey
ALTER TABLE "PaymentOperation" ADD CONSTRAINT "PaymentOperation_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

