const SHELL_CACHE = 'freemannotes-shell-v2';
const RUNTIME_CACHE = 'freemannotes-runtime-v2';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

function isSameOrigin(reqUrl) {
  try {
    return new URL(reqUrl).origin === self.location.origin;
  } catch {
    return false;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(PRECACHE_URLS);
    } catch {}
    try { await self.skipWaiting(); } catch {}
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
    } catch {}
    try { await self.clients.claim(); } catch {}
  })());
});

self.addEventListener('message', (event) => {
  const type = event?.data?.type;
  if (type === 'SKIP_WAITING') {
    try { self.skipWaiting(); } catch {}
  }
});

self.addEventListener('sync', (event) => {
  if (!event || event.tag !== 'freemannotes-sync') return;
  event.waitUntil((async () => {
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        try { client.postMessage({ type: 'FN_SYNC_WAKE' }); } catch {}
      }
    } catch {}
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!req || req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = isSameOrigin(req.url);

  // Never cache Vite/dev module graph requests.
  // Mixed stale module cache can produce runtime React/hook mismatches.
  if (sameOrigin) {
    const p = url.pathname || '';
    const isViteDevPath = p.startsWith('/@vite/') || p.startsWith('/src/') || p.includes('/.vite/') || p.startsWith('/node_modules/');
    if (isViteDevPath) return;
  }

  // Keep API/network requests live (no SW cache for API responses).
  if (sameOrigin && url.pathname.startsWith('/api/')) return;

  // Navigation requests: network first, fall back to cached app shell.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      let cachedShell = null;
      try {
        cachedShell = (await caches.match('/index.html')) || (await caches.match('/')) || null;
      } catch {}

      // Prefer cached shell immediately so manual refresh while offline still boots instantly.
      if (cachedShell) {
        event.waitUntil((async () => {
          try {
            const preload = await event.preloadResponse;
            const fresh = preload || (await fetch(req));
            if (sameOrigin && fresh && fresh.ok) {
              const cache = await caches.open(RUNTIME_CACHE);
              await cache.put('/index.html', fresh.clone());
              try { await cache.put('/', fresh.clone()); } catch {}
            }
          } catch {}
        })());
        return cachedShell;
      }

      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
      } catch {}

      try {
        const net = await fetch(req);
        if (sameOrigin && net && net.ok) {
          try {
            const cache = await caches.open(RUNTIME_CACHE);
            await cache.put('/index.html', net.clone());
            try { await cache.put('/', net.clone()); } catch {}
          } catch {}
        }
        return net;
      } catch {
        try {
          return (await caches.match('/index.html')) || (await caches.match('/')) || Response.error();
        } catch {
          return Response.error();
        }
      }
    })());
    return;
  }

  const cacheableDest = new Set(['script', 'style', 'worker', 'font', 'image']);
  if (sameOrigin && cacheableDest.has(req.destination)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            try { cache.put(req, res.clone()); } catch {}
          }
          return res;
        })
        .catch(() => null);

      // Stale-while-revalidate for static assets (reduces iOS flaky reload issues).
      if (cached) {
        event.waitUntil(networkFetch);
        return cached;
      }
      const net = await networkFetch;
      return net || Response.error();
    })());
  }
});

// Web Push: show notifications even when the PWA is closed.
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = {};
    try {
      data = event.data ? event.data.json() : {};
    } catch {
      try { data = { body: event.data ? event.data.text() : '' }; } catch {}
    }

    const title = (data && data.title) ? String(data.title) : 'FreemanNotes';
    const body = (data && data.body) ? String(data.body) : '';
    const url = (data && data.url) ? String(data.url) : '/';
    const noteId = (data && typeof data.noteId === 'number') ? data.noteId : null;
    const tag = (data && data.type === 'reminder' && noteId != null) ? `reminder-${noteId}` : undefined;

    try {
      await self.registration.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag,
        data: { url, noteId, type: data && data.type ? String(data.type) : null },
      });
    } catch {}
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification && event.notification.data && event.notification.data.url)
    ? String(event.notification.data.url)
    : '/';

  event.waitUntil((async () => {
    try {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        try {
          if ('focus' in client) {
            await client.focus();
            try { client.navigate(url); } catch {}
            return;
          }
        } catch {}
      }
      await self.clients.openWindow(url);
    } catch {}
  })());
});
