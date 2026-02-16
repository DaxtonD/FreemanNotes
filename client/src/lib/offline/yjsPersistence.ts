import * as Y from 'yjs';
import { offlineDb } from './db';

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
  await hydrateYDocFromIndexedDb(noteId, ydoc);

  let localCount = 0;

  const onUpdate = async (update: Uint8Array, origin: any) => {
    try {
      if (origin === 'offline-hydrate') return;
      const seq = await nextSeq(noteId);
      await offlineDb.yDocUpdates.put({
        id: `${noteId}:${seq}`,
        noteId,
        seq,
        update,
        origin: (typeof origin === 'string' ? origin : undefined),
        createdAt: Date.now(),
      });

      localCount += 1;
      if (localCount >= 150) {
        localCount = 0;
        try {
          const snapshot = Y.encodeStateAsUpdate(ydoc);
          await offlineDb.yDocSnapshots.put({ noteId, snapshot, updatedAt: Date.now() });
          await offlineDb.yDocUpdates.where('noteId').equals(noteId).delete();
          await resetSeq(noteId);
        } catch {
          // keep incremental updates if compaction fails
        }
      }
    } catch {
      // best-effort append-only persistence
    }
  };

  ydoc.on('update', onUpdate);

  return () => {
    try { ydoc.off('update', onUpdate); } catch {}
  };
}
