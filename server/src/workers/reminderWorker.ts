import { Job, Worker } from 'bullmq';
import webpush from 'web-push';
import { REMINDER_JOB_NAME, REMINDER_QUEUE_NAME } from '../lib/queue';
import { getRedisConnectionOptions, isReminderWorkerEnabled } from '../lib/redis';

let worker: Worker | null = null;

function getVapidConfig(): { enabled: boolean; reason?: string } {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (process.env.VAPID_SUBJECT || 'mailto:admin@localhost').trim();
  if (!publicKey || !privateKey) {
    return { enabled: false, reason: 'Missing VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY' };
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return { enabled: true };
  } catch (err) {
    return { enabled: false, reason: String(err) };
  }
}

function formatDue(d: Date | null): string {
  if (!d) return '';
  try { return d.toLocaleString(); } catch { return d.toISOString(); }
}

async function processReminderJob(prisma: any, job: Job): Promise<void> {
  const noteId = Number((job.data as any)?.noteId);
  if (!Number.isFinite(noteId) || noteId <= 0) return;

  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: {
      id: true,
      title: true,
      reminderDueAt: true,
      reminderAt: true,
      reminderNotifiedAt: true,
      ownerId: true,
      trashedAt: true,
      archived: true,
    },
  });

  if (!note) return;
  if (note.trashedAt || note.archived) return;
  if (!note.reminderAt || !note.reminderDueAt) return;
  if (note.reminderNotifiedAt) return;

  const now = new Date();
  if (new Date(note.reminderAt as any).getTime() > now.getTime() + 500) {
    // Defensive: if job fired early, let retry scheduling handle it naturally.
    throw new Error('Reminder job fired before reminderAt');
  }

  const cfg = getVapidConfig();
  if (!cfg.enabled) {
    console.warn('[reminderWorker] push disabled:', cfg.reason || 'not configured');
    return;
  }

  const subs = await prisma.pushSubscription.findMany({
    where: { userId: Number(note.ownerId) },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  const title = String(note.title || 'Reminder');
  const body = note.reminderDueAt ? `Due: ${formatDue(new Date(note.reminderDueAt as any))}` : 'Reminder';
  const payload = JSON.stringify({
    type: 'reminder',
    title,
    body,
    url: '/',
    noteId: Number(note.id),
  });

  for (const s of subs) {
    const id = Number(s.id);
    try {
      await webpush.sendNotification(
        {
          endpoint: String(s.endpoint),
          keys: { p256dh: String(s.p256dh), auth: String(s.auth) },
        } as any,
        payload,
        { TTL: 60 * 60, urgency: 'high' as any }
      );
    } catch (err: any) {
      const status = Number(err?.statusCode || err?.status || 0);
      if (status === 404 || status === 410) {
        try { await prisma.pushSubscription.delete({ where: { id } }); } catch {}
      } else {
        throw err;
      }
    }
  }

  await prisma.note.update({ where: { id: Number(note.id) }, data: { reminderNotifiedAt: now } });
  console.log(`[reminderWorker] delivered reminder noteId=${noteId}`);
}

export function startReminderWorker(prisma: any): Worker | null {
  if (!isReminderWorkerEnabled()) {
    console.log('[reminderWorker] disabled (ENABLE_REMINDER_WORKER != true)');
    return null;
  }
  if (worker) return worker;

  worker = new Worker(
    REMINDER_QUEUE_NAME,
    async (job) => {
      if (job.name !== REMINDER_JOB_NAME) return;
      await processReminderJob(prisma, job);
    },
    {
      connection: getRedisConnectionOptions(true),
      concurrency: 5,
    }
  );

  worker.on('ready', () => {
    console.log('[reminderWorker] ready');
  });
  worker.on('completed', (job) => {
    console.log(`[reminderWorker] completed job id=${job.id} name=${job.name}`);
  });
  worker.on('failed', (job, err) => {
    console.error(`[reminderWorker] failed job id=${job?.id} name=${job?.name}:`, err);
  });
  worker.on('error', (err) => {
    console.error('[reminderWorker] worker error:', err);
  });

  return worker;
}

export async function stopReminderWorker(): Promise<void> {
  if (!worker) return;
  try {
    await worker.close();
  } finally {
    worker = null;
  }
}
