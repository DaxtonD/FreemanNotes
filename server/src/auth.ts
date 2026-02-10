import { Router, Request, Response, NextFunction } from "express";
import prisma from "./prismaClient";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sendInviteEmail } from "./mail";
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { notifyUser } from './events';
import { getUsersUploadsDir } from './uploads';

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

function getDeviceHeaders(req: Request): { deviceKey: string | null; deviceName: string | null } {
  const deviceKeyRaw = (req.headers['x-device-key'] ?? req.headers['x-device-id']) as any;
  const deviceNameRaw = (req.headers['x-device-name'] ?? req.headers['x-device-profile']) as any;
  const deviceKey = (typeof deviceKeyRaw === 'string' ? deviceKeyRaw : Array.isArray(deviceKeyRaw) ? deviceKeyRaw[0] : '').trim();
  const deviceName = (typeof deviceNameRaw === 'string' ? deviceNameRaw : Array.isArray(deviceNameRaw) ? deviceNameRaw[0] : '').trim();
  // Defensive limits.
  const dk = deviceKey && deviceKey.length <= 128 ? deviceKey : null;
  const dn = deviceName && deviceName.length <= 128 ? deviceName : null;
  return { deviceKey: dk, deviceName: dn };
}

type DeviceContext = {
  deviceKey: string;
  deviceName: string;
  profileId: number;
};

async function resolveDeviceContext(userId: number, req: Request): Promise<DeviceContext | null> {
  const { deviceKey, deviceName } = getDeviceHeaders(req);
  if (!deviceKey) return null;
  const name = deviceName || 'Unnamed device';
  const prismaAny = prisma as any;

  // If the client key already exists, use it.
  try {
    const existing = await prismaAny.userDeviceClient.findUnique({
      where: { userId_deviceKey: { userId, deviceKey } },
      select: { profileId: true, profile: { select: { name: true } } }
    });
    if (existing?.profileId) {
      try {
        await prismaAny.userDeviceClient.update({ where: { userId_deviceKey: { userId, deviceKey } }, data: { lastSeenAt: new Date() } });
        await prismaAny.userDeviceProfile.update({ where: { id: existing.profileId }, data: { lastSeenAt: new Date() } });
      } catch {}
      return { deviceKey, deviceName: existing.profile?.name || name, profileId: Number(existing.profileId) };
    }
  } catch {}

  // Otherwise, attach this client key to an existing profile with the same name (per user), or create a new profile.
  let profile: any = null;
  try {
    profile = await prismaAny.userDeviceProfile.upsert({
      where: { userId_name: { userId, name } },
      create: { userId, name, lastSeenAt: new Date() },
      update: { lastSeenAt: new Date() }
    });
  } catch (err) {
    // Fallback: if compound unique isn't supported in generated client yet, try a find/create.
    try {
      profile = await prismaAny.userDeviceProfile.findFirst({ where: { userId, name } });
      if (!profile) profile = await prismaAny.userDeviceProfile.create({ data: { userId, name, lastSeenAt: new Date() } });
    } catch {}
  }
  if (!profile?.id) return null;

  try {
    await prismaAny.userDeviceClient.create({ data: { userId, deviceKey, profileId: profile.id, lastSeenAt: new Date() } });
  } catch {
    // In case of race, update lastSeen.
    try {
      await prismaAny.userDeviceClient.update({ where: { userId_deviceKey: { userId, deviceKey } }, data: { profileId: profile.id, lastSeenAt: new Date() } });
    } catch {}
  }

  return { deviceKey, deviceName: String(profile.name || name), profileId: Number(profile.id) };
}

function mergeEffectivePrefs(user: any, devicePrefs: any | null): any {
  if (!devicePrefs) return user;
  // Keep non-pref user fields intact, but allow device prefs to override preference fields.
  const prefKeys = [
    'themeChoice',
    'checklistSpacing',
    'checkboxSize',
    'checklistTextSize',
    'noteLineSpacing',
    'noteWidth',
    'fontFamily',
    'dragBehavior',
    'animationSpeed',
    'animationBehavior',
    'animationsEnabled',
    'chipDisplayMode',
    'imageThumbSize',
    'editorImageThumbSize',
    'editorImagesExpandedByDefault',
    'disableNoteCardLinks'
  ];
  const merged: any = { ...user };
  for (const k of prefKeys) {
    if (devicePrefs[k] !== undefined && devicePrefs[k] !== null) merged[k] = devicePrefs[k];
  }
  return merged;
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
      noteWidth: 288,
      noteLineSpacing: 1.38
    } });
    // Bind this client to a per-device profile and initialize prefs from defaults.
    try {
      const ctx = await resolveDeviceContext(user.id, req);
      if (ctx) {
        const prismaAny = prisma as any;
        await prismaAny.userDevicePrefs.upsert({
          where: { profileId: ctx.profileId },
          create: {
            profileId: ctx.profileId,
            themeChoice: 'system',
            checklistSpacing: user.checklistSpacing,
            checkboxSize: user.checkboxSize,
            checklistTextSize: user.checklistTextSize,
            noteLineSpacing: user.noteLineSpacing,
            noteWidth: user.noteWidth,
            fontFamily: user.fontFamily,
            dragBehavior: user.dragBehavior,
            animationSpeed: user.animationSpeed,
            chipDisplayMode: user.chipDisplayMode,
            animationsEnabled: true,
            imageThumbSize: 96,
            editorImageThumbSize: 115,
            editorImagesExpandedByDefault: false,
            disableNoteCardLinks: false
          },
          update: { lastSeenAt: new Date() }
        });
      }
    } catch {}
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
    // Attach device context (if present) and return effective per-device prefs merged into user.
    try {
      const ctx = await resolveDeviceContext(user.id, req);
      if (ctx) {
        const prismaAny = prisma as any;
        let devicePrefs = await prismaAny.userDevicePrefs.findUnique({ where: { profileId: ctx.profileId } });
        // Backfill newly device-scoped fields from legacy user-scoped defaults.
        try {
          if (devicePrefs && (devicePrefs as any).disableNoteCardLinks == null && typeof (user as any).disableNoteCardLinks === 'boolean') {
            devicePrefs = await prismaAny.userDevicePrefs.update({
              where: { profileId: ctx.profileId },
              data: { disableNoteCardLinks: (user as any).disableNoteCardLinks }
            });
          }
        } catch {}
        (user as any) = mergeEffectivePrefs(user, devicePrefs);
        (user as any).device = { deviceKey: ctx.deviceKey, deviceName: ctx.deviceName };
      }
    } catch {}
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
  let effective: any = user;
  try {
    const ctx = await resolveDeviceContext(user.id, req);
    if (ctx) {
      const prismaAny = prisma as any;
      let devicePrefs = await prismaAny.userDevicePrefs.findUnique({ where: { profileId: ctx.profileId } });
      // Backfill newly device-scoped fields from legacy user-scoped defaults.
      try {
        if (devicePrefs && (devicePrefs as any).disableNoteCardLinks == null && typeof (user as any).disableNoteCardLinks === 'boolean') {
          devicePrefs = await prismaAny.userDevicePrefs.update({
            where: { profileId: ctx.profileId },
            data: { disableNoteCardLinks: (user as any).disableNoteCardLinks }
          });
        }
      } catch {}
      effective = mergeEffectivePrefs(user, devicePrefs);
      effective.device = { deviceKey: ctx.deviceKey, deviceName: ctx.deviceName };
    }
  } catch {}
  // @ts-ignore
  delete effective.passwordHash;
  res.json({ user: effective });
});

// update current user (partial)
router.patch('/api/auth/me', async (req: Request, res: Response) => {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  const body = req.body || {};
  const { name, fontFamily, noteWidth, dragBehavior, animationSpeed, checklistSpacing, checkboxSize, checklistTextSize, chipDisplayMode, noteLineSpacing, themeChoice, animationBehavior, animationsEnabled, imageThumbSize, trashAutoEmptyDays, linkColorDark, linkColorLight, editorImageThumbSize, editorImagesExpandedByDefault, disableNoteCardLinks } = body as any;

  // Resolve device context early so we can decide whether a pref is user-scoped or device-scoped.
  let deviceCtxEarly: DeviceContext | null = null;
  try { deviceCtxEarly = await resolveDeviceContext((user as any).id, req); } catch {}

  const data: any = {};
  if (typeof name === 'string') data.name = name;
  // Store fontFamily on the user as a durable fallback (covers clients that don't send device headers)
  if (typeof fontFamily === 'string') data.fontFamily = fontFamily;
  if (typeof trashAutoEmptyDays === 'number') {
    const d = Math.max(0, Math.min(3650, Math.trunc(trashAutoEmptyDays)));
    data.trashAutoEmptyDays = d;
  }
  // User-scoped hyperlink colors (persist across devices)
  if ('linkColorDark' in body) data.linkColorDark = (body as any).linkColorDark;
  if ('linkColorLight' in body) data.linkColorLight = (body as any).linkColorLight;
  // Note-card preferences: device-scoped when device headers exist, otherwise fall back to user-scoped.
  if (typeof disableNoteCardLinks === 'boolean' && !deviceCtxEarly) data.disableNoteCardLinks = disableNoteCardLinks;
  // Preference fields are stored per-device profile when a device key is present.
  const prefData: any = {};
  if (typeof fontFamily === 'string') prefData.fontFamily = fontFamily;
  if (typeof noteWidth === 'number') prefData.noteWidth = noteWidth;
  if (typeof dragBehavior === 'string') prefData.dragBehavior = dragBehavior;
  if (typeof animationSpeed === 'string') prefData.animationSpeed = animationSpeed;
  if (typeof checklistSpacing === 'number') prefData.checklistSpacing = checklistSpacing;
  if (typeof checkboxSize === 'number') prefData.checkboxSize = checkboxSize;
  if (typeof checklistTextSize === 'number') prefData.checklistTextSize = checklistTextSize;
  if (typeof chipDisplayMode === 'string') prefData.chipDisplayMode = chipDisplayMode;
  if (typeof noteLineSpacing === 'number') prefData.noteLineSpacing = noteLineSpacing;
  if (typeof themeChoice === 'string') prefData.themeChoice = themeChoice;
  if (typeof animationBehavior === 'string') prefData.animationBehavior = animationBehavior;
  if (typeof animationsEnabled === 'boolean') prefData.animationsEnabled = animationsEnabled;
  if (typeof imageThumbSize === 'number') prefData.imageThumbSize = imageThumbSize;
  if (typeof editorImageThumbSize === 'number' && Number.isFinite(editorImageThumbSize)) {
    prefData.editorImageThumbSize = Math.max(48, Math.min(240, Math.trunc(editorImageThumbSize)));
  }
  if (typeof editorImagesExpandedByDefault === 'boolean') {
    prefData.editorImagesExpandedByDefault = editorImagesExpandedByDefault;
  }
  if (typeof disableNoteCardLinks === 'boolean' && deviceCtxEarly) {
    prefData.disableNoteCardLinks = disableNoteCardLinks;
  }
  // allow setting checkbox colors to string values or null to clear
  if ('checkboxBg' in body) data.checkboxBg = (body as any).checkboxBg;
  if ('checkboxBorder' in body) data.checkboxBorder = (body as any).checkboxBorder;
  try {
    const updatedUser = await prisma.user.update({ where: { id: (user as any).id }, data });

    let effective: any = updatedUser;
    let deviceCtx: DeviceContext | null = deviceCtxEarly;
    let updatedPrefs: any | null = null;
    try {
      if (deviceCtx) {
        const prismaAny = prisma as any;
        if (Object.keys(prefData).length > 0) {
          updatedPrefs = await prismaAny.userDevicePrefs.upsert({
            where: { profileId: deviceCtx.profileId },
            create: { profileId: deviceCtx.profileId, ...prefData },
            update: { ...prefData }
          });
        } else {
          updatedPrefs = await prismaAny.userDevicePrefs.findUnique({ where: { profileId: deviceCtx.profileId } });
        }
        effective = mergeEffectivePrefs(updatedUser, updatedPrefs);
        effective.device = { deviceKey: deviceCtx.deviceKey, deviceName: deviceCtx.deviceName };
      }
    } catch {}

    // Push updated preferences to this user's other connected clients
    try {
      // Device-scoped prefs: only apply to sessions on the same deviceKey.
      const devicePayload: any = {};
      for (const k of Object.keys(prefData || {})) devicePayload[k] = (effective as any)[k];
      if (deviceCtx && Object.keys(devicePayload).length > 0) {
        devicePayload.deviceKey = deviceCtx.deviceKey;
        notifyUser((user as any).id, 'user-prefs-updated', devicePayload);
      }

      // User-scoped prefs: broadcast with no deviceKey so all devices accept.
      const userPayload: any = {};
      for (const k of ['trashAutoEmptyDays', 'checkboxBg', 'checkboxBorder', 'linkColorDark', 'linkColorLight']) {
        if (k in (data || {})) userPayload[k] = (effective as any)[k];
      }
      if (Object.keys(userPayload).length > 0) {
        notifyUser((user as any).id, 'user-prefs-updated', userPayload);
      }
    } catch {}
    // @ts-ignore
    delete effective.passwordHash;
    res.json({ user: effective });
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
    const usersDir = getUsersUploadsDir();
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
