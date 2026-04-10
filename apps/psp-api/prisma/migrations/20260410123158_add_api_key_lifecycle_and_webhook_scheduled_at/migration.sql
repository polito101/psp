-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "api_key_expires_at" TIMESTAMP(3),
ADD COLUMN     "api_key_revoked_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WebhookDelivery" ADD COLUMN     "scheduled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_scheduled_at_idx" ON "WebhookDelivery"("status", "scheduled_at");
