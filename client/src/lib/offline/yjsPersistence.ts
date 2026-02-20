import * as Y from 'yjs';
import { offlineDb } from './db';
import { IndexeddbPersistence } from 'y-indexeddb';

function seqKey(noteId: string): string {
  return `ydoc-seq:${noteId}`;
}

async function nextSeq(noteId: string): Promise<number> {
  const key = seqKey(noteId);
  const row = await offlineDb.syncMeta.get(key);
  const cur = Number(row?.value || 0);
  const next = Number.isFinite(cur) ? (cur + 1) : 1;
  await offlineDb.syncMeta.put({ key, value: next, updatedAt: Date.now() });
  return next;
}

async function resetSeq(noteId: string): Promise<void> {
  await offlineDb.syncMeta.put({ key: seqKey(noteId), value: 0, updatedAt: Date.now() });
}

export async function hydrateYDocFromIndexedDb(noteId: string, ydoc: Y.Doc): Promise<void> {
  try {
    const snap = await offlineDb.yDocSnapshots.get(noteId);
    if (snap?.snapshot) {
      try { Y.applyUpdate(ydoc, snap.snapshot, 'offline-hydrate'); } catch {}
    }

    const updates = await offlineDb.yDocUpdates.where('noteId').equals(noteId).sortBy('seq');
    for (const u of updates) {
      try { Y.applyUpdate(ydoc, u.update, 'offline-hydrate'); } catch {}
    }
  } catch {
    // best-effort hydration
  }
}

export async function bindYDocPersistence(noteId: string, ydoc: Y.Doc): Promise<() => void> {
  // One-time migration path: hydrate from legacy Dexie rows into Y.Doc.
  // The indexeddb provider below then becomes canonical local storage.
  await hydrateYDocFromIndexedDb(noteId, ydoc);

  const docKey = `freemannotes:${String(noteId || '').trim()}`;
  const idbProvider = new IndexeddbPersistence(docKey, ydoc);

  // Ensure local IndexedDB state is loaded before the caller continues.
  // This keeps note-open rendering local-first and non-network-blocking.
  try {
    await Promise.race([
      (idbProvider as any).whenSynced,
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch {
    // best-effort; provider will continue syncing in background
  }

  // Best-effort cleanup of legacy custom Dexie Yjs rows after migration.
  // Keep failures silent; they should never block editor load.
  try {
    await offlineDb.yDocSnapshots.delete(noteId);
    await offlineDb.yDocUpdates.where('noteId').equals(noteId).delete();
    await resetSeq(noteId);
  } catch {}

  return () => {
    try { idbProvider.destroy(); } catch {}
  };
}

export async function migrateYDocPersistence(fromNoteId: string, toNoteId: string): Promise<void> {
  const from = String(fromNoteId || '').trim();
  const to = String(toNoteId || '').trim();
  if (!from || !to || from === to) return;

  const fromDocKey = `freemannotes:${from}`;
  const toDocKey = `freemannotes:${to}`;

  const fromDoc = new Y.Doc();
  const toDoc = new Y.Doc();
  const fromProvider = new IndexeddbPersistence(fromDocKey, fromDoc);
  const toProvider = new IndexeddbPersistence(toDocKey, toDoc);

  try {
    await Promise.race([
      Promise.all([
        (fromProvider as any).whenSynced,
        (toProvider as any).whenSynced,
      ]),
      new Promise<void>((resolve) => setTimeout(resolve, 2500)),
    ]);

    const fromState = Y.encodeStateAsUpdate(fromDoc);
    if (fromState && fromState.byteLength > 2) {
      try { Y.applyUpdate(toDoc, fromState, 'offline-migrate'); } catch {}
      try { await new Promise((resolve) => setTimeout(resolve, 60)); } catch {}
    }
  } catch {
    // best-effort migration only
  } finally {
    try { fromProvider.destroy(); } catch {}
    try { toProvider.destroy(); } catch {}
    try { fromDoc.destroy(); } catch {}
    try { toDoc.destroy(); } catch {}
  }
}
