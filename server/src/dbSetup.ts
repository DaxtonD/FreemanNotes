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
      runCommand('npx prisma generate');
      return;
    } catch (err: any) {
      console.warn(`prisma generate failed on attempt ${i}:`, err?.message || err);
      if (i === attempts) throw err;
      // small delay before retrying
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
}

export async function ensureDatabaseReady() {
  // ensure DATABASE_URL is present if set in .env
  if (!process.env.DATABASE_URL) buildDatabaseUrlFromEnvFile();

  // Ensure Prisma client is generated before importing/using it to avoid Windows file locks
  if (!hasGeneratedClient()) {
    try {
      // DATABASE_URL must be provided via environment or .env; deprecated helper removed

      generateClientWithRetries();
    } catch (genErr) {
      console.error('Failed to generate Prisma client:', genErr);
      // If generation fails, we can't safely continue using Prisma
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
