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
