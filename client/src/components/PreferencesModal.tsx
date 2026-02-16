import React, { useEffect, useRef, useState } from 'react';
// Ensure TS recognizes the global defined via Vite
declare const __APP_VERSION__: string;
import { useAuth } from '../authContext';
import SettingsModal from './SettingsModal';
import UserManagementModal from './UserManagementModal';
import AvatarCropModal from './AvatarCropModal';
import { useTheme } from '../themeContext';
import { usePwaInstall } from '../lib/pwaInstall';
import { ensurePushSubscribed, getLastServerPushTestAt, getPushClientStatus, getPushHealth, sendTestPush, showLocalTestNotification, type PushClientStatus, type PushHealthStatus } from '../lib/pushNotifications';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const ABOUT_ICON_DARK = '/icons/darkicon.png';
const ABOUT_ICON_LIGHT = '/icons/lighticon.png';
const ABOUT_WORDMARK = '/icons/freemannotes.png';
const VERSION_ICON_DARK = '/icons/version.png';
const VERSION_ICON_LIGHT = '/icons/version-light.png';

const DEFAULT_LINK_COLOR_DARK = '#8ab4f8';
const DEFAULT_LINK_COLOR_LIGHT = '#0b57d0';

const SYSTEM_FONT_STACK = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SANS_FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const SERIF_FONT_STACK = 'ui-serif, Georgia, "Times New Roman", Times, serif';
const MONO_FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export default function PreferencesModal({ onClose }: { onClose: () => void }) {
  const auth = (() => { try { return useAuth(); } catch { return null as any; } })();
  const themeCtx = (() => { try { return useTheme(); } catch { return null as any; } })();
  const { canInstall, isInstalled, promptInstall } = usePwaInstall();
  const isFirefox = React.useMemo(() => {
    try {
      const ua = String(navigator.userAgent || '').toLowerCase();
      return ua.includes('firefox') || ua.includes('fxios');
    } catch {
      return false;
    }
  }, []);
  const canShowInstallApp = !isInstalled && (canInstall || isFirefox);

  const onInstallApp = React.useCallback(async () => {
    try {
      if (canInstall) {
        await promptInstall();
        return;
      }
      if (!isFirefox) return;

      const mobileLike = (() => {
        try {
          const ua = String(navigator.userAgent || '').toLowerCase();
          return /android|iphone|ipad|ipod|mobile/.test(ua) || !!window.matchMedia?.('(pointer: coarse)')?.matches;
        } catch {
          return false;
        }
      })();

      if (mobileLike) {
        window.alert('Firefox install:\nOpen the browser menu (⋮) and choose "Install" (or "Add to Home screen").');
      } else {
        window.alert('Firefox install:\nUse the address-bar install icon (if shown), or open the browser menu and choose "Install this site as an app" / "Install".');
      }
    } catch {}
  }, [canInstall, isFirefox, promptInstall]);
  const effectiveTheme = (themeCtx && (themeCtx as any).effective) || 'dark';
  const themeChoice = (themeCtx && (themeCtx as any).choice) || 'system';
  const setThemeChoice: (t: any) => void = (themeCtx && (themeCtx as any).setChoice) || (() => {});
  // Split appearance prefs (card vs editor)
  const [pendingCardTitleSize, setPendingCardTitleSize] = useState<number>(() => {
    try {
      const v = localStorage.getItem('prefs.cardTitleSize');
      if (v) return Number(v);
      const userVal = auth && (auth.user as any)?.cardTitleSize;
      if (typeof userVal === 'number') return userVal;
      const css = getComputedStyle(document.documentElement);
      const fromCss = Number.parseInt(String(css.getPropertyValue('--card-title-size') || '').trim(), 10);
      return Number.isFinite(fromCss) && fromCss > 0 ? fromCss : 20;
    } catch { return 20; }
  });
  const [pendingCardChecklistSpacing, setPendingCardChecklistSpacing] = useState<number>(() => {
    try {
      const v = localStorage.getItem('prefs.cardChecklistSpacing') ?? localStorage.getItem('prefs.checklistSpacing');
      if (v) return Number(v);
      const userVal = auth && (auth.user as any)?.cardChecklistSpacing;
      if (typeof userVal === 'number') return userVal;
      const legacyUserVal = auth && (auth.user as any)?.checklistSpacing;
      if (typeof legacyUserVal === 'number') return legacyUserVal;
      return 15;
    } catch { return 15; }
  });
  const [pendingCardCheckboxSize, setPendingCardCheckboxSize] = useState<number>(() => {
    try {
      const v = localStorage.getItem('prefs.cardCheckboxSize') ?? localStorage.getItem('prefs.checkboxSize');
      if (v) return Number(v);
      const userVal = auth && (auth.user as any)?.cardCheckboxSize;
      if (typeof userVal === 'number') return userVal;
      const legacyUserVal = auth && (auth.user as any)?.checkboxSize;
      if (typeof legacyUserVal === 'number') return legacyUserVal;
      return 20;
    } catch { return 20; }
  });
  const [pendingCardTextSize, setPendingCardTextSize] = useState<number>(() => {
    try {
      const v = localStorage.getItem('prefs.cardChecklistTextSize') ?? localStorage.getItem('prefs.checklistTextSize');
      if (v) return Number(v);
      const userVal = auth && (auth.user as any)?.cardChecklistTextSize;
      if (typeof userVal === 'number') return userVal;
      const legacyUserVal = auth && (auth.user as any)?.checklistTextSize;
      if (typeof legacyUserVal === 'number') return legacyUserVal;
      return 17;
    } catch { return 17; }
  });
  const [pendingCardNoteLineSpacing, setPendingCardNoteLineSpacing] = useState<number>(() => {
    try {
      const v = localStorage.getItem('prefs.cardNoteLineSpacing') ?? localStorage.getItem('prefs.noteLineSpacing');
      if (v) return Number(v);
      const userVal = auth && (auth.user as any)?.cardNoteLineSpacing;
      if (typeof userVal === 'number') return userVal;
      const legacyUserVal = auth && (auth.user as any)?.noteLineSpacing;
      if (typeof legacyUserVal === 'number') return legacyUserVal;
      return 1.38;
    } catch { return 1.38; }
  });
  const [pendingEditorChecklistSpacing, setPendingEditorChecklistSpacing] = useState<number>(() => {
    try {
      const v = localStorage.getItem('prefs.editorChecklistSpacing');
      if (v) return Number(v);
      const userVal = auth && (auth.user as any)?.editorChecklistSpacing;
      if (typeof userVal === 'number') return userVal;
      return pendingCardChecklistSpacing;
    } catch { return pendingCardChecklistSpacing; }
  });
  const [pendingEditorCheckboxSize, setPendingEditorCheckboxSize] = useState<number>(() => {
    try {
      const v = localStorage.getItem('prefs.editorCheckboxSize');
      if (v) return Number(v);
      const userVal = auth && (auth.user as any)?.editorCheckboxSize;
      if (typeof userVal === 'number') return userVal;
      return pendingCardCheckboxSize;
    } catch { return pendingCardCheckboxSize; }
  });
  const [pendingEditorTextSize, setPendingEditorTextSize] = useState<number>(() => {
    try {
      const v = localStorage.getItem('prefs.editorChecklistTextSize');
      if (v) return Number(v);
      const userVal = auth && (auth.user as any)?.editorChecklistTextSize;
      if (typeof userVal === 'number') return userVal;
      return pendingCardTextSize;
    } catch { return pendingCardTextSize; }
  });
  const [pendingEditorNoteLineSpacing, setPendingEditorNoteLineSpacing] = useState<number>(() => {
    try {
      const v = localStorage.getItem('prefs.editorNoteLineSpacing');
      if (v) return Number(v);
      const userVal = auth && (auth.user as any)?.editorNoteLineSpacing;
      if (typeof userVal === 'number') return userVal;
      return pendingCardNoteLineSpacing;
    } catch { return pendingCardNoteLineSpacing; }
  });
  const [pendingNoteWidth, setPendingNoteWidth] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('prefs.noteWidth');
      if (stored) return Number(stored);
      const docStyle = getComputedStyle(document.documentElement);
      return Number(docStyle.getPropertyValue('--note-card-width')) || 300;
    } catch { return 300; }
  });
  const [pendingImageThumbSize, setPendingImageThumbSize] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('prefs.imageThumbSize');
      if (stored) return Number(stored);
      const userVal = auth && (auth.user as any)?.imageThumbSize;
      if (typeof userVal === 'number') return userVal;
      const docStyle = getComputedStyle(document.documentElement);
      return Number.parseInt(String(docStyle.getPropertyValue('--image-thumb-size') || '').trim(), 10) || 96;
    } catch { return 96; }
  });
  const [pendingEditorImageThumbSize, setPendingEditorImageThumbSize] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('prefs.editorImageThumbSize');
      if (stored) return Number(stored);
      const userVal = auth && (auth.user as any)?.editorImageThumbSize;
      if (typeof userVal === 'number') return userVal;
      const docStyle = getComputedStyle(document.documentElement);
      return Number.parseInt(String(docStyle.getPropertyValue('--editor-image-thumb-size') || '').trim(), 10) || 115;
    } catch { return 115; }
  });
  const [pendingEditorImagesExpandedByDefault, setPendingEditorImagesExpandedByDefault] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('prefs.editorImagesExpandedByDefault');
      if (stored !== null) return stored === 'true';
      const userVal = auth && (auth.user as any)?.editorImagesExpandedByDefault;
      if (typeof userVal === 'boolean') return userVal;
      return false;
    } catch { return false; }
  });
  const [pendingDisableNoteCardLinks, setPendingDisableNoteCardLinks] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('prefs.disableNoteCardLinks');
      if (stored !== null) return stored === 'true';
      const userVal = auth && (auth.user as any)?.disableNoteCardLinks;
      if (typeof userVal === 'boolean') return userVal;
      return false;
    } catch { return false; }
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

  const [pendingLinkColorDark, setPendingLinkColorDark] = useState<string>(() => {
    try {
      const userVal = auth && (auth.user as any)?.linkColorDark;
      const localVal = localStorage.getItem('prefs.linkColorDark');
      if (typeof userVal === 'string' && userVal) return userVal;
      if (localVal) return localVal;
    } catch {}
    return DEFAULT_LINK_COLOR_DARK;
  });

  const [pendingLinkColorLight, setPendingLinkColorLight] = useState<string>(() => {
    try {
      const userVal = auth && (auth.user as any)?.linkColorLight;
      const localVal = localStorage.getItem('prefs.linkColorLight');
      if (typeof userVal === 'string' && userVal) return userVal;
      if (localVal) return localVal;
    } catch {}
    return DEFAULT_LINK_COLOR_LIGHT;
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

  const [pendingTrashAutoEmptyDays, setPendingTrashAutoEmptyDays] = useState<number>(() => {
    try {
      const v = (auth && (auth.user as any)?.trashAutoEmptyDays);
      return (typeof v === 'number' && Number.isFinite(v)) ? Math.max(0, Math.trunc(v)) : 0;
    } catch {
      return 0;
    }
  });

  const [emptyingTrashNow, setEmptyingTrashNow] = useState(false);

  // Mobile back button: inside Preferences, Back should navigate up a level (section -> top)
  // and from the top-level Preferences menu it should close Preferences (return to notes).
  const backIdRef = useRef<string>('');
  const activeSectionRef = useRef<string | null>(null);
  const onCloseRef = useRef<(() => void) | null>(null);
  onCloseRef.current = onClose;

  async function emptyTrashNow() {
    const token = (auth as any)?.token;
    if (!token) return;
    if (emptyingTrashNow) return;
    const ok = window.confirm('Permanently delete all notes in Trash? This cannot be undone.');
    if (!ok) return;
    setEmptyingTrashNow(true);
    try {
      const res = await fetch('/api/trash/empty', { method: 'DELETE', headers: { Authorization: token ? `Bearer ${token}` : '' } });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      console.error('Failed to empty trash', err);
      alert('Failed to empty trash');
    } finally {
      setEmptyingTrashNow(false);
    }
  }

  const isPhone = (() => {
    try {
      const mq = window.matchMedia;
      const isTouchLike = !!(mq && (mq('(pointer: coarse)').matches || mq('(any-pointer: coarse)').matches));
      const vw = (window.visualViewport && typeof window.visualViewport.width === 'number')
        ? window.visualViewport.width
        : window.innerWidth;
      const vh = (window.visualViewport && typeof window.visualViewport.height === 'number')
        ? window.visualViewport.height
        : window.innerHeight;
      const shortSide = Math.min(vw, vh);
      return isTouchLike && shortSide <= 600;
    } catch { return false; }
  })();

  const [activeSection, setActiveSection] = useState<string | null>(null);
  activeSectionRef.current = activeSection;

  const goBackOneLevel = () => {
    try {
      const cur = activeSectionRef.current;
      if (cur === 'appearance-card' || cur === 'appearance-editor') {
        setActiveSection('appearance');
        return;
      }
      if (cur != null) {
        setActiveSection(null);
        return;
      }
      onCloseRef.current?.();
    } catch {}
  };

  useEffect(() => {
    if (!isPhone) return;
    try {
      if (!backIdRef.current) backIdRef.current = `prefs-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const id = backIdRef.current;
      const onBack = () => {
        try {
          goBackOneLevel();
        } catch {}
      };
      window.dispatchEvent(new CustomEvent('freemannotes:back/register', { detail: { id, onBack } }));
      return () => {
        try { window.dispatchEvent(new CustomEvent('freemannotes:back/unregister', { detail: { id } })); } catch {}
      };
    } catch {
      return;
    }
    // Only register once per mount (avoid pushing extra history entries).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPhone]);

  // when the modal mounts, reflect current saved value into the slider
  useEffect(() => {
    try {
      const cardTitle = localStorage.getItem('prefs.cardTitleSize');
      if (cardTitle) setPendingCardTitleSize(Number(cardTitle));
    } catch {}
    try {
      const cardSpacing = localStorage.getItem('prefs.cardChecklistSpacing') ?? localStorage.getItem('prefs.checklistSpacing');
      if (cardSpacing) setPendingCardChecklistSpacing(Number(cardSpacing));
    } catch {}
    try {
      const cardCb = localStorage.getItem('prefs.cardCheckboxSize') ?? localStorage.getItem('prefs.checkboxSize');
      if (cardCb) setPendingCardCheckboxSize(Number(cardCb));
    } catch {}
    try {
      const cardText = localStorage.getItem('prefs.cardChecklistTextSize') ?? localStorage.getItem('prefs.checklistTextSize');
      if (cardText) setPendingCardTextSize(Number(cardText));
    } catch {}
    try {
      const cardLs = localStorage.getItem('prefs.cardNoteLineSpacing') ?? localStorage.getItem('prefs.noteLineSpacing');
      if (cardLs) setPendingCardNoteLineSpacing(Number(cardLs));
    } catch {}
    try {
      const edSpacing = localStorage.getItem('prefs.editorChecklistSpacing');
      if (edSpacing) setPendingEditorChecklistSpacing(Number(edSpacing));
    } catch {}
    try {
      const edCb = localStorage.getItem('prefs.editorCheckboxSize');
      if (edCb) setPendingEditorCheckboxSize(Number(edCb));
    } catch {}
    try {
      const edText = localStorage.getItem('prefs.editorChecklistTextSize');
      if (edText) setPendingEditorTextSize(Number(edText));
    } catch {}
    try {
      const edLs = localStorage.getItem('prefs.editorNoteLineSpacing');
      if (edLs) setPendingEditorNoteLineSpacing(Number(edLs));
    } catch {}
    try { const f = localStorage.getItem('prefs.fontFamily'); if (f) setPendingFont(f); } catch {}
    try {
      const w = localStorage.getItem('prefs.noteWidth') ?? ((auth && (auth.user as any)?.noteWidth) != null ? String((auth as any).user.noteWidth) : null);
      if (w) setPendingNoteWidth(Number(w));
    } catch {}
    try {
      const its = localStorage.getItem('prefs.imageThumbSize') ?? ((auth && (auth.user as any)?.imageThumbSize) != null ? String((auth as any).user.imageThumbSize) : null);
      if (its) setPendingImageThumbSize(Number(its));
    } catch {}
    try {
      const its = localStorage.getItem('prefs.editorImageThumbSize') ?? ((auth && (auth.user as any)?.editorImageThumbSize) != null ? String((auth as any).user.editorImageThumbSize) : null);
      if (its) setPendingEditorImageThumbSize(Number(its));
    } catch {}
    try {
      const v = localStorage.getItem('prefs.editorImagesExpandedByDefault') ?? ((auth && (auth.user as any)?.editorImagesExpandedByDefault) != null ? String((auth as any).user.editorImagesExpandedByDefault) : null);
      if (v !== null) setPendingEditorImagesExpandedByDefault(v === 'true');
    } catch {}
    try {
      const v = localStorage.getItem('prefs.disableNoteCardLinks') ?? ((auth && (auth.user as any)?.disableNoteCardLinks) != null ? String((auth as any).user.disableNoteCardLinks) : null);
      if (v !== null) setPendingDisableNoteCardLinks(v === 'true');
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
    try {
      const td = (auth && (auth.user as any)?.trashAutoEmptyDays);
      if (typeof td === 'number' && Number.isFinite(td)) setPendingTrashAutoEmptyDays(Math.max(0, Math.trunc(td)));
    } catch {}

    try {
      const d = localStorage.getItem('prefs.linkColorDark') ?? ((auth && (auth.user as any)?.linkColorDark) != null ? String((auth as any).user.linkColorDark) : null);
      if (d) setPendingLinkColorDark(d);
    } catch {}
    try {
      const l = localStorage.getItem('prefs.linkColorLight') ?? ((auth && (auth.user as any)?.linkColorLight) != null ? String((auth as any).user.linkColorLight) : null);
      if (l) setPendingLinkColorLight(l);
    } catch {}
  }, []);

  // Mobile: rearrange drag is disabled; migrate to swap.
  useEffect(() => {
    try {
      if (!isPhone) return;
      if (pendingDragBehavior !== 'rearrange') return;
      setPendingDragBehavior('swap');
      try { localStorage.setItem('prefs.dragBehavior', 'swap'); } catch {}
      try { (auth as any)?.updateMe?.({ dragBehavior: 'swap' }); } catch {}
    } catch {}
  }, [isPhone, pendingDragBehavior]);

  async function onSave() {
    // Card appearance
    document.documentElement.style.setProperty('--card-title-size', `${pendingCardTitleSize}px`);
    document.documentElement.style.setProperty('--card-checklist-gap', `${pendingCardChecklistSpacing}px`);
    document.documentElement.style.setProperty('--card-checklist-checkbox-size', `${pendingCardCheckboxSize}px`);
    document.documentElement.style.setProperty('--card-checklist-text-size', `${pendingCardTextSize}px`);
    document.documentElement.style.setProperty('--card-note-line-height', String(pendingCardNoteLineSpacing));
    // Editor appearance
    document.documentElement.style.setProperty('--editor-checklist-gap', `${pendingEditorChecklistSpacing}px`);
    document.documentElement.style.setProperty('--editor-checklist-checkbox-size', `${pendingEditorCheckboxSize}px`);
    document.documentElement.style.setProperty('--editor-checklist-text-size', `${pendingEditorTextSize}px`);
    document.documentElement.style.setProperty('--editor-note-line-height', String(pendingEditorNoteLineSpacing));

    // Legacy vars (global) are aligned to editor values so editor typography remains independent from card-only sizing.
    document.documentElement.style.setProperty('--checklist-gap', `${pendingCardChecklistSpacing}px`);
    document.documentElement.style.setProperty('--checklist-checkbox-size', `${pendingCardCheckboxSize}px`);
    document.documentElement.style.setProperty('--checklist-text-size', `${pendingEditorTextSize}px`);
    document.documentElement.style.setProperty('--note-line-height', String(pendingCardNoteLineSpacing));
    // Note width preference is disabled on phones (layout auto-fits card width).
    if (!isPhone) {
      document.documentElement.style.setProperty('--note-card-width', `${pendingNoteWidth}px`);
    }
    document.documentElement.style.setProperty('--image-thumb-size', `${pendingImageThumbSize}px`);
    document.documentElement.style.setProperty('--editor-image-thumb-size', `${pendingEditorImageThumbSize}px`);
    document.documentElement.style.setProperty('--link-color-dark', pendingLinkColorDark);
    document.documentElement.style.setProperty('--link-color-light', pendingLinkColorLight);
    // checkbox color customization removed — theme controls visuals
    try { localStorage.setItem('prefs.cardTitleSize', String(pendingCardTitleSize)); } catch {}
    try { localStorage.setItem('prefs.cardChecklistSpacing', String(pendingCardChecklistSpacing)); } catch {}
    try { localStorage.setItem('prefs.cardCheckboxSize', String(pendingCardCheckboxSize)); } catch {}
    try { localStorage.setItem('prefs.cardChecklistTextSize', String(pendingCardTextSize)); } catch {}
    try { localStorage.setItem('prefs.cardNoteLineSpacing', String(pendingCardNoteLineSpacing)); } catch {}
    try { localStorage.setItem('prefs.editorChecklistSpacing', String(pendingEditorChecklistSpacing)); } catch {}
    try { localStorage.setItem('prefs.editorCheckboxSize', String(pendingEditorCheckboxSize)); } catch {}
    try { localStorage.setItem('prefs.editorChecklistTextSize', String(pendingEditorTextSize)); } catch {}
    try { localStorage.setItem('prefs.editorNoteLineSpacing', String(pendingEditorNoteLineSpacing)); } catch {}
    // Legacy keys (kept for backward compatibility)
    try { localStorage.setItem('prefs.checklistSpacing', String(pendingCardChecklistSpacing)); } catch {}
    try { localStorage.setItem('prefs.checkboxSize', String(pendingCardCheckboxSize)); } catch {}
    try { localStorage.setItem('prefs.checklistTextSize', String(pendingEditorTextSize)); } catch {}
    try { localStorage.setItem('prefs.noteLineSpacing', String(pendingCardNoteLineSpacing)); } catch {}
    if (!isPhone) {
      try { localStorage.setItem('prefs.noteWidth', String(pendingNoteWidth)); } catch {}
    }
    try { localStorage.setItem('prefs.imageThumbSize', String(pendingImageThumbSize)); } catch {}
    try { localStorage.setItem('prefs.editorImageThumbSize', String(pendingEditorImageThumbSize)); } catch {}
    try { localStorage.setItem('prefs.editorImagesExpandedByDefault', String(pendingEditorImagesExpandedByDefault)); } catch {}
    try { localStorage.setItem('prefs.disableNoteCardLinks', String(pendingDisableNoteCardLinks)); } catch {}
    try { localStorage.setItem('prefs.fontFamily', pendingFont); } catch {}
    try { localStorage.setItem('prefs.linkColorDark', pendingLinkColorDark); } catch {}
    try { localStorage.setItem('prefs.linkColorLight', pendingLinkColorLight); } catch {}
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
        ...(isPhone ? {} : { noteWidth: pendingNoteWidth }),
        dragBehavior: pendingDragBehavior,
        animationSpeed: pendingAnimSpeed,
        cardTitleSize: pendingCardTitleSize,
        cardChecklistSpacing: pendingCardChecklistSpacing,
        cardCheckboxSize: pendingCardCheckboxSize,
        cardChecklistTextSize: pendingCardTextSize,
        cardNoteLineSpacing: pendingCardNoteLineSpacing,
        editorChecklistSpacing: pendingEditorChecklistSpacing,
        editorCheckboxSize: pendingEditorCheckboxSize,
        editorChecklistTextSize: pendingEditorTextSize,
        editorNoteLineSpacing: pendingEditorNoteLineSpacing,
        chipDisplayMode: pendingChipDisplayMode,
        imageThumbSize: pendingImageThumbSize,
        editorImageThumbSize: pendingEditorImageThumbSize,
        editorImagesExpandedByDefault: pendingEditorImagesExpandedByDefault,
        disableNoteCardLinks: pendingDisableNoteCardLinks,
        trashAutoEmptyDays: pendingTrashAutoEmptyDays,
        linkColorDark: pendingLinkColorDark,
        linkColorLight: pendingLinkColorLight,
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
  const [showUserMgmt, setShowUserMgmt] = useState(false);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [cropSourceUrl, setCropSourceUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  // activeSection declared above so Back handler can reference it.
  const [pushStatus, setPushStatus] = useState<PushClientStatus | null>(null);
  const [pushHealth, setPushHealth] = useState<PushHealthStatus | null>(null);
  const [lastPushTestAt, setLastPushTestAt] = useState<string | null>(() => getLastServerPushTestAt());
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  const refreshPushDiagnostics = React.useCallback(async () => {
    try {
      setPushStatus(await getPushClientStatus());
    } catch {
      setPushStatus(null);
    }
    try {
      const token = String(auth?.token || '');
      if (token) setPushHealth(await getPushHealth(token));
      else setPushHealth(null);
    } catch {
      setPushHealth(null);
    }
    setLastPushTestAt(getLastServerPushTestAt());
  }, [auth?.token]);

  useEffect(() => {
    if (activeSection !== 'notifications') return;
    let alive = true;
    (async () => {
      try {
        await refreshPushDiagnostics();
        if (!alive) return;
      } catch {
        if (!alive) return;
        setPushStatus(null);
        setPushHealth(null);
      }
    })();
    return () => { alive = false; };
  }, [activeSection, refreshPushDiagnostics]);
  async function onPhotoSelected(file: File | null) {
    try {
      if (!file) return;
      const nextUrl = URL.createObjectURL(file);
      setCropSourceUrl((prev) => {
        try { if (prev) URL.revokeObjectURL(prev); } catch {}
        return nextUrl;
      });
    } catch (err) {
      console.error('Failed to prepare photo', err);
      window.alert('Failed to open photo');
      setCropSourceUrl((prev) => {
        try { if (prev) URL.revokeObjectURL(prev); } catch {}
        return null;
      });
    }
  }

  async function onApplyCroppedPhoto(dataUrl: string) {
    try {
      setPhotoPreviewUrl(dataUrl);
      setPhotoUploading(true);
      await (auth?.uploadPhoto?.(dataUrl));
      // After upload, prefer server URL (auth.user.userImageUrl).
      setPhotoPreviewUrl(null);
    } catch (err) {
      console.error('Failed to upload photo', err);
      window.alert('Failed to upload photo');
      setPhotoPreviewUrl(null);
    } finally {
      setPhotoUploading(false);
      setCropSourceUrl((prev) => {
        try { if (prev) URL.revokeObjectURL(prev); } catch {}
        return null;
      });
    }
  }

  React.useEffect(() => {
    return () => {
      try { if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl); } catch {}
      try { if (cropSourceUrl) URL.revokeObjectURL(cropSourceUrl); } catch {}
    };
  }, [photoPreviewUrl, cropSourceUrl]);
  return (
    <div className={`image-dialog-backdrop prefs-backdrop${isPhone ? ' phone' : ''}`}>
      <div className={`prefs-dialog${isPhone ? ' phone' : ''}`} role="dialog" aria-modal aria-label="Preferences">
        <div className="dialog-header prefs-header">
          {isPhone && activeSection != null ? (
            <button className="btn prefs-back" type="button" onClick={goBackOneLevel} aria-label="Back">
              ←
            </button>
          ) : (
            <span />
          )}
          <strong className="prefs-title">
            {activeSection == null ? (isPhone ? 'Settings' : 'Preferences') : (
              activeSection === 'about' ? 'About' :
              activeSection === 'appearance' ? 'Appearance' :
              activeSection === 'appearance-card' ? 'Note Card Preferences' :
              activeSection === 'appearance-editor' ? 'Note Editor Preferences' :
              activeSection === 'colors' ? 'Colors' :
              activeSection === 'noteMgmt' ? 'Note Management' :
              activeSection === 'drag' ? 'Drag & Animation' :
              activeSection === 'collaborators' ? 'Collaborators' :
              activeSection === 'notifications' ? 'Notifications' :
              'Preferences'
            )}
          </strong>
          <button className="icon-close" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="dialog-body prefs-body">
          {activeSection == null ? (
            isPhone ? (
              <div className="prefs-mobile-root">
                <div className="prefs-list" role="list">
                  {canShowInstallApp && (
                    <button
                      className="prefs-item"
                      type="button"
                      onClick={onInstallApp}
                      role="listitem"
                      title="Install Freeman Notes"
                    >
                      <span className="prefs-item__label">Install app</span>
                      <span className="prefs-item__chev" aria-hidden>›</span>
                    </button>
                  )}
                  <button className="prefs-item" type="button" onClick={() => setActiveSection('about')} role="listitem">
                    <span className="prefs-item__label">About</span>
                    <span className="prefs-item__chev" aria-hidden>›</span>
                  </button>
                  <button className="prefs-item" type="button" onClick={() => setActiveSection('appearance')} role="listitem">
                    <span className="prefs-item__label">Appearance</span>
                    <span className="prefs-item__chev" aria-hidden>›</span>
                  </button>
                  <button className="prefs-item" type="button" onClick={() => setActiveSection('notifications')} role="listitem">
                    <span className="prefs-item__label">Notifications</span>
                    <span className="prefs-item__chev" aria-hidden>›</span>
                  </button>
                  <button className="prefs-item" type="button" onClick={() => setActiveSection('noteMgmt')} role="listitem">
                    <span className="prefs-item__label">Note management</span>
                    <span className="prefs-item__chev" aria-hidden>›</span>
                  </button>
                  <button className="prefs-item" type="button" onClick={() => setActiveSection('drag')} role="listitem">
                    <span className="prefs-item__label">Drag & Animation</span>
                    <span className="prefs-item__chev" aria-hidden>›</span>
                  </button>
                  <button className="prefs-item" type="button" onClick={() => setActiveSection('collaborators')} role="listitem">
                    <span className="prefs-item__label">Collaborators</span>
                    <span className="prefs-item__chev" aria-hidden>›</span>
                  </button>
                </div>

                <div style={{ height: 14 }} />

                <div className="prefs-list" role="list" aria-label="Account">
                  {(auth?.user as any)?.role === 'admin' && (
                    <button className="prefs-item" type="button" onClick={() => setShowUserMgmt(true)} role="listitem">
                      <span className="prefs-item__label">User management</span>
                      <span className="prefs-item__chev" aria-hidden>›</span>
                    </button>
                  )}
                  {(auth?.user as any)?.role === 'admin' && (
                    <button className="prefs-item" type="button" onClick={() => setShowInvite(true)} role="listitem">
                      <span className="prefs-item__label">Send invite</span>
                      <span className="prefs-item__chev" aria-hidden>›</span>
                    </button>
                  )}
                  <button className="prefs-item prefs-item--danger" type="button" onClick={() => { try { onClose(); } catch {} try { auth?.logout?.(); } catch {} }} role="listitem">
                    <span className="prefs-item__label">Sign out</span>
                    <span className="prefs-item__chev" aria-hidden>›</span>
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {canShowInstallApp && (
                    <button className="btn" type="button" onClick={onInstallApp}>Install app</button>
                  )}
                  <button className="btn" type="button" onClick={() => setActiveSection('about')}>About</button>
                  <button className="btn" type="button" onClick={() => setActiveSection('appearance')}>Appearance</button>
                  <button className="btn" type="button" onClick={() => setActiveSection('notifications')}>Notifications</button>
                  <button className="btn" type="button" onClick={() => setActiveSection('noteMgmt')}>Note management</button>
                  {false && <button className="btn" type="button" onClick={() => setActiveSection('colors')}>Colors</button>}
                  <button className="btn" type="button" onClick={() => setActiveSection('drag')}>Drag & Animation</button>
                  <button className="btn" type="button" onClick={() => setActiveSection('collaborators')}>Collaborators</button>
                </div>
                <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
                  <button className="btn" type="button" onClick={onCancel}>Close</button>
                  <span style={{ flex: 1 }} />
                  {(auth?.user as any)?.role === 'admin' && <button className="btn" type="button" onClick={() => setShowUserMgmt(true)}>User management</button>}
                  {(auth?.user as any)?.role === 'admin' && <button className="btn" type="button" onClick={() => setShowInvite(true)}>Send Invite</button>}
                  <button className="btn" type="button" onClick={() => { try { onClose(); } catch {} try { auth?.logout?.(); } catch {} }}>Sign out</button>
                </div>
              </div>
            )
          ) : activeSection === 'notifications' ? (
            <div>
              {!isPhone && <button className="btn" type="button" onClick={() => setActiveSection(null)} aria-label="Back">← Back</button>}
              <div style={{ height: 8 }} />
              <h4>Notifications</h4>
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.4 }}>
                Android/Chrome won’t prompt for notification permission during install. Use “Enable notifications” below (it counts as a user gesture).
              </div>

              <div style={{ height: 10 }} />
              <div style={{ display: 'grid', gap: 6 }}>
                <div><strong>Permission:</strong> {pushStatus ? String(pushStatus.permission) : '…'}</div>
                <div><strong>Push supported:</strong> {pushStatus ? (pushStatus.pushManager ? 'yes' : 'no') : '…'}</div>
                <div><strong>Service worker:</strong> {pushStatus ? (pushStatus.serviceWorker ? 'yes' : 'no') : '…'}</div>
                <div><strong>Subscribed:</strong> {pushStatus ? (pushStatus.subscribed ? 'yes' : 'no') : '…'}</div>
                <div><strong>Server push:</strong> {pushStatus ? (pushStatus.serverEnabled ? 'enabled' : `disabled${pushStatus.serverReason ? ` (${pushStatus.serverReason})` : ''}`) : '…'}</div>
              </div>

              {(() => {
                const swSubscriptionOk = !!pushStatus?.subscribed;
                const serverRowOk = !!pushHealth?.hasDeviceSubscription;
                const serverEnabledOk = !!pushStatus?.serverEnabled;
                const isHealthy = swSubscriptionOk && serverRowOk && serverEnabledOk;
                const lastTs = lastPushTestAt;
                const lastTestOk = !!lastTs;
                const lastTsText = (() => {
                  if (!lastTs) return 'never';
                  try {
                    const d = new Date(lastTs);
                    if (!Number.isFinite(d.getTime())) return 'unknown';
                    return d.toLocaleString();
                  } catch {
                    return 'unknown';
                  }
                })();

                return (
                  <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--card)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong>Push health:</strong>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        borderRadius: 999,
                        padding: '3px 10px',
                        fontSize: 12,
                        fontWeight: 700,
                        background: isHealthy ? 'rgba(46, 204, 113, 0.16)' : 'rgba(255, 171, 0, 0.18)',
                        color: isHealthy ? '#2ecc71' : '#f6c343',
                        border: isHealthy ? '1px solid rgba(46, 204, 113, 0.35)' : '1px solid rgba(246, 195, 67, 0.35)',
                      }}>
                        {isHealthy ? 'Healthy' : 'Needs attention'}
                      </span>
                    </div>
                    <div style={{ marginTop: 8, display: 'grid', gap: 4, fontSize: 13 }}>
                      <div><strong>1)</strong> {swSubscriptionOk ? '✅' : '⚠️'} Active SW subscription: {swSubscriptionOk ? 'yes' : 'no'}</div>
                      <div><strong>2)</strong> {serverRowOk ? '✅' : '⚠️'} Server row for this device: {serverRowOk ? 'yes' : 'no'}{pushHealth ? ` (device: ${pushHealth.deviceSubscriptionCount}, user: ${pushHealth.userSubscriptionCount})` : ''}</div>
                      <div><strong>3)</strong> {lastTestOk ? '✅' : '⚠️'} Last successful push test: {lastTsText}</div>
                    </div>
                  </div>
                );
              })()}

              {pushMsg && (
                <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 10, background: 'var(--card)', border: '1px solid var(--border)' }}>
                  {pushMsg}
                </div>
              )}

              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn"
                  type="button"
                  disabled={pushBusy}
                  onClick={async () => {
                    const token = auth?.token || '';
                    if (!token) {
                      setPushMsg('You must be signed in to repair push.');
                      return;
                    }
                    setPushBusy(true);
                    setPushMsg(null);
                    try {
                      await ensurePushSubscribed(token);
                      await refreshPushDiagnostics();
                      setPushMsg('Push repaired for this device.');
                    } catch (err: any) {
                      setPushMsg('Push repair failed: ' + String(err?.message || err));
                    } finally {
                      setPushBusy(false);
                    }
                  }}
                  title="Re-subscribe this device and refresh push health"
                >
                  Repair push
                </button>

                <button
                  className="btn"
                  type="button"
                  disabled={pushBusy}
                  onClick={async () => {
                    const token = auth?.token || '';
                    if (!token) {
                      setPushMsg('You must be signed in to enable push notifications.');
                      return;
                    }
                    setPushBusy(true);
                    setPushMsg(null);
                    try {
                      await ensurePushSubscribed(token);
                      setPushMsg('Notifications enabled.');
                    } catch (err: any) {
                      setPushMsg('Error enabling notifications: ' + String(err?.message || err));
                    } finally {
                      await refreshPushDiagnostics();
                      setPushBusy(false);
                    }
                  }}
                  title="Request permission and subscribe this device"
                >
                  Enable notifications
                </button>

                <button
                  className="btn"
                  type="button"
                  disabled={pushBusy}
                  onClick={async () => {
                    setPushBusy(true);
                    setPushMsg(null);
                    try {
                      await showLocalTestNotification();
                      setPushMsg('Sent a local test notification.');
                    } catch (err: any) {
                      setPushMsg('Local test failed: ' + String(err?.message || err));
                    } finally {
                      await refreshPushDiagnostics();
                      setPushBusy(false);
                    }
                  }}
                  title="Shows a notification using your browser/service worker"
                >
                  Local test
                </button>

                <button
                  className="btn"
                  type="button"
                  disabled={pushBusy || !pushStatus?.serverEnabled || !pushStatus?.subscribed}
                  onClick={async () => {
                    const token = auth?.token || '';
                    if (!token) {
                      setPushMsg('You must be signed in to send a push test.');
                      return;
                    }
                    setPushBusy(true);
                    setPushMsg(null);
                    try {
                      await sendTestPush(token, 'Push test from FreemanNotes');
                      setPushMsg('Sent a push test. (If you don’t see it, check Android notification settings for the app.)');
                      setLastPushTestAt(getLastServerPushTestAt());
                    } catch (err: any) {
                      setPushMsg('Push test failed: ' + String(err?.message || err));
                    } finally {
                      await refreshPushDiagnostics();
                      setPushBusy(false);
                    }
                  }}
                  title="Sends a real Web Push from the server"
                >
                  Push test
                </button>
              </div>

              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
                <button className="btn" type="button" onClick={() => setActiveSection(null)}>Back</button>
                <button className="btn" type="button" onClick={onCancel}>Close</button>
              </div>
            </div>
          ) : activeSection === 'about' ? (
            <div>
              {!isPhone && <button className="btn" type="button" onClick={() => setActiveSection(null)} aria-label="Back">← Back</button>}
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
                <button className="btn" type="button" onClick={() => setActiveSection(null)}>Back</button>
                <button className="btn" type="button" onClick={onCancel}>Close</button>
                <span style={{ flex: 1 }} />
                {(auth?.user as any)?.role === 'admin' && <button className="btn" type="button" onClick={() => setShowInvite(true)}>Send Invite</button>}
                <button className="btn" type="button" onClick={() => { try { onClose(); } catch {} try { auth?.logout?.(); } catch {} }}>Sign out</button>
              </div>
            </div>
          ) : activeSection === 'appearance-card' ? (
            <div>
              {!isPhone && <button className="btn" type="button" onClick={() => setActiveSection('appearance')} aria-label="Back">← Back</button>}
              <div style={{ height: 8 }} />
              <h4>Note Card Preferences</h4>

              <div style={{ display: 'block' }}>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                    <label style={{ color: 'var(--muted)', minWidth: 140 }}>Note Title Size</label>
                    <input aria-label="card title size" type="range" min={12} max={34} step={1} value={pendingCardTitleSize} onChange={(e) => setPendingCardTitleSize(Number(e.target.value))} />
                    <div style={{ width: 48, textAlign: 'left' }}>{pendingCardTitleSize}px</div>
                  </div>
                  <div style={{ height: 10 }} />
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                    <label style={{ color: 'var(--muted)', minWidth: 140 }}>Note line spacing</label>
                    <input aria-label="card note line spacing" type="range" min={0.9} max={1.8} step={0.02} value={pendingCardNoteLineSpacing} onChange={(e) => setPendingCardNoteLineSpacing(Number(e.target.value))} />
                    <div style={{ width: 48, textAlign: 'left' }}>{pendingCardNoteLineSpacing.toFixed(2)}</div>
                  </div>
                  <div style={{ height: 10 }} />
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                    <label style={{ color: 'var(--muted)', minWidth: 140 }}>Checklist item spacing</label>
                    <input aria-label="card checklist spacing" type="range" min={2} max={24} step={1} value={pendingCardChecklistSpacing} onChange={(e) => setPendingCardChecklistSpacing(Number(e.target.value))} />
                    <div style={{ width: 48, textAlign: 'left' }}>{pendingCardChecklistSpacing}px</div>
                  </div>
                  <div style={{ height: 10 }} />
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                    <label style={{ color: 'var(--muted)', minWidth: 140 }}>Checkbox size</label>
                    <input aria-label="card checkbox size" type="range" min={10} max={36} step={1} value={pendingCardCheckboxSize} onChange={(e) => setPendingCardCheckboxSize(Number(e.target.value))} />
                    <div style={{ width: 48, textAlign: 'left' }}>{pendingCardCheckboxSize}px</div>
                  </div>
                  <div style={{ height: 10 }} />
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                    <label style={{ color: 'var(--muted)', minWidth: 140 }}>Text size</label>
                    <input aria-label="card checklist text size" type="range" min={12} max={24} step={1} value={pendingCardTextSize} onChange={(e) => setPendingCardTextSize(Number(e.target.value))} />
                    <div style={{ width: 48, textAlign: 'left' }}>{pendingCardTextSize}px</div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
                <button className="btn" type="button" onClick={goBackOneLevel}>Back</button>
                <button className="btn" type="button" onClick={onSave}>Save</button>
              </div>
            </div>
          ) : activeSection === 'appearance-editor' ? (
            <div>
              {!isPhone && <button className="btn" type="button" onClick={() => setActiveSection('appearance')} aria-label="Back">← Back</button>}
              <div style={{ height: 8 }} />
              <h4>Note Editor Preferences</h4>

              <div style={{ display: 'block' }}>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                    <label style={{ color: 'var(--muted)', minWidth: 140 }}>Note line spacing</label>
                    <input aria-label="editor note line spacing" type="range" min={0.9} max={1.8} step={0.02} value={pendingEditorNoteLineSpacing} onChange={(e) => setPendingEditorNoteLineSpacing(Number(e.target.value))} />
                    <div style={{ width: 48, textAlign: 'left' }}>{pendingEditorNoteLineSpacing.toFixed(2)}</div>
                  </div>
                  <div style={{ height: 10 }} />
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                    <label style={{ color: 'var(--muted)', minWidth: 140 }}>Checklist item spacing</label>
                    <input aria-label="editor checklist spacing" type="range" min={2} max={24} step={1} value={pendingEditorChecklistSpacing} onChange={(e) => setPendingEditorChecklistSpacing(Number(e.target.value))} />
                    <div style={{ width: 48, textAlign: 'left' }}>{pendingEditorChecklistSpacing}px</div>
                  </div>
                  <div style={{ height: 10 }} />
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                    <label style={{ color: 'var(--muted)', minWidth: 140 }}>Checkbox size</label>
                    <input aria-label="editor checkbox size" type="range" min={10} max={36} step={1} value={pendingEditorCheckboxSize} onChange={(e) => setPendingEditorCheckboxSize(Number(e.target.value))} />
                    <div style={{ width: 48, textAlign: 'left' }}>{pendingEditorCheckboxSize}px</div>
                  </div>
                  <div style={{ height: 10 }} />
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                    <label style={{ color: 'var(--muted)', minWidth: 140 }}>Text size</label>
                    <input aria-label="editor checklist text size" type="range" min={12} max={24} step={1} value={pendingEditorTextSize} onChange={(e) => setPendingEditorTextSize(Number(e.target.value))} />
                    <div style={{ width: 48, textAlign: 'left' }}>{pendingEditorTextSize}px</div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
                <button className="btn" type="button" onClick={goBackOneLevel}>Back</button>
                <button className="btn" type="button" onClick={onSave}>Save</button>
              </div>
            </div>
          ) : activeSection === 'appearance' ? (
            <div>
              {!isPhone && <button className="btn" type="button" onClick={() => setActiveSection(null)} aria-label="Back">← Back</button>}
              <div style={{ height: 8 }} />
              <h4>Appearance</h4>

              <div style={{ marginBottom: 16 }}>
                <h5 style={{ margin: 0, color: 'var(--muted)' }}>Profile Photo</h5>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  { photoPreviewUrl ? (
                    <img src={photoPreviewUrl} alt="Profile preview" style={{ width: 55, height: 55, borderRadius: 10, objectFit: 'cover' }} />
                  ) : (auth?.user as any)?.userImageUrl ? (
                    <img src={(auth?.user as any).userImageUrl} alt="Profile" style={{ width: 55, height: 55, borderRadius: 10, objectFit: 'cover' }} />
                  ) : (
                    <div className="avatar" style={{ width: 55, height: 55, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      {((auth?.user as any)?.name || (auth?.user as any)?.email || 'U')[0]}
                    </div>
                  )}
                  <input
                    className="prefs-photo-input"
                    type="file"
                    accept="image/*"
                    disabled={photoUploading}
                    onChange={(e) => onPhotoSelected(e.target.files?.[0] || null)}
                  />
                  {photoUploading && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Uploading…</div>}
                </div>
              </div>

              {isPhone ? (
                <>
                  <div className="prefs-list" role="list" aria-label="Appearance preferences">
                    <button className="prefs-item" type="button" onClick={() => setActiveSection('appearance-card')} role="listitem">
                      <span className="prefs-item__label">Note Card Preferences</span>
                      <span className="prefs-item__chev" aria-hidden>›</span>
                    </button>
                    <button className="prefs-item" type="button" onClick={() => setActiveSection('appearance-editor')} role="listitem">
                      <span className="prefs-item__label">Note Editor Preferences</span>
                      <span className="prefs-item__chev" aria-hidden>›</span>
                    </button>
                  </div>
                  <div style={{ height: 14 }} />
                </>
              ) : null}

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
                <h5 style={{ margin: 0, color: 'var(--muted)' }}>Links</h5>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                  <label style={{ color: 'var(--muted)', minWidth: 120 }}>Link color (dark)</label>
                  <input aria-label="link color dark" type="color" value={pendingLinkColorDark} onChange={(e) => setPendingLinkColorDark(e.target.value)} />
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>{pendingLinkColorDark}</div>
                </div>
                <div style={{ height: 10 }} />
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                  <label style={{ color: 'var(--muted)', minWidth: 120 }}>Link color (light)</label>
                  <input aria-label="link color light" type="color" value={pendingLinkColorLight} onChange={(e) => setPendingLinkColorLight(e.target.value)} />
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>{pendingLinkColorLight}</div>
                </div>
                <div style={{ height: 10 }} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                  <label style={{ color: 'var(--muted)', minWidth: 120 }}>Preview</label>
                  <a
                    href="#"
                    onClick={(e) => e.preventDefault()}
                    style={{ color: 'var(--link-color)', textDecoration: 'underline', textUnderlineOffset: 2 }}
                  >
                    Example link
                  </a>
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>(Overrides pasted link colors)</span>
                </div>
                <div style={{ height: 10 }} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-start' }}>
                  <label style={{ color: 'var(--muted)', minWidth: 120 }}>Actions</label>
                  <button className="btn" type="button" onClick={() => { setPendingLinkColorDark(DEFAULT_LINK_COLOR_DARK); setPendingLinkColorLight(DEFAULT_LINK_COLOR_LIGHT); }}>
                    Reset link colors
                  </button>
                </div>
              </div>

              {!isPhone && (
                <div style={{ display: 'block' }}>
                  <div style={{ marginBottom: 16 }}>
                    <h5 style={{ margin: 0, color: 'var(--muted)' }}>Note Card Preferences</h5>
                    <div style={{ height: 8 }} />
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                      <label style={{ color: 'var(--muted)', minWidth: 140 }}>Note Title Size</label>
                      <input aria-label="card title size" type="range" min={12} max={34} step={1} value={pendingCardTitleSize} onChange={(e) => setPendingCardTitleSize(Number(e.target.value))} />
                      <div style={{ width: 48, textAlign: 'left' }}>{pendingCardTitleSize}px</div>
                    </div>
                    <div style={{ height: 10 }} />
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                      <label style={{ color: 'var(--muted)', minWidth: 140 }}>Note line spacing</label>
                      <input aria-label="card note line spacing" type="range" min={0.9} max={1.8} step={0.02} value={pendingCardNoteLineSpacing} onChange={(e) => setPendingCardNoteLineSpacing(Number(e.target.value))} />
                      <div style={{ width: 48, textAlign: 'left' }}>{pendingCardNoteLineSpacing.toFixed(2)}</div>
                    </div>
                    <div style={{ height: 10 }} />
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                      <label style={{ color: 'var(--muted)', minWidth: 140 }}>Checklist item spacing</label>
                      <input aria-label="card checklist spacing" type="range" min={2} max={24} step={1} value={pendingCardChecklistSpacing} onChange={(e) => setPendingCardChecklistSpacing(Number(e.target.value))} />
                      <div style={{ width: 48, textAlign: 'left' }}>{pendingCardChecklistSpacing}px</div>
                    </div>
                    <div style={{ height: 10 }} />
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                      <label style={{ color: 'var(--muted)', minWidth: 140 }}>Checkbox size</label>
                      <input aria-label="card checkbox size" type="range" min={10} max={36} step={1} value={pendingCardCheckboxSize} onChange={(e) => setPendingCardCheckboxSize(Number(e.target.value))} />
                      <div style={{ width: 48, textAlign: 'left' }}>{pendingCardCheckboxSize}px</div>
                    </div>
                    <div style={{ height: 10 }} />
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                      <label style={{ color: 'var(--muted)', minWidth: 140 }}>Text size</label>
                      <input aria-label="card checklist text size" type="range" min={12} max={24} step={1} value={pendingCardTextSize} onChange={(e) => setPendingCardTextSize(Number(e.target.value))} />
                      <div style={{ width: 48, textAlign: 'left' }}>{pendingCardTextSize}px</div>
                    </div>
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <h5 style={{ margin: 0, color: 'var(--muted)' }}>Note Editor Preferences</h5>
                    <div style={{ height: 8 }} />
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                      <label style={{ color: 'var(--muted)', minWidth: 140 }}>Note line spacing</label>
                      <input aria-label="editor note line spacing" type="range" min={0.9} max={1.8} step={0.02} value={pendingEditorNoteLineSpacing} onChange={(e) => setPendingEditorNoteLineSpacing(Number(e.target.value))} />
                      <div style={{ width: 48, textAlign: 'left' }}>{pendingEditorNoteLineSpacing.toFixed(2)}</div>
                    </div>
                    <div style={{ height: 10 }} />
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                      <label style={{ color: 'var(--muted)', minWidth: 140 }}>Checklist item spacing</label>
                      <input aria-label="editor checklist spacing" type="range" min={2} max={24} step={1} value={pendingEditorChecklistSpacing} onChange={(e) => setPendingEditorChecklistSpacing(Number(e.target.value))} />
                      <div style={{ width: 48, textAlign: 'left' }}>{pendingEditorChecklistSpacing}px</div>
                    </div>
                    <div style={{ height: 10 }} />
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                      <label style={{ color: 'var(--muted)', minWidth: 140 }}>Checkbox size</label>
                      <input aria-label="editor checkbox size" type="range" min={10} max={36} step={1} value={pendingEditorCheckboxSize} onChange={(e) => setPendingEditorCheckboxSize(Number(e.target.value))} />
                      <div style={{ width: 48, textAlign: 'left' }}>{pendingEditorCheckboxSize}px</div>
                    </div>
                    <div style={{ height: 10 }} />
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                      <label style={{ color: 'var(--muted)', minWidth: 140 }}>Text size</label>
                      <input aria-label="editor checklist text size" type="range" min={12} max={24} step={1} value={pendingEditorTextSize} onChange={(e) => setPendingEditorTextSize(Number(e.target.value))} />
                      <div style={{ width: 48, textAlign: 'left' }}>{pendingEditorTextSize}px</div>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display: 'block' }}>

                <div style={{ marginBottom: 16 }}>
                  <h5 style={{ margin: 0, color: 'var(--muted)' }}>Layout</h5>
                  <div style={{ height: 8 }} />
                  {!isPhone ? (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                      <label style={{ color: 'var(--muted)', minWidth: 140 }}>Note width</label>
                      <input aria-label="note width" type="range" min={180} max={520} value={pendingNoteWidth} onChange={(e) => setPendingNoteWidth(Number(e.target.value))} />
                      <div style={{ width: 64, textAlign: 'left' }}>{pendingNoteWidth}px</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start', opacity: 0.7 }}>
                      <label style={{ color: 'var(--muted)', minWidth: 140 }}>Note width</label>
                      <div style={{ color: 'var(--muted)' }}>Auto (disabled on mobile)</div>
                    </div>
                  )}
                  <div style={{ height: 10 }} />
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                    <label style={{ color: 'var(--muted)', minWidth: 140 }}>Image thumbnails</label>
                    <input aria-label="image thumbnail size" type="range" min={48} max={192} step={8} value={pendingImageThumbSize} onChange={(e) => setPendingImageThumbSize(Number(e.target.value))} />
                    <div style={{ width: 64, textAlign: 'left' }}>{pendingImageThumbSize}px</div>
                  </div>
                  <div style={{ height: 10 }} />
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                    <label style={{ color: 'var(--muted)', minWidth: 140 }}>Editor thumbnails</label>
                    <input aria-label="editor thumbnail size" type="range" min={48} max={240} step={8} value={pendingEditorImageThumbSize} onChange={(e) => setPendingEditorImageThumbSize(Number(e.target.value))} />
                    <div style={{ width: 64, textAlign: 'left' }}>{pendingEditorImageThumbSize}px</div>
                  </div>
                </div>
                <div style={{ height: 10 }} />
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                  <label style={{ color: 'var(--muted)', minWidth: 120 }}>Editor images</label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input
                      aria-label="editor images expanded by default"
                      type="checkbox"
                      checked={pendingEditorImagesExpandedByDefault}
                      onChange={(e) => setPendingEditorImagesExpandedByDefault(e.target.checked)}
                    />
                    <span>Expanded by default</span>
                  </label>
                </div>
                <div style={{ height: 10 }} />
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                  <label style={{ color: 'var(--muted)', minWidth: 120 }}>App font</label>
                  <select value={pendingFont} onChange={(e) => setPendingFont(e.target.value)}>
                    <optgroup label="Recommended">
                      <option value={SYSTEM_FONT_STACK}>System (recommended)</option>
                      <option value={SANS_FONT_STACK}>Sans</option>
                      <option value={SERIF_FONT_STACK}>Serif</option>
                      <option value={MONO_FONT_STACK}>Monospace</option>
                    </optgroup>
                    <optgroup label={isPhone ? 'Other (may fall back on mobile)' : 'Other'}>
                      {/* Keep existing values for compatibility with already-saved prefs */}
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
                    </optgroup>
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
                <button className="btn" type="button" onClick={goBackOneLevel}>Back</button>
                <button className="btn" type="button" onClick={onSave}>Save</button>
                <span style={{ flex: 1 }} />
                {(auth?.user as any)?.role === 'admin' && <button className="btn" type="button" onClick={() => setShowInvite(true)}>Send Invite</button>}
                <button className="btn" type="button" onClick={() => { try { onClose(); } catch {} try { auth?.logout?.(); } catch {} }}>Sign out</button>
              </div>
            </div>
          ) : activeSection === 'noteMgmt' ? (
            <div>
              {!isPhone && <button className="btn" type="button" onClick={() => setActiveSection(null)} aria-label="Back">← Back</button>}
              <div style={{ height: 8 }} />
              <h4>Note management</h4>
              <div style={{ marginBottom: 16 }}>
                <h5 style={{ margin: 0, color: 'var(--muted)' }}>Trash</h5>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                  <label style={{ color: 'var(--muted)', minWidth: 160 }}>Auto-empty after</label>
                  <select
                    aria-label="auto empty trash after"
                    value={String(pendingTrashAutoEmptyDays)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setPendingTrashAutoEmptyDays(Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0);
                    }}
                  >
                    <option value="0">Never</option>
                    <option value="7">7 days</option>
                    <option value="14">14 days</option>
                    <option value="30">30 days</option>
                    <option value="60">60 days</option>
                    <option value="90">90 days</option>
                    <option value="180">180 days</option>
                  </select>
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>Trashed notes will be permanently deleted after this period.</span>
                </div>
                <div style={{ height: 10 }} />
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                  <label style={{ color: 'var(--muted)', minWidth: 160 }}>Actions</label>
                  <button
                    className="btn"
                    type="button"
                    onClick={emptyTrashNow}
                    disabled={emptyingTrashNow || !(auth as any)?.token}
                    style={{ borderColor: 'rgba(255,90,90,0.35)' }}
                    title="Permanently delete all trashed notes"
                  >
                    {emptyingTrashNow ? 'Emptying…' : 'Empty trash now'}
                  </button>
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>Deletes everything currently in Trash.</span>
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <h5 style={{ margin: 0, color: 'var(--muted)' }}>Note cards</h5>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                  <label style={{ color: 'var(--muted)', minWidth: 160 }}>Links</label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input
                      aria-label="disable note card link clicks"
                      type="checkbox"
                      checked={pendingDisableNoteCardLinks}
                      onChange={(e) => setPendingDisableNoteCardLinks(e.target.checked)}
                    />
                    <span>Disable link clicks in note previews</span>
                  </label>
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>Per-device setting (this device).</span>
                </div>
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
                <button className="btn" type="button" onClick={() => setActiveSection(null)}>Back</button>
                <button className="btn" type="button" onClick={onSave}>Save</button>
                <span style={{ flex: 1 }} />
                {(auth?.user as any)?.role === 'admin' && <button className="btn" type="button" onClick={() => setShowInvite(true)}>Send Invite</button>}
                <button className="btn" type="button" onClick={() => { try { onClose(); } catch {} try { auth?.logout?.(); } catch {} }}>Sign out</button>
              </div>
            </div>
          ) : activeSection === 'colors' ? (
            <div>
              {!isPhone && <button className="btn" type="button" onClick={() => setActiveSection(null)} aria-label="Back">← Back</button>}
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
                <button className="btn" type="button" onClick={() => setActiveSection(null)}>Back</button>
                <button className="btn" type="button" onClick={onResetColors} title="Reset colors to defaults">Reset colors</button>
                <button className="btn" type="button" onClick={onSave}>Save</button>
                <span style={{ flex: 1 }} />
                {(auth?.user as any)?.role === 'admin' && <button className="btn" type="button" onClick={() => setShowInvite(true)}>Send Invite</button>}
                <button className="btn" type="button" onClick={() => { try { onClose(); } catch {} try { auth?.logout?.(); } catch {} }}>Sign out</button>
              </div>
            </div>
          ) : activeSection === 'drag' ? (
            <div>
              {!isPhone && <button className="btn" type="button" onClick={() => setActiveSection(null)} aria-label="Back">← Back</button>}
              <div style={{ height: 8 }} />
              <h4>Drag & Animation</h4>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-start' }}>
                <label style={{ color: 'var(--muted)', minWidth: 120 }}>Behavior</label>
                <label style={{ color: 'var(--muted)' }}>Swap</label>
                <input aria-label="drag swap" type="radio" name="dragBehavior" checked={pendingDragBehavior === 'swap'} onChange={() => setPendingDragBehavior('swap')} />
                {!isPhone && (
                  <>
                    <label style={{ color: 'var(--muted)' }}>Rearrange</label>
                    <input aria-label="drag rearrange" type="radio" name="dragBehavior" checked={pendingDragBehavior === 'rearrange'} onChange={() => setPendingDragBehavior('rearrange')} />
                  </>
                )}
              </div>
              {isPhone && (
                <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 13 }}>
                  Rearrange drag is disabled on mobile.
                </div>
              )}
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
                <button className="btn" type="button" onClick={() => setActiveSection(null)}>Back</button>
                <button className="btn" type="button" onClick={onSave}>Save</button>
                <span style={{ flex: 1 }} />
                {(auth?.user as any)?.role === 'admin' && <button className="btn" type="button" onClick={() => setShowInvite(true)}>Send Invite</button>}
                <button className="btn" type="button" onClick={() => { try { onClose(); } catch {} try { auth?.logout?.(); } catch {} }}>Sign out</button>
              </div>
            </div>
          ) : (
            <div>
              {!isPhone && <button className="btn" type="button" onClick={() => setActiveSection(null)} aria-label="Back">← Back</button>}
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
                <button className="btn" type="button" onClick={() => setActiveSection(null)}>Back</button>
                <button className="btn" type="button" onClick={onSave}>Save</button>
                <span style={{ flex: 1 }} />
                {(auth?.user as any)?.role === 'admin' && <button className="btn" type="button" onClick={() => setShowInvite(true)}>Send Invite</button>}
                <button className="btn" type="button" onClick={() => { try { onClose(); } catch {} try { auth?.logout?.(); } catch {} }}>Sign out</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {showUserMgmt && <UserManagementModal onClose={() => setShowUserMgmt(false)} />}
      {showInvite && <SettingsModal onClose={() => setShowInvite(false)} />}
      <AvatarCropModal
        open={!!cropSourceUrl}
        imageSrc={cropSourceUrl}
        title="Crop profile photo"
        onCancel={() => {
          setCropSourceUrl((prev) => {
            try { if (prev) URL.revokeObjectURL(prev); } catch {}
            return null;
          });
        }}
        onApply={onApplyCroppedPhoto}
      />
    </div>
  );
}
