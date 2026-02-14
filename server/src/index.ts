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
import { startReminderPushJob } from './reminderPushJob';
import { getUploadsDir } from './uploads';
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

    // Background reminders: send Web Push notifications when reminders are due.
    try {
      startReminderPushJob(prisma as any);
      console.log('Reminder push job started');
    } catch (err) {
      console.warn('Reminder push job failed to start:', err);
    }

    // Wire Yjs persistence to Prisma so rooms load from/stay in sync with DB
    try {
      setPersistence({
        bindState: async (docName: string, ydoc: Y.Doc) => {
          // y-websocket uses the URL path as docName (e.g., "collab/note-123").
          // We only need the final segment for note ID parsing.
          const last = docName.split('/').pop() || docName;
          const m = /^note-(\d+)$/.exec(last);
          if (m) {
            const noteId = Number(m[1]);
            try {
              const note = await prisma.note.findUnique({ where: { id: noteId }, include: { items: true } });
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
                    content: ''
                  });
                  if (note.body) {
                    try {
                      const raw = String(note.body);
                      const json = JSON.parse(raw);
                      tempEditor.commands.setContent(json);
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
            // Persist on every update (can be optimized/batched later)
            ydoc.on("update", async () => {
              try {
                const snapshot = Y.encodeStateAsUpdate(ydoc);
                await prisma.note.updateMany({ where: { id: noteId }, data: { yData: Buffer.from(snapshot) } });
              } catch (e) {
                console.warn("Yjs persist error:", e);
              }
            });
          }
        },
        writeState: async (docName: string, ydoc: Y.Doc) => {
          const last = docName.split('/').pop() || docName;
          const m = /^note-(\d+)$/.exec(last);
          if (!m) return;
          const noteId = Number(m[1]);
          try {
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
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
