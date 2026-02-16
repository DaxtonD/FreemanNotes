import { offlineDb } from './db';

const NOTES_CACHE_KEY = 'notes:active';

export async function loadCachedNotes(): Promise<any[]> {
  try {
    const row = await offlineDb.notesCache.get(NOTES_CACHE_KEY);
    return Array.isArray(row?.notes) ? row!.notes : [];
  } catch {
    return [];
  }
}

export async function saveCachedNotes(notes: any[]): Promise<void> {
  try {
    await offlineDb.notesCache.put({
      key: NOTES_CACHE_KEY,
      notes: Array.isArray(notes) ? notes : [],
      updatedAt: Date.now(),
    });
  } catch {
    // best-effort offline cache write
  }
}
