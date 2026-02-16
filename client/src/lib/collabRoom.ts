function createdAtMs(value: unknown): number | null {
  try {
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) && ms > 0 ? ms : null;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
    }
    if (typeof value === 'string' && value.trim()) {
      const ms = Date.parse(value);
      return Number.isFinite(ms) && ms > 0 ? ms : null;
    }
  } catch {}
  return null;
}

export function noteCollabRoom(noteId: number, createdAt?: unknown): string {
  const id = Number(noteId);
  if (!Number.isFinite(id) || id <= 0) return `note-${String(noteId || '')}`;
  const ms = createdAtMs(createdAt);
  if (ms == null) return `note-${id}`;
  return `note-${id}-c${ms.toString(36)}`;
}

export function noteCollabRoomFromNote(note: any): string {
  const noteId = Number(note?.id);
  const createdAt = note?.createdAt;
  return noteCollabRoom(noteId, createdAt);
}
