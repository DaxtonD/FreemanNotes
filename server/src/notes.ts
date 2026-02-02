import { Router, Request, Response } from "express";
import prisma from "./prismaClient";
import jwt from "jsonwebtoken";
import * as Y from "yjs";
import { notifyUser } from "./events";

const router = Router();

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
        images: true,
          noteLabels: { where: { label: { ownerId: user.id } }, include: { label: true } },
          notePrefs: { where: { userId: user.id } }
      },
      orderBy: [{ ord: 'asc' }, { updatedAt: 'desc' }]
    });
    // ensure checklist items are returned in ord order
      const normalized = (notes as any[]).map((n: any) => ({
        ...n,
        items: (n.items || []).slice().sort((a, b) => (a.ord || 0) - (b.ord || 0)),
        viewerColor: (Array.isArray(n.notePrefs) && n.notePrefs[0]?.color) ? String(n.notePrefs[0].color) : null
      }));
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
  try {
    // Ensure new notes appear first: set ord to (minOrd - 1)
    let ord = 0;
    try {
      const minOrd = await prisma.note.findFirst({ where: { ownerId: user.id }, orderBy: { ord: 'asc' }, select: { ord: true } });
      ord = ((minOrd?.ord ?? 0) - 1);
    } catch {}
    const data: any = { title: title || null, body: body || null, type: type || 'TEXT', ownerId: user.id, ord };
    if (typeof color !== 'undefined') data.color = color || null;
    if (Array.isArray(items) && items.length > 0) {
      data.items = { create: items.map((it: any, idx: number) => ({ content: String(it.content || ''), checked: !!it.checked, ord: typeof it.ord === 'number' ? it.ord : idx, indent: typeof it.indent === 'number' ? it.indent : 0 })) };
    }
    const note = await prisma.note.create({ data, include: { items: true, collaborators: true, images: true, noteLabels: true } });
    // sort items by ord before returning
    const created = { ...note, items: (note.items || []).slice().sort((a, b) => (a.ord || 0) - (b.ord || 0)) };
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
    if (note.ownerId !== user.id) return res.status(403).json({ error: 'forbidden' });
    const img = await prisma.noteImage.create({ data: { noteId: id, url } });
    // OCR functionality removed — return created image immediately
    res.status(201).json({ image: img });
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
    if (note.ownerId !== user.id) return res.status(403).json({ error: 'forbidden' });
    // ensure image belongs to this note
    const img = await prisma.noteImage.findUnique({ where: { id: imageId } });
    if (!img || img.noteId !== id) return res.status(404).json({ error: 'image not found' });
    await prisma.noteImage.delete({ where: { id: imageId } });
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
    const allowed = ['title', 'body', 'pinned', 'archived', 'type', 'cardSpan'];
  for (const k of allowed) if (k in req.body) data[k] = req.body[k];
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    if (note.ownerId !== user.id) {
      // allow collaborators to update body/title but not archive/delete
      const collab = await prisma.collaborator.findFirst({ where: { noteId: id, userId: user.id } });
      if (!collab) return res.status(403).json({ error: 'forbidden' });
    }
    const updated = await prisma.note.update({ where: { id }, data });
    res.json({ note: updated });
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
    const color = (typeof req.body?.color === 'string' ? String(req.body.color) : null);
    try {
        const note = await (prisma as any).note.findUnique({ where: { id: noteId } });
      if (!note) return res.status(404).json({ error: 'not found' });
      // Ensure user has access
      if (note.ownerId !== user.id) {
        const collab = await prisma.collaborator.findFirst({ where: { noteId, userId: user.id } });
        if (!collab) return res.status(403).json({ error: 'forbidden' });
      }
      if (color && color.length) {
          const pref = await (prisma as any).notePref.upsert({
          where: { noteId_userId: { noteId, userId: user.id } },
          update: { color },
          create: { noteId, userId: user.id, color }
        });
        return res.json({ prefs: pref });
      }
      // delete preference if color null/empty
        await (prisma as any).notePref.deleteMany({ where: { noteId, userId: user.id } });
      return res.json({ ok: true });
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
    const item = await prisma.noteItem.update({ where: { id: itemId }, data });
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
  const items: Array<any> = Array.isArray(req.body.items) ? req.body.items : [];
  try {
    const note = await prisma.note.findUnique({ where: { id: noteId } });
    if (!note) return res.status(404).json({ error: 'note not found' });
    if (note.ownerId !== user.id) {
      const collab = await prisma.collaborator.findFirst({ where: { noteId, userId: user.id } });
      if (!collab) return res.status(403).json({ error: 'forbidden' });
    }

    // Safety: if client sends an empty array unexpectedly (e.g., transient sync), do not delete
    if (items.length === 0) {
      const current = await prisma.note.findUnique({ where: { id: noteId }, include: { items: true } });
      const ordered = (current?.items || []).slice().sort((a, b) => (a.ord || 0) - (b.ord || 0));
      return res.json({ items: ordered });
    }

    // sync: upsert provided items only; do NOT delete missing here to avoid accidental wipe during transient states
    await prisma.$transaction(
      items.map((it, idx) => {
        const base = { content: String(it.content || ''), checked: !!it.checked, ord: typeof it.ord === 'number' ? it.ord : idx, indent: typeof it.indent === 'number' ? it.indent : 0 };
        if (it.id) {
          return prisma.noteItem.update({ where: { id: Number(it.id) }, data: base });
        }
        return prisma.noteItem.create({ data: { noteId, ...base } });
      })
    );

    const updated = await prisma.note.findUnique({ where: { id: noteId }, include: { items: true } });
    const ordered = (updated?.items || []).slice().sort((a, b) => (a.ord || 0) - (b.ord || 0));
    res.json({ items: ordered });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// delete note (owner only)
router.delete('/api/notes/:id', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const id = Number(req.params.id);
  try {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) return res.status(404).json({ error: 'not found' });
    if (note.ownerId !== user.id) return res.status(403).json({ error: 'forbidden' });
    await prisma.$transaction([
      prisma.noteItem.deleteMany({ where: { noteId: id } }),
      prisma.noteImage.deleteMany({ where: { noteId: id } }),
      prisma.noteLabel.deleteMany({ where: { noteId: id } }),
      prisma.collaborator.deleteMany({ where: { noteId: id } }),
      prisma.note.delete({ where: { id } })
    ]);
    res.json({ ok: true });
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

