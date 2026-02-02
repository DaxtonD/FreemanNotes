import React, { useState } from 'react';
import { useAuth } from '../authContext';
// photo upload handled via authContext.uploadPhoto for state sync

export default function LoginModal({ onClose }: { onClose: () => void }) {
  const { login, uploadPhoto } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      // If a photo is selected, upload it after login
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
  }

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
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
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 6 }}>Profile photo (optional):</label>
            <input type="file" accept="image/*" onChange={onPhotoChange} />
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
