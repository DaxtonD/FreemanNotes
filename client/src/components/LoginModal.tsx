import React, { useState } from 'react';
import { useAuth } from '../authContext';
import MobileAuthModal from './MobileAuthModal';
import { requestPasswordReset, resetPasswordWithToken } from '../lib/authApi';

export default function LoginModal({ onClose }: { onClose: () => void }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [useMobileModal, setUseMobileModal] = useState(false);
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>(() => {
    try {
      const resetToken = new URLSearchParams(window.location.search).get('reset');
      return resetToken ? 'reset' : 'login';
    } catch {
      return 'login';
    }
  });
  const [resetToken] = useState<string>(() => {
    try { return new URLSearchParams(window.location.search).get('reset') || ''; } catch { return ''; }
  });
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

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
    setMessage(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
        onClose();
        return;
      }

      if (mode === 'forgot') {
        await requestPasswordReset(email);
        setMessage('If an account exists for that email, a reset link has been sent.');
        return;
      }

      if (!resetToken) {
        setError('Missing reset token. Use the link from your email.');
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      await resetPasswordWithToken(resetToken, newPassword);
      setMode('login');
      setNewPassword('');
      setConfirmPassword('');
      setMessage('Password updated. You can sign in now.');
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('reset');
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
      } catch {}
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally { setLoading(false); }
  }

  const title = mode === 'forgot' ? 'Forgot password' : mode === 'reset' ? 'Reset password' : 'Sign in';

  const form = (
    <form onSubmit={submit}>
      {(mode === 'login' || mode === 'forgot') && (
        <div style={{ marginBottom: 8 }}>
          <input
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="image-url-input"
            autoComplete="username"
          />
        </div>
      )}
      {mode === 'login' && (
        <div style={{ marginBottom: 8 }}>
          <input
            placeholder="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="image-url-input"
            autoComplete="current-password"
          />
        </div>
      )}
      {mode === 'reset' && (
        <>
          <div style={{ marginBottom: 8 }}>
            <input
              placeholder="New password"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="image-url-input"
              autoComplete="new-password"
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <input
              placeholder="Confirm new password"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="image-url-input"
              autoComplete="new-password"
            />
          </div>
        </>
      )}
      {error && <div style={{ color: 'salmon', marginBottom: 8 }}>{error}</div>}
      {message && <div style={{ color: 'var(--muted)', marginBottom: 8 }}>{message}</div>}
      <div style={{ marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {mode === 'login' && (
          <button type="button" className="btn" onClick={() => { setMode('forgot'); setError(null); setMessage(null); }}>
            Forgot password?
          </button>
        )}
        {mode !== 'login' && (
          <button type="button" className="btn" onClick={() => { setMode('login'); setError(null); }}>
            Back to sign in
          </button>
        )}
      </div>
      <div className={useMobileModal ? 'auth-mobile-actions' : ''} style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn" disabled={loading || (mode !== 'reset' && !email)}>
          {loading
            ? (mode === 'forgot' ? 'Sending...' : mode === 'reset' ? 'Updating...' : 'Signing in...')
            : (mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Set password' : 'Sign in')}
        </button>
      </div>
    </form>
  );

  if (useMobileModal) {
    return <MobileAuthModal title={title} onClose={onClose}>{form}</MobileAuthModal>;
  }

  return (
    <div className="image-dialog-backdrop">
      <div className="image-dialog" role="dialog" aria-modal>
        <div className="dialog-header">
          <strong>{title}</strong>
          <button className="icon-close" onClick={onClose}>✕</button>
        </div>
        {form}
      </div>
    </div>
  );
}
