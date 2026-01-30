import React, { useEffect, useState } from "react";
import { useAuth } from "../authContext";

export default function Sidebar({ selectedLabelIds = [], onToggleLabel, onClearLabels, collapsed = false }: { selectedLabelIds?: number[]; onToggleLabel?: (id: number) => void; onClearLabels?: () => void; collapsed?: boolean }) {
  const { token } = useAuth();
  const [labels, setLabels] = useState<Array<{ id: number; name: string }>>([]);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!token) { setLabels([]); return; }
    fetch('/api/labels', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setLabels(Array.isArray(d.labels) ? d.labels : []))
      .catch(() => setLabels([]));
    const handler = () => {
      fetch('/api/labels', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => setLabels(Array.isArray(d.labels) ? d.labels : []))
        .catch(() => {});
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('labels:refresh', handler);
    }
    return () => { if (typeof window !== 'undefined') window.removeEventListener('labels:refresh', handler); };
  }, [token]);
  return (
    <aside className={"sidebar" + (collapsed ? " collapsed" : "")}>
      <div className="sidebar-section">
        <div className="sidebar-item active" title="Notes">
          <span className="icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M6 3h9l3 3v15H6zM14 3v4h4"/>
            </svg>
          </span>
          {!collapsed && <span className="text">Notes</span>}
        </div>
        <div className="sidebar-item" title="Reminders">
          <span className="icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2z"/>
              <path d="M18 8V7a6 6 0 1 0-12 0v1c0 3.5-2 5-2 5h16s-2-1.5-2-5z"/>
            </svg>
          </span>
          {!collapsed && <span className="text">Reminders</span>}
        </div>
        <hr />
        <div className="sidebar-item" onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer' }} title="Labels">
          <span className="icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M6 3h12v18l-6-4-6 4V3z"/>
            </svg>
          </span>
          {!collapsed && <span className="text">{open ? '▼' : '▶'} Labels</span>}
        </div>
        {open && !collapsed && (
          <div style={{ paddingLeft: 8 }}>
            {labels.length === 0 && <div className="sidebar-item" style={{ color: 'var(--muted)' }}>No labels</div>}
            {labels.map(l => (
              <label key={l.id} className="sidebar-item" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={selectedLabelIds.includes(l.id)} onChange={() => onToggleLabel && onToggleLabel(l.id)} />
                <span>{l.name}</span>
              </label>
            ))}
            {labels.length > 0 && (
              <button className="btn" onClick={onClearLabels} style={{ marginTop: 6 }}>Clear</button>
            )}
          </div>
        )}
        <div className="sidebar-item" title="Collections">
          <span className="icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
            </svg>
          </span>
          {!collapsed && <span className="text">Collections</span>}
        </div>
        <div className="sidebar-item" title="Archive">
          <span className="icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M20.54 5.23L19.4 4H4.6L3.46 5.23 3 6v2h18V6l-.46-.77zM6 10v9h12V10H6zm3 2h6v2H9v-2z"/>
            </svg>
          </span>
          {!collapsed && <span className="text">Archive</span>}
        </div>
        <div className="sidebar-item" title="Bin">
          <span className="icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M4 7h16"/>
              <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/>
              <path d="M9 7V5h6v2"/>
            </svg>
          </span>
          {!collapsed && <span className="text">Bin</span>}
        </div>
      </div>
    </aside>
  );
}
