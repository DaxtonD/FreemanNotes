import { flushMutationQueue } from './mutationQueue';
import { flushUploadQueue } from './uploadQueue';

export type SyncState =
  | 'BOOTSTRAP'
  | 'OFFLINE'
  | 'CONNECTING'
  | 'ONLINE_IDLE'
  | 'SYNCING_DOCS'
  | 'FLUSHING_OUTBOX'
  | 'FLUSHING_UPLOADS'
  | 'DEGRADED'
  | 'PAUSED';

type Subscriber = (state: SyncState) => void;

let currentState: SyncState = 'BOOTSTRAP';
const subs = new Set<Subscriber>();

let started = false;
let inFlight = false;
let timer: number | null = null;
let tokenProvider: (() => string | null | undefined) | null = null;

function setState(next: SyncState) {
  if (currentState === next) return;
  currentState = next;
  for (const cb of subs) {
    try { cb(next); } catch {}
  }
}

function isOnline(): boolean {
  try { return navigator.onLine !== false; } catch { return true; }
}

export function getSyncState(): SyncState {
  return currentState;
}

export function subscribeSyncState(cb: Subscriber): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}

export function setSyncTokenProvider(provider: (() => string | null | undefined) | null): void {
  tokenProvider = provider;
}

export async function kickOfflineSync(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    if (!isOnline()) {
      setState('OFFLINE');
      return;
    }

    const token = tokenProvider ? String(tokenProvider() || '') : '';
    if (!token) {
      setState('PAUSED');
      return;
    }

    setState('CONNECTING');

    // Yjs doc transport sync happens through existing websocket providers in editors.
    setState('SYNCING_DOCS');

    setState('FLUSHING_OUTBOX');
    await flushMutationQueue(token);

    setState('FLUSHING_UPLOADS');
    await flushUploadQueue(token);

    setState('ONLINE_IDLE');
  } catch {
    setState('DEGRADED');
  } finally {
    inFlight = false;
  }
}

export function startOfflineSyncEngine(): void {
  if (started) return;
  started = true;

  const onOnline = () => { setState('CONNECTING'); void kickOfflineSync(); };
  const onOffline = () => { setState('OFFLINE'); };
  const onVisible = () => {
    try {
      if (document.visibilityState === 'visible') void kickOfflineSync();
    } catch {}
  };

  try { window.addEventListener('online', onOnline); } catch {}
  try { window.addEventListener('offline', onOffline); } catch {}
  try { document.addEventListener('visibilitychange', onVisible); } catch {}

  timer = window.setInterval(() => {
    void kickOfflineSync();
  }, 8000);

  if (!isOnline()) setState('OFFLINE');
  else setState('CONNECTING');

  void kickOfflineSync();
}

export function stopOfflineSyncEngine(): void {
  if (!started) return;
  started = false;
  if (timer != null) {
    try { window.clearInterval(timer); } catch {}
    timer = null;
  }
}
