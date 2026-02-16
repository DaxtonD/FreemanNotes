import { makeOpId, offlineDb, type UploadQueueRow } from './db';

const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 180000;

function computeBackoffMs(attempt: number): number {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempt)));
  const jitter = Math.floor(Math.random() * 700);
  return exp + jitter;
}

export async function enqueueImageUpload(noteId: number, url: string, tempClientId?: number): Promise<string> {
  const opId = makeOpId('img-upload');
  const row: UploadQueueRow = {
    opId,
    kind: 'note.image.attach',
    noteId: Number(noteId),
    url: String(url || ''),
    tempClientId: (typeof tempClientId === 'number' && Number.isFinite(tempClientId)) ? tempClientId : undefined,
    attempt: 0,
    nextAttemptAt: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await offlineDb.uploadQueue.put(row);
  return opId;
}

function emitUploadSuccess(detail: any) {
  try {
    window.dispatchEvent(new CustomEvent('freemannotes:offline-upload/success', { detail }));
  } catch {}
}

function emitUploadFailure(detail: any) {
  try {
    window.dispatchEvent(new CustomEvent('freemannotes:offline-upload/failure', { detail }));
  } catch {}
}

async function executeUpload(token: string, row: UploadQueueRow): Promise<any> {
  const res = await fetch(`/api/notes/${Number(row.noteId)}/images`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Idempotency-Key': row.opId,
    },
    body: JSON.stringify({ url: row.url }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => 'Failed to upload image');
    throw new Error(txt || 'Failed to upload image');
  }

  const data = await res.json().catch(() => ({}));
  return data;
}

export async function flushUploadQueue(token: string): Promise<void> {
  if (!token) return;
  const now = Date.now();
  const rows = await offlineDb.uploadQueue.orderBy('createdAt').toArray();

  for (const row of rows) {
    if (row.nextAttemptAt > now) continue;

    try {
      const data = await executeUpload(token, row);
      const image = data?.image || null;
      emitUploadSuccess({
        opId: row.opId,
        noteId: Number(row.noteId),
        tempClientId: row.tempClientId,
        image,
      });
      await offlineDb.uploadQueue.delete(row.opId);
    } catch (err: any) {
      const attempt = Number(row.attempt || 0) + 1;
      const nextAttemptAt = Date.now() + computeBackoffMs(attempt);
      const lastError = String(err?.message || err || 'Image upload replay failed');
      emitUploadFailure({
        opId: row.opId,
        noteId: Number(row.noteId),
        tempClientId: row.tempClientId,
        error: lastError,
      });
      await offlineDb.uploadQueue.put({
        ...row,
        attempt,
        nextAttemptAt,
        updatedAt: Date.now(),
        lastError,
      });
    }
  }
}
