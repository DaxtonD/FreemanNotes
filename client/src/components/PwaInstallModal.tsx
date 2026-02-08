import React from 'react';
import { usePwaInstall } from '../lib/pwaInstall';

export default function PwaInstallModal({ onClose, isPhone }: { onClose: () => void; isPhone?: boolean }) {
  const { canInstall, isInstalled, promptInstall } = usePwaInstall();

  const onInstall = async () => {
    const outcome = await promptInstall();
    // Either way, close the modal; we’ll re-check installed state.
    try { onClose(); } catch {}
    return outcome;
  };

  return (
    <div className={`image-dialog-backdrop prefs-backdrop${isPhone ? ' phone' : ''}`}>
      <div className={`prefs-dialog${isPhone ? ' phone' : ''} pwa-install-dialog`} role="dialog" aria-modal aria-label="Install app">
        <div className="dialog-header prefs-header">
          <span />
          <strong className="prefs-title">Install app</strong>
          <button className="icon-close" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="dialog-body prefs-body">
          {isInstalled ? (
            <div style={{ color: 'var(--muted)' }}>Freeman Notes is already installed.</div>
          ) : canInstall ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ color: 'var(--muted)', lineHeight: 1.45 }}>
                Install Freeman Notes for faster launch and an app-like fullscreen experience.
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn" type="button" onClick={onClose}>Not now</button>
                <button className="btn" type="button" onClick={onInstall}>Install</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ color: 'var(--muted)', lineHeight: 1.45 }}>
                If you don’t see an install option, open your browser menu and choose “Install app” or “Add to Home screen”.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn" type="button" onClick={onClose}>Close</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
