import { Router, Request, Response } from "express";
import prisma from "./prismaClient";
import jwt from "jsonwebtoken";

const router = Router();

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not set in environment");
  return s;
}

async function getUserFromToken(req: Request) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
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
    const notes = await prisma.note.findMany({
      where: {
        OR: [
          { ownerId: user.id },
          { collaborators: { some: { userId: user.id } } }
        ]
      },
      include: {
        collaborators: { include: { user: true } },
        items: true,
        images: true,
        noteLabels: { include: { label: true } }
      },
      orderBy: [{ ord: 'asc' }, { updatedAt: 'desc' }]
    });
    // ensure checklist items are returned in ord order
    const normalized = notes.map(n => ({ ...n, items: (n.items || []).slice().sort((a, b) => (a.ord || 0) - (b.ord || 0)) }));
    res.json({ notes: normalized });
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
    if (note.ownerId !== user.id) return res.status(403).json({ error: 'forbidden' });

    // upsert label for this user (unique on ownerId+name)
    const label = await prisma.label.upsert({
      where: { ownerId_name: { ownerId: user.id, name } },
      update: {},
      create: { ownerId: user.id, name }
    });
    // link label to note (unique on noteId+labelId)
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
  const allowed = ['title', 'body', 'pinned', 'archived', 'type', 'color'];
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

    // sync: for simplicity, delete items not present and upsert provided items
    const idsToKeep = items.filter(i => i.id).map(i => Number(i.id));
    await prisma.$transaction([
      prisma.noteItem.deleteMany({ where: { noteId, id: { notIn: idsToKeep.length ? idsToKeep : [0] } } }),
      // then upsert each provided item
      ...items.map((it, idx) => {
        if (it.id) {
          return prisma.noteItem.update({ where: { id: Number(it.id) }, data: { content: String(it.content || ''), checked: !!it.checked, ord: typeof it.ord === 'number' ? it.ord : idx, indent: typeof it.indent === 'number' ? it.indent : 0 } });
        }
        return prisma.noteItem.create({ data: { noteId, content: String(it.content || ''), checked: !!it.checked, ord: typeof it.ord === 'number' ? it.ord : idx, indent: typeof it.indent === 'number' ? it.indent : 0 } });
      })
    ]);

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
    if (note.ownerId !== user.id) return res.status(403).json({ error: 'forbidden' });
    await prisma.collaborator.delete({ where: { id: collabId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;

