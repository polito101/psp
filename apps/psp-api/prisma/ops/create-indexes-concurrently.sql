-- This file is executed outside of Prisma migrations to allow `CONCURRENTLY`.
-- It must be run with a connection that is NOT inside an explicit transaction.

-- Avoid long blocking waits if something else holds locks.
SET lock_timeout = '2s';

-- `CONCURRENTLY` avoids blocking writes during index build.
-- `IF NOT EXISTS` makes this safe for re-runs.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Payment_selected_provider_provider_ref_idx"
  ON "Payment" ("selected_provider", "provider_ref");

