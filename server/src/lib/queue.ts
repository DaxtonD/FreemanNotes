import { Queue, QueueOptions } from 'bullmq';
import { getRedisConnectionOptions } from './redis';

export const REMINDER_QUEUE_NAME = 'reminderQueue';
export const REMINDER_JOB_NAME = 'sendReminder';

let reminderQueue: Queue | null = null;

function getQueueOptions(): QueueOptions {
  return {
    connection: getRedisConnectionOptions(true),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: true,
      removeOnFail: 500,
    },
  };
}

export function getReminderQueue(): Queue {
  if (reminderQueue) return reminderQueue;
  reminderQueue = new Queue(REMINDER_QUEUE_NAME, getQueueOptions());
  return reminderQueue;
}

function reminderJobId(noteId: number): string {
  return `note:${Number(noteId)}`;
}

export async function upsertReminderJob(noteId: number, reminderAt: Date | string | null | undefined): Promise<void> {
  const id = Number(noteId);
  if (!Number.isFinite(id) || id <= 0) return;

  const queue = getReminderQueue();
  const atMs = reminderAt ? new Date(reminderAt as any).getTime() : 0;
  if (!Number.isFinite(atMs) || atMs <= 0) {
    await removeReminderJob(id);
    return;
  }

  const delayMs = Math.max(0, atMs - Date.now());
  const jobId = reminderJobId(id);

  try {
    const existing = await queue.getJob(jobId);
    if (existing) {
      try { await existing.remove(); } catch {}
    }
  } catch {}

  await queue.add(
    REMINDER_JOB_NAME,
    { noteId: id },
    {
      jobId,
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    }
  );

  console.log(`[reminderQueue] scheduled job for noteId=${id} delayMs=${delayMs}`);
}

export async function removeReminderJob(noteId: number): Promise<void> {
  const id = Number(noteId);
  if (!Number.isFinite(id) || id <= 0) return;
  const queue = getReminderQueue();
  const jobId = reminderJobId(id);
  try {
    const existing = await queue.getJob(jobId);
    if (existing) {
      await existing.remove();
      console.log(`[reminderQueue] removed job for noteId=${id}`);
    }
  } catch (err) {
    console.warn(`[reminderQueue] failed removing job for noteId=${id}:`, err);
  }
}

export async function resyncReminderJobs(prisma: any): Promise<void> {
  const rows = await prisma.note.findMany({
    where: {
      reminderAt: { not: null },
      reminderNotifiedAt: null,
      reminderDueAt: { not: null },
      trashedAt: null,
      archived: false,
    },
    select: { id: true, reminderAt: true },
  });

  for (const row of rows) {
    try {
      await upsertReminderJob(Number(row.id), row.reminderAt as any);
    } catch (err) {
      console.warn('[reminderQueue] resync enqueue failed:', err);
    }
  }

  console.log(`[reminderQueue] resync complete. jobsScheduled=${rows.length}`);
}

export async function closeReminderQueue(): Promise<void> {
  if (!reminderQueue) return;
  try {
    await reminderQueue.close();
  } finally {
    reminderQueue = null;
  }
}
