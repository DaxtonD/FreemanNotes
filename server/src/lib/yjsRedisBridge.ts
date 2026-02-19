import * as Y from 'yjs';
import { createRedisClient, isRedisPubSubEnabled } from './redis';

type BridgeMessage = {
  instanceId: string;
  docId: string;
  update: string; // base64
  ts: number;
};

const CHANNEL_PREFIX = 'yjs:doc:';
const PATTERN = `${CHANNEL_PREFIX}*`;
const REDIS_ORIGIN = { source: 'redis-bridge' };

export type YjsRedisBridge = {
  enabled: boolean;
  registerDoc: (docId: string, ydoc: Y.Doc) => void;
  unregisterDoc: (docId: string, ydoc?: Y.Doc) => void;
  shutdown: () => Promise<void>;
  redisOrigin: unknown;
};

export function createYjsRedisBridge(): YjsRedisBridge {
  if (!isRedisPubSubEnabled()) {
    return {
      enabled: false,
      registerDoc: () => {},
      unregisterDoc: () => {},
      shutdown: async () => {},
      redisOrigin: REDIS_ORIGIN,
    };
  }

  const instanceId = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const pub = createRedisClient('yjs-pub', true);
  const sub = createRedisClient('yjs-sub', true);

  const docs = new Map<string, Y.Doc>();
  const offMap = new Map<string, (update: Uint8Array, origin: unknown) => void>();

  const subscribePromise = sub.psubscribe(PATTERN).then(() => {
    console.log(`[yjsRedisBridge] subscribed to ${PATTERN} instanceId=${instanceId}`);
  }).catch((err) => {
    console.error('[yjsRedisBridge] subscribe failed:', err);
  });

  sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
    try {
      const payload = JSON.parse(String(message || '{}')) as BridgeMessage;
      if (!payload || payload.instanceId === instanceId) return;
      const docId = String(payload.docId || '').trim();
      if (!docId) return;
      const ydoc = docs.get(docId);
      if (!ydoc) return;
      const buf = Buffer.from(String(payload.update || ''), 'base64');
      if (!buf.length) return;
      // Apply with explicit origin to prevent publish loop.
      Y.applyUpdate(ydoc, new Uint8Array(buf), REDIS_ORIGIN);
    } catch (err) {
      console.warn('[yjsRedisBridge] invalid pubsub message:', err);
    }
  });

  const registerDoc = (docIdRaw: string, ydoc: Y.Doc) => {
    const docId = String(docIdRaw || '').trim();
    if (!docId) return;

    docs.set(docId, ydoc);

    // Rebind handler if already registered.
    const prev = offMap.get(docId);
    if (prev) {
      try { ydoc.off('update', prev as any); } catch {}
      offMap.delete(docId);
    }

    const onUpdate = (update: Uint8Array, origin: unknown) => {
      try {
        if (origin === REDIS_ORIGIN) return;
        const channel = `${CHANNEL_PREFIX}${docId}`;
        const msg: BridgeMessage = {
          instanceId,
          docId,
          update: Buffer.from(update).toString('base64'),
          ts: Date.now(),
        };
        void pub.publish(channel, JSON.stringify(msg));
      } catch (err) {
        console.warn('[yjsRedisBridge] publish failed:', err);
      }
    };

    ydoc.on('update', onUpdate as any);
    offMap.set(docId, onUpdate);
  };

  const unregisterDoc = (docIdRaw: string, ydoc?: Y.Doc) => {
    const docId = String(docIdRaw || '').trim();
    if (!docId) return;
    const current = ydoc || docs.get(docId);
    const off = offMap.get(docId);
    if (current && off) {
      try { current.off('update', off as any); } catch {}
    }
    offMap.delete(docId);
    docs.delete(docId);
  };

  const shutdown = async () => {
    try { await subscribePromise; } catch {}
    for (const [docId, ydoc] of docs.entries()) {
      unregisterDoc(docId, ydoc);
    }
    try { await sub.punsubscribe(PATTERN); } catch {}
    try { await pub.quit(); } catch {}
    try { await sub.quit(); } catch {}
  };

  return {
    enabled: true,
    registerDoc,
    unregisterDoc,
    shutdown,
    redisOrigin: REDIS_ORIGIN,
  };
}
