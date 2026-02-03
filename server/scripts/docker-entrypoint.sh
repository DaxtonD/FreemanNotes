#!/bin/sh
set -e

echo "Starting docker entrypoint: set DATABASE_URL if needed and ensure DB schema"

# Only run set-database-url.js if it exists
if [ -f ./server/scripts/set-database-url.js ]; then
  node ./server/scripts/set-database-url.js
else
  echo "set-database-url.js not found, skipping"
fi

echo "Running setup-db (db push + prisma generate)"
npm run setup-db

echo "Starting application"
exec node dist/server/src/index.js
