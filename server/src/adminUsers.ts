import { Router, Request, Response } from "express";
import prisma from "./prismaClient";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

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

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
