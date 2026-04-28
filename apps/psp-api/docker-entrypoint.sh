#!/bin/sh
set -e
cd /app

# Reintentos con backoff ante fallos transitorios (red/DB aún no lista).
MAX_ATTEMPTS=30
WAIT_SEC=2
MAX_WAIT=60
attempt=1

while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  echo "[entrypoint] prisma migrate deploy: attempt $attempt/$MAX_ATTEMPTS"
  if npx prisma migrate deploy; then
    echo "[entrypoint] prisma migrate deploy: ok"
    exec node dist/main
  fi
  if [ "$attempt" -eq "$MAX_ATTEMPTS" ]; then
    echo "[entrypoint] prisma migrate deploy: failed after $MAX_ATTEMPTS attempts" >&2
    exit 1
  fi
  echo "[entrypoint] prisma migrate deploy: failed, retrying in ${WAIT_SEC}s"
  sleep "$WAIT_SEC"
  WAIT_SEC=$((WAIT_SEC + 2))
  if [ "$WAIT_SEC" -gt "$MAX_WAIT" ]; then
    WAIT_SEC=$MAX_WAIT
  fi
  attempt=$((attempt + 1))
done
