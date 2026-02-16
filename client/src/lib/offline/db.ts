import Dexie, { type Table } from 'dexie';

export type NotesCacheRow = {
  key: string;
  notes: any[];
  updatedAt: number;
};

export type YDocSnapshotRow = {
  noteId: string;
  snapshot: Uint8Array;
  updatedAt: number;
};

export type YDocUpdateRow = {
  id: string; // `${noteId}:${seq}`
  noteId: string;
  seq: number;
  update: Uint8Array;
  origin?: string;
  createdAt: number;
};

export type SyncMetaRow = {
  key: string;
  value: any;
  updatedAt: number;
};

export type OutboxMutationRow = {
  opId: string;
  kind: 'notes.order.patch' | 'http.json';
  payload: any;
  attempt: number;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
};

export type UploadQueueRow = {
  opId: string;
  kind: 'note.image.attach';
  noteId: number;
  url: string; // data URL or remote URL
  tempClientId?: number;
  attempt: number;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
};

class FreemanOfflineDb extends Dexie {
  notesCache!: Table<NotesCacheRow, string>;
  yDocSnapshots!: Table<YDocSnapshotRow, string>;
  yDocUpdates!: Table<YDocUpdateRow, string>;
  syncMeta!: Table<SyncMetaRow, string>;
  outboxMutations!: Table<OutboxMutationRow, string>;
  uploadQueue!: Table<UploadQueueRow, string>;

  constructor() {
    super('freemannotes-offline');

    this.version(1).stores({
      notesCache: '&key,updatedAt',
      yDocSnapshots: '&noteId,updatedAt',
      yDocUpdates: '&id,noteId,seq,createdAt',
      syncMeta: '&key,updatedAt',
      outboxMutations: '&opId,kind,nextAttemptAt,createdAt',
      uploadQueue: '&opId,kind,noteId,nextAttemptAt,createdAt',
    });
  }
}

export const offlineDb = new FreemanOfflineDb();

export function makeOpId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}
