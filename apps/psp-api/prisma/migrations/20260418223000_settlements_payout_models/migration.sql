-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('CREATED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "PaymentSettlement" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "settlement_mode" "SettlementMode" NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "gross_minor" INTEGER NOT NULL,
    "fee_minor" INTEGER NOT NULL,
    "net_minor" INTEGER NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "payout_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'CREATED',
    "window_start_at" TIMESTAMP(3) NOT NULL,
    "window_end_at" TIMESTAMP(3) NOT NULL,
    "gross_minor" INTEGER NOT NULL,
    "fee_minor" INTEGER NOT NULL,
    "net_minor" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutItem" (
    "id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "payment_settlement_id" TEXT NOT NULL,
    "gross_minor" INTEGER NOT NULL,
    "fee_minor" INTEGER NOT NULL,
    "net_minor" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSettlement_payment_id_key" ON "PaymentSettlement"("payment_id");

-- CreateIndex
CREATE INDEX "PaymentSettlement_merchant_id_currency_status_available_at_idx" ON "PaymentSettlement"("merchant_id", "currency", "status", "available_at");

-- CreateIndex
CREATE INDEX "PaymentSettlement_payout_id_idx" ON "PaymentSettlement"("payout_id");

-- CreateIndex
CREATE INDEX "Payout_merchant_id_created_at_idx" ON "Payout"("merchant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutItem_payment_settlement_id_key" ON "PayoutItem"("payment_settlement_id");

-- CreateIndex
CREATE INDEX "PayoutItem_payout_id_created_at_idx" ON "PayoutItem"("payout_id", "created_at");

-- AddForeignKey
ALTER TABLE "PaymentSettlement" ADD CONSTRAINT "PaymentSettlement_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSettlement" ADD CONSTRAINT "PaymentSettlement_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSettlement" ADD CONSTRAINT "PaymentSettlement_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "Payout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_payment_settlement_id_fkey" FOREIGN KEY ("payment_settlement_id") REFERENCES "PaymentSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
