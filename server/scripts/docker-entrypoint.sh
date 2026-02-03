#!/bin/sh
set -e

echo "Starting docker entrypoint: ensure DB schema"

echo "Running setup-db (db push + prisma generate)"
npm run setup-db

echo "Starting application"
exec node dist/server/src/index.js
