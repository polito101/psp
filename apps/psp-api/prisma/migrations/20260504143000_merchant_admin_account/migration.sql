CREATE TYPE "MerchantRegistrationStatus" AS ENUM (
  'LEAD',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'ACTIVE'
);

CREATE TYPE "MerchantIndustry" AS ENUM (
  'CLOUD_COMPUTING',
  'CRYPTO',
  'FOREX',
  'GAMBLING',
  'PSP',
  'OTHER'
);

ALTER TABLE "Merchant"
  ADD COLUMN "email" VARCHAR(320),
  ADD COLUMN "contact_name" VARCHAR(160),
  ADD COLUMN "contact_phone" VARCHAR(64),
  ADD COLUMN "website_url" VARCHAR(2048),
  ADD COLUMN "mid" VARCHAR(6),
  ADD COLUMN "registration_number" VARCHAR(64),
  ADD COLUMN "registration_status" "MerchantRegistrationStatus" NOT NULL DEFAULT 'LEAD',
  ADD COLUMN "industry" "MerchantIndustry" NOT NULL DEFAULT 'OTHER';

WITH numbered AS (
  SELECT
    "id",
    LPAD((100000 + ROW_NUMBER() OVER (ORDER BY "created_at", "id"))::text, 6, '0') AS generated_mid
  FROM "Merchant"
  WHERE "mid" IS NULL
)
UPDATE "Merchant" AS m
SET "mid" = numbered.generated_mid
FROM numbered
WHERE m."id" = numbered."id";

ALTER TABLE "Merchant"
  ALTER COLUMN "mid" SET NOT NULL;

CREATE UNIQUE INDEX "Merchant_email_key" ON "Merchant"("email");
CREATE UNIQUE INDEX "Merchant_mid_key" ON "Merchant"("mid");
