-- Drop legacy non-unique index (environments that applied 20260430210000 before it was corrected).
DROP INDEX IF EXISTS "merchant_onboarding_applications_contact_email_idx";

-- Fail fast if duplicate non-null contact_email rows exist (possible when the table was indexed
-- without UNIQUE). PostgreSQL allows multiple NULLs under a UNIQUE index, so only non-null emails
-- are checked here.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "merchant_onboarding_applications"
    WHERE "contact_email" IS NOT NULL
    GROUP BY "contact_email"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate contact_email values exist in merchant_onboarding_applications. '
      'Resolve duplicates manually (e.g. keep one application per email and remove or reassign the rest, '
      'including orphan Merchant rows tied to discarded applications) before this migration can apply. '
      'Query: SELECT contact_email, COUNT(*) FROM merchant_onboarding_applications WHERE contact_email IS NOT NULL GROUP BY contact_email HAVING COUNT(*) > 1;';
  END IF;
END $$;

-- CreateIndex (unique contact_email)
-- NOTE:
-- We intentionally do NOT create this UNIQUE index here because `prisma migrate deploy` wraps
-- migrations in a transaction on PostgreSQL, and `CREATE UNIQUE INDEX CONCURRENTLY` cannot run inside
-- a transaction block. A blocking `CREATE UNIQUE INDEX` would hold stronger locks during the build
-- and can stall onboarding writes under load.
--
-- Operational step (post-migrate, non-transactional; avoids blocking writes during index build):
--   npm -w apps/psp-api run prisma:ops:indexes
--
-- Until this UNIQUE exists, `MerchantOnboardingService.createApplication` serializes by
-- `contact_email` using `pg_advisory_xact_lock` in the same transaction as the insert.
--
-- The statement lives in `prisma/ops/create-indexes-concurrently.sql`. Pipeline using
-- `npm -w apps/psp-api run prisma:migrate:deploy` runs migrate deploy and then that script.
