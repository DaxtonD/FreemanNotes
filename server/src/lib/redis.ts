import IORedis, { Redis, RedisOptions } from 'ioredis';

function envBool(name: string, fallback = false): boolean {
  const v = String(process.env[name] || '').trim().toLowerCase();
  if (!v) return fallback;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function required(name: string): string {
  const v = String(process.env[name] || '').trim();
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export function isReminderWorkerEnabled(): boolean {
  return envBool('ENABLE_REMINDER_WORKER', false);
}

export function isRedisPubSubEnabled(): boolean {
  return envBool('ENABLE_REDIS_PUBSUB', false);
}

export function getRedisConnectionOptions(requiredForFeature = true): RedisOptions {
  const host = requiredForFeature ? required('REDIS_HOST') : String(process.env.REDIS_HOST || '').trim();
  const portRaw = requiredForFeature ? required('REDIS_PORT') : String(process.env.REDIS_PORT || '').trim();

  const portNum = Number(portRaw || 0);
  if (!Number.isFinite(portNum) || portNum <= 0) {
    throw new Error('Invalid REDIS_PORT. Must be a positive integer.');
  }

  const password = String(process.env.REDIS_PASSWORD || '').trim() || undefined;

  return {
    host,
    port: Math.trunc(portNum),
    password,
    // Required for BullMQ worker internals.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };
}

export function createRedisClient(label: string, requiredForFeature = true): Redis {
  const opts = getRedisConnectionOptions(requiredForFeature);
  const client = new IORedis(opts);

  client.on('connect', () => {
    console.log(`[redis:${label}] connected to ${opts.host}:${opts.port}`);
  });
  client.on('ready', () => {
    console.log(`[redis:${label}] ready`);
  });
  client.on('error', (err) => {
    console.error(`[redis:${label}] error:`, err);
  });
  client.on('close', () => {
    console.warn(`[redis:${label}] connection closed`);
  });
  client.on('reconnecting', () => {
    console.warn(`[redis:${label}] reconnecting...`);
  });

  return client;
}
