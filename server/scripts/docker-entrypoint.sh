#!/bin/sh
set -e

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

echo "Starting application"
exec node dist/server/src/index.js
