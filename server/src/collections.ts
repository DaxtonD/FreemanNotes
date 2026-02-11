import { Router, Request, Response } from "express";
import prisma from "./prismaClient";
import jwt from "jsonwebtoken";
import { notifyUser } from "./events";

const router = Router();

function getJwtSecret() {
	const s = process.env.JWT_SECRET;
	if (!s) throw new Error("JWT_SECRET not set in environment");
	return s;
}

async function getUserFromToken(req: Request) {
	const auth = req.headers.authorization;
	let token: string | null = null;
	if (auth && auth.startsWith("Bearer ")) token = auth.slice(7);
	else if (typeof (req as any).query?.token === "string" && String((req as any).query.token).length > 0) token = String((req as any).query.token);
	if (!token) return null;
	try {
		const payload = jwt.verify(token, getJwtSecret()) as any;
		if (!payload?.userId) return null;
		const user = await prisma.user.findUnique({ where: { id: Number(payload.userId) } });
		return user;
	} catch {
		return null;
	}
}

function normalizeParentId(raw: unknown): number | null {
	if (raw == null || raw === "") return null;
	const n = Number(raw);
	return Number.isInteger(n) ? n : null;
}

function normalizeName(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const name = raw.trim();
	if (!name) return null;
	if (name.length > 80) return name.slice(0, 80);
	return name;
}

// List direct children at a given parentId (null = root)
router.get("/api/collections", async (req: Request, res: Response) => {
	const user = await getUserFromToken(req);
	if (!user) return res.status(401).json({ error: "unauthenticated" });
	const parentId = normalizeParentId((req.query as any)?.parentId);
	try {
		const collections = await (prisma as any).collection.findMany({
			where: { ownerId: user.id, parentId },
			orderBy: [{ name: "asc" }, { id: "asc" }],
			select: {
				id: true,
				name: true,
				parentId: true,
				updatedAt: true,
				createdAt: true,
				_count: { select: { children: true } },
			},
		});

		const ids = collections.map((c) => c.id);
		let noteCounts = new Map<number, number>();
		try {
			if (ids.length) {
				const grouped = await (prisma as any).noteCollection.groupBy({
					by: ["collectionId"],
					where: { userId: user.id, collectionId: { in: ids } },
					_count: { _all: true },
				});
				noteCounts = new Map<number, number>(
					grouped
						.filter((g) => typeof g.collectionId === "number")
						.map((g: any) => [Number(g.collectionId), Number(g._count?._all || 0)])
				);
			}
		} catch {}

		res.json({
			collections: collections.map((c: any) => ({
				id: c.id,
				name: c.name,
				parentId: c.parentId,
				hasChildren: Number(c._count?.children || 0) > 0,
				noteCount: Number(noteCounts.get(c.id) || 0),
				createdAt: c.createdAt,
				updatedAt: c.updatedAt,
			})),
		});
	} catch (err) {
		res.status(500).json({ error: String(err) });
	}
});

// Breadcrumb path from root -> collection
router.get('/api/collections/:id/breadcrumb', async (req: Request, res: Response) => {
	const user = await getUserFromToken(req);
	if (!user) return res.status(401).json({ error: 'unauthenticated' });
	const id = Number((req.params as any)?.id);
	if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

	try {
		const breadcrumb: Array<{ id: number; name: string; parentId: number | null }> = [];
		const visited = new Set<number>();
		let cur: number | null = id;
		let guard = 0;

		while (cur != null) {
			guard++;
			if (guard > 64) break;
			if (visited.has(cur)) break;
			visited.add(cur);

			const c = await (prisma as any).collection.findFirst({
				where: { id: cur, ownerId: user.id },
				select: { id: true, name: true, parentId: true },
			});
			if (!c) {
				if (!breadcrumb.length) return res.status(404).json({ error: 'not found' });
				break;
			}
			breadcrumb.push({ id: Number(c.id), name: String(c.name || ''), parentId: c.parentId == null ? null : Number(c.parentId) });
			cur = (c.parentId == null ? null : Number(c.parentId));
		}

		breadcrumb.reverse();
		return res.json({ breadcrumb });
	} catch (err) {
		return res.status(500).json({ error: String(err) });
	}
});

router.post("/api/collections", async (req: Request, res: Response) => {
	const user = await getUserFromToken(req);
	if (!user) return res.status(401).json({ error: "unauthenticated" });
	const name = normalizeName((req.body as any)?.name);
	const parentId = normalizeParentId((req.body as any)?.parentId);
	if (!name) return res.status(400).json({ error: "name required" });
	try {
		if (parentId != null) {
			const parent = await (prisma as any).collection.findFirst({ where: { id: parentId, ownerId: user.id } });
			if (!parent) return res.status(404).json({ error: "parent not found" });
		}
		const created = await (prisma as any).collection.create({
			data: { ownerId: user.id, parentId, name },
			select: { id: true, name: true, parentId: true, createdAt: true, updatedAt: true },
		});
		try {
			notifyUser(user.id, 'collections-changed', { invalidateAll: true, reason: 'create', id: Number(created.id), parentId: (created.parentId == null ? null : Number(created.parentId)), name: String(created.name || '') });
		} catch {}
		res.status(201).json({ collection: created });
	} catch (err: any) {
		// Prisma unique constraint
		if (String(err?.code || "") === "P2002") {
			return res.status(409).json({ error: "collection name already exists" });
		}
		res.status(500).json({ error: String(err) });
	}
});

router.patch("/api/collections/:id", async (req: Request, res: Response) => {
	const user = await getUserFromToken(req);
	if (!user) return res.status(401).json({ error: "unauthenticated" });
	const id = Number(req.params.id);
	if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid id" });
	const name = ("name" in (req.body || {}) ? normalizeName((req.body as any)?.name) : undefined);
	if (name === null) return res.status(400).json({ error: "name required" });
	try {
		const existing = await (prisma as any).collection.findFirst({ where: { id, ownerId: user.id } });
		if (!existing) return res.status(404).json({ error: "not found" });
		const updated = await (prisma as any).collection.update({
			where: { id },
			data: { ...(typeof name === "string" ? { name } : {}) },
			select: { id: true, name: true, parentId: true, createdAt: true, updatedAt: true },
		});
		try {
			notifyUser(user.id, 'collections-changed', { invalidateAll: true, reason: 'rename', id: Number(updated.id), parentId: (updated.parentId == null ? null : Number(updated.parentId)), name: String(updated.name || '') });
		} catch {}
		res.json({ collection: updated });
	} catch (err: any) {
		if (String(err?.code || "") === "P2002") {
			return res.status(409).json({ error: "collection name already exists" });
		}
		res.status(500).json({ error: String(err) });
	}
});

router.delete("/api/collections/:id", async (req: Request, res: Response) => {
	const user = await getUserFromToken(req);
	if (!user) return res.status(401).json({ error: "unauthenticated" });
	const id = Number(req.params.id);
	if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid id" });
	try {
		const existing = await (prisma as any).collection.findFirst({ where: { id, ownerId: user.id } });
		if (!existing) return res.status(404).json({ error: "not found" });

		// Determine subtree ids (so notes in nested collections update too).
		const subtreeIds: number[] = [];
		try {
			const seen = new Set<number>();
			let frontier: number[] = [Number(id)];
			let guard = 0;
			while (frontier.length && guard < 256) {
				guard++;
				const next: number[] = [];
				for (const cid of frontier) {
					if (!Number.isInteger(cid) || seen.has(cid)) continue;
					seen.add(cid);
					subtreeIds.push(cid);
				}
				if (!subtreeIds.length) break;
				const kids = await (prisma as any).collection.findMany({
					where: { ownerId: user.id, parentId: { in: frontier } },
					select: { id: true },
				});
				for (const k of (Array.isArray(kids) ? kids : [])) {
					const kid = Number((k as any)?.id);
					if (Number.isInteger(kid) && !seen.has(kid)) next.push(kid);
				}
				frontier = next;
			}
		} catch {
			// Fallback: just treat the target as the only id.
			if (!subtreeIds.length) subtreeIds.push(Number(id));
		}

		// Capture affected note ids before deletion (so we can notify clients).
		const affectedNoteIds: number[] = [];
		try {
			const rows = await (prisma as any).noteCollection.findMany({
				where: { userId: user.id, collectionId: { in: subtreeIds } },
				select: { noteId: true },
			});
			const set = new Set<number>();
			for (const r of (Array.isArray(rows) ? rows : [])) {
				const nid = Number((r as any)?.noteId);
				if (Number.isInteger(nid)) set.add(nid);
			}
			affectedNoteIds.push(...Array.from(set.values()));
		} catch {}

		// Delete the collection. DB constraints are configured to cascade to children and memberships.
		await (prisma as any).collection.delete({ where: { id } });

		// Notify all active clients for this user so note chips update immediately.
		try {
			if (affectedNoteIds.length) {
				const remainingRows = await (prisma as any).noteCollection.findMany({
					where: { userId: user.id, noteId: { in: affectedNoteIds } },
					include: { collection: { select: { id: true, name: true, parentId: true } } },
					orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
				});
				const map = new Map<number, Array<{ id: number; name: string; parentId: number | null }>>();
				for (const row of (Array.isArray(remainingRows) ? remainingRows : [])) {
					const nid = Number((row as any)?.noteId);
					const c = (row as any)?.collection;
					if (!Number.isInteger(nid) || !c || typeof c.id !== 'number') continue;
					const entry = map.get(nid) || [];
					entry.push({ id: Number(c.id), name: String(c.name || ''), parentId: (c.parentId == null ? null : Number(c.parentId)) });
					map.set(nid, entry);
				}
				for (const nid of affectedNoteIds) {
					notifyUser(user.id, 'note-collections-changed', { noteId: nid, collections: map.get(nid) || [] });
				}
			}
		} catch {}
		try {
			notifyUser(user.id, 'collections-changed', { invalidateAll: true, reason: 'delete', id: Number(id), subtreeIds });
		} catch {}

		res.json({ ok: true });
	} catch (err) {
		res.status(500).json({ error: String(err) });
	}
});

async function ensureUserCanAccessNote(userId: number, noteId: number): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
	try {
		const note = await prisma.note.findUnique({ where: { id: noteId } });
		if (!note) return { ok: false, status: 404, error: "note not found" };
		if (note.ownerId === userId) return { ok: true };
		const collab = await prisma.collaborator.findFirst({ where: { noteId, userId } });
		if (!collab) return { ok: false, status: 403, error: "forbidden" };
		return { ok: true };
	} catch (e) {
		return { ok: false, status: 500, error: String(e) };
	}
}

async function getNoteCollectionsForUser(userId: number, noteId: number) {
	const rows = await (prisma as any).noteCollection.findMany({
		where: { userId, noteId },
		include: { collection: { select: { id: true, name: true, parentId: true } } },
		orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
	});
	const collections = (Array.isArray(rows) ? rows : [])
		.map((r: any) => r && r.collection)
		.filter((c: any) => c && typeof c.id === 'number' && typeof c.name === 'string')
		.map((c: any) => ({ id: Number(c.id), name: String(c.name), parentId: (c.parentId == null ? null : Number(c.parentId)) }));
	return collections;
}

// List collections that this note belongs to (for current user).
router.get('/api/notes/:id/collections', async (req: Request, res: Response) => {
	const user = await getUserFromToken(req);
	if (!user) return res.status(401).json({ error: 'unauthenticated' });
	const noteId = Number(req.params.id);
	if (!Number.isInteger(noteId)) return res.status(400).json({ error: 'invalid note id' });
	const access = await ensureUserCanAccessNote(user.id, noteId);
	if (access.ok === false) return res.status(access.status).json({ error: access.error });
	try {
		const collections = await getNoteCollectionsForUser(user.id, noteId);
		return res.json({ collections });
	} catch (err) {
		return res.status(500).json({ error: String(err) });
	}
});

// Add note to a collection (for current user).
router.post('/api/notes/:id/collections', async (req: Request, res: Response) => {
	const user = await getUserFromToken(req);
	if (!user) return res.status(401).json({ error: 'unauthenticated' });
	const noteId = Number(req.params.id);
	if (!Number.isInteger(noteId)) return res.status(400).json({ error: 'invalid note id' });
	const collectionId = Number((req.body as any)?.collectionId);
	if (!Number.isInteger(collectionId)) return res.status(400).json({ error: 'invalid collection id' });
	const access = await ensureUserCanAccessNote(user.id, noteId);
	if (access.ok === false) return res.status(access.status).json({ error: access.error });
	try {
		const collection = await (prisma as any).collection.findFirst({ where: { id: collectionId, ownerId: user.id } });
		if (!collection) return res.status(404).json({ error: 'collection not found' });

		await (prisma as any).noteCollection.upsert({
			where: { userId_noteId_collectionId: { userId: user.id, noteId, collectionId } },
			update: {},
			create: { userId: user.id, noteId, collectionId },
		});
		const collections = await getNoteCollectionsForUser(user.id, noteId);
		try { notifyUser(user.id, 'note-collections-changed', { noteId, collections }); } catch {}
		try { notifyUser(user.id, 'collections-changed', { reason: 'membership', noteId, collectionId }); } catch {}
		return res.status(201).json({ ok: true, collections });
	} catch (err) {
		return res.status(500).json({ error: String(err) });
	}
});

// Remove note from a collection (for current user).
router.delete('/api/notes/:id/collections/:collectionId', async (req: Request, res: Response) => {
	const user = await getUserFromToken(req);
	if (!user) return res.status(401).json({ error: 'unauthenticated' });
	const noteId = Number(req.params.id);
	const collectionId = Number(req.params.collectionId);
	if (!Number.isInteger(noteId) || !Number.isInteger(collectionId)) return res.status(400).json({ error: 'invalid ids' });
	const access = await ensureUserCanAccessNote(user.id, noteId);
	if (access.ok === false) return res.status(access.status).json({ error: access.error });
	try {
		await (prisma as any).noteCollection.deleteMany({ where: { userId: user.id, noteId, collectionId } });
		const collections = await getNoteCollectionsForUser(user.id, noteId);
		try { notifyUser(user.id, 'note-collections-changed', { noteId, collections }); } catch {}
		try { notifyUser(user.id, 'collections-changed', { reason: 'membership', noteId, collectionId }); } catch {}
		return res.json({ ok: true, collections });
	} catch (err) {
		return res.status(500).json({ error: String(err) });
	}
});

// Clear all collections for a note (for current user).
router.delete('/api/notes/:id/collections', async (req: Request, res: Response) => {
	const user = await getUserFromToken(req);
	if (!user) return res.status(401).json({ error: 'unauthenticated' });
	const noteId = Number(req.params.id);
	if (!Number.isInteger(noteId)) return res.status(400).json({ error: 'invalid note id' });
	const access = await ensureUserCanAccessNote(user.id, noteId);
	if (access.ok === false) return res.status(access.status).json({ error: access.error });
	try {
		await (prisma as any).noteCollection.deleteMany({ where: { userId: user.id, noteId } });
		const collections: any[] = [];
		try { notifyUser(user.id, 'note-collections-changed', { noteId, collections }); } catch {}
		try { notifyUser(user.id, 'collections-changed', { reason: 'membership', noteId }); } catch {}
		return res.json({ ok: true, collections });
	} catch (err) {
		return res.status(500).json({ error: String(err) });
	}
});

// Legacy endpoint: set note to a *single* collection (or null to clear all).
router.put("/api/notes/:id/collection", async (req: Request, res: Response) => {
	const user = await getUserFromToken(req);
	if (!user) return res.status(401).json({ error: "unauthenticated" });
	const noteId = Number(req.params.id);
	if (!Number.isInteger(noteId)) return res.status(400).json({ error: "invalid note id" });
	const rawCollectionId = (req.body as any)?.collectionId;
	const collectionId = (rawCollectionId == null || rawCollectionId === "") ? null : Number(rawCollectionId);
	if (collectionId != null && !Number.isInteger(collectionId)) return res.status(400).json({ error: "invalid collection id" });

	try {
		const access = await ensureUserCanAccessNote(user.id, noteId);
		if (access.ok === false) return res.status(access.status).json({ error: access.error });

		await (prisma as any).noteCollection.deleteMany({ where: { userId: user.id, noteId } });
		if (collectionId != null) {
			const collection = await (prisma as any).collection.findFirst({ where: { id: collectionId, ownerId: user.id } });
			if (!collection) return res.status(404).json({ error: "collection not found" });
			await (prisma as any).noteCollection.create({ data: { userId: user.id, noteId, collectionId } });
		}
		const collections = await getNoteCollectionsForUser(user.id, noteId);
		try { notifyUser(user.id, 'note-collections-changed', { noteId, collections }); } catch {}
		try { notifyUser(user.id, 'collections-changed', { reason: 'membership', noteId }); } catch {}
		return res.json({ ok: true, collections });
	} catch (err) {
		res.status(500).json({ error: String(err) });
	}
});

export default router;
