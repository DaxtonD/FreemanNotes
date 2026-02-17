import { makeOpId, offlineDb, type OutboxMutationRow } from './db';
import { enqueueImageUpload } from './uploadQueue';

const BASE_BACKOFF_MS = 1500;
const MAX_BACKOFF_MS = 120000;
const INT32_MAX = 2147483647;

function computeBackoffMs(attempt: number): number {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempt)));
  const jitter = Math.floor(Math.random() * 500);
  return exp + jitter;
}

function nonRetryableError(message: string): Error & { nonRetryable: true } {
  const err = new Error(message) as Error & { nonRetryable: true };
  err.nonRetryable = true;
  return err;
}

function isNonRetryableError(err: any): boolean {
  return !!(err && typeof err === 'object' && (err as any).nonRetryable === true);
}

function extractNoteIdFromPath(path: string): number | null {
  const p = String(path || '');
  const m = p.match(/^\/api\/notes\/(-?\d+)(?:\/|$|\?)/i);
  if (!m || !m[1]) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) ? id : null;
}

function replacePathNoteId(path: string, nextId: number): string {
  return String(path || '').replace(/^\/api\/notes\/(-?\d+)(?=\/|$|\?)/i, `/api/notes/${Number(nextId)}`);
}

async function remapQueuedTempNoteReferences(tempNoteId: number, realNoteId: number, parentOpId: string): Promise<void> {
  if (!Number.isFinite(tempNoteId) || tempNoteId >= 0) return;
  if (!Number.isFinite(realNoteId) || realNoteId <= 0) return;

  try {
    const rows = await offlineDb.outboxMutations.toArray();
    for (const row of rows) {
      if (row.kind !== 'http.json') continue;
      if (row.opId === parentOpId) continue;
      const path = String(row.payload?.path || '');
      if (!path.startsWith('/api/notes/')) continue;
      const noteId = extractNoteIdFromPath(path);
      if (noteId == null || noteId !== tempNoteId) continue;
      const nextPath = replacePathNoteId(path, realNoteId);
      if (!nextPath || nextPath === path) continue;
      await offlineDb.outboxMutations.put({
        ...row,
        payload: {
          ...(row.payload || {}),
          path: nextPath,
        },
        updatedAt: Date.now(),
        lastError: undefined,
      });
    }
  } catch {}

  try {
    const uploads = await offlineDb.uploadQueue
      .where('noteId')
      .equals(Number(tempNoteId))
      .toArray();
    for (const up of uploads) {
      await offlineDb.uploadQueue.put({
        ...up,
        noteId: Number(realNoteId),
        updatedAt: Date.now(),
        lastError: undefined,
      });
    }
  } catch {}
}

export async function enqueueNotesOrderPatch(ids: number[]): Promise<string> {
  const opId = makeOpId('notes-order');
  const row: OutboxMutationRow = {
    opId,
    kind: 'notes.order.patch',
    payload: { ids: Array.isArray(ids) ? ids : [] },
    attempt: 0,
    nextAttemptAt: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await offlineDb.outboxMutations.put(row);
  return opId;
}

export async function enqueueHttpJsonMutation(input: {
  method: 'PATCH' | 'PUT' | 'POST' | 'DELETE';
  path: string;
  body?: any;
  meta?: any;
}): Promise<string> {
  const opId = makeOpId('http');
  const row: OutboxMutationRow = {
    opId,
    kind: 'http.json',
    payload: {
      method: String(input.method || 'PATCH').toUpperCase(),
      path: String(input.path || ''),
      body: input.body,
      meta: input.meta,
    },
    attempt: 0,
    nextAttemptAt: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await offlineDb.outboxMutations.put(row);
  return opId;
}

function emitCreateReconciled(detail: any) {
  try {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('freemannotes:offline-note-reconciled', { detail }));
  } catch {}
}

function emitCreateRetry(detail: any) {
  try {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('freemannotes:offline-note-create-retry', { detail }));
  } catch {}
}

async function executeMutation(token: string, row: OutboxMutationRow): Promise<void> {
  if (row.kind === 'notes.order.patch') {
    const ids = Array.isArray(row.payload?.ids)
      ? row.payload.ids.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n))
      : [];

    const res = await fetch('/api/notes/order', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Idempotency-Key': row.opId,
      },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => 'Failed to persist note order');
      throw new Error(txt || 'Failed to persist note order');
    }
    return;
  }

  if (row.kind === 'http.json') {
    const method = String(row.payload?.method || 'PATCH').toUpperCase();
    const path = String(row.payload?.path || '');
    const meta = row.payload?.meta || null;
    if (!path) throw new Error('Missing path for queued http.json mutation');
    const noteIdInPath = extractNoteIdFromPath(path);
    if (noteIdInPath != null && (!Number.isInteger(noteIdInPath) || noteIdInPath <= 0 || noteIdInPath > INT32_MAX)) {
      throw nonRetryableError(`Dropping queued mutation with invalid note id in path: ${path}`);
    }
    const hasBody = row.payload && Object.prototype.hasOwnProperty.call(row.payload, 'body');
    const res = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Idempotency-Key': row.opId,
      },
      body: hasBody ? JSON.stringify(row.payload.body ?? {}) : undefined,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => `Failed queued request ${method} ${path}`);
      if (method === 'POST' && path === '/api/notes' && res.status === 400) {
        throw nonRetryableError(txt || `Dropping invalid queued create request ${method} ${path}`);
      }
      if (res.status === 404 && noteIdInPath != null) {
        throw nonRetryableError(txt || `Dropping stale queued request ${method} ${path}: note not found`);
      }
      throw new Error(txt || `Failed queued request ${method} ${path}`);
    }

    let data: any = null;
    try { data = await res.json(); } catch {}

    if (method === 'POST' && path === '/api/notes') {
      const noteId = Number(data?.note?.id);
      if (Number.isFinite(noteId)) {
        const tempClientNoteId = Number(meta?.tempClientNoteId);
        if (Number.isFinite(tempClientNoteId) && tempClientNoteId < 0) {
          await remapQueuedTempNoteReferences(tempClientNoteId, Number(noteId), row.opId);
        }

        const links = Array.isArray(meta?.pendingLinkUrls)
          ? meta.pendingLinkUrls.map((u: any) => String(u || '').trim()).filter((u: string) => !!u)
          : [];
        for (const url of links) {
          try {
            await enqueueHttpJsonMutation({ method: 'POST', path: `/api/notes/${noteId}/link-preview`, body: { url }, meta: { parentOpId: row.opId } });
          } catch {}
        }

        const collectionId = Number(meta?.activeCollectionId);
        if (meta?.addToCurrentCollection && Number.isFinite(collectionId)) {
          try {
            await enqueueHttpJsonMutation({ method: 'POST', path: `/api/notes/${noteId}/collections`, body: { collectionId }, meta: { parentOpId: row.opId } });
          } catch {}
        }

        const mode = String(meta?.mode || '').toLowerCase();
        const bodyJson = meta?.bodyJson;
        if (mode === 'text' && bodyJson && typeof bodyJson === 'object') {
          try {
            await enqueueHttpJsonMutation({
              method: 'PATCH',
              path: `/api/notes/${noteId}`,
              body: { body: JSON.stringify(bodyJson), type: 'TEXT' },
              meta: { parentOpId: row.opId },
            });
          } catch {}
        }

        const collabs = Array.isArray(meta?.selectedCollaborators)
          ? meta.selectedCollaborators.map((e: any) => String(e || '').trim()).filter((e: string) => !!e)
          : [];
        for (const email of collabs) {
          try {
            await enqueueHttpJsonMutation({ method: 'POST', path: `/api/notes/${noteId}/collaborators`, body: { email }, meta: { parentOpId: row.opId } });
          } catch {}
        }

        const imageUrls = (() => {
          const many = Array.isArray(meta?.imageUrls)
            ? meta.imageUrls.map((u: any) => String(u || '').trim()).filter((u: string) => !!u)
            : [];
          if (many.length > 0) return many;
          const one = (typeof meta?.imageUrl === 'string' ? String(meta.imageUrl).trim() : '');
          return one ? [one] : [];
        })();
        for (const imageUrl of imageUrls) {
          try { await enqueueImageUpload(noteId, imageUrl); } catch {}
        }

        emitCreateReconciled({ opId: row.opId, note: data?.note || null, tempClientNoteId: (Number.isFinite(Number(meta?.tempClientNoteId)) ? Number(meta.tempClientNoteId) : undefined) });
      }
    }

    return;
  }

  throw new Error(`Unsupported mutation kind: ${String((row as any).kind || '')}`);
}

export async function flushMutationQueue(token: string): Promise<void> {
  if (!token) return;
  for (let pass = 0; pass < 6; pass++) {
    const now = Date.now();
    const rows = await offlineDb.outboxMutations
      .orderBy('createdAt')
      .toArray();

    let processedAny = false;
    for (const row of rows) {
      if (row.nextAttemptAt > now) continue;

      processedAny = true;
      try {
        await executeMutation(token, row);
        await offlineDb.outboxMutations.delete(row.opId);
      } catch (err: any) {
        if (isNonRetryableError(err)) {
          await offlineDb.outboxMutations.delete(row.opId);
          try {
            if (row.kind === 'http.json') {
              const method = String(row.payload?.method || '').toUpperCase();
              const path = String(row.payload?.path || '');
              if (method === 'POST' && path === '/api/notes') {
                emitCreateRetry({ opId: row.opId, attempt: 999, error: String(err?.message || err || 'Dropped non-retryable queued create request'), nextAttemptAt: 0 });
              }
            }
          } catch {}
          continue;
        }

        const attempt = Number(row.attempt || 0) + 1;
        const nextAttemptAt = Date.now() + computeBackoffMs(attempt);
        const lastError = String(err?.message || err || 'Mutation replay failed');
        await offlineDb.outboxMutations.put({
          ...row,
          attempt,
          nextAttemptAt,
          updatedAt: Date.now(),
          lastError,
        });

        try {
          if (row.kind === 'http.json') {
            const method = String(row.payload?.method || '').toUpperCase();
            const path = String(row.payload?.path || '');
            if (method === 'POST' && path === '/api/notes') {
              emitCreateRetry({ opId: row.opId, attempt, error: lastError, nextAttemptAt });
            }
          }
        } catch {}
      }
    }

    if (!processedAny) break;
  }
}
