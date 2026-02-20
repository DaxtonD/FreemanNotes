import { offlineDb } from './db';

const NOTES_CACHE_KEY = 'notes:active';
const NOTES_CACHE_FALLBACK_KEY = 'freemannotes.offline.notes.active';

export async function loadCachedNotes(): Promise<any[]> {
  try {
    const row = await offlineDb.notesCache.get(NOTES_CACHE_KEY);
    if (Array.isArray(row?.notes)) return row!.notes;
  } catch {
    // continue to localStorage fallback
  }

  try {
    const raw = localStorage.getItem(NOTES_CACHE_FALLBACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveCachedNotes(notes: any[]): Promise<void> {
  const safeNotes = Array.isArray(notes) ? notes : [];
  try {
    await offlineDb.notesCache.put({
      key: NOTES_CACHE_KEY,
      notes: safeNotes,
      updatedAt: Date.now(),
    });
  } catch {
    // best-effort offline cache write
  }

  try {
    localStorage.setItem(NOTES_CACHE_FALLBACK_KEY, JSON.stringify(safeNotes));
  } catch {
    // best-effort fallback cache write
  }
}
