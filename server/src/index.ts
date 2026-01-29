import express from "express";
import path from "path";
import dotenv from "dotenv";
import { ensureDatabaseReady } from "./dbSetup";

dotenv.config();

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const app = express();

app.use(express.json());

async function start() {
  const isDev = process.env.NODE_ENV !== "production";
  const clientRoot = path.resolve(__dirname, "..", "..", "client");

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
  } catch (err) {
    console.warn("Startup DB initialization warning:", err);
  }

  if (isDev) {
    // Use Vite dev server as middleware so one process serves front+api in dev.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: clientRoot,
      server: { middlewareMode: "ssr", hmr: { protocol: "ws" } }
    } as any);
    app.use(vite.middlewares);
    console.log("Vite dev middleware enabled");
  } else {
    // Production: serve built client from client-dist
    const clientDist = path.resolve(__dirname, "..", "..", "client-dist");
    app.use(express.static(clientDist));
    app.get("*", (req, res) => {
      const indexHtml = path.join(clientDist, "index.html");
      res.sendFile(indexHtml);
    });
  }

  app.listen(PORT, () => {
    console.log(`FreemanNotes server running on http://localhost:${PORT} (dev=${isDev})`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
