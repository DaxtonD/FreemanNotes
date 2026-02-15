#!/usr/bin/env node

// Best-effort helper to ensure `DATABASE_URL` exists for Prisma.
// - If already set (env or .env), do nothing.
// - If DB_* vars exist, append DATABASE_URL to .env.
// This script is intentionally non-fatal and should exit 0.

const fs = require('fs');
const path = require('path');

function readEnvFile(envPath) {
  try {
    if (!fs.existsSync(envPath)) return '';
    return fs.readFileSync(envPath, 'utf8');
  } catch {
    return '';
  }
}

function hasDatabaseUrlInText(txt) {
  return /^\s*DATABASE_URL\s*=.+$/m.test(String(txt || ''));
}

function buildUrlFromDbVars() {
  const user = process.env.DB_USER || process.env.POSTGRES_USER || process.env.PGUSER;
  const pass = process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD;
  const host = process.env.DB_HOST || process.env.POSTGRES_HOST || process.env.PGHOST || 'localhost';
  const port = process.env.DB_PORT || process.env.POSTGRES_PORT || process.env.PGPORT || '5432';
  const name = process.env.DB_NAME || process.env.POSTGRES_DB || process.env.PGDATABASE;
  if (!user || !pass || !host || !name) return null;
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${name}`;
}

(async () => {
  try {
    if (process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim()) process.exit(0);

    const envPath = path.resolve(process.cwd(), '.env');
    const contents = readEnvFile(envPath);
    if (hasDatabaseUrlInText(contents)) process.exit(0);

    const url = buildUrlFromDbVars();
    if (!url) process.exit(0);

    const next = (contents && !contents.endsWith('\n')) ? (contents + '\n') : contents;
    fs.writeFileSync(envPath, `${next || ''}DATABASE_URL=${url}\n`, 'utf8');
    process.exit(0);
  } catch {
    process.exit(0);
  }
})();
