import { getOrCreateDeviceProfile } from './deviceProfile';

function deviceHeaders(): Record<string, string> {
  const p = getOrCreateDeviceProfile();
  return {
    'x-device-key': p.deviceKey,
    'x-device-name': p.deviceName,
  };
}

export async function register(email: string, password: string, name?: string, inviteToken?: string) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const body: any = { email: normalizedEmail, password };
  if (name) body.name = name;
  if (inviteToken) body.inviteToken = inviteToken;
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...deviceHeaders() },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function login(email: string, password: string) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...deviceHeaders() },
    body: JSON.stringify({ email: normalizedEmail, password })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function me(token: string) {
  const res = await fetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}`, ...deviceHeaders() }
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const err: any = new Error(txt || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function updateMe(token: string, payload: any) {
  const res = await fetch('/api/auth/me', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...deviceHeaders() },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function uploadMyPhoto(token: string, dataUrl: string) {
  const res = await fetch('/api/auth/me/photo', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...deviceHeaders() },
    body: JSON.stringify({ dataUrl })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function requestPasswordReset(email: string) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const res = await fetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: normalizedEmail })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function resetPasswordWithToken(token: string, password: string) {
  const res = await fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
