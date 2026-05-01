-- Drop legacy non-unique index (environments that applied 20260430210000 before it was corrected).
DROP INDEX IF EXISTS "merchant_onboarding_applications_contact_email_idx";

-- Ensure unique contact_email (no-op if 20260430210000 already created this index).
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_onboarding_applications_contact_email_key" ON "merchant_onboarding_applications"("contact_email");
