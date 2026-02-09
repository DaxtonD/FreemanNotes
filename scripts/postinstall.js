#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');

const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const hasDatabaseUrl = !!process.env.DATABASE_URL;

const skipPrisma = /^1|true$/i.test(String(process.env.SKIP_PRISMA_POSTINSTALL || ''));
const hasSchema = fs.existsSync('prisma/schema.prisma');

if (skipPrisma) {
  console.log('[postinstall] SKIP_PRISMA_POSTINSTALL set; skipping Prisma steps.');
  process.exit(0);
}

if (!hasSchema) {
  // Docker build stage installs deps before copying the full repo.
  console.log('[postinstall] prisma/schema.prisma not found; skipping Prisma steps.');
  process.exit(0);
}

console.log('[postinstall] Running Prisma generate...');
const gen = spawnSync('npx', ['prisma', 'generate', '--schema=prisma/schema.prisma'], {
  stdio: 'inherit',
  shell: true,
});
if (gen.status) process.exit(gen.status);

if (isCI || !hasDatabaseUrl) {
  console.log('[postinstall] Skipping Prisma db push (CI or missing DATABASE_URL).');
  process.exit(0);
}

console.log('[postinstall] Running Prisma db push...');
const push = spawnSync('npx', ['prisma', 'db', 'push', '--schema=prisma/schema.prisma'], {
  stdio: 'inherit',
  shell: true,
});

process.exit(push.status || 0);
