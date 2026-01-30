import React, { useState, useRef, useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import { useAuth } from '../authContext';

export default function TakeNoteBar({ onCreated }: { onCreated?: () => void }): JSX.Element {
  const { token } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<'text' | 'checklist'>('text');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [maximized, setMaximized] = useState(false);
    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
        }),
        Underline,
        Link.configure({ openOnClick: true, autolink: true }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
      ],
      content: '',
      editorProps: {
        attributes: {
          class: 'rt-editor',
        },
      },
    });

    const [, setToolbarTick] = useState(0);
    useEffect(() => {
      if (!editor) return;
      const handler = () => setToolbarTick(t => t + 1);
      editor.on('selectionUpdate', handler);
      editor.on('transaction', handler);
      return () => {
        editor.off('selectionUpdate', handler);
        editor.off('transaction', handler);
      };
    }, [editor]);

    function applyLink() {
      if (!editor) return;
      const url = window.prompt('Enter URL:');
      if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }

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
        setMaximized(false);
      }
    }

    function onKey(e: KeyboardEvent) {
      if (!expanded) return;
      if (e.key === 'Escape') { setExpanded(false); setMaximized(false); }
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
      const html = mode === 'text' ? (editor?.getHTML() || '') : '';
      const payload: any = { title, body: html, type: mode === 'checklist' ? 'CHECKLIST' : 'TEXT' };
      if (mode === 'checklist') payload.items = items.map((it, i) => ({ content: it.content, ord: i }));
      const res = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(await res.text());
      setTitle(''); setBody(''); setItems([]); setExpanded(false);
      editor?.commands.clearContent();
      onCreated && onCreated();
    } catch (err) {
      console.error('Failed to create note', err);
      window.alert('Failed to create note');
    } finally { setLoading(false); }
  }

  if (!expanded) {
    return (
      <div ref={rootRef}>
        <div
          className="take-note-bar"
          role="button"
          tabIndex={0}
          onMouseDown={() => { setMode('text'); setExpanded(true); }}
          onClick={() => { setMode('text'); setExpanded(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setMode('text');
              setExpanded(true);
            }
          }}
        >
          <div style={{ flex: 1, padding: '10px 12px' }}>Take a note...</div>
          <div
            className="checkbox-visual"
            onMouseDown={(e) => { e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); setMode('checklist'); setItems([{ content: '' }]); setExpanded(true); focusItem(0); }}
            aria-label="Start checklist"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
              <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`take-note-expanded${maximized ? ' maximized' : ''}`} ref={rootRef} style={{ padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} style={{ fontSize: 18, fontWeight: 600, border: 'none', background: 'transparent', color: 'inherit' }} />
      </div>

      {mode === 'text' ? (
        <div>
          <div className="rt-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8, marginBottom: 8, overflowX: 'auto' }}>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleBold().run()} aria-pressed={editor?.isActive('bold')}>B</button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleItalic().run()} aria-pressed={editor?.isActive('italic')}>I</button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleUnderline().run()} aria-pressed={editor?.isActive('underline')}>U</button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} aria-pressed={editor?.isActive('heading', { level: 1 })}>H1</button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} aria-pressed={editor?.isActive('heading', { level: 2 })}>H2</button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} aria-pressed={editor?.isActive('heading', { level: 3 })}>H3</button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleBulletList().run()} aria-pressed={editor?.isActive('bulletList')} aria-label="Bulleted list" title="Bulleted list">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <circle cx="5" cy="6" r="1.5" />
                <rect x="9" y="5" width="10" height="2" rx="1" />
                <circle cx="5" cy="12" r="1.5" />
                <rect x="9" y="11" width="10" height="2" rx="1" />
                <circle cx="5" cy="18" r="1.5" />
                <rect x="9" y="17" width="10" height="2" rx="1" />
              </svg>
            </button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleOrderedList().run()} aria-pressed={editor?.isActive('orderedList')} aria-label="Numbered list" title="Numbered list">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <text x="3.5" y="7" font-size="6" font-family="system-ui, Arial" fill="currentColor">1.</text>
                <rect x="9" y="5" width="10" height="2" rx="1" />
                <text x="3.5" y="13" font-size="6" font-family="system-ui, Arial" fill="currentColor">2.</text>
                <rect x="9" y="11" width="10" height="2" rx="1" />
                <text x="3.5" y="19" font-size="6" font-family="system-ui, Arial" fill="currentColor">3.</text>
                <rect x="9" y="17" width="10" height="2" rx="1" />
              </svg>
            </button>
            <button className="tiny" onClick={() => editor?.chain().focus().setTextAlign('left').run()} aria-pressed={editor?.isActive({ textAlign: 'left' })} aria-label="Align left" title="Align left">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <rect x="4" y="5" width="14" height="2" rx="1" />
                <rect x="4" y="9" width="10" height="2" rx="1" />
                <rect x="4" y="13" width="14" height="2" rx="1" />
                <rect x="4" y="17" width="8" height="2" rx="1" />
              </svg>
            </button>
            <button className="tiny" onClick={() => editor?.chain().focus().setTextAlign('center').run()} aria-pressed={editor?.isActive({ textAlign: 'center' })} aria-label="Align center" title="Align center">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <rect x="5" y="5" width="14" height="2" rx="1" />
                <rect x="7" y="9" width="10" height="2" rx="1" />
                <rect x="5" y="13" width="14" height="2" rx="1" />
                <rect x="8" y="17" width="8" height="2" rx="1" />
              </svg>
            </button>
            <button className="tiny" onClick={() => editor?.chain().focus().setTextAlign('right').run()} aria-pressed={editor?.isActive({ textAlign: 'right' })} aria-label="Align right" title="Align right">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <rect x="6" y="5" width="14" height="2" rx="1" />
                <rect x="10" y="9" width="10" height="2" rx="1" />
                <rect x="6" y="13" width="14" height="2" rx="1" />
                <rect x="12" y="17" width="8" height="2" rx="1" />
              </svg>
            </button>
            <button className="tiny" onClick={() => editor?.chain().focus().setTextAlign('justify').run()} aria-pressed={editor?.isActive({ textAlign: 'justify' })} aria-label="Justify" title="Justify">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <rect x="5" y="5" width="14" height="2" rx="1" />
                <rect x="5" y="9" width="14" height="2" rx="1" />
                <rect x="5" y="13" width="14" height="2" rx="1" />
                <rect x="5" y="17" width="14" height="2" rx="1" />
              </svg>
            </button>
            <button className="tiny" onClick={applyLink} aria-label="Insert link" title="Insert link">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <path d="M9.17 14.83a3 3 0 0 1 0-4.24l2.83-2.83a3 3 0 1 1 4.24 4.24l-.88.88" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M14.83 9.17a3 3 0 0 1 0 4.24l-2.83 2.83a3 3 0 1 1-4.24-4.24l.88-.88" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button className="tiny" onClick={() => setMaximized(m => !m)} aria-label="Toggle maximize" title="Toggle maximize">⤢</button>
          </div>
          <div
            onKeyDown={(e) => {
              if (!editor) return;
              const ctrl = e.ctrlKey || e.metaKey;
              if (!ctrl) return;
              // scope shortcuts when editor is focused
              if (!editor.isFocused) return;
              switch (e.key.toLowerCase()) {
                case 'b': e.preventDefault(); editor.chain().focus().toggleBold().run(); break;
                case 'i': e.preventDefault(); editor.chain().focus().toggleItalic().run(); break;
                case 'u': e.preventDefault(); editor.chain().focus().toggleUnderline().run(); break;
                case 'k': e.preventDefault(); applyLink(); break;
                case 'l': e.preventDefault(); editor.chain().focus().setTextAlign('left').run(); break;
                case 'r': e.preventDefault(); editor.chain().focus().setTextAlign('right').run(); break;
                case 'e': e.preventDefault(); editor.chain().focus().setTextAlign('center').run(); break;
                case 'j': e.preventDefault(); editor.chain().focus().setTextAlign('justify').run(); break;
              }
            }}
          >
            <EditorContent editor={editor} />
          </div>
        </div>
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
        <button className="btn" onClick={save} disabled={loading || (mode==='text' ? ((editor?.getText() || '').trim().length === 0 && !title.trim()) : items.length===0)}>{loading ? 'Saving...' : 'Save'}</button>
      </div>
    </div>
  );
}

