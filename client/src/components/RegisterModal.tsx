import React, { useState, useEffect } from 'react';
import { useAuth } from '../authContext';
// photo upload handled via authContext.uploadPhoto for state sync

export default function RegisterModal({ onClose }: { onClose: () => void }) {
  const { register, uploadPhoto } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrationEnabled, setRegistrationEnabled] = useState<boolean | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);

  // Simple password check: only ensure passwords match
  const matches = confirmPassword.length > 0 && password === confirmPassword;

  function Icon({ ok }: { ok: boolean }) {
    return ok ? (
      <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden focusable="false" style={{ color: '#4caf50' }}>
        <path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden focusable="false" style={{ color: '#ff6e6e' }}>
        <path d="M6 6L18 18M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || !password) {
      setError('All fields are required');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await register(email, password, name, inviteToken || undefined);
      // Upload photo if selected
      try {
        if (photoFile) {
          const dataUrl = await fileToDataUrl(photoFile);
          await uploadPhoto(dataUrl);
        }
      } catch {}
      onClose();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally { setLoading(false); }
  }

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null;
    setPhotoFile(f);
    try {
      setPhotoPreviewUrl((prev) => {
        try { if (prev) URL.revokeObjectURL(prev); } catch {}
        return f ? URL.createObjectURL(f) : null;
      });
    } catch {
      setPhotoPreviewUrl(null);
    }
  }

  useEffect(() => {
    return () => {
      try { if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl); } catch {}
    };
  }, [photoPreviewUrl]);

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
  }

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then((d) => setRegistrationEnabled(Boolean(d.userRegistrationEnabled))).catch(() => setRegistrationEnabled(false));
  }, []);

  return (
    <div className="image-dialog-backdrop">
      <div className="image-dialog" role="dialog" aria-modal>
        <div className="dialog-header">
          <strong>Register</strong>
          <button className="icon-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div style={{ marginBottom: 8 }}>
            <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} className="image-url-input" required />
          </div>
          <div style={{ marginBottom: 8 }}>
            <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="image-url-input" />
          </div>
          <div style={{ marginBottom: 8 }}>
            <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} className="image-url-input" />
          </div>
          <div style={{ marginBottom: 8 }}>
            <input placeholder="Confirm password" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="image-url-input" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 6 }}>Profile photo (optional):</label>
            <input type="file" accept="image/*" onChange={onPhotoChange} />
            {photoPreviewUrl && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                <img
                  src={photoPreviewUrl}
                  alt="Selected profile preview"
                  style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }}
                />
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>Preview</div>
              </div>
            )}
          </div>
          <div style={{ display: 'grid', rowGap: 6, margin: '10px 2px 12px' }} aria-live="polite">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)' }}>
              <Icon ok={matches} /> <span>Passwords match</span>
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <input placeholder="Invite token (optional)" value={inviteToken} onChange={e => setInviteToken(e.target.value)} className="image-url-input" />
          </div>
          {registrationEnabled === false && <div style={{ color: 'salmon', marginBottom: 8 }}>Registration is currently disabled — you must provide a valid invite token.</div>}
          {error && <div style={{ color: 'salmon', marginBottom: 8 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className="btn"
              disabled={
                loading ||
                !name.trim() ||
                !email.trim() ||
                !password ||
                !confirmPassword ||
                !matches
              }
            >
              {loading ? 'Registering...' : 'Register'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
