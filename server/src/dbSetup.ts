import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function buildDatabaseUrlFromEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, 'utf8');
  const m = contents.match(/^DATABASE_URL=(?:"?)(.+?)(?:")?$/m);
  if (m && m[1]) process.env.DATABASE_URL = m[1];
}

function hasGeneratedClient() {
  const p = path.resolve(process.cwd(), 'node_modules', '.prisma', 'client');
  try {
    const stat = fs.statSync(p);
    if (!stat.isDirectory()) return false;
    const files = fs.readdirSync(p);
    return files.length > 0;
  } catch (e) {
    return false;
  }
}

function runCommand(cmd: string) {
  execSync(cmd, { stdio: 'inherit' });
}

function generateClientWithRetries(attempts = 3, delayMs = 1000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      console.log(`Running 'prisma generate' (attempt ${i}/${attempts})`);
      runCommand('npx prisma generate --schema=prisma/schema.prisma');
      return;
    } catch (err: any) {
      console.warn(`prisma generate failed on attempt ${i}:`, err?.message || err);
      if (i === attempts) throw err;
      // small delay before retrying
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
}

function shouldGeneratePrismaClient() {
  const isProd = process.env.NODE_ENV === 'production';
  const forceGenerate = /^1|true$/i.test(String(process.env.FORCE_PRISMA_GENERATE || ''));
  if (forceGenerate) return true;
  // In production images we already generate Prisma client at build time.
  // Re-generating at runtime as a non-root UID can fail on node_modules ownership.
  if (isProd && hasGeneratedClient()) return false;
  return true;
}

export async function ensureDatabaseReady() {
  // ensure DATABASE_URL is present if set in .env
  if (!process.env.DATABASE_URL) buildDatabaseUrlFromEnvFile();

  // Ensure Prisma client is generated before importing/using it to avoid Windows file locks.
  // We run this on every startup so schema changes don't leave a stale client in node_modules.
  try {
    // Make sure DATABASE_URL is set via helper script if DB_* env vars are provided
    try {
      runCommand('node ./server/scripts/set-database-url.js');
    } catch (e) {
      // ignore - script exits 0 when DATABASE_URL present
    }

    const hasClient = hasGeneratedClient();
    if (hasClient) {
      console.log('Prisma client exists.');
    }

    if (shouldGeneratePrismaClient()) {
      if (hasClient) console.log('Regenerating Prisma client to ensure it matches schema...');
      else console.log('Prisma client missing; generating...');
      generateClientWithRetries();
    } else {
      console.log('Skipping prisma generate in production (using build-time generated client). Set FORCE_PRISMA_GENERATE=1 to override.');
    }
  } catch (genErr) {
    const msg = String((genErr as any)?.message || genErr || '');
    const isEacces = /EACCES|permission denied/i.test(msg);
    if (isEacces && hasGeneratedClient()) {
      console.warn('Prisma generate hit a permissions error, but an existing generated client is available. Continuing startup with existing client.');
    } else {
      console.error('Failed to generate Prisma client:', genErr);
      // If generation fails and no usable client exists, we can't safely continue.
      throw genErr;
    }
  }

  // Now attempt to apply migrations or push schema and fallback if needed
  try {
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
      // In development, support an opt-in destructive reset. By default we **do not**
      // drop the DB on each start. Set `DEV_DB_RESET=1` (or `true`) to enable the
      // destructive `prisma migrate reset --force` behavior used during testing.
      const shouldReset = /^1|true$/i.test(String(process.env.DEV_DB_RESET || ''));
      if (shouldReset) {
        // This is intended for local dev only and will DROP existing data.
        try {
          console.log('Development mode: running `prisma migrate reset --force` to recreate schema');
          runCommand('npx prisma migrate reset --force');
          console.log('Database reset/applied via migrate reset.');
          // After reset, ensure the current Prisma schema is synchronized.
          try {
            console.log('Running `prisma db push` after reset to synchronize schema');
            runCommand('npx prisma db push');
            console.log('Database schema synchronized via db push.');
          } catch (pushErr) {
            console.warn('db push after reset failed:', pushErr?.message || pushErr);
          }
        } catch (resetErr) {
          console.warn('migrate reset failed, falling back to db push:', resetErr?.message || resetErr);
          runCommand('npx prisma db push');
          console.log('Database pushed via db push fallback.');
        }
      } else {
        // Non-destructive default: ensure the current Prisma schema is pushed to the DB.
        try {
          console.log('Development mode: skipping destructive reset. Running `prisma db push` to synchronize schema.');
          runCommand('npx prisma db push');
          console.log('Database pushed via db push (non-destructive).');
        } catch (pushErr) {
          console.warn('db push in dev failed:', pushErr?.message || pushErr);
        }
      }
    } else {
      console.log('Attempting to apply migrations (production): migrate deploy => db push fallback');
      try {
        runCommand('npx prisma migrate deploy');
      } catch (deployErr) {
        console.warn('migrate deploy failed, falling back to db push:', deployErr?.message || deployErr);
        runCommand('npx prisma db push');
      }
      console.log('Database schema applied (migrate deploy or db push completed).');
    }
  } catch (mErr) {
    console.error('Failed to apply migrations or push schema:', mErr);
    throw mErr;
  }
}
