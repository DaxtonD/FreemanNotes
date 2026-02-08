// Minimal service worker to satisfy PWA installability criteria.
// Intentionally no offline caching yet; fetch is pass-through.

self.addEventListener('install', (event) => {
  try { self.skipWaiting(); } catch {}
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try { await self.clients.claim(); } catch {}
  })());
});

self.addEventListener('fetch', (event) => {
  // No-op: allow browser to handle requests normally.
});
