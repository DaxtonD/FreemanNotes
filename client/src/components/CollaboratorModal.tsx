import React, { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAuth } from '../authContext';

export default function CollaboratorModal({ onClose, onSelect, current, onRemove, ownerId }:
  { onClose: ()=>void; onSelect: (u:{id:number;email:string;name?:string})=>void; current: Array<{ collabId?: number; userId: number; email: string; name?: string }>; onRemove: (collabId: number) => void; ownerId: number }) {
  const { token, user } = useAuth();
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<Array<{id:number;email:string;name?:string;userImageUrl?: string}>>([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/users', { headers: { Authorization: token ? `Bearer ${token}` : '' } });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setUsers(Array.isArray(data.users) ? data.users : []);
      } catch (err) {
        console.warn('Failed to load users', err);
      }
    })();
  }, [token]);
  const currentIds = useMemo(() => new Set(current.map(c => c.userId)), [current]);
  const list = useMemo(() => users.filter(u => {
    const match = (u.email.includes(q) || (u.name || u.email.split("@")[0]).toLowerCase().includes(q.toLowerCase()));
    const notSelf = (user ? u.id !== (user as any).id : true);
    const notAlready = !currentIds.has(u.id);
    return match && notSelf && notAlready;
  }), [q, users, user, currentIds]);

  const modal = (
    <div
      className="collab-modal-backdrop"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000 }}
    >
      <div
        className="collab-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(720px, 95vw)', maxHeight: '80vh', overflowY: 'auto', margin: '10vh auto 0', borderRadius: 8, boxShadow: '0 10px 28px rgba(0,0,0,0.5)', padding: 16 }}
      >
        <div className="collab-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <strong>Add collaborators</strong>
          <button className="icon-close" onClick={onClose}>✕</button>
        </div>
        <input className="collab-search" placeholder="Search users..." value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', marginBottom: 12 }} />
        <div className="collab-current" style={{ marginBottom: 16 }}>
          <div className="collab-section-title" style={{ fontWeight: 600, opacity: 0.8, marginBottom: 6 }}>Current collaborators</div>
          {current.length === 0 && <div className="collab-empty">None</div>}
          {current.map(c => (
            <div key={c.userId} className="collab-item" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              { (c as any).userImageUrl ? (
                <img src={(c as any).userImageUrl} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                <div className="collab-avatar" style={{ width: 28, height: 28, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {(c.name || c.email.split('@')[0])[0].toUpperCase()}
                </div>
              ) }
              <div className="collab-info" style={{ flex: 1 }}>
                <div className="collab-name" title={c.email}>{c.name || c.email.split("@")[0]}</div>
              </div>
              {typeof c.collabId === 'number' && (((user as any)?.id === ownerId) || ((user as any)?.id === c.userId)) && (
                <button className="tiny danger" onClick={() => c.collabId && onRemove(c.collabId)} aria-label="Remove collaborator" title="Remove">🗑</button>
              )}
            </div>
          ))}
        </div>
        <div className="collab-list">
          <div className="collab-section-title" style={{ fontWeight: 600, opacity: 0.8, marginBottom: 6 }}>Other users</div>
          {list.map(u => (
            <div key={u.id} className="collab-item" onClick={() => onSelect(u)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer' }}>
              { u.userImageUrl ? (
                <img src={u.userImageUrl} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                <div className="collab-avatar" style={{ width: 28, height: 28, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {(u.name || u.email.split('@')[0])[0].toUpperCase()}
                </div>
              ) }
              <div className="collab-info" style={{ flex: 1 }}>
                <div className="collab-name" title={u.email}>{u.name || u.email.split("@")[0]}</div>
              </div>
            </div>
          ))}
          {list.length === 0 && <div className="collab-empty">No users found</div>}
        </div>
      </div>
    </div>
  );

  try {
    if (typeof document !== 'undefined') {
      return createPortal(modal, document.body);
    }
  } catch {}
  return modal;
}
