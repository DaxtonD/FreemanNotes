import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../authContext';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { token } = useAuth();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Mobile back button: treat this as an overlay.
  const backIdRef = useRef<string>('');
  const onCloseRef = useRef<(() => void) | null>(null);
  onCloseRef.current = onClose;
  const isPhoneLike = (() => {
    try {
      const mq = window.matchMedia;
      const touchLike = !!(mq && (mq('(pointer: coarse)').matches || mq('(any-pointer: coarse)').matches));
      const vw = (window.visualViewport && typeof window.visualViewport.width === 'number') ? window.visualViewport.width : window.innerWidth;
      const vh = (window.visualViewport && typeof window.visualViewport.height === 'number') ? window.visualViewport.height : window.innerHeight;
      const shortSide = Math.min(vw, vh);
      return touchLike && shortSide <= 600;
    } catch { return false; }
  })();

  useEffect(() => {
    if (!isPhoneLike) return;
    try {
      if (!backIdRef.current) backIdRef.current = `settings-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const id = backIdRef.current;
      const onBack = () => { try { onCloseRef.current?.(); } catch {} };
      window.dispatchEvent(new CustomEvent('freemannotes:back/register', { detail: { id, onBack } }));
      return () => {
        try { window.dispatchEvent(new CustomEvent('freemannotes:back/unregister', { detail: { id } })); } catch {}
      };
    } catch {
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPhoneLike]);

  async function sendInvite(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ email, role })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMsg(`Invite created for ${data.invite.email} (role: ${data.invite.role})`);
      setEmail('');
      setRole('user');
    } catch (err: any) {
      setMsg(`Error: ${err?.message ?? String(err)}`);
    } finally { setLoading(false); }
  }

  return (
    <div className="image-dialog-backdrop">
      <div className="image-dialog" role="dialog" aria-modal>
        <div className="dialog-header">
          <strong>Settings</strong>
          <button className="icon-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: 8 }}>
          <h4>Invites</h4>
          <form onSubmit={sendInvite} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input placeholder="Email to invite" value={email} onChange={e => setEmail(e.target.value)} className="image-url-input" />
            <select value={role} onChange={e => setRole(e.target.value as 'user' | 'admin')} className="image-url-input" aria-label="Role">
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <button className="btn" type="submit" disabled={loading || !email}>Send invite</button>
          </form>
          {msg && <div style={{ marginTop: 8 }}>{msg}</div>}
        </div>
      </div>
    </div>
  );
}
