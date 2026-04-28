#!/bin/sh
# Runs Prisma migrations then starts Nest. Retries only for likely-transient failures.
#
# Env (defaults are conservative so a broken migration does not block /health for many minutes):
#   PRISMA_MIGRATE_MAX_ATTEMPTS   - max migrate invocations (default 8)
#   PRISMA_MIGRATE_WAIT_INCREMENT_SEC - backoff grows attempt * this seconds (default 2)
#   PRISMA_MIGRATE_MAX_WAIT_SEC   - cap sleep between attempts (default 15)
#   PRISMA_MIGRATE_MAX_ELAPSED_SEC - stop retrying after this many seconds since start (default 120)
#
cd /app

PRISMA_MIGRATE_MAX_ATTEMPTS="${PRISMA_MIGRATE_MAX_ATTEMPTS:-8}"
PRISMA_MIGRATE_WAIT_INCREMENT_SEC="${PRISMA_MIGRATE_WAIT_INCREMENT_SEC:-2}"
PRISMA_MIGRATE_MAX_WAIT_SEC="${PRISMA_MIGRATE_MAX_WAIT_SEC:-15}"
PRISMA_MIGRATE_MAX_ELAPSED_SEC="${PRISMA_MIGRATE_MAX_ELAPSED_SEC:-120}"

LOG_PREFIX="[docker-entrypoint]"
start_ts=$(date +%s)
attempt=1
last_output=""
last_exit=1

# Exit 0 if migrate output indicates a failure that retries will not fix.
is_permanent_migration_failure() {
  # Prisma migration error codes; see https://www.prisma.io/docs/orm/reference/error-reference
  echo "$1" | grep -qiE '(P3009|P3018|P3020)(\s|:|$)|failed migrations in the target database|Migration failed to apply|A migration failed to apply'
}

while true; do
  now_ts=$(date +%s)
  elapsed=$((now_ts - start_ts))
  if [ "$elapsed" -ge "$PRISMA_MIGRATE_MAX_ELAPSED_SEC" ]; then
    echo "$LOG_PREFIX prisma migrate deploy: max elapsed time (${PRISMA_MIGRATE_MAX_ELAPSED_SEC}s) reached before success (attempt ${attempt}, max attempts ${PRISMA_MIGRATE_MAX_ATTEMPTS})." >&2
    echo "$LOG_PREFIX Last run exit code: ${last_exit}. Full output:" >&2
    echo "$last_output" >&2
    exit 1
  fi

  set +e
  out=$(npx prisma migrate deploy 2>&1)
  ec=$?

  if [ "$ec" -eq 0 ]; then
    echo "$LOG_PREFIX prisma migrate deploy succeeded (attempt ${attempt}, ${elapsed}s elapsed)."
    exec node dist/main
  fi

  last_output="$out"
  last_exit="$ec"

  echo "$LOG_PREFIX prisma migrate deploy failed (attempt ${attempt}/${PRISMA_MIGRATE_MAX_ATTEMPTS}, exit ${ec}, ${elapsed}s elapsed). Output (first 30 lines):" >&2
  echo "$last_output" | head -n 30 >&2

  if is_permanent_migration_failure "$last_output"; then
    echo "$LOG_PREFIX non-retryable migration error detected (e.g. P3009/P3018); exiting without further attempts." >&2
    echo "$LOG_PREFIX Full output:" >&2
    echo "$last_output" >&2
    exit "$ec"
  fi

  if [ "$attempt" -ge "$PRISMA_MIGRATE_MAX_ATTEMPTS" ]; then
    echo "$LOG_PREFIX max attempts (${PRISMA_MIGRATE_MAX_ATTEMPTS}) reached. Last exit: ${last_exit}. Full output:" >&2
    echo "$last_output" >&2
    exit 1
  fi

  wait_sec=$((attempt * PRISMA_MIGRATE_WAIT_INCREMENT_SEC))
  if [ "$wait_sec" -gt "$PRISMA_MIGRATE_MAX_WAIT_SEC" ]; then
    wait_sec=$PRISMA_MIGRATE_MAX_WAIT_SEC
  fi

  echo "$LOG_PREFIX retry ${attempt} -> $((attempt + 1)) after ${wait_sec}s (elapsed ${elapsed}s / limit ${PRISMA_MIGRATE_MAX_ELAPSED_SEC}s, max attempts ${PRISMA_MIGRATE_MAX_ATTEMPTS})." >&2
  sleep "$wait_sec"
  attempt=$((attempt + 1))
done
