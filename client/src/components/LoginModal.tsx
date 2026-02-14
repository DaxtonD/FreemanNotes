import React, { useState } from 'react';
import { useAuth } from '../authContext';
import MobileAuthModal from './MobileAuthModal';

export default function LoginModal({ onClose }: { onClose: () => void }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useMobileModal, setUseMobileModal] = useState(false);

  React.useEffect(() => {
    const decide = () => {
      try {
        const coarse = !!window.matchMedia?.('(pointer: coarse)')?.matches;
        const narrow = window.innerWidth <= 760;
        const standalone = !!window.matchMedia?.('(display-mode: standalone)')?.matches;
        setUseMobileModal(Boolean(coarse || narrow || standalone));
      } catch {
        setUseMobileModal(window.innerWidth <= 760);
      }
    };
    decide();
    window.addEventListener('resize', decide);
    return () => window.removeEventListener('resize', decide);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally { setLoading(false); }
  }

  const form = (
    <form onSubmit={submit}>
      <div style={{ marginBottom: 8 }}>
        <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="image-url-input" />
      </div>
      <div style={{ marginBottom: 8 }}>
        <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} className="image-url-input" />
      </div>
      {error && <div style={{ color: 'salmon', marginBottom: 8 }}>{error}</div>}
      <div className={useMobileModal ? 'auth-mobile-actions' : ''} style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
      </div>
    </form>
  );

  if (useMobileModal) {
    return <MobileAuthModal title="Sign in" onClose={onClose}>{form}</MobileAuthModal>;
  }

  return (
    <div className="image-dialog-backdrop">
      <div className="image-dialog" role="dialog" aria-modal>
        <div className="dialog-header">
          <strong>Sign in</strong>
          <button className="icon-close" onClick={onClose}>✕</button>
        </div>
        {form}
      </div>
    </div>
  );
}
