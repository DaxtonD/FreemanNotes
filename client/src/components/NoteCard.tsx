import React, { useRef, useState } from "react";
import { useTheme } from '../themeContext';
import DOMPurify from 'dompurify';
import { useAuth } from '../authContext';
import ChecklistEditor from "./ChecklistEditor";
import RichTextEditor from "./RichTextEditor";
import CollaboratorModal from "./CollaboratorModal";
import MoreMenu from "./MoreMenu";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPalette } from '@fortawesome/free-solid-svg-icons';
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
  viewerColor?: string | null;
  noteLabels?: Array<{ id: number; label?: { id: number; name: string } }>;
  images?: Array<{ id: number; url: string }>
  cardSpan?: number;
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
  const theme = (() => { try { return useTheme(); } catch { return { effective: 'dark' } as any; } })();

  const [bg, setBg] = useState<string>((note as any).viewerColor || note.color || ""); // empty = theme card color
  // default text color for "Default" palette will use CSS var --muted so it matches original layout
  const [textColor, setTextColor] = useState<string | undefined>(((note as any).viewerColor || note.color) ? contrastColorForBackground(((note as any).viewerColor || note.color) as string) : undefined);
  const [archived, setArchived] = useState(false);
  const [images, setImages] = useState<Array<{ id:number; url:string }>>((note.images as any) || []);
  const [noteItems, setNoteItems] = useState<any[]>(note.items || []);
  const [title, setTitle] = useState<string>(note.title || '');
  const [showCollaborator, setShowCollaborator] = useState(false);
  const [collaborators, setCollaborators] = useState<Array<{ collabId?: number; userId: number; email: string; name?: string; userImageUrl?: string }>>([]);
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
  const { token, user } = useAuth();
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
    const base = ((note as any).viewerColor || note.color || '') as string;
    setBg(base || '');
    setTextColor(base ? contrastColorForBackground(base) : undefined);
  }, [note.id, (note as any).viewerColor, note.color]);
  React.useEffect(() => {
    setLabels((note.noteLabels || []).map((nl:any) => nl.label).filter((l:any) => l && typeof l.id === 'number' && typeof l.name === 'string'));
  }, [note.noteLabels]);
  React.useEffect(() => { setTitle(note.title || ''); }, [note.title]);
  React.useEffect(() => { setImages(((note as any).images || []).map((i:any)=>({ id:Number(i.id), url:String(i.url) }))); }, [(note as any).images]);
  // Keep collaborators in sync with server-provided data on note reloads
  React.useEffect(() => {
    try {
      const arr = ((note as any).collaborators || []).map((c:any) => {
        const u = (c && (c.user || {}));
        if (u && typeof u.id === 'number' && typeof u.email === 'string') {
          return { collabId: Number(c.id), userId: Number(u.id), email: String(u.email), name: (typeof u.name === 'string' ? String(u.name) : undefined), userImageUrl: (typeof (u as any).userImageUrl === 'string' ? String((u as any).userImageUrl) : undefined) };
        }
        return null;
      }).filter(Boolean);
      setCollaborators(arr as any);
    } catch {}
  }, [(note as any).collaborators]);

  // track pointer down/up to distinguish clicks from small drags (prevents accidental reflows)
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = React.useRef(false);

  async function onPickColor(color: string) {
    // first palette entry is the "Default" swatch (empty string).
    // Selecting it restores the app's default background and sets text to the original muted color.
    const next = color || '';
    try {
      const res = await fetch(`/api/notes/${note.id}/prefs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ color: next })
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      console.error('Failed to save color preference', err);
      window.alert('Failed to save color preference');
    }
    if (!next) {
      setBg('');
      setTextColor('var(--muted)');
    } else {
      setBg(next);
      setTextColor(contrastColorForBackground(next));
    }
    setShowPalette(false);
  }

  function onAddImageUrl(url?: string | null) {
    setShowImageDialog(false);
    if (!url) return;
    // Persist to server and update local images list
    (async () => {
      try {
        const res = await fetch(`/api/notes/${note.id}/images`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' }, body: JSON.stringify({ url }) });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const img = data.image || null;
        if (img && img.id && img.url) {
          setImages(s => {
            const exists = s.some(x => Number(x.id) === Number(img.id));
            if (exists) return s;
            return [...s, { id: Number(img.id), url: String(img.url) }];
          });
        }
      } catch (err) {
        console.error('Failed to attach image', err);
        // Fallback: show locally even if save fails
        setImages(s => {
          const exists = s.some(x => String(x.url) === String(url));
          if (exists) return s;
          return [...s, { id: Date.now(), url }];
        });
        window.alert('Failed to attach image to server; showing locally');
      }
    })();
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
      const ownerId = (typeof (note as any).owner?.id === 'number' ? Number((note as any).owner.id) : undefined);
      const currentUserId = (user && (user as any).id) ? Number((user as any).id) : undefined;
      if (ownerId && currentUserId && ownerId !== currentUserId) {
        // Collaborator: remove self from this note
        const self = collaborators.find(c => typeof c.userId === 'number' && c.userId === currentUserId);
        if (self && typeof self.collabId === 'number') {
          const res = await fetch(`/api/notes/${note.id}/collaborators/${self.collabId}`, { method: 'DELETE', headers: { Authorization: token ? `Bearer ${token}` : '' } });
          if (!res.ok) throw new Error(await res.text());
          onChange && onChange();
          return;
        }
        window.alert('You are not the owner and could not find your collaborator entry to remove.');
        return;
      }
      // Owner: delete note for everyone
      const res = await fetch(`/api/notes/${note.id}`, { method: 'DELETE', headers: { Authorization: token ? `Bearer ${token}` : '' } });
      if (!res.ok) throw new Error(await res.text());
      onChange && onChange();
    } catch (err) {
      console.error(err);
      window.alert('Failed to delete or leave note');
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

  function onCollaboratorSelect(selected: { id: number; email: string; name?: string }) {
    setCollaborators((s) => {
      if (s.find(x => x.userId === selected.id)) return s;
      return [...s, { userId: selected.id, email: selected.email, name: selected.name }];
    });
    setShowCollaborator(false);
    // Persist collaborator on server
    (async () => {
      try {
        const res = await fetch(`/api/notes/${note.id}/collaborators`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
          body: JSON.stringify({ email: selected.email })
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const collab = (data && (data.collaborator || null));
        if (collab && typeof collab.id === 'number') {
          setCollaborators((s) => s.map(c => (c.userId === selected.id ? { ...c, collabId: Number(collab.id) } : c)));
        }
      } catch (err) {
        console.error('Failed to add collaborator', err);
        window.alert('Failed to add collaborator');
        // Revert optimistic add on failure
        setCollaborators((s) => s.filter(c => c.userId !== selected.id));
      }
    })();
  }

  async function onRemoveCollaborator(collabId: number) {
    try {
      const res = await fetch(`/api/notes/${note.id}/collaborators/${collabId}`, { method: 'DELETE', headers: { Authorization: token ? `Bearer ${token}` : '' } });
      if (!res.ok) throw new Error(await res.text());
      setCollaborators((s) => s.filter(c => c.collabId !== collabId));
      onChange && onChange();
    } catch (err) {
      console.error('Failed to remove collaborator', err);
      window.alert('Failed to remove collaborator');
    }
  }

  async function onSetCardWidth(span: 1 | 2 | 3) {
    try {
      const res = await fetch(`/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ cardSpan: span })
      });
      if (!res.ok) throw new Error(await res.text());
      // Ask grid to recalc columns/width and prompt a soft reload
      try { window.dispatchEvent(new Event('notes-grid:recalc')); } catch {}
      onChange && onChange();
    } catch (err) {
      console.error('Failed to set card width', err);
      window.alert('Failed to set card width');
    }
  }

  // Normalize legacy saved defaults when theme switches: if a note saved the default dark
  // or light background explicitly, treat it as theme-default so it adapts across themes.
  const normalizedBg = (() => {
    const v = (bg || '').toLowerCase().trim();
    // Known dark defaults from prior versions and related UI surfaces
    const darkDefaults = new Set(["#1e1e1e", "#121212", "#181818", "#1c1c1c", "#161616"]);
    const lightDefaults = new Set(["#ffffff", "#fff"]);
    if (theme.effective === 'light' && (darkDefaults.has(v))) return '';
    if (theme.effective === 'dark' && (lightDefaults.has(v))) return '';
    return bg;
  })();

  // Derive the final text color from the effective background; for theme-default bg use inherit
  const finalTextColor: string | undefined = normalizedBg ? contrastColorForBackground(normalizedBg) : undefined;

  // compute chip background so it's visible against selected background/text color
  const chipBg = (finalTextColor === "#ffffff" || finalTextColor === "var(--muted)")
    ? "rgba(0,0,0,0.12)"
    : "rgba(255,255,255,0.06)";

    // Compute participant chips (owner + collaborators), excluding current user
    const chipParticipants: Array<{ key: string | number; name: string; email: string; userImageUrl?: string }> = [];
    try {
      const currentUserId = (user && (user as any).id) ? Number((user as any).id) : undefined;
      const owner = (note as any).owner || null;
      if (owner && typeof owner.id === 'number' && owner.id !== currentUserId) {
        const ownerName = (typeof owner.name === 'string' && owner.name) ? owner.name : String(owner.email || '').split("@")[0];
        chipParticipants.push({ key: `owner-${owner.id}`, name: ownerName, email: String(owner.email || ''), userImageUrl: (typeof (owner as any).userImageUrl === 'string' ? String((owner as any).userImageUrl) : undefined) });
      }
      for (const c of collaborators) {
        if (typeof c.userId === 'number' && c.userId !== currentUserId) {
          const nm = (c.name && c.name.length) ? c.name : String(c.email).split('@')[0];
          chipParticipants.push({ key: c.collabId || `u-${c.userId}`, name: nm, email: c.email, userImageUrl: c.userImageUrl });
        }
      }
    } catch {}

    const styleVars: React.CSSProperties = {
      background: normalizedBg || undefined,
      color: finalTextColor || undefined,
      opacity: archived ? 0.6 : 1,
      position: 'relative',
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      ['--chip-bg' as any]: chipBg,
    } as React.CSSProperties;
    // Only override checkbox vars when the note has an explicit background color.
    if (normalizedBg) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      styleVars['--checkbox-bg'] = normalizedBg;
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      styleVars['--checkbox-border'] = contrastColorForBackground(normalizedBg);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      styleVars['--checkbox-checked-bg'] = normalizedBg;
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      styleVars['--checkbox-checked-mark'] = contrastColorForBackground(normalizedBg);
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

      {chipParticipants.length > 0 && (
        <div className="collab-chips">
          {chipParticipants.map(p => {
            const mode = ((user as any)?.chipDisplayMode) || 'image+text';
            const showImg = (mode === 'image' || mode === 'image+text') && !!p.userImageUrl;
            const showText = (mode === 'text' || mode === 'image+text');
            return (
              <span key={p.key} className="chip" title={p.email} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {showImg ? (
                  <img src={p.userImageUrl!} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover' }} />
                ) : null}
                {showText ? (<span>{p.name}</span>) : null}
              </span>
            );
          })}
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
                  style={{ background: 'var(--checkbox-bg)', border: '2px solid var(--checkbox-border)', color: 'var(--checkbox-stroke)' }}
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
                  style={{ background: 'var(--checkbox-bg)', border: '2px solid var(--checkbox-border)', color: 'var(--checkbox-stroke)' }}
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

      {images && images.length > 0 && (
        <div className="note-images">
          {images.map((img) => (
            <button
              key={img.id}
              className="note-image"
              style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
              onClick={() => { if (note.type === 'CHECKLIST' || (note.items && note.items.length)) setShowEditor(true); else setShowTextEditor(true); }}
            >
              <img src={img.url} alt="note image" />
            </button>
          ))}
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
          onSetWidth={onSetCardWidth}
        />
      )}
      {showLabels && (
        <LabelsDialog noteId={note.id} onClose={() => setShowLabels(false)} onUpdated={(ls) => setLabels(ls)} />
      )}

      {showCollaborator && (
        <CollaboratorModal
          onClose={() => setShowCollaborator(false)}
          onSelect={onCollaboratorSelect}
          current={(() => {
            const arr: Array<{ collabId?: number; userId: number; email: string; name?: string }> = [];
            const currentUserId = (user && (user as any).id) ? Number((user as any).id) : undefined;
            const owner = (note as any).owner || null;
            if (owner && typeof owner.id === 'number' && owner.id !== currentUserId) {
              arr.push({ userId: Number(owner.id), email: String(owner.email || ''), name: (typeof owner.name === 'string' ? owner.name : undefined) });
            }
            for (const c of collaborators) {
              if (typeof c.userId === 'number') {
                arr.push({ collabId: c.collabId, userId: c.userId, email: c.email, name: c.name });
              }
            }
            return arr;
          })()}
          ownerId={(typeof (note as any).owner?.id === 'number' ? Number((note as any).owner.id) : ((user as any)?.id))}
          onRemove={onRemoveCollaborator}
        />
      )}

      {showPalette && <ColorPalette anchorRef={noteRef} onPick={onPickColor} onClose={() => setShowPalette(false)} />}

      {showImageDialog && <ImageDialog onClose={() => setShowImageDialog(false)} onAdd={onAddImageUrl} />}

      {showReminderPicker && <ReminderPicker onClose={() => setShowReminderPicker(false)} onSet={onSetReminder} />}
      {showEditor && (
        <ChecklistEditor
          note={{ ...note, items: noteItems }}
          noteBg={bg}
          onClose={() => setShowEditor(false)}
          onSaved={({ items, title }) => { setNoteItems(items); setTitle(title); }}
          onImagesUpdated={(imgs) => setImages(imgs)}
        />
      )}
      {showTextEditor && (
        <RichTextEditor
          note={note}
          noteBg={bg}
          onClose={() => setShowTextEditor(false)}
          onSaved={({ title, body }) => { setTitle(title); note.body = body; }}
          onImagesUpdated={(imgs) => setImages(imgs)}
        />
      )}
    </article>
  );
}
