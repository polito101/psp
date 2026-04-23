ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "created_weekday_utc" INTEGER;

UPDATE "Payment"
SET "created_weekday_utc" = (EXTRACT(DOW FROM ("created_at" AT TIME ZONE 'UTC')))::INT
WHERE "created_weekday_utc" IS NULL;

CREATE INDEX IF NOT EXISTS "Payment_created_weekday_utc_created_at_idx" ON "Payment"("created_weekday_utc", "created_at");
