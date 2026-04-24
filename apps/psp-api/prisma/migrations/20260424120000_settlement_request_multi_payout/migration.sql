-- Enlace explícito de todos los payouts generados en una misma aprobación de solicitud.
ALTER TABLE "Payout" ADD COLUMN "settlement_request_id" TEXT;

CREATE INDEX "Payout_settlement_request_id_idx" ON "Payout"("settlement_request_id");

ALTER TABLE "Payout"
ADD CONSTRAINT "Payout_settlement_request_id_fkey"
FOREIGN KEY ("settlement_request_id") REFERENCES "SettlementRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: payouts ya referenciados como ancla por la solicitud.
UPDATE "Payout" p
SET "settlement_request_id" = sr.id
FROM "SettlementRequest" sr
WHERE sr."payout_id" = p.id AND p."settlement_request_id" IS NULL;

ALTER TABLE "SettlementRequest" ADD COLUMN "paid_net_minor" INTEGER;
ALTER TABLE "SettlementRequest" ADD COLUMN "settled_all_available" BOOLEAN NOT NULL DEFAULT true;

UPDATE "SettlementRequest" sr
SET "paid_net_minor" = p."net_minor", "settled_all_available" = true
FROM "Payout" p
WHERE sr."payout_id" = p.id AND sr."paid_net_minor" IS NULL AND sr.status = 'PAID'::"SettlementRequestStatus";
