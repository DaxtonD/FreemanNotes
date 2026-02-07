import React, { useState } from 'react';
import { useAuth } from '../authContext';

export default function LoginModal({ onClose }: { onClose: () => void }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="image-dialog-backdrop">
      <div className="image-dialog" role="dialog" aria-modal>
        <div className="dialog-header">
          <strong>Sign in</strong>
          <button className="icon-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div style={{ marginBottom: 8 }}>
            <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="image-url-input" />
          </div>
          <div style={{ marginBottom: 8 }}>
            <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} className="image-url-input" />
          </div>
          {error && <div style={{ color: 'salmon', marginBottom: 8 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
