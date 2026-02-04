import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";

dotenv.config();

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const appVersion = pkg.version ?? "0.0.0";

function collectAllowedHosts(): string[] {
  const hosts = new Set<string>();
  const add = (h?: string | null) => { if (h) hosts.add(h.toLowerCase()); };
  const parseHost = (u?: string | null) => {
    if (!u) return;
    try { const url = new URL(u); add(url.hostname); } catch { add(u); }
  };
  // From explicit list
  (process.env.ALLOWED_HOSTS || "").split(",").map(s => s.trim()).filter(Boolean).forEach(add);
  // Derive from base/prod URLs
  parseHost(process.env.APP_BASE_URL || process.env.APP_URL);
  parseHost(process.env.PRODUCTION_URL);
  // Always allow localhost variants
  ["localhost", "127.0.0.1"].forEach(add);
  return Array.from(hosts);
}

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  build: {
    outDir: path.resolve(__dirname, "..", "client-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html")
    }
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: collectAllowedHosts()
  }
});
