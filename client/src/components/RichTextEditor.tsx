import React from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../authContext';
import { EditorContent, useEditor } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Collaboration from '@tiptap/extension-collaboration';
import Underline from '@tiptap/extension-underline';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import ColorPalette from './ColorPalette';
import ReminderPicker from './ReminderPicker';
import CollaboratorModal from './CollaboratorModal';
import ImageDialog from './ImageDialog';
import ImageLightbox from './ImageLightbox';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPalette } from '@fortawesome/free-solid-svg-icons';
import MoreMenu from './MoreMenu';

export default function RichTextEditor({ note, onClose, onSaved, noteBg, onImagesUpdated, onColorChanged, moreMenu }:
  {
    note: any;
    onClose: () => void;
    onSaved?: (payload: { title: string; body: string }) => void;
    noteBg?: string;
    onImagesUpdated?: (images: Array<{ id:number; url:string }>) => void;
    onColorChanged?: (color: string) => void;
    moreMenu?: {
      onDelete: () => void;
      onAddLabel: () => void;
      onSetWidth: (span: 1 | 2 | 3) => void;
    };
  }) {
  const { token, user } = useAuth();
  const clientIdRef = React.useRef<string>((() => {
    try { return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; } catch { return `c${Math.random()}`; }
  })());

  React.useEffect(() => {
    window.dispatchEvent(new Event('freemannotes:editor-modal-open'));
    return () => {
      window.dispatchEvent(new Event('freemannotes:editor-modal-close'));
    };
  }, []);

  const [title, setTitle] = React.useState<string>(note.title || '');
  const [maximized, setMaximized] = React.useState<boolean>(false);
  const [showPalette, setShowPalette] = React.useState(false);
  const [showReminderPicker, setShowReminderPicker] = React.useState(false);
  const [showCollaborator, setShowCollaborator] = React.useState(false);
  const [showImageDialog, setShowImageDialog] = React.useState(false);
  const [images, setImages] = React.useState<Array<{ id:number; url:string }>>(((note as any).images || []).map((i:any)=>({ id:Number(i.id), url:String(i.url) })));
  const [imagesOpen, setImagesOpen] = React.useState(false);
  const [lightboxUrl, setLightboxUrl] = React.useState<string | null>(null);
  const [collaborators, setCollaborators] = React.useState<{ id:number; email:string }[]>([]);
  const [showMore, setShowMore] = React.useState(false);
  const moreBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const seededOnceRef = React.useRef<boolean>(false);

  // Collaborative setup via Yjs + y-websocket (room per note)
  const ydoc = React.useMemo(() => new Y.Doc(), [note.id]);
  const providerRef = React.useRef<WebsocketProvider | null>(null);
  React.useEffect(() => {
    const room = `note-${note.id}`;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const serverUrl = `${proto}://${window.location.host}/collab`;
    const provider = new WebsocketProvider(serverUrl, room, ydoc);
    providerRef.current = provider;
    return () => { try { provider.destroy(); } catch {} };
  }, [note.id, ydoc]);

  const broadcastImagesChanged = React.useCallback(() => {
    try {
      const ymeta = ydoc.getMap<any>('meta');
      ymeta.set('imagesTick', { t: Date.now(), by: clientIdRef.current });
    } catch {}
  }, [ydoc]);

  const refreshImagesFromServer = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/notes/${note.id}/images`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      const next = (((data && data.images) || []).map((i: any) => ({ id: Number(i.id), url: String(i.url) })));
      setImages(next);
      onImagesUpdated && onImagesUpdated(next);
    } catch {}
  }, [note.id, token, onImagesUpdated]);

  React.useEffect(() => {
    const ymeta = (() => { try { return ydoc.getMap<any>('meta'); } catch { return null; } })();
    if (!ymeta) return;
    const onMeta = () => {
      try {
        const payload: any = ymeta.get('imagesTick');
        if (!payload || !payload.t) return;
        if (payload.by && String(payload.by) === String(clientIdRef.current)) return;
        refreshImagesFromServer();
      } catch {}
    };
    try { ymeta.observe(onMeta); } catch {}
    return () => { try { ymeta.unobserve(onMeta); } catch {} };
  }, [ydoc, refreshImagesFromServer]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: true, autolink: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Collaboration.configure({ document: ydoc }),
      Underline,
      // Ensure equal spacing by splitting blocks instead of inserting hard breaks
      Extension.create({
        name: 'paragraphEnterFix',
        priority: 1000,
        addKeyboardShortcuts() {
          return {
            'Shift-Enter': () => {
              const e = this.editor;
              e.commands.splitBlock();
              e.commands.setParagraph();
              return true;
            },
            'Mod-Enter': () => {
              const e = this.editor;
              e.commands.splitBlock();
              e.commands.setParagraph();
              return true;
            },
          };
        },
      }),
    ],
    editorProps: { attributes: { class: 'rt-editor' } },
  });

  function toggleMarkAcrossLine(mark: 'bold' | 'italic' | 'underline') {
    if (!editor) return;
    const sel: any = editor.state.selection;
    if (!sel || !sel.empty) {
      editor.chain().focus()[`toggle${mark.charAt(0).toUpperCase() + mark.slice(1)}` as 'toggleBold' | 'toggleItalic' | 'toggleUnderline']().run();
      return;
    }
    const $from = sel.$from;
    let depth = $from.depth;
    while (depth > 0 && !$from.node(depth).isBlock) depth--;
    const from = $from.start(depth);
    const to = $from.end(depth);
    const chain = editor.chain().focus().setTextSelection({ from, to });
    if (mark === 'bold') chain.toggleBold().run();
    else if (mark === 'italic') chain.toggleItalic().run();
    else chain.toggleUnderline().run();
    try { editor.chain().setTextSelection(sel.from).run(); } catch {}
  }

  React.useEffect(() => {
    try {
      const next = (((note as any).images || []).map((i:any)=>({ id:Number(i.id), url:String(i.url) })));
      setImages((cur) => {
        try {
          if (cur.length === next.length && cur.every((c, idx) => Number(c.id) === Number(next[idx]?.id) && String(c.url) === String(next[idx]?.url))) return cur;
        } catch {}
        return next;
      });
    } catch {}
  }, [ (note as any).images ]);

  // Server is authoritative; clients never seed initial content.

  const [, setToolbarTick] = React.useState(0);
  React.useEffect(() => {
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

  // Debounced derived preview sync: keep `note.body` updated from Yjs for cards/search
  const savePreviewTimer = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      if (savePreviewTimer.current) window.clearTimeout(savePreviewTimer.current);
      savePreviewTimer.current = window.setTimeout(async () => {
        try {
          const json = editor.getJSON();
          await fetch(`/api/notes/${note.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ body: JSON.stringify(json), type: 'TEXT' })
          });
        } catch {}
      }, 700);
    };
    editor.on('update', onUpdate);
    return () => { editor.off('update', onUpdate); if (savePreviewTimer.current) window.clearTimeout(savePreviewTimer.current); };
  }, [editor, note.id, token]);

  async function saveTitleOnly() {
    try {
      const bodySnapshot = (() => { try { return JSON.stringify(editor?.getJSON() || {}); } catch { return note.body || ''; } })();
      if ((note.title || '') !== title) {
        const r1 = await fetch(`/api/notes/${note.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ title }) });
        if (!r1.ok) throw new Error(await r1.text());
      }
      onSaved && onSaved({ title, body: bodySnapshot });
      onClose();
    } catch (err) {
      console.error('Failed to update title', err);
      window.alert('Failed to update title');
    }
  }

  // Contrast color for adaptive text/icon colors
  function contrastColor(hex?: string | null) {
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
    const contrastWithWhite = (1 + 0.05) / (L + 0.05);
    const contrastWithBlack = (L + 0.05) / (0 + 0.05);
    return contrastWithWhite >= contrastWithBlack ? '#ffffff' : '#000000';
  }

  // Match note color in dialog; prefer viewer-specific color, and set text color accordingly
  const dialogStyle: React.CSSProperties = {} as any;
  const [bg, setBg] = React.useState<string>(noteBg ?? ((note as any).viewerColor || note.color || ''));
  const textColor = bg ? (contrastColor(bg) || 'var(--muted)') : undefined;
  React.useEffect(() => { setBg(noteBg ?? ((note as any).viewerColor || note.color || '')); }, [noteBg, (note as any).viewerColor, note.color]);
  if (bg) {
    (dialogStyle as any)['--checkbox-bg'] = bg;
    (dialogStyle as any)['--checkbox-border'] = textColor || undefined;
    (dialogStyle as any)['--checkbox-stroke'] = textColor || undefined;
    (dialogStyle as any)['--checkbox-checked-bg'] = bg;
    (dialogStyle as any)['--checkbox-checked-mark'] = textColor || undefined;
    (dialogStyle as any)['--editor-surface'] = bg;
    dialogStyle.background = bg;
    if (textColor) dialogStyle.color = textColor;
  }

  async function onPickColor(color: string) {
    const nextBg = color || '';
    try {
      const res = await fetch(`/api/notes/${note.id}/prefs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ color: nextBg })
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      console.error('Failed to save color preference', err);
      window.alert('Failed to save color preference');
    }
    setBg(nextBg);
    try { (onColorChanged as any)?.(nextBg); } catch {}
  }

  function onAddImageUrl(url?: string | null) {
    setShowImageDialog(false);
    if (!url) return;
    const tempId = -Date.now();
    // Optimistically show immediately
    setImages((s) => {
      const exists = s.some((x) => String(x.url) === String(url));
      const next = exists ? s : [...s, { id: tempId, url: String(url) }];
      onImagesUpdated && onImagesUpdated(next);
      return next;
    });
    try { setImagesOpen(true); } catch {}
    (async () => {
      try {
        const res = await fetch(`/api/notes/${note.id}/images`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ url }) });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const img = data.image || null;
        if (img && img.id && img.url) {
          setImages((s) => {
            const serverId = Number(img.id);
            const serverUrl = String(img.url);
            // Replace the optimistic temp entry if present; otherwise merge by url/id.
            const replaced = s.map((x) => (Number(x.id) === tempId || String(x.url) === String(url)) ? ({ id: serverId, url: serverUrl }) : x);
            const hasServer = replaced.some((x) => Number(x.id) === serverId);
            const next = hasServer ? replaced : [...replaced, { id: serverId, url: serverUrl }];
            onImagesUpdated && onImagesUpdated(next);
            return next;
          });
          broadcastImagesChanged();
        }
      } catch (err) {
        console.error('Failed to attach image', err);
        // Keep optimistic image; just surface the error.
        window.alert('Failed to attach image');
      }
    })();
  }

  function onCollaboratorSelect(u: { id:number; email:string; name?: string }) {
    setCollaborators(s => (s.find(x=>x.id===u.id)?s:[...s,u]));
    setShowCollaborator(false);
    (async () => {
      try {
        const res = await fetch(`/api/notes/${note.id}/collaborators`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ email: u.email }) });
        if (!res.ok) throw new Error(await res.text());
      } catch (err) {
        console.error('Failed to add collaborator', err);
        window.alert('Failed to add collaborator');
      }
    })();
  }
  async function onRemoveCollaborator(collabId: number) {
    try {
      const res = await fetch(`/api/notes/${note.id}/collaborators/${collabId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      console.error('Failed to remove collaborator', err);
      window.alert('Failed to remove collaborator');
    }
  }

  async function deleteImage(imageId: number) {
    const prev = images;
    const next = prev.filter(i => Number(i.id) !== Number(imageId));
    setImages(next);
    onImagesUpdated && onImagesUpdated(next);
    try {
      const res = await deleteImageFromServer(note.id, imageId, token);
      if (!res.ok) throw new Error(await res.text());
      broadcastImagesChanged();
    } catch (err) {
      console.error('Failed to delete image', err);
      setImages(prev);
      onImagesUpdated && onImagesUpdated(prev);
      window.alert('Failed to delete image');
    }
  }

  const dialog = (
    <div className="image-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { saveTitleOnly(); } }}>
      <div className={`image-dialog editor-dialog${maximized ? ' maximized' : ''}`} role="dialog" aria-modal style={{ width: maximized ? '96vw' : 'min(1000px, 86vw)', ...dialogStyle }}>
        <div className="dialog-header">
          <strong>Edit note</strong>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="tiny" onClick={() => setMaximized(m => !m)} aria-label="Toggle maximize" title="Toggle maximize">⤢</button>
            <button className="icon-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="dialog-body">
          <div className="rt-sticky-header">
            <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
              <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, background: 'transparent', border: 'none', color: 'inherit', fontWeight: 600, fontSize: 18 }} />
            </div>
            <div className="rt-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 0, marginBottom: 0, overflowX: 'auto', color: textColor }}>
              <button className="tiny" onClick={() => toggleMarkAcrossLine('bold')} aria-pressed={editor?.isActive('bold')} aria-label="Bold" title="Bold">B</button>
              <button className="tiny" onClick={() => toggleMarkAcrossLine('italic')} aria-pressed={editor?.isActive('italic')} aria-label="Italic" title="Italic">I</button>
              <button className="tiny" onClick={() => toggleMarkAcrossLine('underline')} aria-pressed={editor?.isActive('underline')} aria-label="Underline" title="Underline">U</button>
              <button className="tiny" onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} aria-pressed={editor?.isActive('heading', { level: 1 })} aria-label="Heading 1" title="Heading 1">H1</button>
              <button className="tiny" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} aria-pressed={editor?.isActive('heading', { level: 2 })} aria-label="Heading 2" title="Heading 2">H2</button>
              <button className="tiny" onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} aria-pressed={editor?.isActive('heading', { level: 3 })} aria-label="Heading 3" title="Heading 3">H3</button>
              <button className="tiny" onClick={() => editor?.chain().focus().toggleBulletList().run()} aria-pressed={editor?.isActive('bulletList')} aria-label="Bulleted list" title="Bulleted list">
                <svg viewBox="0 0 24 24" aria-hidden focusable="false"><circle cx="5" cy="6" r="1.5" /><rect x="9" y="5" width="10" height="2" rx="1" /><circle cx="5" cy="12" r="1.5" /><rect x="9" y="11" width="10" height="2" rx="1" /><circle cx="5" cy="18" r="1.5" /><rect x="9" y="17" width="10" height="2" rx="1" /></svg>
              </button>
              <button className="tiny" onClick={() => editor?.chain().focus().toggleOrderedList().run()} aria-pressed={editor?.isActive('orderedList')} aria-label="Numbered list" title="Numbered list">
                <svg viewBox="0 0 24 24" aria-hidden focusable="false"><text x="3.5" y="7" fontSize="6" fontFamily="system-ui, Arial" fill="currentColor">1.</text><rect x="9" y="5" width="10" height="2" rx="1" /><text x="3.5" y="13" fontSize="6" fontFamily="system-ui, Arial" fill="currentColor">2.</text><rect x="9" y="11" width="10" height="2" rx="1" /><text x="3.5" y="19" fontSize="6" fontFamily="system-ui, Arial" fill="currentColor">3.</text><rect x="9" y="17" width="10" height="2" rx="1" /></svg>
              </button>
              <button className="tiny" onClick={() => editor?.chain().focus().setTextAlign('left').run()} aria-pressed={editor?.isActive({ textAlign: 'left' })} aria-label="Align left" title="Align left"><svg viewBox="0 0 24 24" aria-hidden focusable="false"><rect x="4" y="5" width="14" height="2" rx="1" /><rect x="4" y="9" width="10" height="2" rx="1" /><rect x="4" y="13" width="14" height="2" rx="1" /><rect x="4" y="17" width="8" height="2" rx="1" /></svg></button>
              <button className="tiny" onClick={() => editor?.chain().focus().setTextAlign('center').run()} aria-pressed={editor?.isActive({ textAlign: 'center' })} aria-label="Align center" title="Align center"><svg viewBox="0 0 24 24" aria-hidden focusable="false"><rect x="5" y="5" width="14" height="2" rx="1" /><rect x="7" y="9" width="10" height="2" rx="1" /><rect x="5" y="13" width="14" height="2" rx="1" /><rect x="8" y="17" width="8" height="2" rx="1" /></svg></button>
              <button className="tiny" onClick={() => editor?.chain().focus().setTextAlign('right').run()} aria-pressed={editor?.isActive({ textAlign: 'right' })} aria-label="Align right" title="Align right"><svg viewBox="0 0 24 24" aria-hidden focusable="false"><rect x="6" y="5" width="14" height="2" rx="1" /><rect x="10" y="9" width="10" height="2" rx="1" /><rect x="6" y="13" width="14" height="2" rx="1" /><rect x="12" y="17" width="8" height="2" rx="1" /></svg></button>
              <button className="tiny" onClick={() => editor?.chain().focus().setTextAlign('justify').run()} aria-pressed={editor?.isActive({ textAlign: 'justify' })} aria-label="Justify" title="Justify"><svg viewBox="0 0 24 24" aria-hidden focusable="false"><rect x="5" y="5" width="14" height="2" rx="1" /><rect x="5" y="9" width="14" height="2" rx="1" /><rect x="5" y="13" width="14" height="2" rx="1" /><rect x="5" y="17" width="14" height="2" rx="1" /></svg></button>
              <button className="tiny" onClick={applyLink} aria-label="Insert link" title="Insert link"><svg viewBox="0 0 24 24" aria-hidden focusable="false"><path d="M9.17 14.83a3 3 0 0 1 0-4.24l2.83-2.83a3 3 0 1 1 4.24 4.24l-.88.88" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M14.83 9.17a3 3 0 0 1 0 4.24l-2.83 2.83a3 3 0 1 1-4.24-4.24l.88-.88" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
            </div>
          </div>
          <div
            onKeyDown={(e) => {
              if (!editor) return;
              const ctrl = e.ctrlKey || e.metaKey;
              if (!ctrl) return;
              if (!editor.isFocused) return;
              switch (e.key.toLowerCase()) {
                case 'b': e.preventDefault(); toggleMarkAcrossLine('bold'); break;
                case 'i': e.preventDefault(); toggleMarkAcrossLine('italic'); break;
                case 'u': e.preventDefault(); toggleMarkAcrossLine('underline'); break;
                case 'k': e.preventDefault(); applyLink(); break;
                case 'l': e.preventDefault(); editor.chain().focus().setTextAlign('left').run(); break;
                case 'r': e.preventDefault(); editor.chain().focus().setTextAlign('right').run(); break;
                case 'e': e.preventDefault(); editor.chain().focus().setTextAlign('center').run(); break;
                case 'j': e.preventDefault(); editor.chain().focus().setTextAlign('justify').run(); break;
              }
            }}
          >
            <EditorContent editor={editor} style={{ color: textColor }} />
          </div>

          {images && images.length > 0 && (
            <div className="editor-images" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn editor-images-toggle"
                onClick={() => setImagesOpen(o => !o)}
                aria-expanded={imagesOpen}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ transform: imagesOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>{'▸'}</span>
                  <span>Images ({images.length})</span>
                </span>
              </button>
              {imagesOpen && (
                <div className="editor-images-grid" style={{ marginTop: 8 }}>
                  {images.map(img => (
                    <div
                      key={img.id}
                      className="note-image"
                      role="button"
                      tabIndex={0}
                      onClick={() => setLightboxUrl(img.url)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightboxUrl(img.url); } }}
                      style={{ cursor: 'zoom-in', position: 'relative' }}
                    >
                      <img src={img.url} alt="note image" />
                      <button
                        className="image-delete"
                        aria-label="Delete image"
                        title="Delete image"
                        onClick={(e) => { e.stopPropagation(); deleteImage(img.id); }}
                        style={{ position: 'absolute', right: 6, bottom: 6 }}
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="dialog-footer" style={{ borderTop: `1px solid ${textColor || 'rgba(255,255,255,0.15)'}` }}>
          <div className="note-actions" style={{ marginRight: 'auto', display: 'inline-flex', gap: 8, justifyContent: 'flex-start', color: textColor }}>
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
            {moreMenu && (
              <button
                ref={moreBtnRef}
                className="tiny editor-more"
                onClick={(e) => { e.stopPropagation(); setShowMore(s => !s); }}
                aria-label="More"
                title="More"
              >⋮</button>
            )}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn" onClick={saveTitleOnly}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );

  {showPalette && <ColorPalette anchorRef={undefined as any} onPick={onPickColor} onClose={() => setShowPalette(false)} />}
  {showReminderPicker && <ReminderPicker onClose={() => setShowReminderPicker(false)} onSet={(iso) => { setShowReminderPicker(false); if (iso) window.alert(`Reminder set (UI-only): ${iso}`); }} />}
  {showCollaborator && (
    <CollaboratorModal
      onClose={() => setShowCollaborator(false)}
      onSelect={onCollaboratorSelect}
      current={((): Array<{ collabId?: number; userId: number; email: string; name?: string }> => {
        const arr: Array<{ collabId?: number; userId: number; email: string; name?: string }> = [];
        try {
          const currentUserId = (user && (user as any).id) ? Number((user as any).id) : undefined;
          const owner = (note as any).owner || null;
          if (owner && typeof owner.id === 'number' && owner.id !== currentUserId) {
            arr.push({ userId: Number(owner.id), email: String(owner.email || ''), name: (typeof owner.name === 'string' ? owner.name : undefined) });
          }
          const cols = ((note as any).collaborators || []) as Array<any>;
          for (const c of cols) {
            const u = (c && (c.user || {}));
            const uid = typeof u.id === 'number' ? Number(u.id) : (typeof c.userId === 'number' ? Number(c.userId) : undefined);
            const email = (typeof u.email === 'string' ? String(u.email) : undefined);
            const nm = (typeof u.name === 'string' ? String(u.name) : undefined);
            if (uid && email) {
              arr.push({ collabId: Number(c.id), userId: uid, email, name: nm });
            }
          }
        } catch {}
        return arr;
      })()}
      ownerId={(typeof (note as any).owner?.id === 'number' ? Number((note as any).owner.id) : ((user as any)?.id))}
      onRemove={onRemoveCollaborator}
    />
  )}
  {showImageDialog && <ImageDialog onClose={() => setShowImageDialog(false)} onAdd={onAddImageUrl} />}

  if (typeof document !== 'undefined') {
    const portal = createPortal(dialog, document.body);
    return (<>{portal}
      {moreMenu && showMore && (
        <MoreMenu
          anchorRef={moreBtnRef as any}
          itemsCount={4}
          onClose={() => setShowMore(false)}
          onDelete={moreMenu.onDelete}
          onAddLabel={moreMenu.onAddLabel}
          onSetWidth={moreMenu.onSetWidth}
        />
      )}
      {showPalette && <ColorPalette anchorRef={undefined as any} onPick={onPickColor} onClose={() => setShowPalette(false)} />}
      {showReminderPicker && <ReminderPicker onClose={() => setShowReminderPicker(false)} onSet={(iso) => { setShowReminderPicker(false); if (iso) window.alert(`Reminder set (UI-only): ${iso}`); }} />}
      {showCollaborator && (
        <CollaboratorModal
          onClose={() => setShowCollaborator(false)}
          onSelect={onCollaboratorSelect}
          current={((): Array<{ collabId?: number; userId: number; email: string; name?: string }> => {
            const arr: Array<{ collabId?: number; userId: number; email: string; name?: string }> = [];
            try {
              const currentUserId = (user && (user as any).id) ? Number((user as any).id) : undefined;
              const owner = (note as any).owner || null;
              if (owner && typeof owner.id === 'number' && owner.id !== currentUserId) {
                arr.push({ userId: Number(owner.id), email: String(owner.email || ''), name: (typeof owner.name === 'string' ? owner.name : undefined) });
              }
              const cols = ((note as any).collaborators || []) as Array<any>;
              for (const c of cols) {
                const u = (c && (c.user || {}));
                const uid = typeof u.id === 'number' ? Number(u.id) : (typeof c.userId === 'number' ? Number(c.userId) : undefined);
                const email = (typeof u.email === 'string' ? String(u.email) : undefined);
                const nm = (typeof u.name === 'string' ? String(u.name) : undefined);
                if (uid && email) {
                  arr.push({ collabId: Number(c.id), userId: uid, email, name: nm });
                }
              }
            } catch {}
            return arr;
          })()}
          ownerId={(typeof (note as any).owner?.id === 'number' ? Number((note as any).owner.id) : ((user as any)?.id))}
          onRemove={onRemoveCollaborator}
        />
      )}
      {showImageDialog && <ImageDialog onClose={() => setShowImageDialog(false)} onAdd={onAddImageUrl} />}
      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </>);
  }
  return dialog;
}

function deleteImageFromServer(noteId: number, imageId: number, token: string) {
  return fetch(`/api/notes/${noteId}/images/${imageId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
}
