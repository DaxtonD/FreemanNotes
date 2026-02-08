import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../authContext';

export default function LabelsDialog({ noteId, onClose, onUpdated }: { noteId: number; onClose: () => void; onUpdated?: (labels: Array<{ id: number; name: string }>) => void }) {
  const { token } = useAuth();
  const [labels, setLabels] = useState<Array<{ id: number; name: string }>>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      fetch('/api/labels', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch(`/api/notes`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())
    ])
    .then(([lbl, notesData]) => {
      const list = Array.isArray(lbl.labels) ? lbl.labels : [];
      setLabels(list);
      const note = (Array.isArray(notesData.notes) ? notesData.notes : []).find((n: any) => n.id === noteId);
      const existing = new Set<number>((note?.noteLabels || []).map((nl: any) => nl.label?.id).filter((id: any) => typeof id === 'number'));
      setSelected(existing);
    })
    .catch(() => {});
  }, [token, noteId]);

  // Prevent interaction with notes behind the modal.
  // Use the shared open/close depth events so NotesGrid owns the global lock.
  useEffect(() => {
    try {
      window.dispatchEvent(new Event('freemannotes:editor-modal-open'));
      return () => {
        // Delay the close signal one tick so the same gesture can't click-through.
        setTimeout(() => {
          try { window.dispatchEvent(new Event('freemannotes:editor-modal-close')); } catch {}
        }, 0);
      };
    } catch {
      return;
    }
  }, []);

  async function attach(nameOrId: string | number) {
    if (!token) return;
    setSaving(true);
    try {
      let body: any = {};
      if (typeof nameOrId === 'string') body = { name: nameOrId };
      else {
        const lbl = labels.find(l => l.id === nameOrId);
        if (!lbl) return;
        body = { name: lbl.name };
      }
      const res = await fetch(`/api/notes/${noteId}/labels`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (data?.label) {
        const lbl = data.label as { id: number; name: string };
        const exists = labels.some(x => x.id === lbl.id);
        const nextLabels = exists ? labels : [...labels, lbl];
        const nextSelected = new Set(selected);
        nextSelected.add(lbl.id);
        setLabels(nextLabels);
        setSelected(nextSelected);
        onUpdated && onUpdated(nextLabels.filter(l => nextSelected.has(l.id)));
        // update sidebar immediately
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('labels:refresh'));
      }
    } finally {
      setSaving(false);
    }
  }

  async function detach(labelId: number) {
    if (!token) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/notes/${noteId}/labels/${labelId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(await res.text());
      const nextSelected = new Set(selected);
      nextSelected.delete(labelId);
      setSelected(nextSelected);
      onUpdated && onUpdated(labels.filter(l => nextSelected.has(l.id)));
    } finally {
      setSaving(false);
    }
  }

  async function deleteLabel(labelId: number) {
    if (!token) return;
    const ok = window.confirm('Delete this label? This will remove it from all notes and from the sidebar.');
    if (!ok) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/labels/${labelId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(await res.text());
      const nextLabels = labels.filter(l => l.id !== labelId);
      const nextSelected = new Set(selected);
      nextSelected.delete(labelId);
      setLabels(nextLabels);
      setSelected(nextSelected);
      onUpdated && onUpdated(nextLabels.filter(l => nextSelected.has(l.id)));
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('labels:refresh'));
    } finally {
      setSaving(false);
    }
  }

  const dialog = (
    <div
      className="image-dialog-backdrop"
      onPointerDown={(e) => {
        // Close on pointer-down to avoid click-through (don't wait for click).
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        e.stopPropagation();
        setTimeout(() => onClose(), 0);
      }}
      onClick={(e) => {
        // If we close on pointerdown, ignore the synthetic click.
        if (e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div
        className="image-dialog"
        role="dialog"
        aria-modal
        style={{ width: 360 }}
        onPointerDown={(e) => { e.stopPropagation(); }}
        onMouseDown={(e) => { e.stopPropagation(); }}
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div className="dialog-header">
          <strong>Labels</strong>
          <button className="icon-close" onClick={onClose}>✕</button>
        </div>
        <div className="dialog-body">
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Create new label" className="image-url-input" />
            <button className="btn" onClick={async () => { const name = newName.trim(); if (!name) return; await attach(name); setNewName(''); }} disabled={saving}>Add</button>
          </div>
          <div>
            {labels.length === 0 ? (
              <div style={{ color: 'var(--muted)' }}>No labels yet</div>
            ) : (
              labels.map(l => {
                const isChecked = selected.has(l.id);
                return (
                  <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', justifyContent: 'space-between' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                      <input type="checkbox" checked={isChecked} onChange={async () => { if (isChecked) { await detach(l.id); } else { await attach(l.id); } }} />
                      <span>{l.name}</span>
                    </label>
                    <button className="tiny" onClick={() => deleteLabel(l.id)} title="Delete label" aria-label="Delete label" style={{ color: 'var(--danger, #d33)' }}>✕</button>
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn" onClick={() => { onUpdated && onUpdated(labels.filter(l => selected.has(l.id))); onClose(); }}>Close</button>
        </div>
      </div>
    </div>
  );
  if (typeof document !== 'undefined') return createPortal(dialog, document.body);
  return dialog;
}
