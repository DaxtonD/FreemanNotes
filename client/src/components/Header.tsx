import React, { useState, useEffect, useRef } from "react";
import PreferencesModal from "./PreferencesModal";
import { useTheme } from "../themeContext";
import { useAuth } from "../authContext";

export default function Header({ onToggleSidebar, searchQuery, onSearchChange, viewMode = 'cards', onToggleViewMode, showViewToggle = true }: { onToggleSidebar?: () => void, searchQuery?: string, onSearchChange?: (q: string) => void, viewMode?: 'cards' | 'list-1' | 'list-2', onToggleViewMode?: () => void, showViewToggle?: boolean }) {
  const [showPrefs, setShowPrefs] = useState(false);
  const [mobileCompact, setMobileCompact] = useState(false);
    const [avatarKey, setAvatarKey] = useState<number>(() => Date.now());
  const { user } = useAuth();
  const theme = (() => { try { return useTheme(); } catch { return { effective: 'dark' } as any; } })();
  const nextViewMode = viewMode === 'cards' ? 'list-1' : (viewMode === 'list-1' ? 'list-2' : 'cards');
  const currentViewLabel = viewMode === 'cards' ? 'Card view' : (viewMode === 'list-1' ? '1x1 list view' : '2x1 list view');
  const nextViewLabel = nextViewMode === 'cards' ? 'Card view' : (nextViewMode === 'list-1' ? '1x1 list view' : '2x1 list view');

  // dropdown removed; preferences open via avatar click

  useEffect(() => {
    const onPhoto = (e: any) => {
      try { setAvatarKey(Date.now()); } catch {}
    };
    window.addEventListener('freemannotes:user-photo-updated', onPhoto as EventListener);
    return () => window.removeEventListener('freemannotes:user-photo-updated', onPhoto as EventListener);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (showPrefs) {
      root.classList.add('is-preferences-open');
      try { window.dispatchEvent(new CustomEvent('freemannotes:mobile-add/close')); } catch {}
    } else {
      root.classList.remove('is-preferences-open');
    }
    return () => {
      try { root.classList.remove('is-preferences-open'); } catch {}
    };
  }, [showPrefs]);

  useEffect(() => {
    let rafId: number | null = null;
    const root = document.documentElement;
    let lastY = 0;
    let compact = false;
    let upAccum = 0;
    let downAccum = 0;
    let lastToggleAt = 0;

    const ENTER_Y = 72;
    const EXIT_Y = 26;
    const MIN_DELTA = 1.25;
    const ENTER_ACCUM = 14;
    const EXIT_ACCUM = 14;
    const TOGGLE_COOLDOWN_MS = 220;

    const isPhoneLike = () => {
      try {
        const mq = window.matchMedia;
        const touchLike = !!(mq && (mq('(pointer: coarse)').matches || mq('(any-pointer: coarse)').matches));
        const vw = (window.visualViewport && typeof window.visualViewport.width === 'number') ? window.visualViewport.width : window.innerWidth;
        const vh = (window.visualViewport && typeof window.visualViewport.height === 'number') ? window.visualViewport.height : window.innerHeight;
        const shortSide = Math.min(vw, vh);
        return touchLike && shortSide <= 600;
      } catch {
        return false;
      }
    };

    const getScrollTop = () => {
      const el = document.querySelector('.main-area') as HTMLElement | null;
      if (el) return Math.max(0, el.scrollTop || 0);
      return Math.max(0, window.scrollY || 0);
    };

    const applyCompact = (next: boolean) => {
      if (compact === next) return;
      compact = next;
      lastToggleAt = Date.now();
      upAccum = 0;
      downAccum = 0;
      setMobileCompact(next);
      root.classList.toggle('mobile-header-compact', next);
    };

    const evaluate = () => {
      if (!isPhoneLike()) {
        if (compact) applyCompact(false);
        return;
      }
      const y = getScrollTop();
      const dy = y - lastY;
      lastY = y;

      // Ignore micro-jitter from inertial/bounce scrolling.
      if (Math.abs(dy) < MIN_DELTA) return;

      if (dy > 0) {
        downAccum += dy;
        upAccum = 0;
      } else {
        upAccum += -dy;
        downAccum = 0;
      }

      if ((Date.now() - lastToggleAt) < TOGGLE_COOLDOWN_MS) return;

      // Enter compact mode only after passing threshold + clear downward intent.
      if (!compact && y >= ENTER_Y && downAccum >= ENTER_ACCUM) {
        applyCompact(true);
        return;
      }

      // Exit compact mode near top or after clear upward intent.
      if (compact && (y <= EXIT_Y || upAccum >= EXIT_ACCUM)) {
        applyCompact(false);
      }
    };

    const onScroll = () => {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        evaluate();
      });
    };

    const onResize = () => {
      lastY = getScrollTop();
      evaluate();
    };

    const mainArea = document.querySelector('.main-area') as HTMLElement | null;
    lastY = getScrollTop();
    evaluate();
    mainArea?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    try { window.visualViewport?.addEventListener('resize', onResize); } catch {}

    return () => {
      if (rafId != null) {
        try { window.cancelAnimationFrame(rafId); } catch {}
      }
      mainArea?.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      try { window.visualViewport?.removeEventListener('resize', onResize); } catch {}
      try { root.classList.remove('mobile-header-compact'); } catch {}
      setMobileCompact(false);
    };
  }, []);

  return (
    <header className={`app-header${mobileCompact ? ' app-header--mobile-compact' : ''}`}>
      <div className="header-left">
        <button
          type="button"
          className="menu-btn"
          aria-label="Menu"
          title="Menu"
          onClick={() => onToggleSidebar && onToggleSidebar()}
        >
          <svg viewBox="0 0 24 24" aria-hidden focusable="false">
            <rect x="4" y="5" width="16" height="2.2" rx="1.1" />
            <rect x="4" y="10.9" width="16" height="2.2" rx="1.1" />
            <rect x="4" y="16.8" width="16" height="2.2" rx="1.1" />
          </svg>
        </button>
        <div className="brand-inline">
          <img src={(theme.effective === 'light') ? '/icons/lighticon.png' : '/icons/darkicon.png'} alt="FreemanNotes icon" className="app-icon" />
        </div>
      </div>
      <div className="header-center">
        <input
          className="search"
          placeholder="Search"
          value={searchQuery ?? ''}
          onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
        />
      </div>
      <div className="header-right" style={{ position: 'relative' }}>
        {showViewToggle && (
          <button
            type="button"
            className="view-toggle-btn"
            onClick={() => onToggleViewMode && onToggleViewMode()}
            aria-label={`Switch to ${nextViewLabel}`}
            title={`${currentViewLabel} (click for ${nextViewLabel})`}
            aria-pressed={viewMode !== 'cards'}
          >
            {viewMode === 'cards' ? (
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <rect x="4" y="5" width="6" height="6" rx="1.5" />
                <rect x="14" y="5" width="6" height="6" rx="1.5" />
                <rect x="4" y="13" width="6" height="6" rx="1.5" />
                <rect x="14" y="13" width="6" height="6" rx="1.5" />
              </svg>
            ) : viewMode === 'list-1' ? (
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <rect x="4" y="5" width="16" height="2.2" rx="1.1" />
                <rect x="4" y="10.9" width="16" height="2.2" rx="1.1" />
                <rect x="4" y="16.8" width="16" height="2.2" rx="1.1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <rect x="4" y="5" width="7" height="2.2" rx="1.1" />
                <rect x="13" y="5" width="7" height="2.2" rx="1.1" />
                <rect x="4" y="10.9" width="7" height="2.2" rx="1.1" />
                <rect x="13" y="10.9" width="7" height="2.2" rx="1.1" />
                <rect x="4" y="16.8" width="7" height="2.2" rx="1.1" />
                <rect x="13" y="16.8" width="7" height="2.2" rx="1.1" />
              </svg>
            )}
          </button>
        )}
        {user ? (
          <div className="header-avatar-wrap">
            { (user as any).userImageUrl ? (
              <img key={avatarKey} src={(user as any).userImageUrl} alt="User" className="avatar" style={{ width: 33, height: 33, borderRadius: '50%', objectFit: 'cover', cursor: 'pointer' }} onClick={() => setShowPrefs(true)} />
            ) : (
              <div className="avatar" style={{ width: 33, height: 33, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={() => setShowPrefs(true)}>{(user.name && user.email ? (user.name || user.email)[0] : '')}</div>
            ) }
          </div>
        ) : null}
      </div>
      {showPrefs && <PreferencesModal onClose={() => setShowPrefs(false)} />}
    </header>
  );
}
