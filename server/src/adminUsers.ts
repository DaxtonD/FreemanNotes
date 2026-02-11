import { Router, Request, Response } from "express";
import prisma from "./prismaClient";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { getUploadsDir } from './uploads';
import * as fsp from 'fs/promises';
import path from 'path';

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
  } catch {
    return null;
  }
}

async function requireAdmin(req: Request, res: Response) {
  const user = await getUserFromToken(req);
  if (!user) {
    res.status(401).json({ error: "unauthenticated" });
    return null;
  }
  if (String((user as any).role || "") !== "admin") {
    res.status(403).json({ error: "forbidden: admin only" });
    return null;
  }
  return user;
}

function safeUser(u: any) {
  return {
    id: Number(u.id),
    email: String(u.email || ""),
    name: u.name == null ? null : String(u.name),
    role: String(u.role || "user"),
    userImageUrl: u.userImageUrl == null ? null : String(u.userImageUrl),
    createdAt: u.createdAt,
    updatedAt: u.updatedAt
  };
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

async function cleanupUserNoteUploadsForUrls(opts: { userId: number; urls: string[] }): Promise<void> {
  const userId = Number(opts.userId);
  if (!Number.isFinite(userId)) return;

  const prefix = `/uploads/notes/${userId}/`;
  const unique = Array.from(new Set(
    (opts.urls || [])
      .map((u) => stripUrlQueryAndHash(String(u || '').trim()))
      .filter((u) => u && u.startsWith(prefix))
  ));

  if (unique.length === 0) return;

  // Check for any remaining DB references (e.g., another note copied the same URL).
  const remaining = new Set<string>();
  const chunkSize = 500;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    try {
      const rows = await prisma.noteImage.findMany({ where: { url: { in: chunk } }, select: { url: true } });
      for (const r of (rows || []) as any[]) {
        const u = String((r as any)?.url || '');
        if (u) remaining.add(u);
      }
    } catch {
      // If we can't check, be conservative and abort cleanup.
      return;
    }
  }

  const uploadsDir = getUploadsDir();
  for (const url of unique) {
    if (remaining.has(url)) continue;

    const rel = url.slice('/uploads/'.length);
    const abs = uploadsAbsPathFromRel(rel);
    if (!abs) continue;

    try { await fsp.unlink(abs); } catch {}

    // Best-effort: prune now-empty directories (note folder, then user folder).
    try {
      const fileDir = path.dirname(abs);
      if (isPathInside(uploadsDir, fileDir)) {
        await fsp.rmdir(fileDir).catch(() => {});
      }
      const userDir = path.join(uploadsDir, 'notes', String(userId));
      if (isPathInside(uploadsDir, userDir)) {
        await fsp.rmdir(userDir).catch(() => {});
      }
    } catch {}
  }
}

// List/search users + roles (admin only)
router.get("/api/admin/users", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const q = (typeof (req.query as any)?.q === "string" ? String((req.query as any).q) : "").trim();
  const takeRaw = Number((req.query as any)?.take ?? 100);
  const take = Number.isFinite(takeRaw) ? Math.max(1, Math.min(200, Math.floor(takeRaw))) : 100;

  try {
    const where: any = q
      ? {
          OR: [
            { email: { contains: q } },
            { name: { contains: q } }
          ]
        }
      : undefined;

    const users = await prisma.user.findMany({
      where,
      orderBy: [{ email: "asc" }, { id: "asc" }],
      take,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        userImageUrl: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({ users: (users || []).map(safeUser) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Update a user's role (admin only)
router.patch("/api/admin/users/:id", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid user id" });

  const roleRaw = (req.body || {}).role;
  const role = roleRaw === "admin" ? "admin" : roleRaw === "user" ? "user" : null;
  if (!role) return res.status(400).json({ error: "invalid role" });

  // Prevent self-lockout by accident.
  if (id === (admin as any).id && role !== "admin") {
    return res.status(400).json({ error: "cannot change your own role" });
  }

  try {
    const updated = await prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        userImageUrl: true,
        createdAt: true,
        updatedAt: true
      }
    });
    res.json({ user: safeUser(updated) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Create a user directly (admin only)
router.post("/api/admin/users", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { email, password, name, role: roleRaw } = req.body || {};
  const emailStr = typeof email === "string" ? email.trim().toLowerCase() : "";
  const passwordStr = typeof password === "string" ? password : "";
  const nameStr = typeof name === "string" ? name.trim() : "";
  const role = roleRaw === "admin" ? "admin" : "user";

  if (!emailStr) return res.status(400).json({ error: "email required" });
  if (!passwordStr || passwordStr.length < 6) return res.status(400).json({ error: "password must be at least 6 characters" });

  try {
    const existing = await prisma.user.findUnique({ where: { email: emailStr } });
    if (existing) return res.status(409).json({ error: "email already registered" });

    const hash = await bcrypt.hash(passwordStr, 10);
    const created = await prisma.user.create({
      data: {
        email: emailStr,
        name: nameStr || null,
        passwordHash: hash,
        role,
        fontFamily: "Calibri, system-ui, Arial, sans-serif",
        dragBehavior: "swap",
        animationSpeed: "normal",
        checklistSpacing: 15,
        checkboxSize: 20,
        checklistTextSize: 17,
        noteWidth: 288,
        noteLineSpacing: 1.38
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        userImageUrl: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.status(201).json({ user: safeUser(created) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Delete a user (admin only). Deletes owned notes + related data.
router.delete("/api/admin/users/:id", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid user id" });
  if (id === (admin as any).id) return res.status(400).json({ error: "cannot delete your own user" });

  try {
    // Ensure user exists before doing work.
    const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) return res.status(404).json({ error: "user not found" });

    // Preload note image URLs for owned notes so we can delete persisted uploads after DB delete.
    const imgs = await prisma.noteImage.findMany({ where: { note: { ownerId: id } } as any, select: { url: true } as any });
    const imageUrls = (imgs || []).map((i: any) => String(i?.url || '')).filter(Boolean);

    await prisma.$transaction([
      // Remove this user as a collaborator on other people's notes.
      prisma.collaborator.deleteMany({ where: { userId: id } }),

      // Remove device-scoped prefs and device bindings.
      (prisma as any).userDevicePrefs.deleteMany({ where: { profile: { userId: id } } }),
      (prisma as any).userDeviceClient.deleteMany({ where: { userId: id } }),
      (prisma as any).userDeviceProfile.deleteMany({ where: { userId: id } }),

      // Remove note-related join data for notes owned by this user.
      (prisma as any).noteCollection.deleteMany({ where: { note: { ownerId: id } } }),
      (prisma as any).notePref.deleteMany({ where: { note: { ownerId: id } } }),
      (prisma as any).collaborator.deleteMany({ where: { note: { ownerId: id } } }),
      (prisma as any).noteLabel.deleteMany({ where: { note: { ownerId: id } } }),
      (prisma as any).noteImage.deleteMany({ where: { note: { ownerId: id } } }),
      (prisma as any).noteItem.deleteMany({ where: { note: { ownerId: id } } }),

      // Delete notes owned by this user.
      prisma.note.deleteMany({ where: { ownerId: id } }),

      // Remove user-owned metadata.
      (prisma as any).collection.deleteMany({ where: { ownerId: id } }),
      (prisma as any).label.deleteMany({ where: { ownerId: id } }),
      (prisma as any).invite.deleteMany({ where: { invitedById: id } }),

      // Finally delete the user.
      prisma.user.delete({ where: { id } })
    ]);

    // Best-effort: remove persisted uploads for deleted user's owned notes.
    try {
      await cleanupUserNoteUploadsForUrls({ userId: id, urls: imageUrls });
    } catch {}

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
