import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../authContext';

export default function TakeNoteBar({ onCreated }: { onCreated?: () => void }) {
  const { token } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<'text' | 'checklist'>('text');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [items, setItems] = useState<{ content: string; checked?: boolean }[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLInputElement | null>>([]);
  const draggingIdx = useRef<number | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!expanded) return;
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setExpanded(false);
      }
    }

    function onKey(e: KeyboardEvent) {
      if (!expanded) return;
      if (e.key === 'Escape') setExpanded(false);
    }

    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  function addItem() {
    setItems(s => {
      const next = [...s, { content: '' }];
      return next;
    });
  }

  function updateItem(idx: number, content: string) {
    setItems(s => s.map((it, i) => i === idx ? { ...it, content } : it));
  }

  function toggleLocalItemChecked(idx: number) {
    setItems(s => s.map((it, i) => i === idx ? { ...it, checked: !it.checked } : it));
  }

  function focusItem(idx: number) {
    setTimeout(() => {
      const el = itemRefs.current[idx];
      el && el.focus();
    }, 0);
  }

  async function save() {
    setLoading(true);
    try {
      const payload: any = { title, body, type: mode === 'checklist' ? 'CHECKLIST' : 'TEXT' };
      if (mode === 'checklist') payload.items = items.map((it, i) => ({ content: it.content, ord: i }));
      const res = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(await res.text());
      setTitle(''); setBody(''); setItems([]); setExpanded(false);
      onCreated && onCreated();
    } catch (err) {
      console.error('Failed to create note', err);
      window.alert('Failed to create note');
    } finally { setLoading(false); }
  }

  if (!expanded) {
    return (
      <div style={{ marginBottom: 12 }} ref={rootRef}>
        <div className="take-note-bar" onClick={() => { setMode('text'); setExpanded(true); }} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, padding: '10px 12px' }}>Take a note...</div>
          <button className="tiny" onClick={(e) => { e.stopPropagation(); setMode('checklist'); setItems([{ content: '' }]); setExpanded(true); focusItem(0); }}>☑️</button>
          <button className="tiny" onClick={(e) => { e.stopPropagation(); setMode('text'); setExpanded(true); }}>🖊️</button>
        </div>
      </div>
    );
  }

  return (
    <div className="take-note-expanded" ref={rootRef} style={{ marginBottom: 12, padding: 12, borderRadius: 8, background: 'var(--card)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} style={{ fontSize: 18, fontWeight: 600, border: 'none', background: 'transparent', color: 'inherit' }} />
        <div>
          <button className="tiny" onClick={() => setMode('text')} disabled={mode==='text'}>Note</button>
          <button className="tiny" onClick={() => setMode('checklist')} disabled={mode==='checklist'}>Checklist</button>
        </div>
      </div>

      {mode === 'text' ? (
        <textarea placeholder="Take a note..." value={body} onChange={e => setBody(e.target.value)} style={{ width: '100%', minHeight: 80, marginTop: 8 }} />
      ) : (
        <div style={{ marginTop: 8 }}>
          {items.map((it, idx) => (
            <div
              key={idx}
              className="checklist-item"
              draggable
              onDragStart={(e) => { draggingIdx.current = idx; e.dataTransfer?.setData('text/plain', String(idx)); }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const src = draggingIdx.current ?? parseInt(e.dataTransfer.getData('text/plain') || '-1', 10);
                const dst = idx;
                if (src >= 0 && src !== dst) {
                  setItems(s => {
                    const copy = [...s];
                    const [moved] = copy.splice(src, 1);
                    copy.splice(dst, 0, moved);
                    return copy;
                  });
                }
                draggingIdx.current = null;
              }}
              style={{ display: 'flex', gap: 8, alignItems: 'center' }}
            >
              <div className="drag-handle" style={{ width: 20, cursor: 'grab', userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none', msUserSelect: 'none' }} aria-hidden>≡</div>
              <div className="checkbox-visual" onClick={() => toggleLocalItemChecked(idx)} aria-hidden>
                {it.checked && (
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <input
                ref={el => itemRefs.current[idx] = el}
                value={it.content}
                onChange={e => updateItem(idx, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setItems(s => {
                      const copy = [...s];
                      copy.splice(idx + 1, 0, { content: '' });
                      return copy;
                    });
                    focusItem(idx + 1);
                  }
                }}
                placeholder="List item"
                className="take-note-input"
                style={{ flex: 1, background: 'transparent', border: 'none', color: 'inherit', outline: 'none' }}
              />
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <button className="btn" onClick={() => { setExpanded(false); setTitle(''); setBody(''); setItems([]); }}>Cancel</button>
        <button className="btn" onClick={save} disabled={loading || (mode==='text' ? !body.trim() && !title.trim() : items.length===0)}>{loading ? 'Saving...' : 'Save'}</button>
      </div>
    </div>
  );
}

