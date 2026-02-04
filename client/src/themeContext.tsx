import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeChoice = 'dark' | 'light' | 'system';
export type EffectiveTheme = 'dark' | 'light';

type ThemeCtx = {
  choice: ThemeChoice;
  effective: EffectiveTheme;
  setChoice: (t: ThemeChoice) => void;
};

const Ctx = createContext<ThemeCtx | null>(null);

function getSystemTheme(): EffectiveTheme {
  try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'dark'; }
}

function applyTheme(effective: EffectiveTheme) {
  try { document.documentElement.dataset.theme = effective; } catch {}
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    try { return (localStorage.getItem('prefs.theme') as ThemeChoice) || 'system'; } catch { return 'system'; }
  });
  const effective: EffectiveTheme = useMemo(() => (choice === 'system' ? getSystemTheme() : choice), [choice]);

  useEffect(() => {
    applyTheme(effective);
    try { localStorage.setItem('prefs.theme', choice); } catch {}
    // react to system changes when using 'system'
    if (choice === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme(getSystemTheme());
      try { mq.addEventListener('change', handler); } catch {}
      return () => { try { mq.removeEventListener('change', handler); } catch {} };
    }
  }, [choice, effective]);

  const value: ThemeCtx = { choice, effective, setChoice };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
