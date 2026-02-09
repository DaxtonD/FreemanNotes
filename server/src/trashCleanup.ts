import { notifyUser } from './events';

function clampDays(v: any): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const d = Math.trunc(n);
  return Math.max(0, Math.min(3650, d));
}

async function getParticipantIdsForNote(prisma: any, noteId: number, ownerId: number): Promise<number[]> {
  try {
    const collabs = await prisma.collaborator.findMany({ where: { noteId }, select: { userId: true } });
    return Array.from(new Set<number>([
      Number(ownerId),
      ...collabs.map((c: any) => Number(c.userId)).filter((id: any) => Number.isFinite(id)),
    ]));
  } catch {
    return [Number(ownerId)].filter((id) => Number.isFinite(id));
  }
}

async function hardDeleteNote(prisma: any, noteId: number): Promise<void> {
  await prisma.$transaction([
    prisma.noteItem.deleteMany({ where: { noteId } }),
    prisma.noteImage.deleteMany({ where: { noteId } }),
    prisma.noteLabel.deleteMany({ where: { noteId } }),
    prisma.collaborator.deleteMany({ where: { noteId } }),
    prisma.notePref.deleteMany({ where: { noteId } }),
    prisma.noteCollection.deleteMany({ where: { noteId } }),
    prisma.note.delete({ where: { id: noteId } }),
  ]);
}

export async function runTrashCleanupOnce(prisma: any): Promise<{ purgedNotes: number }>{
  const now = Date.now();
  let purgedNotes = 0;

  const users = await prisma.user.findMany({
    where: { trashAutoEmptyDays: { gt: 0 } },
    select: { id: true, trashAutoEmptyDays: true },
  });

  for (const u of users) {
    const days = clampDays(u.trashAutoEmptyDays);
    if (days <= 0) continue;
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);

    const candidates = await prisma.note.findMany({
      where: {
        ownerId: Number(u.id),
        trashedAt: { not: null, lte: cutoff },
      },
      select: { id: true, ownerId: true },
      take: 500,
    });

    for (const n of candidates) {
      const noteId = Number(n.id);
      if (!Number.isFinite(noteId)) continue;

      const participants = await getParticipantIdsForNote(prisma, noteId, Number(n.ownerId));
      try {
        await hardDeleteNote(prisma, noteId);
        purgedNotes++;
        try {
          for (const uid of participants) notifyUser(uid, 'note-deleted', { noteId });
        } catch {}
      } catch {
        // Keep going; next cleanup run may succeed.
      }
    }
  }

  return { purgedNotes };
}

export function startTrashCleanupJob(prisma: any, opts?: { intervalMs?: number; immediate?: boolean }) {
  const intervalMs = (opts && typeof opts.intervalMs === 'number' && Number.isFinite(opts.intervalMs) && opts.intervalMs > 10_000)
    ? Math.trunc(opts.intervalMs)
    : 6 * 60 * 60 * 1000; // 6 hours

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runTrashCleanupOnce(prisma);
    } catch {
      // ignore
    } finally {
      running = false;
    }
  };

  if (opts?.immediate) {
    tick();
  }

  const timer = setInterval(tick, intervalMs);
  try { (timer as any).unref?.(); } catch {}
  return timer;
}
