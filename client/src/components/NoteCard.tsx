import React, { useRef, useState } from "react";
import DOMPurify from 'dompurify';
import { useAuth } from '../authContext';
import ChecklistEditor from "./ChecklistEditor";
import RichTextEditor from "./RichTextEditor";
import CollaboratorModal from "./CollaboratorModal";
import MoreMenu from "./MoreMenu";
import LabelsDialog from "./LabelsDialog";
import ColorPalette from "./ColorPalette";
import ImageDialog from "./ImageDialog";
import ReminderPicker from "./ReminderPicker";
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Collaboration from '@tiptap/extension-collaboration';

type NoteItem = {
  id: number;
  content: string;
  checked?: boolean;
  ord?: number;
  indent?: number;
};

type Note = {
  id: number;
  title?: string;
  body?: string;
  pinned?: boolean;
  items?: NoteItem[];
  type?: string;
  color?: string;
  noteLabels?: Array<{ id: number; label?: { id: number; name: string } }>;
};

/** choose '#000' or '#fff' based on best WCAG contrast vs provided hex color */
function contrastColorForBackground(hex?: string | null): string | undefined {
  if (!hex) return undefined;
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map(ch => ch + ch).join("") : h;
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

  return contrastWithWhite >= contrastWithBlack ? "#ffffff" : "#000000";
}

export default function NoteCard({ note, onChange }: { note: Note, onChange?: () => void }) {
  const noteRef = useRef<HTMLElement | null>(null);

  const [bg, setBg] = useState<string>(note.color || ""); // empty = theme card color
  // default text color for "Default" palette will use CSS var --muted so it matches original layout
  const [textColor, setTextColor] = useState<string | undefined>(note.color ? contrastColorForBackground(note.color) : undefined);
  const [archived, setArchived] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [noteItems, setNoteItems] = useState<any[]>(note.items || []);
  const [title, setTitle] = useState<string>(note.title || '');
  const [showCollaborator, setShowCollaborator] = useState(false);
  const [collaborators, setCollaborators] = useState<{ id: number; email: string }[]>([]);
  const [labels, setLabels] = useState<Array<{ id: number; name: string }>>(() => (note.noteLabels || []).map((nl:any) => nl.label).filter((l:any) => l && typeof l.id === 'number' && typeof l.name === 'string'));
  const [showMore, setShowMore] = useState(false);
  const [moreAnchorPoint, setMoreAnchorPoint] = useState<{ x:number; y:number } | null>(null);

  const [showPalette, setShowPalette] = useState(false);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showTextEditor, setShowTextEditor] = useState(false);
  const [showCompleted, setShowCompleted] = useState<boolean>(true);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const { token } = useAuth();
  // Subscribe to Yjs checklist for live card updates
  const ydoc = React.useMemo(() => new Y.Doc(), [note.id]);
  const providerRef = React.useRef<WebsocketProvider | null>(null);
  const yarrayRef = React.useRef<Y.Array<Y.Map<any>> | null>(null);
  const [rtHtmlFromY, setRtHtmlFromY] = React.useState<string | null>(null);
  React.useEffect(() => {
    const room = `note-${note.id}`;
    const serverUrl = `ws://${window.location.host}/collab`;
    const provider = new WebsocketProvider(serverUrl, room, ydoc);
    providerRef.current = provider;
    const yarr = ydoc.getArray<Y.Map<any>>('checklist');
    yarrayRef.current = yarr;
    const updateFromY = () => {
      try {
        if (yarr.length === 0) return; // avoid overwriting DB items until doc has content
        const arr = yarr.toArray().map((m) => ({
          id: (typeof m.get('id') === 'number' ? Number(m.get('id')) : undefined),
          content: String(m.get('content') || ''),
          checked: !!m.get('checked'),
          indent: Number(m.get('indent') || 0),
        }));
        setNoteItems(arr);
      } catch {}
    };
    yarr.observeDeep(updateFromY);
    provider.on('sync', (isSynced: boolean) => { if (isSynced) updateFromY(); });
    return () => { try { yarr.unobserveDeep(updateFromY as any); } catch {}; try { provider.destroy(); } catch {}; };
  }, [note.id, ydoc]);

  // Subscribe to Yjs text doc for real-time HTML preview on cards (TEXT notes)
  React.useEffect(() => {
    if (note.type !== 'TEXT') { setRtHtmlFromY(null); return; }
    let ed: Editor | null = null;
    try {
      ed = new Editor({
        extensions: [
          StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
          Link.configure({ openOnClick: false, autolink: true }),
          TextAlign.configure({ types: ['heading', 'paragraph'] }),
          Collaboration.configure({ document: ydoc })
        ],
        content: ''
      });
      const compute = () => {
        try {
          const html = ed?.getHTML() || '';
          const safe = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
          setRtHtmlFromY(safe);
        } catch {}
      };
      ed.on('update', compute);
      // On initial provider sync, compute once
      const provider = providerRef.current;
      const onSync = (isSynced: boolean) => { if (isSynced) compute(); };
      provider?.on('sync', onSync);
      return () => { try { ed?.destroy(); } catch {}; try { provider?.off('sync', onSync as any); } catch {}; };
    } catch {
      // ignore editor init failures
    }
  }, [note.id, note.type, ydoc]);
  // Render a minimal formatted HTML preview from TipTap JSON stored in note.body
  function bodyHtmlPreview(): string {
    const raw = note.body || '';
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const renderMarks = (text: string, marks?: any[]): string => {
      if (!marks || !marks.length) return esc(text);
      return marks.reduce((acc, m) => {
        switch (m.type) {
          case 'bold': return `<strong>${acc}</strong>`;
          case 'italic': return `<em>${acc}</em>`;
          case 'underline': return `<u>${acc}</u>`;
          case 'link': {
            const href = typeof m.attrs?.href === 'string' ? m.attrs.href : '#';
            return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${acc}</a>`;
          }
          default: return acc;
        }
      }, esc(text));
    };
    const renderNode = (node: any, inListItem = false): string => {
      if (!node) return '';
      if (Array.isArray(node)) return node.map(n => renderNode(n, inListItem)).join('');
      const t = node.type;
      if (t === 'text') return renderMarks(node.text || '', node.marks);
      if (t === 'hardBreak') return '<br/>';
      if ((t === 'paragraph' || t === 'heading') && (!node.content || node.content.length === 0)) return inListItem ? '' : '<p></p>';
      const inner = node.content ? renderNode(node.content, t === 'listItem') : '';
      switch (t) {
        case 'paragraph': return `<p>${inner}</p>`;
        case 'heading': {
          const lvl = Math.min(6, Math.max(1, Number(node.attrs?.level || 1)));
          return `<h${lvl}>${inner}</h${lvl}>`;
        }
        case 'bulletList': return `<ul>${inner}</ul>`;
        case 'orderedList': return `<ol>${inner}</ol>`;
        case 'listItem': {
          // TipTap listItem usually wraps a paragraph; flatten to inline
          return `<li>${inner.replace(/^<p>|<\/p>$/g, '')}</li>`;
        }
        case 'blockquote': return `<blockquote>${inner}</blockquote>`;
        case 'codeBlock': return `<pre><code>${esc((node.textContent || '') as string)}</code></pre>`;
        default: return inner;
      }
    };
    try {
      const json = JSON.parse(raw);
      const html = renderNode(json);
      return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    } catch {
      const fallback = esc(raw).replace(/\n/g, '<br/>');
      return DOMPurify.sanitize(`<p>${fallback}</p>`);
    }
  }

  // keep local bg/textColor in sync when the parent reloads the note (e.g., after page refresh)
  React.useEffect(() => {
    setBg(note.color || '');
    setTextColor(note.color ? contrastColorForBackground(note.color) : undefined);
  }, [note.color]);
  React.useEffect(() => {
    setLabels((note.noteLabels || []).map((nl:any) => nl.label).filter((l:any) => l && typeof l.id === 'number' && typeof l.name === 'string'));
  }, [note.noteLabels]);
  React.useEffect(() => { setTitle(note.title || ''); }, [note.title]);

  // track pointer down/up to distinguish clicks from small drags (prevents accidental reflows)
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = React.useRef(false);

  function onPickColor(color: string) {
    // first palette entry is the "Default" swatch (empty string).
    // Selecting it restores the app's default background and sets text to the original muted color.
    if (!color) {
      setBg("");
      // use CSS variable so the note inherits the theme muted color defined in styles
      setTextColor("var(--muted)");
    } else {
      setBg(color);
      setTextColor(contrastColorForBackground(color));
    }
    setShowPalette(false);
    // persist color to server (store null when selecting default)
    (async () => {
      try {
        const res = await fetch(`/api/notes/${note.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ color: color || null }) });
        if (!res.ok) throw new Error(await res.text());
        // update local state from saved color
        setBg(color || '');
      } catch (err) {
        console.error('Failed to save note color', err);
        // fallback to local only
        setBg(color || '');
      }
    })();
  }

  function onAddImageUrl(url?: string | null) {
    setShowImageDialog(false);
    if (url) setImageUrl(url);
  }

  async function toggleItemChecked(itemId: number, checked: boolean) {
    const yarr = yarrayRef.current;
    if (yarr) {
      const idx = yarr.toArray().findIndex((m) => (typeof m.get('id') === 'number' ? Number(m.get('id')) === itemId : false));
      if (idx >= 0) {
        const m = yarr.get(idx) as Y.Map<any>;
        m.set('checked', checked);
        const indent = Number(m.get('indent') || 0);
        if (indent === 0) {
          for (let i = idx + 1; i < yarr.length; i++) {
            const child = yarr.get(i) as Y.Map<any>;
            const childIndent = Number(child.get('indent') || 0);
            if (childIndent > 0) child.set('checked', checked); else break;
          }
        }
        return;
      }
    }
    // Fallback to REST if Yjs not available
    try {
      const res = await fetch(`/api/notes/${note.id}/items/${itemId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ checked }) });
      if (!res.ok) throw new Error(await res.text());
      setNoteItems(s => s.map(it => it.id === itemId ? { ...it, checked } : it));
    } catch (err) {
      console.error(err);
      window.alert('Failed to update checklist item — please try again.');
    }
  }

  function onSetReminder(iso?: string | null) {
    setShowReminderPicker(false);
    if (iso) window.alert(`Reminder set (UI-only): ${iso}`);
  }

  function toggleArchive() {
    const next = !archived;
    setArchived(next);
    // call API to update
    fetch(`/api/notes/${note.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' }, body: JSON.stringify({ archived: next }) })
      .then(() => onChange && onChange())
      .catch((e) => { console.error(e); window.alert('Failed to archive note'); });
  }
  async function onDeleteNote() {
    try {
      const res = await fetch(`/api/notes/${note.id}`, { method: 'DELETE', headers: { Authorization: token ? `Bearer ${token}` : '' } });
      if (!res.ok) throw new Error(await res.text());
      onChange && onChange();
    } catch (err) {
      console.error(err);
      window.alert('Failed to delete note');
    }
  }
  const [showLabels, setShowLabels] = useState(false);
  function onAddLabel() { setShowLabels(true); }
  async function onUncheckAll() {
    try {
      const updated = (noteItems || []).map((it:any, idx:number) => ({ id: it.id, content: it.content, checked: false, ord: typeof it.ord === 'number' ? it.ord : idx, indent: typeof it.indent === 'number' ? it.indent : 0 }));
      setNoteItems(updated);
      const res = await fetch(`/api/notes/${note.id}/items`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' }, body: JSON.stringify({ items: updated }) });
      if (!res.ok) throw new Error(await res.text());
      // no full reload needed; local state already reflects changes
    } catch (err) {
      console.error(err);
      window.alert('Failed to uncheck all items');
    }
  }
  async function onCheckAll() {
    try {
      const updated = (noteItems || []).map((it:any, idx:number) => ({ id: it.id, content: it.content, checked: true, ord: typeof it.ord === 'number' ? it.ord : idx, indent: typeof it.indent === 'number' ? it.indent : 0 }));
      setNoteItems(updated);
      const res = await fetch(`/api/notes/${note.id}/items`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' }, body: JSON.stringify({ items: updated }) });
      if (!res.ok) throw new Error(await res.text());
      // no full reload needed; local state already reflects changes
    } catch (err) {
      console.error(err);
      window.alert('Failed to check all items');
    }
  }

  function onCollaboratorSelect(user: { id: number; email: string }) {
    setCollaborators((s) => {
      if (s.find(x => x.id === user.id)) return s;
      return [...s, user];
    });
    setShowCollaborator(false);
  }

  // compute chip background so it's visible against selected background/text color
  const chipBg = (textColor === "#ffffff" || textColor === "var(--muted)")
    ? "rgba(0,0,0,0.12)"
    : "rgba(255,255,255,0.06)";

    const styleVars: React.CSSProperties = {
      background: bg || undefined,
      color: textColor || undefined,
      opacity: archived ? 0.6 : 1,
      position: 'relative',
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      ['--chip-bg' as any]: chipBg,
    } as React.CSSProperties;
    // Only override checkbox vars when the note has an explicit background color.
    if (bg) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      styleVars['--checkbox-bg'] = bg;
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      styleVars['--checkbox-border'] = contrastColorForBackground(bg);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      styleVars['--checkbox-checked-bg'] = bg;
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      styleVars['--checkbox-checked-mark'] = contrastColorForBackground(bg);
    }

    return (
    <article
      ref={(el) => { noteRef.current = el as HTMLElement | null; }}
      className={`note-card${labels.length > 0 ? ' has-labels' : ''}`}
      style={styleVars}
    >
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} />

      {title && (
        <div
          className="note-title"
          style={{ cursor: 'pointer' }}
          onClick={() => { if (note.type === 'CHECKLIST' || (note.items && note.items.length)) setShowEditor(true); else setShowTextEditor(true); }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (note.type === 'CHECKLIST' || (note.items && note.items.length)) setShowEditor(true); else setShowTextEditor(true); } }}
        >
          {title}
        </div>
      )}

      {collaborators.length > 0 && (
        <div className="collab-chips">
          {collaborators.map(c => <span key={c.id} className="chip">{c.email.split("@")[0]}</span>)}
        </div>
      )}

      <div className="note-body" onClick={() => { if (note.type === 'CHECKLIST' || (note.items && note.items.length)) setShowEditor(true); else setShowTextEditor(true); }}>
        {noteItems && noteItems.length > 0 ? (
          <div>
            {/** Show incomplete first, then optionally completed items. Preserve indent in preview. */}
            {(noteItems.filter((it:any) => !it.checked)).map(it => (
              <div key={it.id} className="note-item" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginLeft: ((it.indent || 0) * 16) }}>
                <button
                  className={`note-checkbox ${it.checked ? 'checked' : ''}`}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleItemChecked(it.id, !it.checked); }}
                  aria-pressed={!!it.checked}
                  style={{ background: 'var(--checkbox-bg)', border: '2px solid var(--checkbox-border)' }}
                >
                  {it.checked && (
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
                      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <div style={{ fontSize: 'var(--checklist-text-size)', overflow: 'hidden', whiteSpace: 'normal', wordBreak: 'break-word', display: 'flex', alignItems: 'flex-start' }}>
                  <div className="rt-html" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(String(it.content || ''), { USE_PROFILES: { html: true } }) }} />
                </div>
              </div>
            ))}

            {/** Completed items block */}
            {noteItems.some((it:any) => it.checked) && (
              <div style={{ marginTop: 6 }}>
                <button className="btn completed-toggle" onClick={(e) => { e.stopPropagation(); setShowCompleted(s => !s); }} aria-expanded={showCompleted} aria-controls={`completed-${note.id}`}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ transform: showCompleted ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>{'▸'}</span>
                    <span>{noteItems.filter((it:any)=>it.checked).length} completed items</span>
                  </span>
                </button>
              </div>
            )}

            {showCompleted && noteItems.filter((it:any) => it.checked).map(it => (
              <div key={`c-${it.id}`} className="note-item completed" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginLeft: ((it.indent || 0) * 16), opacity: 0.7 }}>
                <button
                  className={`note-checkbox ${it.checked ? 'checked' : ''}`}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleItemChecked(it.id, !it.checked); }}
                  aria-pressed={!!it.checked}
                  style={{ background: 'var(--checkbox-bg)', border: '2px solid var(--checkbox-border)' }}
                >
                  {it.checked && (
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
                      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <div style={{ fontSize: 'var(--checklist-text-size)', textDecoration: 'line-through', display: 'flex', alignItems: 'flex-start' }}>
                  <div className="rt-html" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(String(it.content || ''), { USE_PROFILES: { html: true } }) }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          (rtHtmlFromY || note.body) ? (
            <div className="note-html" dangerouslySetInnerHTML={{ __html: (rtHtmlFromY || bodyHtmlPreview()) }} />
          ) : null
        )}
      </div>

      {imageUrl && (
        <div className="note-image">
          <img src={imageUrl} alt="note" />
        </div>
      )}

      {labels.length > 0 && (
        <div className="label-chips">
          {labels.map(l => <span key={l.id} className="chip">{l.name}</span>)}
        </div>
      )}

      {/* Protected footer region for actions (not affected by note bg/text color) */}
      <div className="note-footer" aria-hidden={false}>
        <div className="note-actions">
          <button className="tiny palette" onClick={() => setShowPalette(true)} aria-label="Change color" title="Change color">🎨</button>
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

          <button className="tiny" onClick={toggleArchive} aria-label="Archive" title="Archive">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M20.54 5.23L19.4 4H4.6L3.46 5.23 3 6v2h18V6l-.46-.77zM6 10v9h12V10H6zm3 2h6v2H9v-2z"/>
            </svg>
          </button>

          <button
            className="tiny"
            onClick={(e) => { e.stopPropagation(); setMoreAnchorPoint({ x: e.clientX, y: e.clientY }); setShowMore(s => !s); }}
            aria-label="More"
            title="More"
          >
            ⋮
          </button>
        </div>
      </div>

      {showMore && (
        <MoreMenu
          anchorRef={noteRef}
          anchorPoint={moreAnchorPoint}
          itemsCount={4}
          onClose={() => setShowMore(false)}
          onDelete={onDeleteNote}
          onAddLabel={onAddLabel}
          onUncheckAll={onUncheckAll}
          onCheckAll={onCheckAll}
        />
      )}
      {showLabels && (
        <LabelsDialog noteId={note.id} onClose={() => setShowLabels(false)} onUpdated={(ls) => setLabels(ls)} />
      )}

      {showCollaborator && (
        <CollaboratorModal onClose={() => setShowCollaborator(false)} onSelect={onCollaboratorSelect} />
      )}

      {showPalette && <ColorPalette anchorRef={noteRef} onPick={onPickColor} onClose={() => setShowPalette(false)} />}

      {showImageDialog && <ImageDialog onClose={() => setShowImageDialog(false)} onAdd={onAddImageUrl} />}

      {showReminderPicker && <ReminderPicker onClose={() => setShowReminderPicker(false)} onSet={onSetReminder} />}
      {showEditor && <ChecklistEditor note={{ ...note, items: noteItems }} noteBg={bg} onClose={() => setShowEditor(false)} onSaved={({ items, title }) => { setNoteItems(items); setTitle(title); }} />}
      {showTextEditor && <RichTextEditor note={note} noteBg={bg} onClose={() => setShowTextEditor(false)} onSaved={({ title, body }) => { setTitle(title); /* update body via note; preview renders `noteItems` or sanitized HTML, but we keep local title */ note.body = body; }} />}
    </article>
  );
}
