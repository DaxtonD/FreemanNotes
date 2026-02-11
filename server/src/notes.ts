import { Router, Request, Response } from "express";
import prisma from "./prismaClient";
import jwt from "jsonwebtoken";
import * as Y from "yjs";
import { notifyUser } from "./events";
import { scrapeLinkPreview } from "./linkPreview";
import { createHash } from "crypto";
import { enqueueNoteImageOcr } from "./ocr/ocrQueue";
import { getUploadsDir } from './uploads';
import * as fsp from 'fs/promises';
import path from 'path';

const router = Router();

async function getParticipantIdsForNote(noteId: number, note?: { ownerId: number } | null): Promise<number[]> {
  try {
    const n = note || await prisma.note.findUnique({ where: { id: noteId }, select: { ownerId: true } });
    if (!n) return [];
    const collabs = await prisma.collaborator.findMany({ where: { noteId }, select: { userId: true } });
    return Array.from(new Set<number>([
      Number(n.ownerId),
      ...collabs.map(c => Number(c.userId)).filter((id) => Number.isFinite(id)),
    ]));
  } catch {
    return [];
  }
}

async function hardDeleteNote(noteId: number): Promise<void> {
  const note = await prisma.note.findUnique({ where: { id: noteId }, select: { ownerId: true } });
  const ownerId = Number((note as any)?.ownerId);
  const imgs = await prisma.noteImage.findMany({ where: { noteId }, select: { url: true } });
  const urls = (imgs || []).map((i: any) => String(i?.url || '')).filter(Boolean);

  // Delete dependent rows first (some relations are not cascading).
  await prisma.$transaction([
    prisma.noteItem.deleteMany({ where: { noteId } }),
    prisma.noteImage.deleteMany({ where: { noteId } }),
    prisma.noteLabel.deleteMany({ where: { noteId } }),
    prisma.collaborator.deleteMany({ where: { noteId } }),
    (prisma as any).notePref.deleteMany({ where: { noteId } }),
    (prisma as any).noteCollection.deleteMany({ where: { noteId } }),
    prisma.note.delete({ where: { id: noteId } }),
  ]);

  // Best-effort: remove uploaded image files for this note.
  // Keep this post-transaction so DB deletion can't be blocked by file IO.
  try {
    if (Number.isFinite(ownerId)) {
      await cleanupNoteUploadsForUrls({ ownerId, noteId, urls });
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

  // Windows is case-insensitive by default.
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

async function cleanupNoteUploadsForUrls(opts: { ownerId: number; noteId: number; urls: string[] }): Promise<void> {
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
    const rel = url.slice('/uploads/'.length); // safe because prefix starts with /uploads/
    const abs = uploadsAbsPathFromRel(rel);
    if (!abs) continue;

    // If some other note still references the exact same URL, don't delete.
    try {
      const remaining = await prisma.noteImage.findFirst({ where: { url } , select: { id: true } });
      if (remaining) continue;
    } catch {
      // If we can't check, be conservative and keep the file.
      continue;
    }

    try {
      await fsp.unlink(abs);
    } catch {
      // ignore missing/unlink errors
    }
  }

  // Optional best-effort cleanup: remove the note directory if it is empty.
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

function parseDateTimeMaybe(v: any): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const s = String(v || '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function clampInt(v: any, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function stripHtmlToText(html: any): string {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function computeReminderAt(dueAt: Date, offsetMinutes: number): Date {
  const ms = dueAt.getTime() - (offsetMinutes * 60 * 1000);
  return new Date(ms);
}

function hashUrl(url: string): string {
  return createHash('sha256').update(String(url || '').trim()).digest('hex');
}

function isDataUrlImage(s: string): boolean {
  return /^data:image\/[^;]+;base64,/i.test(String(s || ''));
}

function parseDataUrlImage(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const m = String(dataUrl || '').match(/^data:(image\/[^;]+);base64,(.+)$/i);
  if (!m) return null;
  try {
    return { mime: String(m[1] || 'image/octet-stream'), buffer: Buffer.from(String(m[2] || ''), 'base64') };
  } catch {
    return null;
  }
}

function extFromMime(mime: string): string {
  const m = String(mime || '').toLowerCase();
  if (m === 'image/jpeg') return 'jpg';
  if (m === 'image/jpg') return 'jpg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/gif') return 'gif';
  if (m === 'image/bmp') return 'bmp';
  return 'bin';
}

async function persistNoteImageDataUrl(opts: { dataUrl: string; ownerId: number; noteId: number; imageId?: number }): Promise<string | null> {
  try {
    const parsed = parseDataUrlImage(opts.dataUrl);
    if (!parsed) return null;
    if (!parsed.buffer || parsed.buffer.length < 8) return null;

    const sha = createHash('sha256').update(parsed.buffer).digest('hex');
    const ext = extFromMime(parsed.mime);
    const base = `${opts.imageId ? `${opts.imageId}-` : ''}${sha.slice(0, 16)}.${ext}`;
    const rel = path.posix.join('notes', String(opts.ownerId), String(opts.noteId), base);

    const uploadsDir = getUploadsDir();
    const abs = path.join(uploadsDir, ...rel.split('/'));
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, parsed.buffer);
    return `/uploads/${rel}`;
  } catch {
    return null;
  }
}

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not set in environment");
  return s;
}

async function getUserFromToken(req: Request) {
  // Accept Authorization header or dev-only ?token= query param for quick testing
  const auth = req.headers.authorization;
  let token: string | null = null;
  if (auth && auth.startsWith("Bearer ")) token = auth.slice(7);
  else if (typeof req.query?.token === 'string' && req.query.token.length > 0) token = String(req.query.token);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getJwtSecret()) as any;
    if (!payload?.userId) return null;
    const user = await prisma.user.findUnique({ where: { id: Number(payload.userId) } });
    return user;
  } catch (err) {
    return null;
  }
}

// list notes for current user (owner or collaborator)
router.get('/api/notes', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const notes = await (prisma as any).note.findMany({
      where: {
        OR: [
          { ownerId: user.id },
          { collaborators: { some: { userId: user.id } } }
        ]
      },
        include: {
        collaborators: { include: { user: true } },
        owner: true,
        items: true,
        _count: { select: { images: true } },
        // Include OCR fields for global search, but omit `url` to avoid huge payloads
        // when legacy images are stored as base64 data URLs.
        images: { select: { id: true, ocrStatus: true, ocrText: true, ocrSearchText: true, createdAt: true } },
        linkPreviews: { orderBy: { createdAt: 'asc' } },
          noteCollections: {
          where: { userId: user.id },
          include: { collection: { select: { id: true, name: true, parentId: true } } },
          },
          noteLabels: { where: { label: { ownerId: user.id } }, include: { label: true } },
          notePrefs: { where: { userId: user.id } }
      },
        // Default ordering:
        // 1) `ord` for manual drag-reorder
        // 2) `createdAt` so notes remain in creation order by default
        orderBy: [{ ord: 'asc' }, { createdAt: 'desc' }]
    });
    // ensure checklist items are returned in ord order
      const normalized = (notes as any[]).map((n: any) => {
        const isOwnerView = Number(n.ownerId) === Number(user.id);
        // Prefer authoritative Yjs snapshot for checklist items when available.
        // This prevents stale/ghost DB rows from briefly appearing before the client finishes Yjs sync.
        let itemsFromDb = (n.items || []).slice().sort((a: any, b: any) => (a.ord || 0) - (b.ord || 0));
        try {
          if (String(n.type || '') === 'CHECKLIST') {
            const buf = n.yData as unknown as Buffer | null;
            if (buf && (buf as any).length) {
              const ydoc = new Y.Doc();
              Y.applyUpdate(ydoc, new Uint8Array(buf as any));
              const yarr = ydoc.getArray<Y.Map<any>>('checklist');
              if (yarr) {
                // Important: trust the snapshot even when it's empty, so we don't fall back
                // to stale DB rows.
                itemsFromDb = yarr.toArray().map((m: any, idx: number) => ({
                  id: (typeof m.get('id') === 'number' ? Number(m.get('id')) : undefined),
                  content: String(m.get('content') || ''),
                  checked: !!m.get('checked'),
                  indent: Number(m.get('indent') || 0),
                  ord: idx,
                }));
              }
            }
          }
        } catch {}
      const viewerCollections = (Array.isArray(n.noteCollections) ? n.noteCollections : [])
        .map((nc: any) => nc && nc.collection)
        .filter((c: any) => c && typeof c.id === 'number' && typeof c.name === 'string')
        .map((c: any) => ({ id: Number(c.id), name: String(c.name), parentId: (c.parentId == null ? null : Number(c.parentId)) }));
        return {
          ...n,
          items: itemsFromDb,
          imagesCount: (typeof (n as any)?._count?.images === 'number') ? Number((n as any)._count.images) : 0,
          viewerColor: (Array.isArray(n.notePrefs) && n.notePrefs[0]?.color) ? String(n.notePrefs[0].color) : null,
          viewerImagesExpanded: !!(Array.isArray(n.notePrefs) && (n.notePrefs[0] as any)?.imagesExpanded),
        viewerCollections,
          // Reminders are owner-only; collaborators should not see the owner's reminder state.
          reminderDueAt: isOwnerView ? (n as any).reminderDueAt : null,
          reminderAt: isOwnerView ? (n as any).reminderAt : null,
          reminderOffsetMinutes: isOwnerView ? (n as any).reminderOffsetMinutes : 0,
          reminderNotifiedAt: isOwnerView ? (n as any).reminderNotifiedAt : null,
        };
      });
    res.json({ notes: normalized });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Integrity check: compare DB items vs Y.Doc snapshot for a note
router.get('/api/notes/:id/integrity', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const noteId = Number(req.params.id);
  if (!Number.isInteger(noteId)) return res.status(400).json({ error: 'invalid note id' });
  try {
    const note = await prisma.note.findUnique({ where: { id: noteId }, include: { items: true } });
    if (!note) return res.status(404).json({ error: 'not found' });
    if (note.ownerId !== user.id) {
      const collab = await prisma.collaborator.findFirst({ where: { noteId, userId: user.id } });
      if (!collab) return res.status(403).json({ error: 'forbidden' });
    }
    const dbItems = (note.items || []).slice().sort((a, b) => (a.ord || 0) - (b.ord || 0)).map((it) => ({ id: it.id, content: it.content, checked: !!it.checked, indent: it.indent || 0, ord: it.ord || 0 }));
    const yItems: Array<any> = [];
    try {
      const ydoc = new Y.Doc();
      const buf = note.yData as unknown as Buffer;
      if (buf && buf.length) {
        Y.applyUpdate(ydoc, new Uint8Array(buf));
        const yarr = ydoc.getArray<Y.Map<any>>('checklist');
        yarr.forEach((m: Y.Map<any>, idx: number) => {
          yItems.push({ id: (typeof m.get('id') === 'number' ? Number(m.get('id')) : undefined), content: String(m.get('content') || ''), checked: !!m.get('checked'), indent: Number(m.get('indent') || 0), ord: idx });
        });
      }
    } catch (e) {
      // ignore snapshot decode errors
    }
    res.json({ dbItems, yItems });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// reorder notes (accepts array of ids in desired order)
router.patch('/api/notes/order', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const ids: number[] = Array.isArray(req.body.ids) ? req.body.ids.map((x: any) => Number(x)) : [];
  try {
    // ensure all notes belong to user (owner) or the user has permission
    const notes = await prisma.note.findMany({ where: { id: { in: ids } } });
    // simple ownership check: require owner for any reorder action
    for (const n of notes) {
      if (n.ownerId !== user.id) return res.status(403).json({ error: 'forbidden' });
    }

    const tx = ids.map((id, idx) => prisma.note.update({ where: { id }, data: { ord: idx } }));
    await prisma.$transaction(tx);
    // Notify all sessions for this user so other devices update immediately.
    try { notifyUser(user.id, 'notes-reordered', { ids }); } catch {}
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// create note (supports checklist items)
router.post('/api/notes', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const { title, body, type, items } = req.body || {};
  const { color } = req.body || {};
  const reminderDueAt = parseDateTimeMaybe((req.body || {}).reminderDueAt);
  const reminderOffsetMinutes = clampInt((req.body || {}).reminderOffsetMinutes, 0, 60 * 24 * 365, 0);
  try {
    // Ensure new notes appear first: set ord to (minOrd - 1)
    let ord = 0;
    try {
      const minOrd = await prisma.note.findFirst({ where: { ownerId: user.id }, orderBy: { ord: 'asc' }, select: { ord: true } });
      ord = ((minOrd?.ord ?? 0) - 1);
    } catch {}
    const titleText = (typeof title === 'string') ? title.trim() : String(title || '').trim();
    const bodyText = (typeof body === 'string') ? body.trim() : '';
    const data: any = { title: (titleText ? titleText : null), body: (bodyText ? bodyText : null), type: type || 'TEXT', ownerId: user.id, ord };
    if (typeof color !== 'undefined') data.color = color || null;
    if (reminderDueAt) {
      data.reminderDueAt = reminderDueAt;
      data.reminderOffsetMinutes = reminderOffsetMinutes;
      data.reminderAt = computeReminderAt(reminderDueAt, reminderOffsetMinutes);
    }

    // Enforce: do not create empty notes/checklists.
    // (Empty checklist items are already filtered below.)
    let filteredItemsCount = 0;
    if (Array.isArray(items) && items.length > 0) {
      const filtered = items
        .map((it: any) => ({
          content: String(it?.content || ''),
          checked: !!it?.checked,
          ord: (typeof it?.ord === 'number' ? Number(it.ord) : undefined),
          indent: (typeof it?.indent === 'number' ? Number(it.indent) : 0),
        }))
        .filter((it: any) => stripHtmlToText(it.content).length > 0);
      filteredItemsCount = filtered.length;
      if (filtered.length > 0) {
        data.items = { create: filtered.map((it: any, idx: number) => ({ content: it.content, checked: !!it.checked, ord: (typeof it.ord === 'number' ? it.ord : idx), indent: (typeof it.indent === 'number' ? it.indent : 0) })) };
      }
    }

    if (!titleText && !bodyText && filteredItemsCount === 0) {
      return res.status(400).json({ error: 'empty note' });
    }
    const note = await prisma.note.create({ data, include: { items: true, collaborators: true, images: true, noteLabels: true } });
    // sort items by ord before returning
    const created = { ...note, items: (note.items || []).slice().sort((a, b) => (a.ord || 0) - (b.ord || 0)) };
    // Notify all sessions for this user so new note appears instantly
    try { notifyUser(user.id, 'note-created', { noteId: created.id }); } catch {}
    res.status(201).json({ note: created });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// add image to a note
router.post('/api/notes/:id/images', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'image url required' });
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    if (note.ownerId !== user.id) {
      const collab = await prisma.collaborator.findFirst({ where: { noteId: id, userId: user.id } });
      if (!collab) return res.status(403).json({ error: 'forbidden' });
    }

    let storedUrl = url;
    // If the client sent a base64 data URL (FileReader), persist it to disk and store a short /uploads URL instead.
    if (isDataUrlImage(storedUrl)) {
      const persisted = await persistNoteImageDataUrl({ dataUrl: storedUrl, ownerId: Number(note.ownerId), noteId: id });
      if (persisted) storedUrl = persisted;
    }

    const img = await prisma.noteImage.create({ data: { noteId: id, url: storedUrl, ocrStatus: 'pending' } as any });
    // OCR runs asynchronously (never block this request).
    try { enqueueNoteImageOcr(Number((img as any).id)); } catch {}
    try {
      const collabs = await prisma.collaborator.findMany({ where: { noteId: id }, select: { userId: true } });
      const participantIds = Array.from(new Set<number>([note.ownerId, ...collabs.map(c => Number(c.userId)).filter((n) => Number.isFinite(n))]));
      for (const uid of participantIds) notifyUser(uid, 'note-images-changed', { noteId: id });
    } catch {}
    res.status(201).json({ image: img });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Trigger OCR for a specific image (owner or collaborators)
router.post('/api/notes/:id/images/:imageId/ocr', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  const imageId = Number(req.params.imageId);
  if (!Number.isInteger(id) || !Number.isInteger(imageId)) return res.status(400).json({ error: 'invalid id' });
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    if (note.ownerId !== user.id) {
      const collab = await prisma.collaborator.findFirst({ where: { noteId: id, userId: user.id } });
      if (!collab) return res.status(403).json({ error: 'forbidden' });
    }
    const img = await prisma.noteImage.findUnique({ where: { id: imageId } });
    if (!img || (img as any).noteId !== id) return res.status(404).json({ error: 'image not found' });
    try {
      await (prisma as any).noteImage.update({ where: { id: imageId }, data: { ocrStatus: 'pending' } });
    } catch {}
    try { enqueueNoteImageOcr(imageId); } catch {}
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// list images for a note (owner or collaborators)
router.get('/api/notes/:id/images', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    if (note.ownerId !== user.id) {
      const collab = await prisma.collaborator.findFirst({ where: { noteId: id, userId: user.id } });
      if (!collab) return res.status(403).json({ error: 'forbidden' });
    }
    const images = await prisma.noteImage.findMany({ where: { noteId: id }, orderBy: { createdAt: 'asc' } });

    // Best-effort auto-migration: convert legacy data URLs to files under /uploads.
    const migrated: any[] = [];
    for (const img of (images as any[])) {
      try {
        const u = String((img as any).url || '');
        if (isDataUrlImage(u)) {
          const persisted = await persistNoteImageDataUrl({ dataUrl: u, ownerId: Number(note.ownerId), noteId: id, imageId: Number((img as any).id) });
          if (persisted) {
            try {
              await (prisma as any).noteImage.update({ where: { id: Number((img as any).id) }, data: { url: persisted } });
              (img as any).url = persisted;
            } catch {}
          }
        }
      } catch {}
      migrated.push(img);
    }

    res.json({ images: migrated });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Generate and persist a URL preview (unfurl) for a note.
router.post('/api/notes/:id/link-preview', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  const urlRaw = (req.body || {}).url;
  const url = (typeof urlRaw === 'string') ? urlRaw : String(urlRaw || '');
  if (!url.trim()) return res.status(400).json({ error: 'url required' });

  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    if (note.ownerId !== user.id) {
      const collab = await prisma.collaborator.findFirst({ where: { noteId: id, userId: user.id } });
      if (!collab) return res.status(403).json({ error: 'forbidden' });
    }

    // Cheap caching: if this URL was fetched recently for this note, return current list.
    try {
      const inputHash = hashUrl(String(url).trim());
      const existing = await (prisma as any).noteLinkPreview.findFirst({
        where: { noteId: id, urlHash: inputHash },
        select: { id: true, fetchedAt: true },
      });
      const recent = existing?.fetchedAt && (new Date(existing.fetchedAt).getTime() > (Date.now() - 6 * 60 * 60 * 1000));
      if (existing && recent) {
        const previews = await (prisma as any).noteLinkPreview.findMany({ where: { noteId: id }, orderBy: { createdAt: 'asc' } });
        return res.json({ previews, cached: true });
      }
    } catch {}

    const preview = await scrapeLinkPreview(url);
    const urlHash = hashUrl(preview.url);
    // Upsert by (noteId, url) to avoid duplicates.
    try {
      await (prisma as any).noteLinkPreview.upsert({
        where: { noteId_urlHash: { noteId: id, urlHash } },
        create: {
          noteId: id,
          urlHash,
          url: preview.url,
          title: preview.title,
          description: preview.description,
          imageUrl: preview.imageUrl,
          domain: preview.domain,
          fetchedAt: new Date(),
        },
        update: {
          urlHash,
          title: preview.title,
          description: preview.description,
          imageUrl: preview.imageUrl,
          domain: preview.domain,
          fetchedAt: new Date(),
        },
      });
    } catch (e: any) {
      // If a race causes uniqueness issues, fall back to best-effort create/update.
      try {
        const existing = await (prisma as any).noteLinkPreview.findFirst({ where: { noteId: id, urlHash } });
        if (existing?.id) {
          await (prisma as any).noteLinkPreview.update({ where: { id: existing.id }, data: {
            urlHash,
            title: preview.title,
            description: preview.description,
            imageUrl: preview.imageUrl,
            domain: preview.domain,
            fetchedAt: new Date(),
          } });
        } else {
          await (prisma as any).noteLinkPreview.create({ data: {
            noteId: id,
            urlHash,
            url: preview.url,
            title: preview.title,
            description: preview.description,
            imageUrl: preview.imageUrl,
            domain: preview.domain,
            fetchedAt: new Date(),
          } });
        }
      } catch {}
    }

    const previews = await (prisma as any).noteLinkPreview.findMany({ where: { noteId: id }, orderBy: { createdAt: 'asc' } });

    // Broadcast to all participants (owner + collaborators).
    try {
      const participantIds = await getParticipantIdsForNote(id, { ownerId: note.ownerId });
      for (const uid of participantIds) {
        notifyUser(uid, 'note-link-previews-changed', { noteId: id, previews });
      }
    } catch {}

    res.json({ previews });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// List URL previews for a note.
router.get('/api/notes/:id/link-previews', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    if (note.ownerId !== user.id) {
      const collab = await prisma.collaborator.findFirst({ where: { noteId: id, userId: user.id } });
      if (!collab) return res.status(403).json({ error: 'forbidden' });
    }
    const previews = await (prisma as any).noteLinkPreview.findMany({ where: { noteId: id }, orderBy: { createdAt: 'asc' } });
    res.json({ previews });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Edit a URL preview (updates URL and re-scrapes metadata).
router.patch('/api/notes/:id/link-previews/:previewId', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  const previewId = Number(req.params.previewId);
  if (!Number.isInteger(id) || !Number.isInteger(previewId)) return res.status(400).json({ error: 'invalid ids' });
  const urlRaw = (req.body || {}).url;
  const url = (typeof urlRaw === 'string') ? urlRaw : String(urlRaw || '');
  if (!url.trim()) return res.status(400).json({ error: 'url required' });
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    if (note.ownerId !== user.id) {
      const collab = await prisma.collaborator.findFirst({ where: { noteId: id, userId: user.id } });
      if (!collab) return res.status(403).json({ error: 'forbidden' });
    }
    const pv = await (prisma as any).noteLinkPreview.findUnique({ where: { id: previewId } });
    if (!pv || Number(pv.noteId) !== id) return res.status(404).json({ error: 'not found' });
    const preview = await scrapeLinkPreview(url);
    const urlHash = hashUrl(preview.url);
    // If URL already exists on this note, delete this row and update the existing one.
    const existing = await (prisma as any).noteLinkPreview.findFirst({ where: { noteId: id, urlHash } });
    if (existing?.id && Number(existing.id) !== previewId) {
      await (prisma as any).noteLinkPreview.update({ where: { id: existing.id }, data: {
        urlHash,
        title: preview.title,
        description: preview.description,
        imageUrl: preview.imageUrl,
        domain: preview.domain,
        fetchedAt: new Date(),
      } });
      await (prisma as any).noteLinkPreview.delete({ where: { id: previewId } });
    } else {
      await (prisma as any).noteLinkPreview.update({ where: { id: previewId }, data: {
        urlHash,
        url: preview.url,
        title: preview.title,
        description: preview.description,
        imageUrl: preview.imageUrl,
        domain: preview.domain,
        fetchedAt: new Date(),
      } });
    }
    const previews = await (prisma as any).noteLinkPreview.findMany({ where: { noteId: id }, orderBy: { createdAt: 'asc' } });
    try {
      const participantIds = await getParticipantIdsForNote(id, { ownerId: note.ownerId });
      for (const uid of participantIds) notifyUser(uid, 'note-link-previews-changed', { noteId: id, previews });
    } catch {}
    res.json({ previews });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// Delete a single URL preview.
router.delete('/api/notes/:id/link-previews/:previewId', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  const previewId = Number(req.params.previewId);
  if (!Number.isInteger(id) || !Number.isInteger(previewId)) return res.status(400).json({ error: 'invalid ids' });
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    if (note.ownerId !== user.id) {
      const collab = await prisma.collaborator.findFirst({ where: { noteId: id, userId: user.id } });
      if (!collab) return res.status(403).json({ error: 'forbidden' });
    }
    const pv = await (prisma as any).noteLinkPreview.findUnique({ where: { id: previewId } });
    if (!pv || Number(pv.noteId) !== id) return res.status(404).json({ error: 'not found' });
    await (prisma as any).noteLinkPreview.delete({ where: { id: previewId } });
    const previews = await (prisma as any).noteLinkPreview.findMany({ where: { noteId: id }, orderBy: { createdAt: 'asc' } });
    try {
      const participantIds = await getParticipantIdsForNote(id, { ownerId: note.ownerId });
      for (const uid of participantIds) notifyUser(uid, 'note-link-previews-changed', { noteId: id, previews });
    } catch {}
    res.json({ previews });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Back-compat: clear ALL URL previews for a note.
router.delete('/api/notes/:id/link-preview', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    if (note.ownerId !== user.id) {
      const collab = await prisma.collaborator.findFirst({ where: { noteId: id, userId: user.id } });
      if (!collab) return res.status(403).json({ error: 'forbidden' });
    }
    await (prisma as any).noteLinkPreview.deleteMany({ where: { noteId: id } });
    try {
      const participantIds = await getParticipantIdsForNote(id, { ownerId: note.ownerId });
      for (const uid of participantIds) notifyUser(uid, 'note-link-previews-changed', { noteId: id, previews: [] });
    } catch {}
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// delete image from a note (owner only)
router.delete('/api/notes/:id/images/:imageId', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  const imageId = Number(req.params.imageId);
  if (!Number.isInteger(id) || !Number.isInteger(imageId)) return res.status(400).json({ error: 'invalid ids' });
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    if (note.ownerId !== user.id) {
      const collab = await prisma.collaborator.findFirst({ where: { noteId: id, userId: user.id } });
      if (!collab) return res.status(403).json({ error: 'forbidden' });
    }
    // ensure image belongs to this note
    const img = await prisma.noteImage.findUnique({ where: { id: imageId }, select: { id: true, noteId: true, url: true } as any });
    if (!img || img.noteId !== id) return res.status(404).json({ error: 'image not found' });
    await prisma.noteImage.delete({ where: { id: imageId } });

    // Best-effort: delete the underlying upload file if it was a persisted note upload.
    try {
      const url = String((img as any).url || '');
      if (url) {
        await cleanupNoteUploadsForUrls({ ownerId: Number(note.ownerId), noteId: id, urls: [url] });
      }
    } catch {}

    try {
      const collabs = await prisma.collaborator.findMany({ where: { noteId: id }, select: { userId: true } });
      const participantIds = Array.from(new Set<number>([note.ownerId, ...collabs.map(c => Number(c.userId)).filter((n) => Number.isFinite(n))]));
      for (const uid of participantIds) notifyUser(uid, 'note-images-changed', { noteId: id });
    } catch {}
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// add label to a note (create label if needed)
router.post('/api/notes/:id/labels', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  const { name } = req.body || {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'label name required' });
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    // Allow owner or collaborators to attach labels (labels are per-user via ownerId)
    if (note.ownerId !== user.id) {
      const collab = await prisma.collaborator.findFirst({ where: { noteId: id, userId: user.id } });
      if (!collab) return res.status(403).json({ error: 'forbidden' });
    }

    // upsert label for this user (unique on ownerId+name)
    const label = await prisma.label.upsert({
      where: { ownerId_name: { ownerId: user.id, name } },
      update: {},
      create: { ownerId: user.id, name }
    });
    // link label to note (unique on noteId+labelId); since label.ownerId is current user, this remains per-user
    await prisma.noteLabel.upsert({
      where: { noteId_labelId: { noteId: id, labelId: label.id } },
      update: {},
      create: { noteId: id, labelId: label.id }
    });

    // Realtime: labels are per-user; update this user's other connected clients.
    try {
      const nls = await prisma.noteLabel.findMany({
        where: { noteId: id, label: { ownerId: user.id } } as any,
        include: { label: true } as any,
      });
      const labels = (nls || [])
        .map((nl: any) => (nl && nl.label ? { id: Number(nl.label.id), name: String(nl.label.name || '') } : null))
        .filter((l: any) => l && Number.isFinite(l.id) && l.name);
      notifyUser(user.id, 'note-labels-changed', { noteId: id, labels });
    } catch {}

    res.status(201).json({ label });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// update note
router.patch('/api/notes/:id', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid note id' });
  const data: any = {};
  const allowed = ['title', 'body', 'pinned', 'archived', 'type', 'cardSpan', 'reminderDueAt', 'reminderOffsetMinutes'];
  for (const k of allowed) if (k in req.body) data[k] = req.body[k];
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    const isOwner = note.ownerId === user.id;

    // Business rule: trashed notes can't be archived (restore first).
    if ('archived' in (req.body || {}) && !!(note as any).trashedAt && !!(req.body as any).archived) {
      return res.status(409).json({ error: 'cannot archive trashed note' });
    }

    const wantsReminderDueAt = ('reminderDueAt' in (req.body || {}));
    const wantsOffset = ('reminderOffsetMinutes' in (req.body || {}));
    if (note.ownerId !== user.id) {
      // allow collaborators to update body/title but not archive/delete
      const collab = await prisma.collaborator.findFirst({ where: { noteId: id, userId: user.id } });
      if (!collab) return res.status(403).json({ error: 'forbidden' });
      if ('archived' in req.body) return res.status(403).json({ error: 'forbidden' });
      if ('pinned' in req.body) return res.status(403).json({ error: 'forbidden' });
      // Reminders are owner-only.
      if (wantsReminderDueAt || wantsOffset) return res.status(403).json({ error: 'forbidden' });
    }

    // If pinning, bump this note to the top of the pinned group by setting ord to (minPinnedOrd - 1).
    // This keeps the newly pinned note reliably at the top across devices on the default sort.
    if ('pinned' in req.body) {
      const nextPinned = !!(req.body as any).pinned;
      if (nextPinned && !(note as any).pinned) {
        try {
          const minPinned = await prisma.note.findFirst({
            where: { ownerId: user.id, pinned: true },
            orderBy: { ord: 'asc' },
            select: { ord: true },
          });
          const base = (typeof minPinned?.ord === 'number') ? Number(minPinned.ord) : Number((note as any).ord || 0);
          data.ord = Math.trunc(base) - 1;
        } catch {
          // ignore ord adjustment failures
        }
      }
    }
    // Reminders: compute reminderAt and normalize nulls.
    if (wantsReminderDueAt || wantsOffset) {
      // Any reminder change should allow a new notification.
      data.reminderNotifiedAt = null;
      const nextDueAt = wantsReminderDueAt
        ? parseDateTimeMaybe((req.body || {}).reminderDueAt)
        : ((note as any).reminderDueAt ? new Date((note as any).reminderDueAt as any) : null);
      const nextOffset = wantsOffset
        ? clampInt((req.body || {}).reminderOffsetMinutes, 0, 60 * 24 * 365, Number((note as any).reminderOffsetMinutes || 0))
        : clampInt((note as any).reminderOffsetMinutes, 0, 60 * 24 * 365, 0);

      if (!nextDueAt) {
        data.reminderDueAt = null;
        data.reminderAt = null;
        data.reminderOffsetMinutes = nextOffset;
      } else {
        data.reminderDueAt = nextDueAt;
        data.reminderOffsetMinutes = nextOffset;
        data.reminderAt = computeReminderAt(nextDueAt, nextOffset);
      }
    }

    const updated = await prisma.note.update({ where: { id }, data });

    // Realtime: title changes should sync across participants.
    if ('title' in req.body) {
      try {
        const participantIds = await getParticipantIdsForNote(id, note as any);
        const payload = {
          noteId: id,
          title: ((updated as any).title ?? null),
          updatedAt: (updated as any).updatedAt ? new Date((updated as any).updatedAt as any).toISOString() : null,
        };
        for (const uid of participantIds) {
          notifyUser(uid, 'note-title-changed', payload);
        }
      } catch {}
    }

    // Realtime: archive/unarchive updates should hide/show notes on other clients.
    if ('archived' in req.body) {
      try {
        const participantIds = await getParticipantIdsForNote(id, note as any);
        for (const uid of participantIds) {
          notifyUser(uid, 'note-archive-changed', { noteId: id, archived: !!(updated as any).archived });
        }
      } catch {}
    }

    // Realtime: pin/unpin so all sessions move note between pinned/unpinned sections.
    if ('pinned' in req.body) {
      try {
        const participantIds = await getParticipantIdsForNote(id, note as any);
        const payload = { noteId: id, pinned: !!(updated as any).pinned };
        for (const uid of participantIds) {
          notifyUser(uid, 'note-pin-changed', payload);
        }
      } catch {}
    }

    // Realtime: update reminder bell chips across other clients/collaborators.
    if (wantsReminderDueAt || wantsOffset) {
      try {
        // Reminders are owner-only: notify only the owner so their other devices update.
        const dueAt = (updated as any).reminderDueAt ? new Date((updated as any).reminderDueAt as any) : null;
        const payload = {
          noteId: id,
          reminderDueAt: dueAt ? dueAt.toISOString() : null,
          reminderOffsetMinutes: (typeof (updated as any).reminderOffsetMinutes === 'number')
            ? Number((updated as any).reminderOffsetMinutes)
            : null,
        };
        notifyUser(Number((updated as any).ownerId), 'note-reminder-changed', payload);
      } catch {}
    }

    const out: any = updated as any;
    if (!isOwner) {
      // Collaborators should not see reminder state.
      out.reminderDueAt = null;
      out.reminderAt = null;
      out.reminderOffsetMinutes = 0;
      out.reminderNotifiedAt = null;
    }

    res.json({ note: out });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

  // set per-user note preferences (e.g., color)
  router.patch('/api/notes/:id/prefs', async (req: Request, res: Response) => {
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'unauthenticated' });
    const noteId = Number(req.params.id);
    if (!Number.isInteger(noteId)) return res.status(400).json({ error: 'invalid note id' });
    const wantsColor = !!(req.body && Object.prototype.hasOwnProperty.call(req.body, 'color'));
    const wantsImagesExpanded = !!(req.body && Object.prototype.hasOwnProperty.call(req.body, 'imagesExpanded'));
    const color = wantsColor ? (typeof req.body?.color === 'string' ? String(req.body.color) : '') : undefined;
    const imagesExpanded = wantsImagesExpanded ? !!(req.body as any)?.imagesExpanded : undefined;
    if (!wantsColor && !wantsImagesExpanded) return res.status(400).json({ error: 'no prefs provided' });
    try {
        const note = await (prisma as any).note.findUnique({ where: { id: noteId } });
      if (!note) return res.status(404).json({ error: 'not found' });
      // Ensure user has access
      if (note.ownerId !== user.id) {
        const collab = await prisma.collaborator.findFirst({ where: { noteId, userId: user.id } });
        if (!collab) return res.status(403).json({ error: 'forbidden' });
      }

      // Back-compat: if caller only sends an empty color, delete the preference row.
      // If additional prefs are provided, keep the row and just clear `color`.
      if (wantsColor && !wantsImagesExpanded) {
        const c = (typeof color === 'string') ? String(color) : '';
        if (!c.length) {
          await (prisma as any).notePref.deleteMany({ where: { noteId, userId: user.id } });
          try { notifyUser(user.id, 'note-color-changed', { noteId, color: '' }); } catch {}
          return res.json({ ok: true });
        }
      }

      const updateData: any = {};
      const createData: any = { noteId, userId: user.id };
      if (wantsColor) {
        const c = (typeof color === 'string') ? String(color) : '';
        updateData.color = c.length ? c : null;
        createData.color = c.length ? c : null;
      }
      if (wantsImagesExpanded) {
        updateData.imagesExpanded = !!imagesExpanded;
        createData.imagesExpanded = !!imagesExpanded;
      }

      const pref = await (prisma as any).notePref.upsert({
        where: { noteId_userId: { noteId, userId: user.id } },
        update: updateData,
        create: createData,
      });

      if (wantsColor) {
        const c = (typeof color === 'string') ? String(color) : '';
        try { notifyUser(user.id, 'note-color-changed', { noteId, color: c }); } catch {}
      }
      if (wantsImagesExpanded) {
        try { notifyUser(user.id, 'note-images-expanded-changed', { noteId, imagesExpanded: !!imagesExpanded }); } catch {}
      }

      return res.json({ prefs: pref });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

// update note item (checked/content)
router.patch('/api/notes/:noteId/items/:itemId', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const noteId = Number(req.params.noteId);
  if (!Number.isInteger(noteId)) return res.status(400).json({ error: 'invalid note id' });
  const itemId = Number(req.params.itemId);
  if (!Number.isInteger(itemId)) return res.status(400).json({ error: 'invalid item id' });
  const data: any = {};
  if ('checked' in req.body) data.checked = !!req.body.checked;
  if ('content' in req.body) data.content = String(req.body.content || '');
  try {
    const note = await prisma.note.findUnique({ where: { id: noteId } });
    if (!note) return res.status(404).json({ error: 'note not found' });
    // ensure user has access
    if (note.ownerId !== user.id) {
      const collab = await prisma.collaborator.findFirst({ where: { noteId, userId: user.id } });
      if (!collab) return res.status(403).json({ error: 'forbidden' });
    }
    const existing = await prisma.noteItem.findUnique({ where: { id: itemId } });
    if (!existing || Number((existing as any).noteId) !== noteId) return res.status(404).json({ error: 'item not found' });

    // If content is being cleared, delete the item instead of saving an empty row.
    if ('content' in req.body && stripHtmlToText(String(data.content || '')).length === 0) {
      await prisma.noteItem.delete({ where: { id: itemId } });
      try {
        const updated = await prisma.note.findUnique({ where: { id: noteId }, include: { items: true } });
        const ordered = (updated?.items || []).slice().sort((a, b) => (a.ord || 0) - (b.ord || 0));
        const participantIds = await getParticipantIdsForNote(noteId, note);
        for (const uid of (participantIds.length ? participantIds : [note.ownerId])) {
          notifyUser(uid, 'note-items-changed', {
            noteId,
            items: ordered.map((it) => ({ id: it.id, content: it.content, checked: !!it.checked, indent: it.indent || 0, ord: it.ord || 0 })),
          });
        }
      } catch {}
      return res.json({ ok: true, deleted: true });
    }

    const item = await prisma.noteItem.update({ where: { id: itemId }, data });

    // Realtime: sync checklist items across other sessions and collaborators.
    try {
      const updated = await prisma.note.findUnique({ where: { id: noteId }, include: { items: true } });
      const ordered = (updated?.items || []).slice().sort((a, b) => (a.ord || 0) - (b.ord || 0));
      const participantIds = await getParticipantIdsForNote(noteId, note);
      for (const uid of (participantIds.length ? participantIds : [note.ownerId])) {
        notifyUser(uid, 'note-items-changed', {
          noteId,
          items: ordered.map((it) => ({ id: it.id, content: it.content, checked: !!it.checked, indent: it.indent || 0, ord: it.ord || 0 })),
        });
      }
    } catch {}

    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// replace/sync items for a note (create/update/delete as needed)
router.put('/api/notes/:id/items', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const noteId = Number(req.params.id);
  if (!Number.isInteger(noteId)) return res.status(400).json({ error: 'invalid note id' });
  const itemsRaw: Array<any> = Array.isArray(req.body.items) ? req.body.items : [];
  const items: Array<any> = (itemsRaw || []).filter((it: any) => stripHtmlToText(it?.content).length > 0);
  const replaceMissing = !!(req.body && (req.body.replaceMissing === true || req.body.fullReplace === true || req.body.replace === true));
  try {
    const note = await prisma.note.findUnique({ where: { id: noteId } });
    if (!note) return res.status(404).json({ error: 'note not found' });
    if (note.ownerId !== user.id) {
      const collab = await prisma.collaborator.findFirst({ where: { noteId, userId: user.id } });
      if (!collab) return res.status(403).json({ error: 'forbidden' });
    }

    // Safety: if client sends an empty array unexpectedly (e.g., transient sync), do not delete.
    // If the client explicitly opts into full replacement, allow clearing all items.
    if (items.length === 0) {
      if (replaceMissing) {
        await prisma.noteItem.deleteMany({ where: { noteId } });
        try {
          const participantIds = await getParticipantIdsForNote(noteId, note);
          for (const uid of (participantIds.length ? participantIds : [note.ownerId])) {
            notifyUser(uid, 'note-items-changed', { noteId, items: [] });
          }
        } catch {}
        return res.json({ items: [] });
      }

      const current = await prisma.note.findUnique({ where: { id: noteId }, include: { items: true } });
      const ordered = (current?.items || []).slice().sort((a, b) => (a.ord || 0) - (b.ord || 0));
      return res.json({ items: ordered });
    }

    // Sync: upsert provided items. If `replaceMissing` is true, also delete DB rows
    // that are not present in the provided list (full authoritative replace).
    const results = await prisma.$transaction(
      items.map((it, idx) => {
        const base = { content: String(it.content || ''), checked: !!it.checked, ord: typeof it.ord === 'number' ? it.ord : idx, indent: typeof it.indent === 'number' ? it.indent : 0 };
        if (it.id) {
          return prisma.noteItem.update({ where: { id: Number(it.id) }, data: base });
        }
        return prisma.noteItem.create({ data: { noteId, ...base } });
      })
    );

    if (replaceMissing) {
      try {
        const keepIds = (Array.isArray(results) ? results : [])
          .map((r: any) => Number(r?.id))
          .filter((n: any) => Number.isFinite(n));

        // If none of the upserts returned ids, avoid deleting everything.
        if (keepIds.length) {
          await prisma.noteItem.deleteMany({ where: { noteId, id: { notIn: keepIds } } });
        }
      } catch {}
    }

    const updated = await prisma.note.findUnique({ where: { id: noteId }, include: { items: true } });
    const ordered = (updated?.items || []).slice().sort((a, b) => (a.ord || 0) - (b.ord || 0));

    // Realtime: sync checklist items across other sessions and collaborators.
    try {
      const participantIds = await getParticipantIdsForNote(noteId, note);
      for (const uid of (participantIds.length ? participantIds : [note.ownerId])) {
        notifyUser(uid, 'note-items-changed', {
          noteId,
          items: ordered.map((it) => ({ id: it.id, content: it.content, checked: !!it.checked, indent: it.indent || 0, ord: it.ord || 0 })),
        });
      }
    } catch {}

    res.json({ items: ordered });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// move note to trash (owner only)
router.delete('/api/notes/:id', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    if (note.ownerId !== user.id) return res.status(403).json({ error: 'forbidden' });
    // Idempotent: if already trashed, succeed.
    if ((note as any).trashedAt) return res.json({ ok: true });

    const participantIds = await getParticipantIdsForNote(id, note);
    const trashedAt = new Date();
    await prisma.note.update({
      where: { id },
      data: {
        trashedAt,
        pinned: false,
        archived: false,
        // Trashed notes should not generate reminders.
        reminderDueAt: null,
        reminderAt: null,
        reminderOffsetMinutes: 0,
        reminderNotifiedAt: null,
      } as any,
    });

    try {
      for (const uid of (participantIds.length ? participantIds : [note.ownerId])) {
        notifyUser(uid, 'note-trashed', { noteId: id, trashedAt: trashedAt.toISOString() });
      }
    } catch {}

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// restore note from trash (owner only)
router.post('/api/notes/:id/restore', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    if (note.ownerId !== user.id) return res.status(403).json({ error: 'forbidden' });
    // Idempotent: if not trashed, succeed.
    if (!(note as any).trashedAt) return res.json({ ok: true });

    const participantIds = await getParticipantIdsForNote(id, note);
    await prisma.note.update({ where: { id }, data: { trashedAt: null } as any });

    try {
      for (const uid of (participantIds.length ? participantIds : [note.ownerId])) {
        notifyUser(uid, 'note-restored', { noteId: id });
      }
    } catch {}

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// permanently delete note (owner only)
router.delete('/api/notes/:id/purge', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    if (note.ownerId !== user.id) return res.status(403).json({ error: 'forbidden' });

    const participantIds = await getParticipantIdsForNote(id, note);
    await hardDeleteNote(id);

    try {
      for (const uid of (participantIds.length ? participantIds : [note.ownerId])) {
        notifyUser(uid, 'note-deleted', { noteId: id });
      }
    } catch {}

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// empty trash (permanently delete all trashed notes owned by current user)
router.delete('/api/trash/empty', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });

  try {
    const trashedNotes = await prisma.note.findMany({
      where: {
        ownerId: user.id,
        trashedAt: { not: null } as any,
      } as any,
      select: { id: true },
    });

    const noteIds = (trashedNotes || []).map((n: any) => Number(n.id)).filter((id) => Number.isFinite(id));
    if (noteIds.length === 0) return res.json({ ok: true, deletedCount: 0, noteIds: [] });

    // Preload collaborators so we can notify after delete.
    const collabs = await prisma.collaborator.findMany({
      where: { noteId: { in: noteIds } },
      select: { noteId: true, userId: true },
    });
    const participantsByNoteId = new Map<number, Set<number>>();
    for (const id of noteIds) participantsByNoteId.set(id, new Set<number>([user.id]));
    for (const c of (collabs || [])) {
      const nid = Number((c as any).noteId);
      const uid = Number((c as any).userId);
      if (!Number.isFinite(nid) || !Number.isFinite(uid)) continue;
      if (!participantsByNoteId.has(nid)) participantsByNoteId.set(nid, new Set<number>([user.id]));
      participantsByNoteId.get(nid)!.add(uid);
    }

    for (const id of noteIds) {
      await hardDeleteNote(id);
      try {
        const participantIds = Array.from(participantsByNoteId.get(id) || new Set<number>([user.id]));
        for (const uid of participantIds) {
          notifyUser(uid, 'note-deleted', { noteId: id });
        }
      } catch {}
    }

    res.json({ ok: true, deletedCount: noteIds.length, noteIds });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// add collaborator by email
router.post('/api/notes/:id/collaborators', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  const { email, role } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    if (note.ownerId !== user.id) return res.status(403).json({ error: 'forbidden' });
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) return res.status(404).json({ error: 'user not found' });
    const collab = await prisma.collaborator.create({ data: { noteId: id, userId: u.id, role: role || 'editor' } });

    // Notify the collaborator immediately so the note appears
    try { notifyUser(u.id, 'note-shared', { noteId: id }); } catch {}

    // Realtime: update collaborator chips across other connected clients/collaborators.
    try {
      const participantIds = await getParticipantIdsForNote(id, note as any);
      const payload = {
        noteId: id,
        collaborator: {
          collabId: Number((collab as any).id),
          userId: Number((u as any).id),
          email: String((u as any).email || ''),
          name: (typeof (u as any).name === 'string' ? String((u as any).name) : null),
          userImageUrl: (typeof (u as any).userImageUrl === 'string' ? String((u as any).userImageUrl) : null),
          role: (typeof (collab as any).role === 'string' ? String((collab as any).role) : null),
        },
      };
      for (const uid of participantIds) notifyUser(uid, 'collab-added', payload);
    } catch {}

    res.status(201).json({ collaborator: collab });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// remove collaborator
router.delete('/api/notes/:id/collaborators/:collabId', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  const collabId = Number(req.params.collabId);
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    // Allow owner to remove anyone; allow collaborators to remove themselves
    const collab = await prisma.collaborator.findUnique({ where: { id: collabId } });
    if (!collab || collab.noteId !== id) return res.status(404).json({ error: 'collaborator not found' });
    const isOwner = note.ownerId === user.id;
    const isSelf = collab.userId === user.id;
    if (!isOwner && !isSelf) return res.status(403).json({ error: 'forbidden' });
    await prisma.collaborator.delete({ where: { id: collabId } });
    // Notify participants (owner + remaining collaborators) and the removed user
    try {
      const { notifyUser } = await import('./events');
      const remaining = await prisma.collaborator.findMany({ where: { noteId: id } });
      const participantIds = new Set<number>([note.ownerId, ...remaining.map(c => c.userId)]);
      participantIds.delete(collab.userId); // exclude removed user from 'remaining' broadcast
      for (const uid of participantIds) notifyUser(uid, 'collab-removed', { noteId: id, userId: collab.userId });
      // Tell removed user to drop the note
      notifyUser(collab.userId, 'note-unshared', { noteId: id });
    } catch {}
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
// list users (for collaborator selection)
router.get('/api/users', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const users = await (prisma as any).user.findMany({ orderBy: { email: 'asc' } });
    res.json({ users: (users || []).map((u: any) => ({ id: u.id, email: u.email, name: u.name, userImageUrl: u.userImageUrl })) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
// list labels for current user
router.get('/api/labels', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const labels = await prisma.label.findMany({ where: { ownerId: user.id }, orderBy: { name: 'asc' } });
    res.json({ labels });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// remove label from a note
router.delete('/api/notes/:id/labels/:labelId', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  const labelId = Number(req.params.labelId);
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    // Permit owner or collaborators to detach labels, but only for labels they own
    if (note.ownerId !== user.id) {
      const collab = await prisma.collaborator.findFirst({ where: { noteId: id, userId: user.id } });
      if (!collab) return res.status(403).json({ error: 'forbidden' });
    }
    const label = await prisma.label.findUnique({ where: { id: labelId } });
    if (!label || label.ownerId !== user.id) return res.status(403).json({ error: 'forbidden' });
    await prisma.noteLabel.deleteMany({ where: { noteId: id, labelId } });

    // Realtime: labels are per-user; update this user's other connected clients.
    try {
      const nls = await prisma.noteLabel.findMany({
        where: { noteId: id, label: { ownerId: user.id } } as any,
        include: { label: true } as any,
      });
      const labels = (nls || [])
        .map((nl: any) => (nl && nl.label ? { id: Number(nl.label.id), name: String(nl.label.name || '') } : null))
        .filter((l: any) => l && Number.isFinite(l.id) && l.name);
      notifyUser(user.id, 'note-labels-changed', { noteId: id, labels });
    } catch {}

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// delete a label globally for the current user
router.delete('/api/labels/:labelId', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const labelId = Number(req.params.labelId);
  try {
    const label = await prisma.label.findUnique({ where: { id: labelId } });
    if (!label) return res.status(404).json({ error: 'label not found' });
    if (label.ownerId !== user.id) return res.status(403).json({ error: 'forbidden' });

    await prisma.$transaction([
      prisma.noteLabel.deleteMany({ where: { labelId } }),
      prisma.label.delete({ where: { id: labelId } })
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

