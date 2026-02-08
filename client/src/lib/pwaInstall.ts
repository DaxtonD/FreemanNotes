import * as React from 'react';

// Non-standard event supported by Chromium-based browsers (and some others).
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type PwaState = {
  isInstalled: boolean;
  canInstall: boolean;
};

let initialized = false;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let state: PwaState = { isInstalled: false, canInstall: false };
const subscribers = new Set<() => void>();

function computeIsInstalled(): boolean {
  try {
    const isStandalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    const isIosStandalone = (navigator as any)?.standalone === true;
    return !!(isStandalone || isIosStandalone);
  } catch {
    return false;
  }
}

async function computeIsInstalledRelatedApps(): Promise<boolean> {
  try {
    const fn = (navigator as any)?.getInstalledRelatedApps;
    if (typeof fn !== 'function') return false;
    const apps = await fn.call(navigator);
    return Array.isArray(apps) && apps.length > 0;
  } catch {
    return false;
  }
}

function publish(next: Partial<PwaState>) {
  state = { ...state, ...next };
  for (const cb of subscribers) {
    try { cb(); } catch {}
  }
}

export function initPwaInstall(): void {
  if (initialized) return;
  initialized = true;

  // Initial state
  publish({ isInstalled: computeIsInstalled() });
  // Related apps can mark installed even when display-mode is not standalone.
  computeIsInstalledRelatedApps().then((installed) => {
    if (installed) publish({ isInstalled: true });
  }).catch(() => {});

  // Capture install prompt
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    try {
      // Prevent the browser from showing its mini-infobar; we’ll present our own UI.
      e.preventDefault();
    } catch {}
    deferredPrompt = e as BeforeInstallPromptEvent;
    publish({ canInstall: true, isInstalled: computeIsInstalled() });
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    publish({ isInstalled: true, canInstall: false });
  });

  // If the user installs via browser UI, we may not get appinstalled in all cases.
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    publish({ isInstalled: computeIsInstalled() });
  });
}

export function getPwaInstallState(): PwaState {
  return state;
}

export function subscribePwaInstall(cb: () => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

export async function promptPwaInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const ev = deferredPrompt;
  if (!ev) return 'unavailable';
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    if (choice?.outcome === 'accepted') {
      deferredPrompt = null;
      publish({ canInstall: false });
      return 'accepted';
    }
    return 'dismissed';
  } catch {
    return 'unavailable';
  }
}

export function usePwaInstall() {
  // Ensure we initialize exactly once when any component uses the hook.
  React.useEffect(() => {
    try { initPwaInstall(); } catch {}
  }, []);

  const [snap, setSnap] = React.useState<PwaState>(() => getPwaInstallState());

  React.useEffect(() => {
    return subscribePwaInstall(() => {
      try { setSnap(getPwaInstallState()); } catch {}
    });
  }, []);

  const promptInstall = React.useCallback(async () => {
    return await promptPwaInstall();
  }, []);

  return {
    isInstalled: !!snap.isInstalled,
    canInstall: !!snap.canInstall && !snap.isInstalled,
    promptInstall,
  };
}
