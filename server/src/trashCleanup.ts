import { notifyUser } from './events';
import { getUploadsDir } from './uploads';
import * as fsp from 'fs/promises';
import path from 'path';

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
  const note = await prisma.note.findUnique({ where: { id: noteId }, select: { ownerId: true } });
  const ownerId = Number(note?.ownerId);
  const imgs = await prisma.noteImage.findMany({ where: { noteId }, select: { url: true } });
  const urls = (imgs || []).map((i: any) => String(i?.url || '')).filter(Boolean);

  await prisma.$transaction([
    prisma.noteItem.deleteMany({ where: { noteId } }),
    prisma.noteImage.deleteMany({ where: { noteId } }),
    prisma.noteLabel.deleteMany({ where: { noteId } }),
    prisma.collaborator.deleteMany({ where: { noteId } }),
    prisma.notePref.deleteMany({ where: { noteId } }),
    prisma.noteCollection.deleteMany({ where: { noteId } }),
    prisma.note.delete({ where: { id: noteId } }),
  ]);

  // Best-effort: remove uploaded image files for this note.
  try {
    if (Number.isFinite(ownerId)) {
      await cleanupNoteUploadsForUrls(prisma, { ownerId, noteId, urls });
    }
  } catch {}
}

function stripUrlQueryAndHash(u: string): string {
  const s = String(u || '');
  const q = s.indexOf('?');
  const h = s.indexOf('#');
  const cut = (q === -1) ? h : (h === -1 ? q : Math.min(q, h));
  return cut === -1 ? s : s.slice(0, cut);
}

function isPathInside(parent: string, child: string): boolean {
  const parentResolved = path.resolve(parent);
  const childResolved = path.resolve(child);

  const parentCmp = process.platform === 'win32' ? parentResolved.toLowerCase() : parentResolved;
  const childCmp = process.platform === 'win32' ? childResolved.toLowerCase() : childResolved;
  if (parentCmp === childCmp) return true;
  const sep = path.sep;
  return childCmp.startsWith(parentCmp.endsWith(sep) ? parentCmp : parentCmp + sep);
}

function uploadsAbsPathFromRel(relPosix: string): string | null {
  const rel = path.posix.normalize(String(relPosix || '').replace(/\\/g, '/'));
  if (!rel || rel === '.' || rel.startsWith('..') || rel.includes('/../')) return null;
  const uploadsDir = getUploadsDir();
  const abs = path.join(uploadsDir, ...rel.split('/'));
  if (!isPathInside(uploadsDir, abs)) return null;
  return abs;
}

async function cleanupNoteUploadsForUrls(prisma: any, opts: { ownerId: number; noteId: number; urls: string[] }): Promise<void> {
  const ownerId = Number(opts.ownerId);
  const noteId = Number(opts.noteId);
  if (!Number.isFinite(ownerId) || !Number.isFinite(noteId)) return;

  const prefix = `/uploads/notes/${ownerId}/${noteId}/`;
  const seen = new Set<string>();

  for (const raw of (opts.urls || [])) {
    const url = stripUrlQueryAndHash(String(raw || '').trim());
    if (!url || seen.has(url)) continue;
    seen.add(url);

    if (!url.startsWith(prefix)) continue;
    const rel = url.slice('/uploads/'.length);
    const abs = uploadsAbsPathFromRel(rel);
    if (!abs) continue;

    // If some other note still references the exact same URL, don't delete.
    try {
      const remaining = await prisma.noteImage.findFirst({ where: { url }, select: { id: true } });
      if (remaining) continue;
    } catch {
      continue;
    }

    try {
      await fsp.unlink(abs);
    } catch {}
  }

  try {
    const uploadsDir = getUploadsDir();
    const noteDir = path.join(uploadsDir, 'notes', String(ownerId), String(noteId));
    if (!isPathInside(uploadsDir, noteDir)) return;
    const entries = await fsp.readdir(noteDir).catch(() => [] as any);
    if (Array.isArray(entries) && entries.length === 0) {
      await fsp.rmdir(noteDir).catch(() => {});
    }
  } catch {}
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
