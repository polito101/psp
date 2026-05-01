-- Drop non-unique index on contact_email (replaced by unique constraint for concurrency-safe dedup).
DROP INDEX IF EXISTS "merchant_onboarding_applications_contact_email_idx";

-- Unique contact email: serializes concurrent `createApplication` for the same address.
CREATE UNIQUE INDEX "merchant_onboarding_applications_contact_email_key" ON "merchant_onboarding_applications"("contact_email");
