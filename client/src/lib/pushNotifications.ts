import { getOrCreateDeviceProfile } from './deviceProfile';

type PublicKeyResponse = { enabled: boolean; publicKey: string | null; reason?: string | null };

function deviceHeaders(): Record<string, string> {
  const p = getOrCreateDeviceProfile();
  return {
    'x-device-key': p.deviceKey,
    'x-device-name': p.deviceName,
  };
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export type PushClientStatus = {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  serviceWorker: boolean;
  pushManager: boolean;
  subscribed: boolean;
  serverEnabled: boolean;
  serverReason?: string | null;
};

export async function getPushClientStatus(): Promise<PushClientStatus> {
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const permission: any = supported ? Notification.permission : 'unsupported';
  const serviceWorker = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const pushManager = typeof window !== 'undefined' && 'PushManager' in window;

  let serverEnabled = false;
  let serverReason: string | null = null;
  try {
    const r = await fetch('/api/push/public-key');
    const data = (await r.json()) as PublicKeyResponse;
    serverEnabled = !!data?.enabled;
    serverReason = (data as any)?.reason ?? null;
  } catch {
    serverEnabled = false;
    serverReason = 'Failed to reach server push config';
  }

  let subscribed = false;
  try {
    if (serviceWorker && pushManager) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      subscribed = !!sub;
    }
  } catch {
    subscribed = false;
  }

  return {
    supported,
    permission,
    serviceWorker,
    pushManager,
    subscribed,
    serverEnabled,
    serverReason,
  };
}

export async function ensurePushSubscribed(token: string): Promise<void> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') throw new Error('Not in a browser');
  if (!('Notification' in window)) throw new Error('Notifications not supported in this browser');
  if (!('serviceWorker' in navigator)) throw new Error('Service worker not supported');
  if (!('PushManager' in window)) throw new Error('Push messaging not supported');

  const perm = Notification.permission;
  if (perm !== 'granted') {
    const next = await Notification.requestPermission();
    if (next !== 'granted') throw new Error('Notification permission not granted');
  }

  const reg = await navigator.serviceWorker.ready;

  const cfgRes = await fetch('/api/push/public-key');
  const cfg = (await cfgRes.json()) as PublicKeyResponse;
  if (!cfg?.enabled || !cfg?.publicKey) {
    throw new Error(String(cfg?.reason || 'Push not configured on server (missing VAPID keys)'));
  }

  const existing = await reg.pushManager.getSubscription();
  const subscription = existing || await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(String(cfg.publicKey)),
  });

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
      ...deviceHeaders(),
    },
    body: JSON.stringify({ subscription }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function sendTestPush(token: string, body?: string): Promise<void> {
  const res = await fetch('/api/push/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
      ...deviceHeaders(),
    },
    body: JSON.stringify({ body: body || 'Test notification' }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function showLocalTestNotification(): Promise<void> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (!('Notification' in window)) throw new Error('Notifications not supported');

  const perm = Notification.permission;
  if (perm !== 'granted') {
    const next = await Notification.requestPermission();
    if (next !== 'granted') throw new Error('Notification permission not granted');
  }

  // Prefer service worker notification (more reliable on Android).
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('FreemanNotes', {
        body: 'Local test notification',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
      });
      return;
    }
  } catch {}

  try {
    new Notification('FreemanNotes', { body: 'Local test notification' });
  } catch {}
}
