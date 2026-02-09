import { Router, Request, Response } from 'express';
import prisma from './prismaClient';
import jwt from 'jsonwebtoken';
import webpush from 'web-push';
import { createHash } from 'crypto';

const router = Router();

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not set in environment');
  return s;
}

async function getUserFromToken(req: Request) {
  const auth = req.headers.authorization;
  let token: string | null = null;
  if (auth && auth.startsWith('Bearer ')) token = auth.slice(7);
  else if (typeof req.query?.token === 'string' && req.query.token.length > 0) token = String(req.query.token);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getJwtSecret()) as any;
    if (!payload?.userId) return null;
    return await prisma.user.findUnique({ where: { id: Number(payload.userId) } });
  } catch {
    return null;
  }
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(String(s || ''), 'utf8').digest('hex');
}

function getVapidConfig(): { enabled: boolean; publicKey: string | null; reason?: string } {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (process.env.VAPID_SUBJECT || 'mailto:admin@localhost').trim();
  if (!publicKey || !privateKey) {
    return { enabled: false, publicKey: publicKey || null, reason: 'Missing VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY' };
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return { enabled: true, publicKey };
  } catch (err) {
    return { enabled: false, publicKey: publicKey || null, reason: String(err) };
  }
}

function normalizeSubscription(body: any): { endpoint: string; p256dh: string; auth: string } | null {
  const endpoint = String(body?.endpoint || '').trim();
  const keys = body?.keys || {};
  const p256dh = String(keys?.p256dh || '').trim();
  const auth = String(keys?.auth || '').trim();
  if (!endpoint || !p256dh || !auth) return null;
  if (endpoint.length > 4096) return null;
  if (p256dh.length > 512 || auth.length > 512) return null;
  return { endpoint, p256dh, auth };
}

router.get('/api/push/public-key', async (_req: Request, res: Response) => {
  const cfg = getVapidConfig();
  res.json({ enabled: cfg.enabled, publicKey: cfg.publicKey, reason: cfg.reason || null });
});

router.post('/api/push/subscribe', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });

  const cfg = getVapidConfig();
  if (!cfg.enabled) return res.status(501).json({ error: 'push_not_configured', reason: cfg.reason || 'Push not configured' });

  const sub = normalizeSubscription((req.body || {}).subscription ?? req.body);
  if (!sub) return res.status(400).json({ error: 'invalid_subscription' });

  const deviceKeyRaw = (req.headers['x-device-key'] ?? req.headers['x-device-id']) as any;
  const deviceKey = (typeof deviceKeyRaw === 'string' ? deviceKeyRaw : Array.isArray(deviceKeyRaw) ? deviceKeyRaw[0] : '').trim();
  const dk = (deviceKey && deviceKey.length <= 128) ? deviceKey : null;

  const endpointHash = sha256Hex(sub.endpoint);

  try {
    const prismaAny = prisma as any;
    // Upsert via unique compound key (userId+endpointHash)
    const existing = await prismaAny.pushSubscription.findFirst({ where: { userId: user.id, endpointHash } });
    if (existing?.id) {
      await prismaAny.pushSubscription.update({
        where: { id: Number(existing.id) },
        data: {
          deviceKey: dk,
          endpoint: sub.endpoint,
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      });
    } else {
      await prismaAny.pushSubscription.create({
        data: {
          userId: user.id,
          deviceKey: dk,
          endpointHash,
          endpoint: sub.endpoint,
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed_to_store_subscription', detail: String(err) });
  }
});

router.post('/api/push/unsubscribe', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });

  const endpoint = String((req.body || {}).endpoint || '').trim();
  if (!endpoint) return res.status(400).json({ error: 'missing_endpoint' });
  const endpointHash = sha256Hex(endpoint);

  try {
    const prismaAny = prisma as any;
    await prismaAny.pushSubscription.deleteMany({ where: { userId: user.id, endpointHash } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed_to_remove_subscription', detail: String(err) });
  }
});

router.post('/api/push/test', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });

  const cfg = getVapidConfig();
  if (!cfg.enabled) return res.status(501).json({ error: 'push_not_configured', reason: cfg.reason || 'Push not configured' });

  const prismaAny = prisma as any;
  const subs = await prismaAny.pushSubscription.findMany({ where: { userId: user.id } });
  if (!subs.length) return res.status(400).json({ error: 'no_subscriptions' });

  const payload = {
    type: 'test',
    title: 'FreemanNotes',
    body: String((req.body || {}).body || 'Test notification'),
    url: '/',
  };

  const results: Array<{ id: number; ok: boolean; error?: string }> = [];
  for (const s of subs) {
    const id = Number(s.id);
    try {
      await webpush.sendNotification(
        {
          endpoint: String(s.endpoint),
          keys: { p256dh: String(s.p256dh), auth: String(s.auth) },
        } as any,
        JSON.stringify(payload),
        { TTL: 60, urgency: 'high' as any }
      );
      results.push({ id, ok: true });
    } catch (err: any) {
      const msg = String(err?.body || err?.message || err);
      results.push({ id, ok: false, error: msg });
      // Prune expired subscriptions.
      const status = Number(err?.statusCode || err?.status || 0);
      if (status === 404 || status === 410) {
        try { await prismaAny.pushSubscription.delete({ where: { id } }); } catch {}
      }
    }
  }

  res.json({ ok: true, count: subs.length, results });
});

export default router;
