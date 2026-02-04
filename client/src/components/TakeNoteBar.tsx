import React, { useState, useRef, useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { useAuth } from '../authContext';
import ChecklistItemRT from './ChecklistItemRT';
import ColorPalette from './ColorPalette';
import ReminderPicker from './ReminderPicker';
import CollaboratorModal from './CollaboratorModal';
import ImageDialog from './ImageDialog';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPalette } from '@fortawesome/free-solid-svg-icons';

export default function TakeNoteBar({ onCreated }: { onCreated?: () => void }): JSX.Element {
  const { token, user } = useAuth();
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

    // Link insertion is only available in the full editor.

  const [items, setItems] = useState<{ content: string; checked?: boolean }[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const draggingIdx = useRef<number | null>(null);
  const activeChecklistEditor = useRef<any | null>(null);
  const itemEditorRefs = useRef<Array<any | null>>([]);
  const [, setChecklistToolbarTick] = useState(0);
  const [bg, setBg] = useState<string>('');
  const [textColor, setTextColor] = useState<string | undefined>(undefined);
  const [showPalette, setShowPalette] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [showCollaborator, setShowCollaborator] = useState(false);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [selectedCollaborators, setSelectedCollaborators] = useState<Array<{id:number;email:string}>>([]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!expanded) return;
      const el = rootRef.current;
      if (!el) return;
      // Ignore clicks inside any overlay/popover elements so the creation dialog stays open
      const t = e.target as Node;
      const inPalette = document.querySelector('.palette-popover')?.contains(t);
      const inReminder = document.querySelector('.reminder-popover')?.contains(t);
      const inCollab = document.querySelector('.collab-modal')?.contains(t);
      const inImageDlg = document.querySelector('.image-dialog')?.contains(t);
      if (inPalette || inReminder || inCollab || inImageDlg) return;
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

  /** choose '#000' or '#fff' based on best WCAG contrast vs provided hex color */
  function contrastColorForBackground(hex?: string | null): string | undefined {
    if (!hex) return undefined;
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h;
    if (full.length !== 6) return undefined;
    const r = parseInt(full.slice(0, 2), 16) / 255;
    const g = parseInt(full.slice(2, 4), 16) / 255;
    const b = parseInt(full.slice(4, 6), 16) / 255;
    const srgbToLin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const R = srgbToLin(r), G = srgbToLin(g), B = srgbToLin(b);
    const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const contrastRatio = (L1: number, L2: number) => (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const contrastWithWhite = contrastRatio(1, L);
    const contrastWithBlack = contrastRatio(0, L);
    return contrastWithWhite >= contrastWithBlack ? '#ffffff' : '#000000';
  }

  // Update textColor whenever bg changes
  useEffect(() => {
    if (!bg) {
      setTextColor('var(--muted)');
    } else {
      setTextColor(contrastColorForBackground(bg));
    }
  }, [bg]);

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
    // Slight delay to allow newly inserted item to mount and register its editor ref
    setTimeout(() => {
      const ed = itemEditorRefs.current[idx];
      try { ed && ed.chain().focus().run(); } catch {}
    }, 30);
  }

  async function save() {
    setLoading(true);
    try {
      // For text notes, capture content JSON to seed Yjs after creation.
      const bodyJson = mode === 'text' ? (editor?.getJSON() || {}) : {};
      // Do not store body for text notes; rely on Yjs collaboration persistence.
      const payload: any = { title, body: null, type: mode === 'checklist' ? 'CHECKLIST' : 'TEXT', color: bg || null };
      if (mode === 'checklist') payload.items = items.map((it, i) => ({ content: it.content, ord: i }));
      const res = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const noteId = data?.note?.id;
      // For text notes, push initial content into the Yjs doc so it persists canonically.
      if (noteId && mode === 'text') {
        try {
          const ydoc = new Y.Doc();
          const room = `note-${noteId}`;
          const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
          const serverUrl = `${proto}://${window.location.host}/collab`;
          const provider = new WebsocketProvider(serverUrl, room, ydoc);
          // Create a headless temporary editor bound to the Yjs doc and set content
          const tempEditor = new Editor({
            extensions: [
              StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
              TextAlign.configure({ types: ['heading', 'paragraph'] }),
              Collaboration.configure({ document: ydoc })
            ],
            content: '',
          });
          // Wait until synced before seeding to avoid overwriting any state
          await new Promise<void>((resolve) => {
            provider.on('sync', (isSynced: boolean) => { if (isSynced) resolve(); });
          });
          try { tempEditor?.commands.setContent(bodyJson); } catch {}
          // Give a brief moment for updates to flush
          await new Promise(r => setTimeout(r, 100));
          try { tempEditor?.destroy(); } catch {}
          try { provider.destroy(); } catch {}
          try { ydoc.destroy(); } catch {}
          // Also store derived snapshot for preview/search
          try {
            await fetch(`/api/notes/${noteId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ body: JSON.stringify(bodyJson), type: 'TEXT' }) });
          } catch {}
        } catch (e) {
          console.warn('Failed to seed Yjs content for new note', e);
        }
      }
      // post-create additions: collaborators and image
      if (noteId && selectedCollaborators.length) {
        for (const u of selectedCollaborators) {
          try { await fetch(`/api/notes/${noteId}/collaborators`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ email: u.email }) }); } catch {}
        }
      }
      if (noteId && imageUrl) {
        try { await fetch(`/api/notes/${noteId}/images`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ url: imageUrl }) }); } catch {}
      }
      setTitle(''); setBody(''); setItems([]); setExpanded(false); setBg(''); setImageUrl(null); setSelectedCollaborators([]);
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

  const dialogStyle: React.CSSProperties = {} as any;
  if (bg) {
    dialogStyle.background = bg;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    dialogStyle['--checkbox-bg'] = bg;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    dialogStyle['--checkbox-border'] = '#ffffff';
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    dialogStyle['--checkbox-checked-bg'] = bg;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    dialogStyle['--checkbox-checked-mark'] = '#ffffff';
  }

  return (
    <div className={`take-note-expanded${maximized ? ' maximized' : ''}`} ref={rootRef} style={{ padding: 12, ...dialogStyle }}>
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
                <text x="3.5" y="7" fontSize="6" fontFamily="system-ui, Arial" fill="currentColor">1.</text>
                <rect x="9" y="5" width="10" height="2" rx="1" />
                <text x="3.5" y="13" fontSize="6" fontFamily="system-ui, Arial" fill="currentColor">2.</text>
                <rect x="9" y="11" width="10" height="2" rx="1" />
                <text x="3.5" y="19" fontSize="6" fontFamily="system-ui, Arial" fill="currentColor">3.</text>
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
            {/* Link insertion is available in the full editor only */}
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
                // 'k' (insert link) is available in the full editor only
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
          <div className="rt-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <button className="tiny" onClick={() => activeChecklistEditor.current?.chain().focus().toggleBold().run()} aria-pressed={activeChecklistEditor.current?.isActive?.('bold')}>B</button>
            <button className="tiny" onClick={() => activeChecklistEditor.current?.chain().focus().toggleItalic().run()} aria-pressed={activeChecklistEditor.current?.isActive?.('italic')}>I</button>
            <button className="tiny" onClick={() => activeChecklistEditor.current?.chain().focus().toggleUnderline().run()} aria-pressed={activeChecklistEditor.current?.isActive?.('underline')}>U</button>
          </div>
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
              <div style={{ flex: 1 }}>
                <ChecklistItemRT
                  value={it.content}
                  onChange={(html) => updateItem(idx, html)}
                  onEnter={() => {
                    setItems(s => { const copy = [...s]; copy.splice(idx + 1, 0, { content: '' }); return copy; });
                    focusItem(idx + 1);
                  }}
                  onArrowUp={() => focusItem(Math.max(0, idx - 1))}
                  onArrowDown={() => focusItem(Math.min(items.length - 1, idx + 1))}
                  onBackspaceEmpty={() => {
                    if (idx > 0) {
                      setItems(s => { const copy = [...s]; copy.splice(idx, 1); return copy; });
                      focusItem(idx - 1);
                    }
                  }}
                  onFocus={(ed: any) => {
                    activeChecklistEditor.current = ed;
                    itemEditorRefs.current[idx] = ed;
                    setChecklistToolbarTick(t => t + 1);
                  }}
                  placeholder={''}
                  autoFocus={idx === 0}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="note-footer" aria-hidden={false} style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <div className="note-actions" style={{ marginRight: 'auto', display: 'inline-flex', gap: 8, color: (bg ? textColor : undefined) }}>
          <button className="tiny palette" onClick={() => setShowPalette(true)} aria-label="Change color" title="Change color">
            <FontAwesomeIcon icon={faPalette} className="palette-svg" />
          </button>
          <button className="tiny" onClick={() => setShowReminderPicker(true)} aria-label="Reminder" title="Reminder">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2z"/>
              <path d="M18 8V7a6 6 0 1 0-12 0v1c0 3.5-2 5-2 5h16s-2-1.5-2-5z"/>
            </svg>
          </button>
          <button className="tiny" onClick={() => setShowCollaborator(true)} aria-label="Collaborators" title="Collaborators">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/>
              <path d="M6 14c-1.66 0-3 1.34-3 3v1h9.5c-.2-.63-.5-1.23-.9-1.76C11.7 15.6 9.9 14 6 14z"/>
              <path d="M20 16v2h-2v2h-2v-2h-2v-2h2v-2h2v2z" />
            </svg>
          </button>
          <button className="tiny" onClick={() => setShowImageDialog(true)} aria-label="Add image" title="Add image">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M21 19V5c0-1.1-.9-2-2-2H5C3.9 3 3 3.9 3 5v14h18zM8.5 13.5l2.5 3L14.5 12l4.5 7H5l3.5-5.5z"/>
            </svg>
          </button>
        </div>
        <button className="btn" onClick={() => { setExpanded(false); setTitle(''); setBody(''); setItems([]); setBg(''); setImageUrl(null); setSelectedCollaborators([]); }}>Cancel</button>
        <button className="btn" onClick={save} disabled={loading || (mode==='text' ? ((editor?.getText() || '').trim().length === 0 && !title.trim()) : items.length===0)}>{loading ? 'Saving...' : 'Save'}</button>
      </div>

      {showPalette && <ColorPalette anchorRef={rootRef} onPick={(c) => { setBg(c); /* keep palette open */ }} onClose={() => setShowPalette(false)} />}
      {showReminderPicker && <ReminderPicker onClose={() => setShowReminderPicker(false)} onSet={(iso) => { setShowReminderPicker(false); /* TODO: persist reminder when supported */ }} />}
      {showCollaborator && (
        <CollaboratorModal
          onClose={() => setShowCollaborator(false)}
          onSelect={(u) => { setSelectedCollaborators(s => (s.find(x=>x.id===u.id)?s:[...s,u])); setShowCollaborator(false); }}
          current={(() => {
            const currentUserId = (user && (user as any).id) ? Number((user as any).id) : undefined;
            return selectedCollaborators
              .filter(u => (typeof u.id === 'number' ? u.id !== currentUserId : true))
              .map(u => ({ userId: u.id, email: u.email }));
          })()}
          ownerId={(user as any)?.id}
          onRemove={() => { /* no-op: creation dialog selections have no collabId yet */ }}
        />
      )}
      {showImageDialog && <ImageDialog onClose={() => setShowImageDialog(false)} onAdd={(url) => setImageUrl(url || null)} />}
    </div>
  );
}

