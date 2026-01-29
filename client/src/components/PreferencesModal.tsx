import React, { useEffect, useState } from 'react';
import { useAuth } from '../authContext';
import { updateMe } from '../lib/authApi';

export default function PreferencesModal({ onClose }: { onClose: () => void }) {
  const auth = (() => { try { return useAuth(); } catch { return null as any; } })();
  const [pending, setPending] = useState<number>(() => {
    try {
      const v = localStorage.getItem('prefs.checklistSpacing');
      return v ? Number(v) : 15;
    } catch {
      return 15;
    }
  });
  const [pendingCheckboxSize, setPendingCheckboxSize] = useState<number>(() => {
    try { return Number(localStorage.getItem('prefs.checkboxSize') || '20'); } catch { return 20; }
  });
  const [pendingTextSize, setPendingTextSize] = useState<number>(() => {
    try { return Number(localStorage.getItem('prefs.checklistTextSize') || '17'); } catch { return 17; }
  });
  const [pendingNoteWidth, setPendingNoteWidth] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('prefs.noteWidth');
      if (stored) return Number(stored);
      const docStyle = getComputedStyle(document.documentElement);
      return Number(docStyle.getPropertyValue('--note-card-width')) || 300;
    } catch { return 300; }
  });
  const [pendingCheckboxBg, setPendingCheckboxBg] = useState<string>(() => {
    try {
      const userVal = auth && (auth.user as any)?.checkboxBg;
      const localVal = localStorage.getItem('prefs.checkboxBg');
      if (userVal) return userVal;
      if (localVal) return localVal;
      const css = getComputedStyle(document.documentElement);
      const card = css.getPropertyValue('--card').trim() || '#1e1e1e';
      return card;
    } catch { return '#1e1e1e'; }
  });
  const [pendingCheckboxBorder, setPendingCheckboxBorder] = useState<string>(() => {
    try {
      const userVal = auth && (auth.user as any)?.checkboxBorder;
      const localVal = localStorage.getItem('prefs.checkboxBorder');
      if (userVal) return userVal;
      if (localVal) return localVal;
      const css = getComputedStyle(document.documentElement);
      const def = css.getPropertyValue('--checkbox-border-default').trim() || '#ffffff';
      return def;
    } catch { return '#ffffff'; }
  });
  const [resetColors, setResetColors] = useState(false);
  const [pendingFont, setPendingFont] = useState<string>(() => {
    try { return localStorage.getItem('prefs.fontFamily') || 'Calibri, system-ui, Arial, sans-serif'; } catch { return 'Calibri, system-ui, Arial, sans-serif'; }
  });
  const [pendingAutoFit, setPendingAutoFit] = useState<boolean>(() => {
    return false;
  });
  const [pendingDragBehavior, setPendingDragBehavior] = useState<string>(() => {
    try { return localStorage.getItem('prefs.dragBehavior') || 'swap'; } catch { return 'swap'; }
  });
  const [pendingAnimSpeed, setPendingAnimSpeed] = useState<string>(() => {
    try { return localStorage.getItem('prefs.animationSpeed') || 'normal'; } catch { return 'normal'; }
  });

  // when the modal mounts, reflect current saved value into the slider
  useEffect(() => {
    const saved = (() => {
      try { return Number(localStorage.getItem('prefs.checklistSpacing') || '8'); } catch { return 8; }
    })();
    setPending(saved);
    try { const f = localStorage.getItem('prefs.fontFamily'); if (f) setPendingFont(f); } catch {}
    try {
      const w = localStorage.getItem('prefs.noteWidth') ?? ((auth && (auth.user as any)?.noteWidth) != null ? String((auth as any).user.noteWidth) : null);
      if (w) setPendingNoteWidth(Number(w));
    } catch {}
    // auto-fit removed
    try {
      const db = localStorage.getItem('prefs.dragBehavior') || (auth && (auth.user as any)?.dragBehavior) || 'swap';
      if (db) setPendingDragBehavior(db);
    } catch {}
    try {
      const as = localStorage.getItem('prefs.animationSpeed') || (auth && (auth.user as any)?.animationSpeed) || 'normal';
      if (as) setPendingAnimSpeed(as);
    } catch {}
  }, []);

  function onSave() {
    document.documentElement.style.setProperty('--checklist-gap', `${pending}px`);
    document.documentElement.style.setProperty('--checklist-checkbox-size', `${pendingCheckboxSize}px`);
    document.documentElement.style.setProperty('--checklist-text-size', `${pendingTextSize}px`);
    // apply note/card width preference
    document.documentElement.style.setProperty('--note-card-width', `${pendingNoteWidth}px`);
    // apply colors; if reset requested, use defaults
    if (resetColors) {
      document.documentElement.style.setProperty('--checkbox-bg', 'var(--card)');
      document.documentElement.style.setProperty('--checkbox-border', 'var(--checkbox-border-default)');
    } else {
      document.documentElement.style.setProperty('--checkbox-bg', pendingCheckboxBg);
      document.documentElement.style.setProperty('--checkbox-border', pendingCheckboxBorder);
    }
    try { localStorage.setItem('prefs.checklistSpacing', String(pending)); } catch {}
    try { localStorage.setItem('prefs.checkboxSize', String(pendingCheckboxSize)); } catch {}
    try { localStorage.setItem('prefs.checklistTextSize', String(pendingTextSize)); } catch {}
    try { localStorage.setItem('prefs.noteWidth', String(pendingNoteWidth)); } catch {}
    try { localStorage.setItem('prefs.fontFamily', pendingFont); } catch {}
    // auto-fit removed
    try { localStorage.setItem('prefs.dragBehavior', pendingDragBehavior); } catch {}
    try { localStorage.setItem('prefs.animationSpeed', pendingAnimSpeed); } catch {}
    document.documentElement.style.setProperty('--app-font-family', pendingFont);
    // trigger grid recalculation so changes to note width/auto-fit take effect immediately
    try {
      window.dispatchEvent(new CustomEvent('notes-grid:recalc'));
      // also fire a resize to satisfy existing listeners
      window.dispatchEvent(new Event('resize'));
    } catch {}
    // if authenticated, persist to server
    try {
      const token = auth?.token;
      if (token) {
        const payload: any = {
          fontFamily: pendingFont,
          noteWidth: pendingNoteWidth,
          dragBehavior: pendingDragBehavior,
          animationSpeed: pendingAnimSpeed,
          checklistSpacing: pending,
          checkboxSize: pendingCheckboxSize,
          checklistTextSize: pendingTextSize
        };
        if (resetColors) {
          payload.checkboxBg = null;
          payload.checkboxBorder = null;
        } else {
          payload.checkboxBg = pendingCheckboxBg;
          payload.checkboxBorder = pendingCheckboxBorder;
        }
        updateMe(token, payload).catch(() => {});
      }
    } catch {}
    try {
      if (resetColors) {
        localStorage.removeItem('prefs.checkboxBg');
        localStorage.removeItem('prefs.checkboxBorder');
      } else {
        localStorage.setItem('prefs.checkboxBg', pendingCheckboxBg);
        localStorage.setItem('prefs.checkboxBorder', pendingCheckboxBorder);
      }
    } catch {}
    onClose();
  }

  function onResetColors() {
    // mark that we want to reset to defaults; reflect defaults in UI
    setResetColors(true);
    try {
      const css = getComputedStyle(document.documentElement);
      const card = css.getPropertyValue('--card').trim() || '#1e1e1e';
      const def = css.getPropertyValue('--checkbox-border-default').trim() || '#ffffff';
      setPendingCheckboxBg(card);
      setPendingCheckboxBorder(def);
    } catch {
      setPendingCheckboxBg('#1e1e1e');
      setPendingCheckboxBorder('#ffffff');
    }
  }
  function onCancel() { onClose(); }
  return (
    <div className="image-dialog-backdrop">
      <div className="prefs-dialog" role="dialog" aria-modal>
        <div className="dialog-header">
          <strong>Preferences</strong>
          <button className="icon-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: 12 }}>
          <div style={{ display: 'block' }}>
            <h4>Appearance</h4>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
              <label style={{ color: 'var(--muted)', minWidth: 120 }}>Item spacing</label>
              <input aria-label="checklist spacing" type="range" min={2} max={24} value={pending} onChange={(e) => setPending(Number(e.target.value))} />
              <div style={{ width: 48, textAlign: 'left' }}>{pending}px</div>
            </div>
            <div style={{ height: 10 }} />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
              <label style={{ color: 'var(--muted)', minWidth: 120 }}>Checkbox size</label>
              <input aria-label="checkbox size" type="range" min={10} max={36} value={pendingCheckboxSize} onChange={(e) => setPendingCheckboxSize(Number(e.target.value))} />
              <div style={{ width: 48, textAlign: 'left' }}>{pendingCheckboxSize}px</div>
            </div>
            <div style={{ height: 10 }} />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
              <label style={{ color: 'var(--muted)', minWidth: 120 }}>Text size</label>
              <input aria-label="checklist text size" type="range" min={12} max={20} value={pendingTextSize} onChange={(e) => setPendingTextSize(Number(e.target.value))} />
              <div style={{ width: 48, textAlign: 'left' }}>{pendingTextSize}px</div>
            </div>
            <div style={{ height: 10 }} />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
              <label style={{ color: 'var(--muted)', minWidth: 120 }}>Note width</label>
              <input aria-label="note width" type="range" min={180} max={520} value={pendingNoteWidth} onChange={(e) => setPendingNoteWidth(Number(e.target.value))} />
              <div style={{ width: 64, textAlign: 'left' }}>{pendingNoteWidth}px</div>
            </div>
            <div style={{ height: 10 }} />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
              <label style={{ color: 'var(--muted)', minWidth: 120 }}>App font</label>
              <select value={pendingFont} onChange={(e) => setPendingFont(e.target.value)}>
                <option value={'Inter, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial'}>Inter</option>
                <option value={'Calibri, system-ui, Arial, sans-serif'}>Calibri</option>
                <option value={'Segoe UI, system-ui, Arial, sans-serif'}>Segoe UI</option>
                <option value={'Roboto, system-ui, Arial, sans-serif'}>Roboto</option>
                <option value={'Helvetica Neue, Helvetica, Arial, sans-serif'}>Helvetica Neue</option>
                <option value={'Arial, Helvetica, sans-serif'}>Arial</option>
                <option value={'Verdana, Geneva, sans-serif'}>Verdana</option>
                <option value={'Tahoma, Geneva, sans-serif'}>Tahoma</option>
                <option value={'Trebuchet MS, Helvetica, sans-serif'}>Trebuchet MS</option>
                <option value={'Gill Sans, Calibri, sans-serif'}>Gill Sans</option>
              </select>
            </div>
          </div>

          {/* Layout auto-fit removed */}

          <div style={{ height: 16 }} />
          <h4>Colors</h4>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
            <label style={{ color: 'var(--muted)', minWidth: 120 }}>Checkbox background</label>
            <input aria-label="checkbox bg" type="color" value={pendingCheckboxBg} onChange={(e) => setPendingCheckboxBg(e.target.value)} style={{ width: 44, height: 28, padding: 0 }} />
          </div>
          <div style={{ height: 10 }} />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
            <label style={{ color: 'var(--muted)', minWidth: 120 }}>Checkbox border</label>
            <input aria-label="checkbox border" type="color" value={pendingCheckboxBorder} onChange={(e) => setPendingCheckboxBorder(e.target.value)} style={{ width: 44, height: 28, padding: 0 }} />
          </div>

          <div style={{ height: 16 }} />
          <h4>Drag & Animation</h4>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
            <label style={{ color: 'var(--muted)', minWidth: 120 }}>Behavior</label>
            <label style={{ color: 'var(--muted)' }}>Swap</label>
            <input aria-label="drag swap" type="radio" name="dragBehavior" checked={pendingDragBehavior === 'swap'} onChange={() => setPendingDragBehavior('swap')} />
            <label style={{ color: 'var(--muted)' }}>Rearrange</label>
            <input aria-label="drag rearrange" type="radio" name="dragBehavior" checked={pendingDragBehavior === 'rearrange'} onChange={() => setPendingDragBehavior('rearrange')} />
          </div>
          <div style={{ height: 10 }} />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
            <label style={{ color: 'var(--muted)', minWidth: 120 }}>Speed</label>
            <select aria-label="animation speed" value={pendingAnimSpeed} onChange={(e) => setPendingAnimSpeed(e.target.value)}>
              <option value="fast">Fast</option>
              <option value="normal">Normal</option>
              <option value="slow">Slow</option>
            </select>
          </div>

          <div style={{ height: 16 }} />
          

          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
            <button className="btn" onClick={onCancel}>Cancel</button>
            <button className="btn" onClick={onResetColors} title="Reset colors to defaults">Reset colors</button>
            <button className="btn" onClick={onSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
