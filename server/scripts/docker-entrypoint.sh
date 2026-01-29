#!/bin/sh
set -e

echo "Starting docker entrypoint: set DATABASE_URL if needed and ensure DB schema"
# Ensure DATABASE_URL is set from DB_* env vars
node ./server/scripts/set-database-url.js || true

echo "Running setup-db (db push + prisma generate)"
npm run setup-db

echo "Starting application"
exec node dist/server/src/index.js
