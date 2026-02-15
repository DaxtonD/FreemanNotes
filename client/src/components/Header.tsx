import React, { useState, useEffect, useRef } from "react";
import PreferencesModal from "./PreferencesModal";
import { useTheme } from "../themeContext";
import { useAuth } from "../authContext";

export default function Header({ onToggleSidebar, searchQuery, onSearchChange, viewMode = 'cards', onToggleViewMode }: { onToggleSidebar?: () => void, searchQuery?: string, onSearchChange?: (q: string) => void, viewMode?: 'cards' | 'list-1' | 'list-2', onToggleViewMode?: () => void }) {
  const [showPrefs, setShowPrefs] = useState(false);
  const { user } = useAuth();
  const theme = (() => { try { return useTheme(); } catch { return { effective: 'dark' } as any; } })();
  const nextViewMode = viewMode === 'cards' ? 'list-1' : (viewMode === 'list-1' ? 'list-2' : 'cards');
  const currentViewLabel = viewMode === 'cards' ? 'Card view' : (viewMode === 'list-1' ? '1x1 list view' : '2x1 list view');
  const nextViewLabel = nextViewMode === 'cards' ? 'Card view' : (nextViewMode === 'list-1' ? '1x1 list view' : '2x1 list view');

  // dropdown removed; preferences open via avatar click

  return (
    <header className="app-header">
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
        {user ? (
          <div className="header-avatar-wrap">
            { (user as any).userImageUrl ? (
              <img src={(user as any).userImageUrl} alt="User" className="avatar" style={{ width: 33, height: 33, borderRadius: '50%', objectFit: 'cover', cursor: 'pointer' }} onClick={() => setShowPrefs(true)} />
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
