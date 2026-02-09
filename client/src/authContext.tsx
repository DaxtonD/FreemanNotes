import React, { createContext, useContext, useEffect, useState } from 'react';
import { me as apiMe, login as apiLogin, register as apiRegister, uploadMyPhoto, updateMe as apiUpdateMe } from './lib/authApi';

type User = { id: number; email: string; name?: string; role?: 'admin' | 'user' } | null;

type AuthContextValue = {
  user: User;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string, inviteToken?: string) => Promise<void>;
  logout: () => void;
  uploadPhoto: (dataUrl: string) => Promise<void>;
  updateMe: (payload: any) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth() {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used within AuthProvider');
  return v;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('fn_token'));

  useEffect(() => {
    if (!token) return;
    apiMe(token).then((data) => setUser(data.user)).catch(() => { setUser(null); setToken(null); localStorage.removeItem('fn_token'); });
  }, [token]);
  // apply persisted user preferences when loaded
  useEffect(() => {
    if (!user) return;
    try {
      if ((user as any).fontFamily) {
        document.documentElement.style.setProperty('--app-font-family', (user as any).fontFamily);
        localStorage.setItem('prefs.fontFamily', (user as any).fontFamily);
      }
      if (typeof (user as any).noteWidth === 'number') {
        const w = (user as any).noteWidth;
        document.documentElement.style.setProperty('--note-card-width', String(w) + 'px');
        localStorage.setItem('prefs.noteWidth', String(w));
        // trigger notes grid to recalc immediately so width is applied without requiring a window resize
        try { window.dispatchEvent(new Event('notes-grid:recalc')); } catch {}
      }
      if ((user as any).dragBehavior) {
        localStorage.setItem('prefs.dragBehavior', (user as any).dragBehavior);
      }
      if ((user as any).animationSpeed) {
        localStorage.setItem('prefs.animationSpeed', (user as any).animationSpeed);
      }
      if (typeof (user as any).checklistSpacing === 'number') {
        document.documentElement.style.setProperty('--checklist-gap', String((user as any).checklistSpacing) + 'px');
        localStorage.setItem('prefs.checklistSpacing', String((user as any).checklistSpacing));
      }
      if (typeof (user as any).checkboxSize === 'number') {
        document.documentElement.style.setProperty('--checklist-checkbox-size', String((user as any).checkboxSize) + 'px');
        localStorage.setItem('prefs.checkboxSize', String((user as any).checkboxSize));
      }
      if (typeof (user as any).checklistTextSize === 'number') {
        document.documentElement.style.setProperty('--checklist-text-size', String((user as any).checklistTextSize) + 'px');
        localStorage.setItem('prefs.checklistTextSize', String((user as any).checklistTextSize));
      }
      if (typeof (user as any).noteLineSpacing === 'number') {
        document.documentElement.style.setProperty('--note-line-height', String((user as any).noteLineSpacing));
        localStorage.setItem('prefs.noteLineSpacing', String((user as any).noteLineSpacing));
      }
      if (typeof (user as any).imageThumbSize === 'number') {
        document.documentElement.style.setProperty('--image-thumb-size', String((user as any).imageThumbSize) + 'px');
        localStorage.setItem('prefs.imageThumbSize', String((user as any).imageThumbSize));
      }
      if ((user as any).checkboxBg) {
        document.documentElement.style.setProperty('--checkbox-bg', (user as any).checkboxBg);
        localStorage.setItem('prefs.checkboxBg', (user as any).checkboxBg);
      }
      if ((user as any).checkboxBorder) {
        document.documentElement.style.setProperty('--checkbox-border', (user as any).checkboxBorder);
        localStorage.setItem('prefs.checkboxBorder', (user as any).checkboxBorder);
      }

      // Hyperlink colors (user-scoped)
      try {
        const dark = (user as any).linkColorDark;
        if (typeof dark === 'string' && dark) {
          document.documentElement.style.setProperty('--link-color-dark', dark);
          localStorage.setItem('prefs.linkColorDark', dark);
        } else if (dark === null) {
          document.documentElement.style.removeProperty('--link-color-dark');
          localStorage.removeItem('prefs.linkColorDark');
        }
        const light = (user as any).linkColorLight;
        if (typeof light === 'string' && light) {
          document.documentElement.style.setProperty('--link-color-light', light);
          localStorage.setItem('prefs.linkColorLight', light);
        } else if (light === null) {
          document.documentElement.style.removeProperty('--link-color-light');
          localStorage.removeItem('prefs.linkColorLight');
        }
      } catch {}
    } catch {}
  }, [user]);

  async function login(email: string, password: string) {
    const data = await apiLogin(email, password);
    const t = data.token;
    setToken(t);
    localStorage.setItem('fn_token', t);
    setUser(data.user);
  }

  async function register(email: string, password: string, name?: string, inviteToken?: string) {
    const data = await apiRegister(email, password, name, inviteToken);
    const t = data.token;
    setToken(t);
    localStorage.setItem('fn_token', t);
    setUser(data.user);
  }

  async function uploadPhoto(dataUrl: string) {
    // After registration/login, `setToken()` may not have propagated yet,
    // but we synchronously store the token in localStorage. Use that as a fallback.
    const effectiveToken = token || localStorage.getItem('fn_token');
    if (!effectiveToken) throw new Error('Not authenticated');
    const data = await uploadMyPhoto(effectiveToken, dataUrl);
    if (data && data.user) setUser(data.user);
  }

  async function updateMe(payload: any) {
    if (!token) throw new Error('Not authenticated');
    const data = await apiUpdateMe(token, payload);
    if (data && data.user) setUser(data.user);
    else {
      // Optimistically merge payload into user if server doesn't echo
      setUser((prev) => {
        if (!prev) return prev;
        return { ...(prev as any), ...(payload || {}) } as any;
      });
    }
  }

  function logout() {
    setToken(null);
    setUser(null);
    localStorage.removeItem('fn_token');
  }

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, uploadPhoto, updateMe }}>
      {children}
    </AuthContext.Provider>
  );
};
