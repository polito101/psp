-- This file is executed outside of Prisma migrations to allow `CONCURRENTLY`.
-- It must be run with a connection that is NOT inside an explicit transaction.

-- Note: `lock_timeout` (env `PSP_PRISMA_INDEX_LOCK_TIMEOUT`) is applied by the wrapper
-- only immediately before `DROP INDEX CONCURRENTLY`, not before `CREATE INDEX CONCURRENTLY`.
-- A `lock_timeout` during a concurrent build can abort mid-build and leave an invalid
-- index that `IF NOT EXISTS` will not recreate on re-run; the wrapper validates
-- `pg_index.indisvalid` after a successful pass.

-- `CONCURRENTLY` avoids blocking writes during index build.
-- `IF NOT EXISTS` makes this safe for re-runs.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Payment_selected_provider_provider_ref_idx"
  ON "Payment" ("selected_provider", "provider_ref");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Payment_status_currency_succeeded_at_idx"
  ON "Payment" ("status", "currency", "succeeded_at");

DROP INDEX CONCURRENTLY IF EXISTS "Payment_status_currency_created_at_idx";

-- `PAYMENTS_V2_ASSERT_NO_LEGACY_STRIPE_ROWS` y filtros por `provider` (misma convención de nombres que Prisma Migrate).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PaymentSettlement_provider_idx"
  ON "PaymentSettlement" ("provider");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "MerchantRateTable_provider_merchant_id_currency_idx"
  ON "MerchantRateTable" ("provider", "merchant_id", "currency");

-- Merchant onboarding: unique normalized email (race-safe vs application-level checks).
-- IF NOT EXISTS: environments that applied the corrected 20260430210000 migration already have this index.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "merchant_onboarding_applications_contact_email_key"
  ON "merchant_onboarding_applications" ("contact_email");

