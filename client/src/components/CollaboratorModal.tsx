import React, { useMemo, useState } from "react";

const MOCK_USERS = [
  { id: 1, email: "alice@example.com" },
  { id: 2, email: "bob@example.com" },
  { id: 3, email: "carol@example.com" },
  { id: 4, email: "dan@example.com" }
];

export default function CollaboratorModal({ onClose, onSelect }: { onClose: ()=>void; onSelect: (u:{id:number;email:string})=>void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => MOCK_USERS.filter(u => u.email.includes(q) || u.email.split("@")[0].includes(q)), [q]);

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
