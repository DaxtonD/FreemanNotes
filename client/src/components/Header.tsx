import React, { useState, useEffect, useRef } from "react";
import RegisterModal from "./RegisterModal";
import LoginModal from "./LoginModal";
import SettingsModal from "./SettingsModal";
import PreferencesModal from "./PreferencesModal";
import { useAuth } from "../authContext";

export default function Header({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const [showRegister, setShowRegister] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [registrationEnabled, setRegistrationEnabled] = useState<boolean | null>(null);
  const { user, logout } = useAuth();

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then((d) => setRegistrationEnabled(Boolean(d.userRegistrationEnabled))).catch(() => setRegistrationEnabled(false));
  }, []);

  // close dropdown on click-away or ESC
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!showDropdown) return;
      const el = dropdownRef.current;
      if (el && !el.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowDropdown(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [showDropdown]);

  return (
    <header className="app-header">
      <div className="header-left">
        <button className="menu-btn" aria-label="menu" onClick={() => onToggleSidebar && onToggleSidebar()}>☰</button>
        <img src="/icons/darkicon.png" alt="FreemanNotes icon" className="app-icon" />
        <div className="brand">FreemanNotes</div>
      </div>
      <div className="header-center">
        <input className="search" placeholder="Search" />
      </div>
      <div className="header-right" style={{ position: 'relative' }}>
        {user ? (
          <>
            <div className="avatar">{(user.name && user.name[0]) || user.email[0]}</div>
            <button className="icon-btn" onClick={logout}>Sign out</button>
            <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setShowDropdown(d => !d); }}>⚙️</button>
            {showDropdown && (
              <div ref={dropdownRef} className="settings-dropdown">
                <button className="settings-item" onClick={() => { setShowPrefs(true); setShowDropdown(false); }}>Preferences ⚙️</button>
                {user.role === 'admin' && (
                  <button className="settings-item" onClick={() => { setShowSettings(true); setShowDropdown(false); }}>Send Invite</button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <button className="icon-btn" onClick={() => setShowLogin(true)}>Sign in</button>
            {registrationEnabled && <button className="icon-btn" onClick={() => setShowRegister(true)}>Sign up</button>}
          </>
        )}
      </div>
      {showRegister && <RegisterModal onClose={() => setShowRegister(false)} />}
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showPrefs && <PreferencesModal onClose={() => setShowPrefs(false)} />}
    </header>
  );
}
