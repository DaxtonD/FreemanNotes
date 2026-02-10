import path from 'path';

export function getUploadsDir(): string {
  const raw = String(process.env.UPLOADS_DIR || '').trim();
  if (raw) return path.resolve(raw);
  return path.resolve(process.cwd(), 'uploads');
}

export function getUsersUploadsDir(): string {
  return path.join(getUploadsDir(), 'users');
}
