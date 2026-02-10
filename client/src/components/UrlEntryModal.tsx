import React from 'react';
import { createPortal } from 'react-dom';

function normalizeUrl(raw: string): string | null {
  const t = String(raw || '').trim();
  if (!t) return null;
  const withScheme = (() => {
    const lower = t.toLowerCase();
    if (lower.startsWith('http://') || lower.startsWith('https://')) return t;
    if (lower.startsWith('www.')) return `https://${t}`;
    // If it looks like a domain/path, default to https.
    if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(t)) return `https://${t}`;
    return t;
  })();
  try {
    const u = new URL(withScheme);
    if (!u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export default function UrlEntryModal({
  open,
  title,
  initialUrl,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  title?: string;
  initialUrl?: string;
  onCancel: () => void;
  onSubmit: (url: string) => void;
}) {
  const [url, setUrl] = React.useState<string>(String(initialUrl || ''));
  const [error, setError] = React.useState<string>('');

  React.useEffect(() => {
    if (!open) return;
    setUrl(String(initialUrl || ''));
    setError('');
  }, [open, initialUrl]);

  const submit = React.useCallback(() => {
    const norm = normalizeUrl(url);
    if (!norm) {
      setError('Enter a valid URL (example: https://example.com)');
      return;
    }
    try { onSubmit(norm); } catch {}
  }, [url, onSubmit]);

  if (!open) return null;

  return createPortal(
    <div
      className="image-dialog-backdrop url-entry-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          try { onCancel(); } catch {}
        }
      }}
    >
      <div
        className="image-dialog editor-dialog url-entry-dialog"
        role="dialog"
        aria-modal
        style={{ width: 'min(560px, 92vw)' }}
        onMouseDown={(e) => {
          try { e.stopPropagation(); } catch {}
        }}
      >
        <div className="dialog-header">
          <strong>{title || 'Add link'}</strong>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="icon-close" onClick={onCancel} aria-label="Close">✕</button>
          </div>
        </div>
        <div className="dialog-body" style={{ padding: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              style={{ width: '100%', padding: '15px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)', background: 'var(--card)', color: 'inherit' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            {error && <div style={{ color: 'rgba(255,120,120,0.95)', fontSize: 13 }}>{error}</div>}
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              Adds a URL preview to the note footer.
            </div>
          </div>
        </div>
        <div className="dialog-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" type="button" onClick={onCancel}>Cancel</button>
          <button className="btn" type="button" onClick={submit}>Add</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
