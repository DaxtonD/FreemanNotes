#!/usr/bin/env node
const { spawnSync } = require('child_process');

const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const hasDatabaseUrl = !!process.env.DATABASE_URL;

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
