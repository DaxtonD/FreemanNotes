import { Router, Request, Response, NextFunction } from "express";
import prisma from "./prismaClient";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sendInviteEmail } from "./mail";
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { notifyUser } from './events';

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

// register (supports optional invite token when registration is disabled)
router.post("/api/auth/register", async (req: Request, res: Response) => {
  const { email, password, name, inviteToken } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  // Bootstrap allowance: if no users exist yet, allow registration even if disabled
  const usersCount = await prisma.user.count();
  const registrationEnabled = String(process.env.USER_REGISTRATION_ENABLED || '').toLowerCase() === 'true' || usersCount === 0;
  let invite: any = null;

  if (!registrationEnabled) {
    if (!inviteToken) return res.status(403).json({ error: "registration disabled; invite required" });
    try {
      invite = await prisma.invite.findUnique({ where: { token: inviteToken } });
    } catch (e) {
      invite = null;
    }
    if (!invite) return res.status(400).json({ error: "invalid invite token" });
    if (invite.usedAt) return res.status(400).json({ error: "invite already used" });
    if (invite.email && invite.email !== email) return res.status(400).json({ error: "invite email does not match registration email" });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: "email already registered" });
    const hash = await bcrypt.hash(password, 10);
    let role: string = 'user';
    if (usersCount === 0) {
      // Bootstrap: first user becomes admin by default
      role = 'admin';
    } else if (invite && (invite.desiredRole === 'admin' || invite.desiredRole === 'user')) {
      role = invite.desiredRole;
    }
    const user = await prisma.user.create({ data: {
      email,
      name: name || null,
      passwordHash: hash,
      role,
      // initial preferences
      fontFamily: 'Calibri, system-ui, Arial, sans-serif',
      dragBehavior: 'swap',
      animationSpeed: 'normal',
      checklistSpacing: 15,
      checkboxSize: 20,
      checklistTextSize: 17,
      noteWidth: 288
    } });
    const token = jwt.sign({ userId: user.id }, getJwtSecret(), { expiresIn: "7d" });
    if (invite) {
      try {
        await prisma.invite.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
      } catch (e) {
        // non-fatal
        console.warn('Failed to mark invite used', e);
      }
    }
    // hide passwordHash in response
    // @ts-ignore
    delete user.passwordHash;
    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// login
router.post("/api/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) return res.status(401).json({ error: "invalid credentials" });
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: "invalid credentials" });
    const token = jwt.sign({ userId: user.id }, getJwtSecret(), { expiresIn: "7d" });
    // @ts-ignore
    delete user.passwordHash;
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// get current user
router.get("/api/auth/me", async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: "unauthenticated" });
  // @ts-ignore
  delete user.passwordHash;
  res.json({ user });
});

// update current user (partial)
router.patch('/api/auth/me', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const body = req.body || {};
  const { name, fontFamily, noteWidth, dragBehavior, animationSpeed, checklistSpacing, checkboxSize, checklistTextSize, chipDisplayMode } = body as any;
  const data: any = {};
  if (typeof name === 'string') data.name = name;
  if (typeof fontFamily === 'string') data.fontFamily = fontFamily;
  if (typeof noteWidth === 'number') data.noteWidth = noteWidth;
  if (typeof dragBehavior === 'string') data.dragBehavior = dragBehavior;
  if (typeof animationSpeed === 'string') data.animationSpeed = animationSpeed;
  if (typeof checklistSpacing === 'number') data.checklistSpacing = checklistSpacing;
  if (typeof checkboxSize === 'number') data.checkboxSize = checkboxSize;
  if (typeof checklistTextSize === 'number') data.checklistTextSize = checklistTextSize;
  if (typeof chipDisplayMode === 'string') data.chipDisplayMode = chipDisplayMode;
  // allow setting checkbox colors to string values or null to clear
  if ('checkboxBg' in body) data.checkboxBg = (body as any).checkboxBg;
  if ('checkboxBorder' in body) data.checkboxBorder = (body as any).checkboxBorder;
  try {
    const updated = await prisma.user.update({ where: { id: (user as any).id }, data });
    // @ts-ignore
    delete updated.passwordHash;
    res.json({ user: updated });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// expose lightweight config to client (e.g. toggle registration)
router.get('/api/config', (_req: Request, res: Response) => {
  const enabled = String(process.env.USER_REGISTRATION_ENABLED || '').toLowerCase() === 'true';
  res.json({ userRegistrationEnabled: enabled });
});

// send invite (authenticated)
router.post('/api/invite', async (req: Request, res: Response) => {
  const inviter = await getUserFromToken(req);
  if (!inviter) return res.status(401).json({ error: 'unauthenticated' });
  if (inviter.role !== 'admin') return res.status(403).json({ error: 'forbidden: admin only' });
  const { email, role } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  try {
    const token = require('crypto').randomBytes(16).toString('hex');
    const desiredRole = role === 'admin' ? 'admin' : 'user';
    const invite = await prisma.invite.create({ data: { email, token, invitedById: inviter.id, desiredRole } });
    let emailSent = false;
    try {
      await sendInviteEmail(invite.email, invite.token);
      emailSent = true;
    } catch (err) {
      console.warn('Failed to send invite email:', err);
    }
    res.status(201).json({ invite: { id: invite.id, email: invite.email, token: invite.token, role: invite.desiredRole }, emailSent });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;

// upload/update current user's photo (expects JSON { dataUrl: string })
router.post('/api/auth/me/photo', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const dataUrl = String((req.body || {}).dataUrl || '');
  if (!dataUrl.startsWith('data:image/')) return res.status(400).json({ error: 'invalid image data' });
  try {
    const commaIdx = dataUrl.indexOf(',');
    const b64 = dataUrl.slice(commaIdx + 1);
    const buf = Buffer.from(b64, 'base64');
    // Resize and compress to avatar size
    const out = await sharp(buf)
      .resize({ width: 256, height: 256, fit: 'cover' })
      .jpeg({ quality: 80 })
      .toBuffer();
    // Ensure uploads directory exists
    const uploadsDir = path.resolve(__dirname, '..', '..', 'uploads');
    const usersDir = path.join(uploadsDir, 'users');
    try { fs.mkdirSync(usersDir, { recursive: true }); } catch {}
    const filename = `${user.id}.jpg`;
    const filePath = path.join(usersDir, filename);
    fs.writeFileSync(filePath, out);
    const publicUrl = `/uploads/users/${filename}?v=${Date.now()}`;
    const updated = await prisma.user.update({ where: { id: user.id }, data: { userImageUrl: publicUrl } });
    // Broadcast to all participants who share notes with this user
    try {
      const notes = await prisma.note.findMany({
        where: {
          OR: [
            { ownerId: user.id },
            { collaborators: { some: { userId: user.id } } }
          ]
        },
        select: { ownerId: true, collaborators: { select: { userId: true } } }
      });
      const ids = new Set<number>();
      for (const n of notes) {
        ids.add(n.ownerId);
        for (const c of n.collaborators) ids.add(c.userId);
      }
      ids.delete(user.id);
      for (const uid of ids) notifyUser(uid, 'user-photo-updated', { userId: user.id, userImageUrl: publicUrl });
    } catch {}
    // @ts-ignore
    delete updated.passwordHash;
    res.json({ user: updated });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
