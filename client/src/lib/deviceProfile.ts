export type DeviceProfile = {
  deviceKey: string;
  deviceName: string;
};

const DEVICE_KEY_STORAGE = 'fn.deviceKey';
const DEVICE_NAME_STORAGE = 'fn.deviceName';

function safeStorageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeStorageSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch {}
}

function generateDeviceKey(): string {
  try {
    // Most modern browsers.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  // Fallback: not cryptographically strong, but acceptable as a stable client id.
  return 'dev_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
}

function computeDefaultDeviceName(): string {
  // Goal: be device-ish, not browser-ish. Keep it stable across browsers where possible.
  try {
    const uaData: any = (navigator as any).userAgentData;
    const platform = (uaData && typeof uaData.platform === 'string' && uaData.platform) || (navigator.platform || 'device');
    const mobile = !!(uaData && typeof uaData.mobile === 'boolean' ? uaData.mobile : /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || ''));
    const deviceType = mobile ? 'Mobile' : 'Desktop';
    const w = typeof window !== 'undefined' ? window.screen?.width : 0;
    const h = typeof window !== 'undefined' ? window.screen?.height : 0;
    const dims = (w && h) ? `${Math.max(w, h)}x${Math.min(w, h)}` : '';
    return [platform, deviceType, dims].filter(Boolean).join(' ');
  } catch {
    return 'Device';
  }
}

export function getOrCreateDeviceProfile(): DeviceProfile {
  let deviceKey = safeStorageGet(DEVICE_KEY_STORAGE) || '';
  if (!deviceKey) {
    deviceKey = generateDeviceKey();
    safeStorageSet(DEVICE_KEY_STORAGE, deviceKey);
  }

  let deviceName = safeStorageGet(DEVICE_NAME_STORAGE) || '';
  if (!deviceName) {
    deviceName = computeDefaultDeviceName();
    safeStorageSet(DEVICE_NAME_STORAGE, deviceName);
  }

  return { deviceKey, deviceName };
}

export function setDeviceName(deviceName: string) {
  if (!deviceName) return;
  safeStorageSet(DEVICE_NAME_STORAGE, deviceName);
}
