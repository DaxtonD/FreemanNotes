#!/usr/bin/env node

/*
  Ensure target Postgres database exists. Non-fatal helper used during
  development startup so `npm run dev` can create a fresh DB automatically.

  Behavior:
  - Reads DATABASE_URL from env or .env
  - Attempts to connect to the target database. If successful, exits 0.
  - If connection fails with database-not-found, attempts to connect to the
    maintenance DB (`postgres` or `template1`) using same credentials and
    issues `CREATE DATABASE` for the target name. If creation succeeds,
    exits 0. Otherwise logs and exits 0 (non-fatal).

  This script tolerates missing privileges and non-reachable servers and is
  intentionally non-fatal (returns 0) so local dev startup can continue with
  informative logs.
*/

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, 'utf8');
  const m = contents.match(/^DATABASE_URL=(?:"?)(.+?)(?:")?$/m);
  if (m && m[1]) process.env.DATABASE_URL = m[1];
}

function parseDatabaseUrl(dsn) {
  try {
    const u = new URL(dsn);
    const db = u.pathname ? u.pathname.replace(/^\//, '') : '';
    return {
      host: u.hostname,
      port: u.port || '5432',
      user: u.username,
      password: u.password,
      database: db,
      ssl: u.searchParams.get('sslmode') === 'require' || false,
    };
  } catch (e) { return null; }
}

async function tryConnect(cfg) {
  const c = new Client({
    host: cfg.host,
    port: Number(cfg.port || 5432),
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    statement_timeout: 5000,
  });
  try {
    await c.connect();
    await c.end();
    return { ok: true };
  } catch (err) {
    try { await c.end(); } catch (e) {}
    return { ok: false, error: err };
  }
}

async function createDatabaseIfMissing(cfg) {
  const target = cfg.database;
  const maintenanceDbCandidates = ['postgres', 'template1'];
  for (const m of maintenanceDbCandidates) {
    const tryCfg = Object.assign({}, cfg, { database: m });
    const res = await tryConnect(tryCfg);
    if (!res.ok) continue;
    const client = new Client({ host: tryCfg.host, port: Number(tryCfg.port), user: tryCfg.user, password: tryCfg.password, database: tryCfg.database, ssl: tryCfg.ssl ? { rejectUnauthorized: false } : false });
    try {
      await client.connect();
      // Use quoted identifier to preserve casing if provided
      const quoted = '"' + target.replace(/"/g, '""') + '"';
      const quotedOwner = cfg.user ? ' TO "' + cfg.user.replace(/"/g, '""') + '"' : '';
      const sql = `SELECT 1 FROM pg_database WHERE datname = $1`;
      const r = await client.query(sql, [target]);
      if (r && r.rows && r.rows.length > 0) {
        await client.end();
        return { created: false, reason: 'already_exists' };
      }
      console.log(`Creating database ${target} via maintenance DB ${tryCfg.database}...`);
      await client.query(`CREATE DATABASE ${quoted}${quotedOwner}`);
      await client.end();
      return { created: true };
    } catch (err) {
      try { await client.end(); } catch (e) {}
      return { created: false, error: err };
    }
  }
  return { created: false, error: new Error('no maintenance DB reachable') };
}

(async function main() {
  try {
    if (!process.env.DATABASE_URL) loadEnvFile();
    const dsn = process.env.DATABASE_URL;
    if (!dsn) {
      console.warn('ensure-database: no DATABASE_URL found; skipping');
      process.exit(0);
    }
    const cfg = parseDatabaseUrl(dsn);
    if (!cfg || !cfg.database) {
      console.warn('ensure-database: failed to parse DATABASE_URL; skipping');
      process.exit(0);
    }

    // Try connecting to the target DB first
    const res = await tryConnect(cfg);
    if (res.ok) {
      console.log(`ensure-database: target database '${cfg.database}' is reachable.`);
      process.exit(0);
    }

    const err = res.error;
    const msg = String(err && err.message || err || '');
    // PostgreSQL error code for invalid_catalog_name = 3D000
    const code = err && err.code;
    if (code === '3D000' || /does not exist/i.test(msg) || /invalid_catalog_name/i.test(msg)) {
      console.log(`ensure-database: database '${cfg.database}' does not exist. Attempting to create it...`);
      const created = await createDatabaseIfMissing(cfg);
      if (created && created.created) {
        console.log(`ensure-database: created database '${cfg.database}'.`);
      } else if (created && created.reason === 'already_exists') {
        console.log(`ensure-database: database '${cfg.database}' already exists (race).`);
      } else {
        console.warn('ensure-database: could not create database:', created && (created.error || created.reason));
      }
      process.exit(0);
    }

    console.warn('ensure-database: connection to target DB failed:', msg);
    process.exit(0);
  } catch (e) {
    console.warn('ensure-database: unexpected error:', e && e.message || e);
    process.exit(0);
  }
})();
