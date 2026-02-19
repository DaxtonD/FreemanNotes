import express from "express";
import path from "path";
import fs from 'fs';
import dotenv from "dotenv";
import { ensureDatabaseReady } from "./dbSetup";
import http from "http";
import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { registerConnection, removeConnection } from "./events";
import { startTrashCleanupJob } from './trashCleanup';
import { getUploadsDir } from './uploads';
import { closeReminderQueue, getReminderQueue, resyncReminderJobs } from './lib/queue';
import { isReminderWorkerEnabled } from './lib/redis';
import { createYjsRedisBridge } from './lib/yjsRedisBridge';
// y-websocket util sets up Yjs collaboration rooms over WebSocket
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
// Import y-websocket utils and persistence hook
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { setupWSConnection, setPersistence } from "y-websocket/bin/utils";
import * as Y from "yjs";
// TipTap headless editor to initialize Yjs doc state from DB on server
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import Collaboration from "@tiptap/extension-collaboration";

dotenv.config();

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const app = express();

// Increase JSON body limit to support data URL image uploads.
// Configurable via env MAX_IMAGE_UPLOAD_MB (default 10MB).
const imgLimitMb = (() => {
  const raw = process.env.MAX_IMAGE_UPLOAD_MB;
  const n = raw ? Number(raw) : 10;
  return Number.isFinite(n) && n > 0 ? n : 10;
})();
app.use(express.json({ limit: `${imgLimitMb}mb` }));
// Serve uploaded files (e.g., user photos)
try {
  const uploadsDir = getUploadsDir();
  try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch {}
  app.use('/uploads', express.static(uploadsDir));
} catch {}

async function start() {
  const isDev = process.env.NODE_ENV !== "production";
  const clientRoot = path.resolve(__dirname, "..", "..", "client");
  let routesRegistered = false;
  const yjsRedisBridge = createYjsRedisBridge();
  let stopReminderWorkerFn: null | (() => Promise<void>) = null;

  // Attempt Prisma connection on startup
  try {
    await ensureDatabaseReady();

    // Import Prisma client after migrations/generation to avoid Windows file-lock
    const { default: prisma } = await import("./prismaClient");
    try {
      await prisma.$connect();
      console.log("Prisma connected.");
    } catch (err) {
      console.warn("Prisma connection warning:", err);
    }

    // Background cleanup: auto-empty trash based on user preference.
    try {
      startTrashCleanupJob(prisma as any);
      console.log('Trash cleanup job started');
    } catch (err) {
      console.warn('Trash cleanup job failed to start:', err);
    }

    // Reminder scheduling via BullMQ + Redis (replaces polling).
    try {
      // Ensure queue can initialize and resync delayed jobs from DB state.
      getReminderQueue();
      await resyncReminderJobs(prisma as any);
      if (isReminderWorkerEnabled()) {
        const mod = await import('./workers/reminderWorker');
        mod.startReminderWorker(prisma as any);
        stopReminderWorkerFn = async () => { await mod.stopReminderWorker(); };
      } else {
        console.log('[reminderWorker] not started (ENABLE_REMINDER_WORKER != true)');
      }
    } catch (err) {
      console.warn('[reminderQueue] startup failed:', err);
    }

    // Wire Yjs persistence to Prisma so rooms load from/stay in sync with DB
    try {
      const yjsPersistDebounceMs = (() => {
        const raw = Number(process.env.YJS_PERSIST_DEBOUNCE_MS || 700);
        if (!Number.isFinite(raw)) return 700;
        return Math.max(150, Math.min(5000, Math.floor(raw)));
      })();

      const parseCollabRoom = (docName: string): { noteId: number; stamp: string | null } | null => {
        const last = String(docName || '').split('/').pop() || String(docName || '');
        const m = /^note-(\d+)(?:-c([0-9a-z]+))?$/i.exec(last);
        if (!m) return null;
        const noteId = Number(m[1]);
        if (!Number.isFinite(noteId) || noteId <= 0) return null;
        const stamp = (m[2] ? String(m[2]).toLowerCase() : null);
        return { noteId, stamp };
      };
      const collabStampFromCreatedAt = (createdAt: unknown): string | null => {
        try {
          const d = createdAt instanceof Date ? createdAt : new Date(String(createdAt || ''));
          const ms = d.getTime();
          if (!Number.isFinite(ms) || ms <= 0) return null;
          return ms.toString(36);
        } catch {
          return null;
        }
      };

      setPersistence({
        bindState: async (docName: string, ydoc: Y.Doc) => {
          const parsed = parseCollabRoom(docName);
          if (parsed) {
            const noteId = Number(parsed.noteId);
            try {
              const note = await prisma.note.findUnique({ where: { id: noteId }, include: { items: true } });
              if (!note) return;
              const expectedStamp = collabStampFromCreatedAt((note as any).createdAt);
              // Reject legacy/incorrect rooms so note ID reuse after DB reset cannot
              // attach stale in-memory collaboration state to a new note.
              if (!expectedStamp || !parsed.stamp || String(parsed.stamp) !== String(expectedStamp)) {
                console.warn('Ignoring non-canonical collab room', { docName, noteId, expectedStamp, gotStamp: parsed.stamp || null });
                return;
              }
              if (yjsRedisBridge.enabled) {
                try { yjsRedisBridge.registerDoc(docName, ydoc); } catch {}
              }
              const persisted = note?.yData as unknown as Buffer | null;
              const hasPersisted = !!(persisted && persisted.length > 0);
              if (hasPersisted) {
                Y.applyUpdate(ydoc, new Uint8Array(persisted as Buffer));
              } else if (note) {
                // Initialize Y.Doc from DB once, server-authoritatively.
                // 1) Text notes: seed ProseMirror fragment with TipTap JSON or plain text.
                try {
                  const tempEditor = new Editor({
                    extensions: [
                      StarterKit.configure({ heading: { levels: [1,2,3] } }),
                      Link.configure({ openOnClick: false, autolink: false }),
                      TextAlign.configure({ types: ['heading', 'paragraph'] }),
                      Collaboration.configure({ document: ydoc })
                    ],
                    // Use JSON doc content on server (not string HTML) to avoid
                    // window-dependent parsing in non-browser runtime.
                    content: { type: 'doc', content: [{ type: 'paragraph' }] }
                  });
                  if (note.body) {
                    try {
                      const raw = String(note.body);
                      const json = JSON.parse(raw);
                      if (json && typeof json === 'object') {
                        tempEditor.commands.setContent(json as any);
                      } else {
                        throw new Error('Non-object JSON body');
                      }
                    } catch {
                      // Fallback: plain HTML/text body inside a paragraph
                      tempEditor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: String(note.body) }]}] });
                    }
                  }
                  // 2) Checklist items: seed Y.Array<Y.Map>
                  try {
                    const yarr = ydoc.getArray<Y.Map<any>>('checklist');
                    if (Array.isArray(note.items) && note.items.length) {
                      const toInsert = note.items.map(it => {
                        const m = new Y.Map<any>();
                        if (typeof it.id === 'number') m.set('id', it.id);
                        m.set('content', String(it.content || ''));
                        m.set('checked', !!it.checked);
                        m.set('indent', typeof it.indent === 'number' ? it.indent : 0);
                        return m;
                      });
                      yarr.insert(0, toInsert);
                    }
                  } catch {}
                  // Persist initial snapshot atomically
                  try {
                    const snapshot = Y.encodeStateAsUpdate(ydoc);
                    await prisma.note.updateMany({ where: { id: noteId }, data: { yData: Buffer.from(snapshot) } });
                  } catch (e) {
                    console.warn('Yjs initial persist error:', e);
                  }
                  try { tempEditor?.destroy(); } catch {}
                } catch (e) {
                  console.warn('Server-side TipTap init error:', e);
                }
              }
            } catch (e) {
              console.warn("Yjs bindState load error:", e);
            }
            // Persist updates in a debounced/batched way.
            // Realtime collaboration itself remains immediate over websocket;
            // only DB snapshot writes are throttled.
            let persistTimer: ReturnType<typeof setTimeout> | null = null;
            let persistInFlight = false;
            let persistQueued = false;

            const persistSnapshot = async () => {
              if (persistInFlight) {
                persistQueued = true;
                return;
              }
              persistInFlight = true;
              try {
                const snapshot = Y.encodeStateAsUpdate(ydoc);
                await prisma.note.updateMany({ where: { id: noteId }, data: { yData: Buffer.from(snapshot) } });
              } catch (e) {
                console.warn("Yjs persist error:", e);
              } finally {
                persistInFlight = false;
                if (persistQueued) {
                  persistQueued = false;
                  // Drain one trailing write if updates arrived mid-flight.
                  if (persistTimer) {
                    try { clearTimeout(persistTimer); } catch {}
                    persistTimer = null;
                  }
                  persistTimer = setTimeout(() => {
                    persistTimer = null;
                    void persistSnapshot();
                  }, yjsPersistDebounceMs);
                }
              }
            };

            const schedulePersist = () => {
              if (persistTimer) {
                try { clearTimeout(persistTimer); } catch {}
              }
              persistTimer = setTimeout(() => {
                persistTimer = null;
                void persistSnapshot();
              }, yjsPersistDebounceMs);
            };

            ydoc.on("update", () => {
              schedulePersist();
            });
          }
        },
        writeState: async (docName: string, ydoc: Y.Doc) => {
          if (yjsRedisBridge.enabled) {
            try { yjsRedisBridge.unregisterDoc(docName, ydoc); } catch {}
          }
          const parsed = parseCollabRoom(docName);
          if (!parsed) return;
          const noteId = Number(parsed.noteId);
          try {
            const note = await prisma.note.findUnique({ where: { id: noteId }, select: { createdAt: true } });
            if (!note) return;
            const expectedStamp = collabStampFromCreatedAt((note as any).createdAt);
            if (!expectedStamp || !parsed.stamp || String(parsed.stamp) !== String(expectedStamp)) return;
            const snapshot = Y.encodeStateAsUpdate(ydoc);
            await prisma.note.updateMany({ where: { id: noteId }, data: { yData: Buffer.from(snapshot) } });
          } catch (e) {
            console.warn("Yjs final persist error:", e);
          }
        }
      });
      console.log("Yjs persistence enabled (DB-backed)");
    } catch (err) {
      console.warn("Failed to enable Yjs persistence:", err);
    }

    // DB health endpoint
    app.get("/api/db-health", async (_req, res) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: "ok", db: "connected" });
      } catch (err) {
        res.status(500).json({ status: "error", db: "unreachable", error: String(err) });
      }
    });

    // Minimal API route for health
    app.get("/api/health", (_req, res) => {
      res.json({ status: "ok", env: process.env.NODE_ENV || "development" });
    });

    // Auth routes
    try {
      const authRouter = (await import("./auth")).default;
      app.use(authRouter);
      console.log("Auth routes registered");
    } catch (err) {
      console.warn("Auth routes not available:", err);
    }
    // Notes routes
    try {
      const notesRouter = (await import("./notes")).default;
      app.use(notesRouter);
      console.log("Notes routes registered");
    } catch (err) {
      console.warn("Notes routes not available:", err);
    }

    // Collections routes
    try {
      const collectionsRouter = (await import("./collections")).default;
      app.use(collectionsRouter);
      console.log("Collections routes registered");
    } catch (err) {
      console.warn("Collections routes not available:", err);
    }

    // Admin user management routes
    try {
      const adminUsersRouter = (await import("./adminUsers")).default;
      app.use(adminUsersRouter);
      console.log("Admin users routes registered");
    } catch (err) {
      console.warn("Admin users routes not available:", err);
    }

    // Push notification routes (Web Push subscriptions + test)
    try {
      const pushRouter = (await import('./push')).default;
      app.use(pushRouter);
      console.log('Push routes registered');
    } catch (err) {
      console.warn('Push routes not available:', err);
    }

    routesRegistered = true;
  } catch (err) {
    console.warn("Startup DB initialization warning:", err);
    // Keep API surface available even if DB bootstrap failed, so clients get
    // proper API errors (e.g. 500) instead of route-level 404 responses.
    if (!routesRegistered) {
      try {
        const authRouter = (await import("./auth")).default;
        app.use(authRouter);
        console.log("Auth routes registered (fallback)");
      } catch (e) {
        console.warn("Auth routes not available (fallback):", e);
      }
      try {
        const notesRouter = (await import("./notes")).default;
        app.use(notesRouter);
        console.log("Notes routes registered (fallback)");
      } catch (e) {
        console.warn("Notes routes not available (fallback):", e);
      }
      try {
        const collectionsRouter = (await import("./collections")).default;
        app.use(collectionsRouter);
        console.log("Collections routes registered (fallback)");
      } catch (e) {
        console.warn("Collections routes not available (fallback):", e);
      }
      try {
        const adminUsersRouter = (await import("./adminUsers")).default;
        app.use(adminUsersRouter);
        console.log("Admin users routes registered (fallback)");
      } catch (e) {
        console.warn("Admin users routes not available (fallback):", e);
      }
      try {
        const pushRouter = (await import('./push')).default;
        app.use(pushRouter);
        console.log('Push routes registered (fallback)');
      } catch (e) {
        console.warn('Push routes not available (fallback):', e);
      }
    }
  }

  if (isDev) {
    // Use Vite dev server as middleware so one process serves front+api in dev.
    const { createServer: createViteServer } = await import("vite");
    const collectAllowedHosts = (): string[] => {
      const hosts = new Set<string>();
      const add = (h?: string | null) => { if (h) hosts.add(h.toLowerCase()); };
      const parseHost = (u?: string | null) => {
        if (!u) return;
        try { const url = new URL(u); add(url.hostname); } catch { add(u); }
      };
      (process.env.ALLOWED_HOSTS || "").split(",").map(s => s.trim()).filter(Boolean).forEach(add);
      parseHost(process.env.APP_BASE_URL || process.env.APP_URL);
      parseHost(process.env.PRODUCTION_URL);
      ["localhost", "127.0.0.1"].forEach(add);
      return Array.from(hosts);
    };
    const vite = await createViteServer({
      root: clientRoot,
      server: { middlewareMode: "ssr", hmr: { protocol: "ws" }, host: true, allowedHosts: collectAllowedHosts() }
    } as any);
    app.use(vite.middlewares);
    console.log("Vite dev middleware enabled");
  } else {
    // Production: serve built client from client-dist
    const clientDist = path.resolve(__dirname, "..", "..", "client-dist");
    app.use(express.static(clientDist, {
      etag: true,
      setHeaders: (res, filePath) => {
        try {
          const rel = path.relative(clientDist, filePath).replace(/\\/g, "/");
          // App shell files must revalidate so new builds roll out.
          if (rel === "index.html" || rel === "manifest.webmanifest" || rel === "sw.js") {
            res.setHeader("Cache-Control", "no-cache");
            return;
          }
          // Vite emits content-hashed assets; safe to cache forever.
          if (rel.startsWith("assets/")) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            return;
          }
          // Default: revalidate.
          res.setHeader("Cache-Control", "no-cache");
        } catch {}
      }
    }));
    app.get("*", (req, res) => {
      const indexHtml = path.join(clientDist, "index.html");
      try { res.setHeader("Cache-Control", "no-cache"); } catch {}
      res.sendFile(indexHtml);
    });
  }

  // Create HTTP server to attach WebSocket upgrade handler for Yjs
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    // Only handle Yjs collaboration upgrades here; leave others (e.g., Vite HMR) alone
    const { url } = request;
    if (url && url.startsWith("/collab")) {
      wss.handleUpgrade(request, socket as any, head, (ws) => {
        setupWSConnection(ws, request);
      });
    } else if (url && url.startsWith("/events")) {
      // Lightweight events channel: authenticate via JWT token in query string
      wss.handleUpgrade(request, socket as any, head, (ws) => {
        try {
          const u = new URL(url, `http://localhost:${PORT}`);
          const token = u.searchParams.get('token') || '';
          const secret = process.env.JWT_SECRET || '';
          const payload = token && secret ? (jwt.verify(token, secret) as any) : null;
          const userId = payload?.userId ? Number(payload.userId) : null;
          if (!userId || !Number.isFinite(userId)) { try { ws.close(); } catch {}; return; }
          registerConnection(userId, ws);
          ws.on('close', () => { try { removeConnection(userId, ws); } catch {} });
        } catch {
          try { ws.close(); } catch {}
        }
      });
    }
    // Do not destroy non-/collab upgrades so other listeners (like Vite) can handle them.
  });

  server.listen(PORT, () => {
    console.log(`FreemanNotes server running on http://localhost:${PORT} (dev=${isDev})`);
    console.log(`Yjs WebSocket endpoint: ws://localhost:${PORT}/collab`);
  });

  const shutdown = async () => {
    try { if (stopReminderWorkerFn) await stopReminderWorkerFn(); } catch {}
    try { await closeReminderQueue(); } catch {}
    try { await yjsRedisBridge.shutdown(); } catch {}
    try { server.close(); } catch {}
  };

  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
