import React, { useEffect, useState } from 'react';
// Ensure TS recognizes the global defined via Vite
declare const __APP_VERSION__: string;
import { useAuth } from '../authContext';
import SettingsModal from './SettingsModal';
import { useTheme } from '../themeContext';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const ABOUT_ICON_DARK = '/icons/darkicon.png';
const ABOUT_ICON_LIGHT = '/icons/lighticon.png';
const ABOUT_WORDMARK = '/icons/freemannotes.png';
const VERSION_ICON_DARK = '/icons/version.png';
const VERSION_ICON_LIGHT = '/icons/version-light.png';

export default function PreferencesModal({ onClose }: { onClose: () => void }) {
  const auth = (() => { try { return useAuth(); } catch { return null as any; } })();
  const themeCtx = (() => { try { return useTheme(); } catch { return null as any; } })();
  const effectiveTheme = (themeCtx && (themeCtx as any).effective) || 'dark';
  const themeChoice = (themeCtx && (themeCtx as any).choice) || 'system';
  const setThemeChoice: (t: any) => void = (themeCtx && (themeCtx as any).setChoice) || (() => {});
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
  const [pendingNoteLineSpacing, setPendingNoteLineSpacing] = useState<number>(() => {
    try {
      const v = localStorage.getItem('prefs.noteLineSpacing');
      if (v) return Number(v);
      const userVal = auth && (auth.user as any)?.noteLineSpacing;
      if (typeof userVal === 'number') return userVal;
      return 1.38;
    } catch { return 1.38; }
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
  const [pendingChipDisplayMode, setPendingChipDisplayMode] = useState<string>(() => {
    try { return (auth && (auth.user as any)?.chipDisplayMode) || 'image+text'; } catch { return 'image+text'; }
  });

  // when the modal mounts, reflect current saved value into the slider
  useEffect(() => {
    const saved = (() => {
      try { return Number(localStorage.getItem('prefs.checklistSpacing') || '8'); } catch { return 8; }
    })();
    setPending(saved);
    try { const f = localStorage.getItem('prefs.fontFamily'); if (f) setPendingFont(f); } catch {}
    try { const ls = localStorage.getItem('prefs.noteLineSpacing') ?? ((auth && (auth.user as any)?.noteLineSpacing) != null ? String((auth as any).user.noteLineSpacing) : null); if (ls) setPendingNoteLineSpacing(Number(ls)); } catch {}
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
    try {
      const cdm = (auth && (auth.user as any)?.chipDisplayMode) || 'image+text';
      if (cdm) setPendingChipDisplayMode(cdm);
    } catch {}
  }, []);

  async function onSave() {
    document.documentElement.style.setProperty('--checklist-gap', `${pending}px`);
    document.documentElement.style.setProperty('--checklist-checkbox-size', `${pendingCheckboxSize}px`);
    document.documentElement.style.setProperty('--checklist-text-size', `${pendingTextSize}px`);
    document.documentElement.style.setProperty('--note-line-height', String(pendingNoteLineSpacing));
    // apply note/card width preference
    document.documentElement.style.setProperty('--note-card-width', `${pendingNoteWidth}px`);
    // checkbox color customization removed — theme controls visuals
    try { localStorage.setItem('prefs.checklistSpacing', String(pending)); } catch {}
    try { localStorage.setItem('prefs.checkboxSize', String(pendingCheckboxSize)); } catch {}
    try { localStorage.setItem('prefs.checklistTextSize', String(pendingTextSize)); } catch {}
    try { localStorage.setItem('prefs.noteLineSpacing', String(pendingNoteLineSpacing)); } catch {}
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
      const payload: any = {
        fontFamily: pendingFont,
        noteWidth: pendingNoteWidth,
        dragBehavior: pendingDragBehavior,
        animationSpeed: pendingAnimSpeed,
        checklistSpacing: pending,
        checkboxSize: pendingCheckboxSize,
        checklistTextSize: pendingTextSize,
        noteLineSpacing: pendingNoteLineSpacing,
        chipDisplayMode: pendingChipDisplayMode
      };
      // remove checkbox color fields from payload
      await (auth?.updateMe?.(payload));
    } catch {}
    try { localStorage.removeItem('prefs.checkboxBg'); localStorage.removeItem('prefs.checkboxBorder'); } catch {}
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
  const [showInvite, setShowInvite] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  async function onUploadPhoto() {
    try {
      if (!photoFile) { window.alert('Select a photo first'); return; }
      const dataUrl = await fileToDataUrl(photoFile);
      await (auth?.uploadPhoto?.(dataUrl));
      window.alert('Photo updated');
    } catch (err) {
      console.error('Failed to upload photo', err);
      window.alert('Failed to upload photo');
    }
  }
  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
  }
  return (
    <div className="image-dialog-backdrop">
      <div className="prefs-dialog" role="dialog" aria-modal>
        <div className="dialog-header">
          <strong>Preferences</strong>
          <button className="icon-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: 12 }}>
          {activeSection == null ? (
            <div>
              <div style={{ display: 'grid', gap: 10 }}>
                <button className="btn" onClick={() => setActiveSection('about')}>About</button>
                <button className="btn" onClick={() => setActiveSection('appearance')}>Appearance</button>
                {false && <button className="btn" onClick={() => setActiveSection('colors')}>Colors</button>}
                <button className="btn" onClick={() => setActiveSection('drag')}>Drag & Animation</button>
                <button className="btn" onClick={() => setActiveSection('collaborators')}>Collaborators</button>
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
                <button className="btn" onClick={onCancel}>Close</button>
                <span style={{ flex: 1 }} />
                { (auth?.user as any)?.role === 'admin' && <button className="btn" onClick={() => setShowInvite(true)}>Send Invite</button> }
                <button className="btn" onClick={() => auth?.logout?.()}>Sign out</button>
              </div>
            </div>
          ) : activeSection === 'about' ? (
            <div>
              <button className="btn" onClick={() => setActiveSection(null)} aria-label="Back">← Back</button>
              <div style={{ height: 8 }} />
              <h4>About Freeman Notes</h4>
              <div className="about-hero-group">
                <div className="about-hero" aria-label="Freeman Notes branding">
                  <img src={effectiveTheme === 'light' ? ABOUT_ICON_LIGHT : ABOUT_ICON_DARK} alt="Freeman Notes icon" className="about-hero-icon" />
                  <img src={ABOUT_WORDMARK} alt="" role="presentation" className="about-hero-wordmark" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                </div>
                <div className="about-version-row" aria-label="Current version">
                  <img src={effectiveTheme === 'light' ? VERSION_ICON_LIGHT : VERSION_ICON_DARK} alt="Version badge" className="about-version-icon" />
                  <span className="about-version-text">{APP_VERSION}</span>
                </div>
              </div>
              <div className="about-description">
                <p>Freeman Notes exists to prevent small thoughts from becoming resonance cascades.</p>
                <p>It captures ideas before they scatter, organizes them without Combine interference, and keeps Civil Protection out of your creative process.</p>
                <p>No manhacks. No surveillance. Just free notes, recorded and remembered on your terms.</p>
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
                <button className="btn" onClick={() => setActiveSection(null)}>Back</button>
                <button className="btn" onClick={onCancel}>Close</button>
                <span style={{ flex: 1 }} />
                { (auth?.user as any)?.role === 'admin' && <button className="btn" onClick={() => setShowInvite(true)}>Send Invite</button> }
                <button className="btn" onClick={() => auth?.logout?.()}>Sign out</button>
              </div>
            </div>
          ) : activeSection === 'appearance' ? (
            <div>
              <button className="btn" onClick={() => setActiveSection(null)} aria-label="Back">← Back</button>
              <div style={{ height: 8 }} />
              <h4>Appearance</h4>
              <div style={{ marginBottom: 16 }}>
                <h5 style={{ margin: 0, color: 'var(--muted)' }}>Theme</h5>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                  <label style={{ color: 'var(--muted)', minWidth: 120 }}>Appearance</label>
                  <select value={themeChoice} onChange={(e) => setThemeChoice(e.target.value)}>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="system">System</option>
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <h5 style={{ margin: 0, color: 'var(--muted)' }}>Profile Photo</h5>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  { (auth?.user as any)?.userImageUrl ? (
                    <img src={(auth?.user as any).userImageUrl} alt="Profile" style={{ width: 55, height: 55, borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <div className="avatar" style={{ width: 55, height: 55, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      {((auth?.user as any)?.name || (auth?.user as any)?.email || 'U')[0]}
                    </div>
                  )}
                  <input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} />
                  <button className="btn" onClick={onUploadPhoto}>Upload</button>
                </div>
              </div>
              <div style={{ display: 'block' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                  <label style={{ color: 'var(--muted)', minWidth: 120 }}>Checklist item spacing</label>
                  <input aria-label="checklist spacing" type="range" min={2} max={24} value={pending} onChange={(e) => setPending(Number(e.target.value))} />
                  <div style={{ width: 48, textAlign: 'left' }}>{pending}px</div>
                </div>
                <div style={{ height: 10 }} />
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                  <label style={{ color: 'var(--muted)', minWidth: 120 }}>Note line spacing</label>
                  <input aria-label="note line spacing" type="range" min={0.9} max={1.8} step={0.02} value={pendingNoteLineSpacing} onChange={(e) => setPendingNoteLineSpacing(Number(e.target.value))} />
                  <div style={{ width: 48, textAlign: 'left' }}>{pendingNoteLineSpacing.toFixed(2)}</div>
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
              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
                <button className="btn" onClick={() => setActiveSection(null)}>Back</button>
                <button className="btn" onClick={onSave}>Save</button>
                <span style={{ flex: 1 }} />
                { (auth?.user as any)?.role === 'admin' && <button className="btn" onClick={() => setShowInvite(true)}>Send Invite</button> }
                <button className="btn" onClick={() => auth?.logout?.()}>Sign out</button>
              </div>
            </div>
          ) : activeSection === 'colors' ? (
            <div>
              <button className="btn" onClick={() => setActiveSection(null)} aria-label="Back">← Back</button>
              <div style={{ height: 8 }} />
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
              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
                <button className="btn" onClick={() => setActiveSection(null)}>Back</button>
                <button className="btn" onClick={onResetColors} title="Reset colors to defaults">Reset colors</button>
                <button className="btn" onClick={onSave}>Save</button>
                <span style={{ flex: 1 }} />
                { (auth?.user as any)?.role === 'admin' && <button className="btn" onClick={() => setShowInvite(true)}>Send Invite</button> }
                <button className="btn" onClick={() => auth?.logout?.()}>Sign out</button>
              </div>
            </div>
          ) : activeSection === 'drag' ? (
            <div>
              <button className="btn" onClick={() => setActiveSection(null)} aria-label="Back">← Back</button>
              <div style={{ height: 8 }} />
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
              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
                <button className="btn" onClick={() => setActiveSection(null)}>Back</button>
                <button className="btn" onClick={onSave}>Save</button>
                <span style={{ flex: 1 }} />
                { (auth?.user as any)?.role === 'admin' && <button className="btn" onClick={() => setShowInvite(true)}>Send Invite</button> }
                <button className="btn" onClick={() => auth?.logout?.()}>Sign out</button>
              </div>
            </div>
          ) : (
            <div>
              <button className="btn" onClick={() => setActiveSection(null)} aria-label="Back">← Back</button>
              <div style={{ height: 8 }} />
              <h4>Collaborators</h4>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                <label style={{ color: 'var(--muted)', minWidth: 120 }}>Display</label>
                <select aria-label="collaborator chip display" value={pendingChipDisplayMode} onChange={(e) => setPendingChipDisplayMode(e.target.value)}>
                  <option value="image+text">Image + Text</option>
                  <option value="image">Image only</option>
                  <option value="text">Text only</option>
                </select>
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
                <button className="btn" onClick={() => setActiveSection(null)}>Back</button>
                <button className="btn" onClick={onSave}>Save</button>
                <span style={{ flex: 1 }} />
                { (auth?.user as any)?.role === 'admin' && <button className="btn" onClick={() => setShowInvite(true)}>Send Invite</button> }
                <button className="btn" onClick={() => auth?.logout?.()}>Sign out</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {showInvite && <SettingsModal onClose={() => setShowInvite(false)} />}
    </div>
  );
}
