export function makeWebSocketUrl(path: string): string {
  // Allow callers to pass a full ws/wss URL.
  if (/^wss?:\/\//i.test(path)) return path;

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // In practice this only runs in the browser.
  if (typeof window === 'undefined' || !window.location) {
    return `ws://localhost${normalizedPath}`;
  }

  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}${normalizedPath}`;
}
