#!/bin/sh
set -e

# Optional Unraid-style runtime identity controls.
# - PUID/PGID: run app process as this uid/gid (uses gosu when available)
# - UMASK: process umask (default from image ENV)
UPLOADS_PATH="${UPLOADS_DIR:-/app/uploads}"

if [ -n "$UMASK" ]; then
  # shellcheck disable=SC2086
  umask $UMASK || true
fi

if [ -n "$PUID" ] && [ -n "$PGID" ] && command -v gosu >/dev/null 2>&1; then
  echo "Applying PUID/PGID: ${PUID}:${PGID}"
  mkdir -p "$UPLOADS_PATH" || true
  chown -R "$PUID:$PGID" "$UPLOADS_PATH" 2>/dev/null || true
  # Ensure optional runtime prisma generate can update generated client files.
  if [ -d /app/node_modules/.prisma ]; then
    chown -R "$PUID:$PGID" /app/node_modules/.prisma 2>/dev/null || true
  fi
  if [ -d /app/node_modules/@prisma ]; then
    chown -R "$PUID:$PGID" /app/node_modules/@prisma 2>/dev/null || true
  fi

  echo "Starting docker entrypoint: set DATABASE_URL if needed and ensure DB schema"

  # Only run set-database-url.js if it exists
  if [ -f ./server/scripts/set-database-url.js ]; then
    gosu "$PUID:$PGID" node ./server/scripts/set-database-url.js
  else
    echo "set-database-url.js not found, skipping"
  fi

  echo "DB schema is handled by server startup (ensureDatabaseReady): migrate deploy (safe)"

  # Avoid running `prisma db push` here so production-like databases aren't modified
  # outside the server's controlled startup path.

  echo "Starting application"
  exec gosu "$PUID:$PGID" node dist/server/src/index.js
fi

echo "Starting docker entrypoint: set DATABASE_URL if needed and ensure DB schema"

# Only run set-database-url.js if it exists
if [ -f ./server/scripts/set-database-url.js ]; then
  node ./server/scripts/set-database-url.js
else
  echo "set-database-url.js not found, skipping"
fi

echo "DB schema is handled by server startup (ensureDatabaseReady): migrate deploy (safe)"

# Avoid running `prisma db push` here so production-like databases aren't modified
# outside the server's controlled startup path.

if [ -n "$PUID" ] || [ -n "$PGID" ]; then
  echo "PUID/PGID provided but gosu missing or incomplete values; running as current user"
fi

echo "Starting application"
exec node dist/server/src/index.js
