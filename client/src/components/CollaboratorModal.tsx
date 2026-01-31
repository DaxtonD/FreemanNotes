import React, { useMemo, useState, useEffect } from "react";
import { useAuth } from '../authContext';

export default function CollaboratorModal({ onClose, onSelect }: { onClose: ()=>void; onSelect: (u:{id:number;email:string})=>void }) {
  const { token, user } = useAuth();
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<Array<{id:number;email:string}>>([]);
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
  const list = useMemo(() => users.filter(u => (u.email.includes(q) || u.email.split("@")[0].includes(q)) && (user ? u.id !== user.id : true)), [q, users, user]);

  return (
    <div className="collab-modal-backdrop" onClick={onClose}>
      <div className="collab-modal" onClick={(e) => e.stopPropagation()}>
        <div className="collab-header">
          <strong>Add collaborators</strong>
          <button className="icon-close" onClick={onClose}>✕</button>
        </div>
        <input className="collab-search" placeholder="Search users..." value={q} onChange={e => setQ(e.target.value)} />
        <div className="collab-list">
          {list.map(u => (
            <div key={u.id} className="collab-item" onClick={() => onSelect(u)}>
              <div className="collab-avatar">{u.email[0].toUpperCase()}</div>
              <div className="collab-info">
                <div className="collab-email">{u.email}</div>
              </div>
            </div>
          ))}
          {list.length === 0 && <div className="collab-empty">No users found</div>}
        </div>
      </div>
    </div>
  );
}
