import React, { useState, useEffect, useRef } from "react";
import RegisterModal from "./RegisterModal";
import LoginModal from "./LoginModal";
import PreferencesModal from "./PreferencesModal";
import { useTheme } from "../themeContext";
import { useAuth } from "../authContext";

export default function Header({ onToggleSidebar, searchQuery, onSearchChange }: { onToggleSidebar?: () => void, searchQuery?: string, onSearchChange?: (q: string) => void }) {
  const [showRegister, setShowRegister] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState<boolean | null>(null);
  const { user, logout } = useAuth();
  const theme = (() => { try { return useTheme(); } catch { return { effective: 'dark' } as any; } })();

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then((d) => setRegistrationEnabled(Boolean(d.userRegistrationEnabled))).catch(() => setRegistrationEnabled(false));
  }, []);

  // dropdown removed; preferences open via avatar click

  return (
    <header className="app-header">
      <div className="header-left">
        <button className="menu-btn" aria-label="menu" onClick={() => onToggleSidebar && onToggleSidebar()}>☰</button>
        <div className="brand-inline">
          <img src={(theme.effective === 'light') ? '/icons/lighticon.png' : '/icons/darkicon.png'} alt="FreemanNotes icon" className="app-icon" />
          <div className="brand">Freeman Notes</div>
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
        {user ? (
          <>
            { (user as any).userImageUrl ? (
              <img src={(user as any).userImageUrl} alt="User" className="avatar" style={{ width: 33, height: 33, borderRadius: '50%', objectFit: 'cover', cursor: 'pointer' }} onClick={() => setShowPrefs(true)} />
            ) : (
              <div className="avatar" style={{ width: 33, height: 33, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={() => setShowPrefs(true)}>{(user.name && user.email ? (user.name || user.email)[0] : '')}</div>
            ) }
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
      {showPrefs && <PreferencesModal onClose={() => setShowPrefs(false)} />}
    </header>
  );
}
