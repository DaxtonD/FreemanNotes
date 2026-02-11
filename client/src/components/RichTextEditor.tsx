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
import ReminderPicker, { type ReminderDraft } from './ReminderPicker';
import CollaboratorModal from './CollaboratorModal';
import ImageDialog from './ImageDialog';
import ImageLightbox from './ImageLightbox';
import ConfirmDialog from './ConfirmDialog';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLink, faPalette } from '@fortawesome/free-solid-svg-icons';
import MoreMenu from './MoreMenu';
import UrlEntryModal from './UrlEntryModal';

export default function RichTextEditor({ note, onClose, onSaved, noteBg, onImagesUpdated, onColorChanged, onCollaboratorsChanged, moreMenu }:
  {
    note: any;
    onClose: () => void;
    onSaved?: (payload: { title: string; body: string }) => void;
    noteBg?: string;
    onImagesUpdated?: (images: Array<{ id:number; url:string }>) => void;
    onColorChanged?: (color: string) => void;
    onCollaboratorsChanged?: (next: Array<{ collabId?: number; userId: number; email: string; name?: string; userImageUrl?: string }>) => void;
    moreMenu?: {
      onDelete: () => void;
      deleteLabel?: string;
      onRestore?: () => void;
      restoreLabel?: string;
      onAddLabel?: () => void;
      onMoveToCollection?: () => void;
      onSetWidth?: (span: 1 | 2 | 3) => void;
    };
  }) {
  const { token, user } = useAuth();
  const ownerId = (typeof (note as any).owner?.id === 'number' ? Number((note as any).owner.id) : (typeof (note as any).ownerId === 'number' ? Number((note as any).ownerId) : undefined));
  const currentUserId = (user && (user as any).id) ? Number((user as any).id) : undefined;
  const isOwner = !!(ownerId && currentUserId && ownerId === currentUserId);
  const clientIdRef = React.useRef<string>((() => {
    try { return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; } catch { return `c${Math.random()}`; }
  })());

  const isCoarsePointer = (() => {
    try { return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches; } catch { return false; }
  })();
  const imageLongPressTimerRef = React.useRef<number | null>(null);
  const imageLongPressStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const suppressNextImageClickRef = React.useRef(false);
  const [confirmImageDeleteId, setConfirmImageDeleteId] = React.useState<number | null>(null);

  function clearImageLongPress() {
    if (imageLongPressTimerRef.current != null) {
      window.clearTimeout(imageLongPressTimerRef.current);
      imageLongPressTimerRef.current = null;
    }
    imageLongPressStartRef.current = null;
  }

  function requestDeleteImage(imageId: number) {
    setConfirmImageDeleteId(Number(imageId));
  }

  const backIdRef = React.useRef<string>((() => {
    try { return `rte-${note?.id || 'x'}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; } catch { return `rte-${Math.random()}`; }
  })());

  React.useEffect(() => {
    window.dispatchEvent(new Event('freemannotes:editor-modal-open'));
    try {
      const id = backIdRef.current;
      const onBack = () => { try { onClose(); } catch {} };
      window.dispatchEvent(new CustomEvent('freemannotes:back/register', { detail: { id, onBack } }));
    } catch {}
    return () => {
      try { window.dispatchEvent(new CustomEvent('freemannotes:back/unregister', { detail: { id: backIdRef.current } })); } catch {}
      window.dispatchEvent(new Event('freemannotes:editor-modal-close'));
    };
  }, []);

  const [title, setTitle] = React.useState<string>(note.title || '');
  const [maximized, setMaximized] = React.useState<boolean>(false);
  const lastSavedTitleRef = React.useRef<string>(note.title || '');
  const titleSaveTimerRef = React.useRef<number | null>(null);
  const [showPalette, setShowPalette] = React.useState(false);
  const [showReminderPicker, setShowReminderPicker] = React.useState(false);
  const [showCollaborator, setShowCollaborator] = React.useState(false);
  const [showImageDialog, setShowImageDialog] = React.useState(false);
  const [images, setImages] = React.useState<Array<{ id:number; url:string }>>(((note as any).images || []).map((i:any)=>({ id:Number(i.id), url:String(i.url) })));
  const defaultImagesOpen = (() => {
    try {
      const stored = localStorage.getItem('prefs.editorImagesExpandedByDefault');
      if (stored !== null) return stored === 'true';
      const v = (user as any)?.editorImagesExpandedByDefault;
      if (typeof v === 'boolean') return v;
    } catch {}
    return false;
  })();
  const [imagesOpen, setImagesOpen] = React.useState(defaultImagesOpen);
  const [linkPreviews, setLinkPreviews] = React.useState<any[]>(() => {
    try {
      const raw = Array.isArray((note as any).linkPreviews) ? (note as any).linkPreviews : [];
      return raw
        .map((p: any) => ({
          id: Number(p?.id),
          url: String(p?.url || ''),
          title: (p?.title == null ? null : String(p.title)),
          description: (p?.description == null ? null : String(p.description)),
          imageUrl: (p?.imageUrl == null ? null : String(p.imageUrl)),
          domain: (p?.domain == null ? null : String(p.domain)),
        }))
        .filter((p: any) => Number.isFinite(p.id) && p.url);
    } catch { return []; }
  });
  const [lightboxUrl, setLightboxUrl] = React.useState<string | null>(null);
  const [collaborators, setCollaborators] = React.useState<Array<{ collabId?: number; userId: number; email: string; name?: string; userImageUrl?: string }>>([]);
  const [showMore, setShowMore] = React.useState(false);
  const moreBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const seededOnceRef = React.useRef<boolean>(false);
  const syncedRef = React.useRef<boolean>(false);
  const dirtyRef = React.useRef<boolean>(false);
  const [urlModal, setUrlModal] = React.useState<{ mode: 'add' | 'edit'; previewId?: number; initialUrl?: string } | null>(null);

  // Keep collaborators in sync with server-provided note data.
  React.useEffect(() => {
    try {
      const arr = ((note as any).collaborators || [])
        .map((c: any) => {
          const u = (c && (c.user || {}));
          if (u && typeof u.id === 'number' && typeof u.email === 'string') {
            const img = (typeof (u as any).userImageUrl === 'string')
              ? String((u as any).userImageUrl)
              : (typeof (c as any).userImageUrl === 'string' ? String((c as any).userImageUrl) : undefined);
            return {
              collabId: (typeof c.id === 'number' ? Number(c.id) : undefined),
              userId: Number(u.id),
              email: String(u.email),
              name: (typeof u.name === 'string' ? String(u.name) : undefined),
              userImageUrl: img,
            };
          }
          return null;
        })
        .filter(Boolean) as any;
      setCollaborators(arr);
      try { (onCollaboratorsChanged as any)?.(arr); } catch {}
    } catch {}
  }, [(note as any).collaborators]);

  async function onConfirmReminder(draft: ReminderDraft) {
    setShowReminderPicker(false);
    if (!isOwner) {
      window.alert('Only the note owner can set reminders.');
      return;
    }
    try {
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          await Notification.requestPermission();
        }
      } catch {}

      const res = await fetch(`/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ reminderDueAt: draft.dueAtIso, reminderOffsetMinutes: draft.offsetMinutes }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      console.error(err);
      window.alert('Failed to set reminder');
    }
  }

  async function onClearReminder() {
    setShowReminderPicker(false);
    if (!isOwner) {
      window.alert('Only the note owner can clear reminders.');
      return;
    }
    try {
      const res = await fetch(`/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ reminderDueAt: null }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      console.error(err);
      window.alert('Failed to clear reminder');
    }
  }

  const markDirty = React.useCallback(() => {
    if (dirtyRef.current) return;
    dirtyRef.current = true;
    try { window.dispatchEvent(new CustomEvent('freemannotes:draft/dirty', { detail: { noteId: Number(note?.id) } })); } catch {}
  }, [note?.id]);

  React.useEffect(() => {
    lastSavedTitleRef.current = note.title || '';
    setTitle(note.title || '');
  }, [note.id]);

  const saveTitleNow = React.useCallback(async (nextTitle?: string) => {
    const t = (typeof nextTitle === 'string' ? nextTitle : title);
    if ((lastSavedTitleRef.current || '') === (t || '')) return;
    lastSavedTitleRef.current = t || '';
    try {
      const r1 = await fetch(`/api/notes/${note.id}` as any, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: t || '' }),
      });
      if (!r1.ok) throw new Error(await r1.text());
    } catch (err) {
      // revert saved pointer so we retry on next change
      lastSavedTitleRef.current = note.title || '';
      console.error('Failed to update title', err);
      window.alert('Failed to update title');
    }
  }, [note.id, note.title, title, token]);

  React.useEffect(() => {
    if ((note.title || '') === (title || '')) return;
    if (titleSaveTimerRef.current) window.clearTimeout(titleSaveTimerRef.current);
    titleSaveTimerRef.current = window.setTimeout(() => {
      saveTitleNow(title);
    }, 350);
  }, [title, note.title, saveTitleNow]);

  // Collaborative setup via Yjs + y-websocket (room per note)
  const ydoc = React.useMemo(() => new Y.Doc(), [note.id]);
  const providerRef = React.useRef<WebsocketProvider | null>(null);
  React.useEffect(() => {
    const room = `note-${note.id}`;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const serverUrl = `${proto}://${window.location.host}/collab`;
    const provider = new WebsocketProvider(serverUrl, room, ydoc);
    providerRef.current = provider;
    const onSync = (isSynced: boolean) => { if (isSynced) syncedRef.current = true; };
    try { provider.on('sync', onSync as any); } catch {}
    return () => {
      try { provider.off('sync', onSync as any); } catch {}
      try { provider.destroy(); } catch {}
    };
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
    try { setUrlModal({ mode: 'add' }); } catch {}
  }

  const linkPreviewTimerRef = React.useRef<number | null>(null);
  const lastPreviewUrlRef = React.useRef<string | null>(null);
  function extractFirstUrl(text: string): string | null {
    const t = String(text || '');
    const m = t.match(/\bhttps?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/i);
    if (m && m[0]) return String(m[0]);
    const m2 = t.match(/\bwww\.[\w\-._~:/?#[\]@!$&'()*+,;=%]+/i);
    if (m2 && m2[0]) return `https://${String(m2[0])}`;
    return null;
  }
  async function requestLinkPreview(url: string) {
    try {
      const res = await fetch(`/api/notes/${note.id}/link-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const raw = Array.isArray(data?.previews) ? data.previews : [];
      const next = raw
        .map((p: any) => ({
          id: Number(p?.id),
          url: String(p?.url || ''),
          title: (p?.title == null ? null : String(p.title)),
          description: (p?.description == null ? null : String(p.description)),
          imageUrl: (p?.imageUrl == null ? null : String(p.imageUrl)),
          domain: (p?.domain == null ? null : String(p.domain)),
        }))
        .filter((p: any) => Number.isFinite(p.id) && p.url);
      setLinkPreviews(next);
    } catch {}
  }

  async function submitEditPreview(previewId: number, nextUrl: string) {
    try {
      const res = await fetch(`/api/notes/${note.id}/link-previews/${previewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ url: nextUrl }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const raw = Array.isArray(data?.previews) ? data.previews : [];
      const next = raw
        .map((p: any) => ({
          id: Number(p?.id),
          url: String(p?.url || ''),
          title: (p?.title == null ? null : String(p.title)),
          description: (p?.description == null ? null : String(p.description)),
          imageUrl: (p?.imageUrl == null ? null : String(p.imageUrl)),
          domain: (p?.domain == null ? null : String(p.domain)),
        }))
        .filter((p: any) => Number.isFinite(p.id) && p.url);
      setLinkPreviews(next);
    } catch (e) {
      console.error(e);
      window.alert('Failed to edit URL');
    }
  }

  const [previewMenu, setPreviewMenu] = React.useState<{ x: number; y: number; previewId: number } | null>(null);
  const longPressTimerRef = React.useRef<number | null>(null);
  const [previewMenuIsSheet, setPreviewMenuIsSheet] = React.useState(false);
  function clearLongPress() {
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  React.useEffect(() => {
    const decide = () => {
      try {
        const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        const narrow = window.innerWidth <= 760;
        setPreviewMenuIsSheet(!!(coarse || narrow));
      } catch {
        setPreviewMenuIsSheet(window.innerWidth <= 760);
      }
    };
    decide();
    window.addEventListener('resize', decide);
    return () => window.removeEventListener('resize', decide);
  }, []);

  React.useEffect(() => {
    if (!previewMenu) return;
    const onDoc = (e: any) => {
      try { setPreviewMenu(null); } catch {}
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('mousedown', onDoc);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [previewMenu]);
  async function deletePreview(previewId: number) {
    try {
      const res = await fetch(`/api/notes/${note.id}/link-previews/${previewId}`, {
        method: 'DELETE',
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const raw = Array.isArray(data?.previews) ? data.previews : [];
      setLinkPreviews(raw);
    } catch (e) {
      console.error(e);
      window.alert('Failed to delete URL');
    }
  }
  async function editPreview(previewId: number) {
    const nextUrl = window.prompt('Edit URL:');
    if (!nextUrl) return;
    try {
      const res = await fetch(`/api/notes/${note.id}/link-previews/${previewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ url: nextUrl }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const raw = Array.isArray(data?.previews) ? data.previews : [];
      setLinkPreviews(raw);
    } catch (e) {
      console.error(e);
      window.alert('Failed to edit URL');
    }
  }

  // Debounced derived preview sync: keep `note.body` updated from Yjs for cards/search
  const savePreviewTimer = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      // Mark dirty only after initial sync; otherwise initial content hydration
      // can spuriously count as a user edit.
      try { if (syncedRef.current) markDirty(); } catch {}
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

      // Debounced URL detection to populate link preview.
      try {
        if (linkPreviewTimerRef.current) window.clearTimeout(linkPreviewTimerRef.current);
        linkPreviewTimerRef.current = window.setTimeout(() => {
          try {
            const found = extractFirstUrl(editor.getText());
            if (!found) return;
            if (lastPreviewUrlRef.current && String(lastPreviewUrlRef.current) === String(found)) return;
            lastPreviewUrlRef.current = String(found);
            requestLinkPreview(found);
          } catch {}
        }, 1200);
      } catch {}
    };
    editor.on('update', onUpdate);
    return () => {
      editor.off('update', onUpdate);
      if (savePreviewTimer.current) window.clearTimeout(savePreviewTimer.current);
      if (linkPreviewTimerRef.current) window.clearTimeout(linkPreviewTimerRef.current);
    };
  }, [editor, note.id, token, markDirty]);

  function handleClose() {
    try {
      const txt = String(editor?.getText?.() || '').trim();
      const isEmpty = !String(title || '').trim() && !txt;
      if (isEmpty && (dirtyRef.current || ((note.title || '') !== (title || '')))) {
        // Discard empty notes instead of saving.
        try { fetch(`/api/notes/${note.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }); } catch {}
        onClose();
        return;
      }
      const bodySnapshot = (() => { try { return JSON.stringify(editor?.getJSON() || {}); } catch { return note.body || ''; } })();
      onSaved && onSaved({ title, body: bodySnapshot });
    } catch {}
    onClose();
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

  function onCollaboratorSelect(u: { id:number; email:string; name?: string; userImageUrl?: string }) {
    setCollaborators((s) => {
      if (s.find(x => x.userId === u.id)) return s;
      const next = [...s, { userId: u.id, email: u.email, name: u.name, userImageUrl: u.userImageUrl }];
      try { (onCollaboratorsChanged as any)?.(next); } catch {}
      return next;
    });
    setShowCollaborator(false);
    (async () => {
      try {
        const res = await fetch(`/api/notes/${note.id}/collaborators`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ email: u.email })
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const collab = (data && (data.collaborator || null));
        if (collab && typeof collab.id === 'number') {
          setCollaborators((s) => {
            const next = s.map(c => (c.userId === u.id ? { ...c, collabId: Number(collab.id) } : c));
            try { (onCollaboratorsChanged as any)?.(next); } catch {}
            return next;
          });
        }
      } catch (err) {
        console.error('Failed to add collaborator', err);
        window.alert('Failed to add collaborator');
        // Revert optimistic add on failure
        setCollaborators((s) => {
          const next = s.filter(c => c.userId !== u.id);
          try { (onCollaboratorsChanged as any)?.(next); } catch {}
          return next;
        });
      }
    })();
  }
  async function onRemoveCollaborator(collabId: number) {
    try {
      const res = await fetch(`/api/notes/${note.id}/collaborators/${collabId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(await res.text());
      setCollaborators((s) => {
        const next = s.filter(c => c.collabId !== collabId);
        try { (onCollaboratorsChanged as any)?.(next); } catch {}
        return next;
      });
    } catch (err) {
      console.error('Failed to remove collaborator', err);
      window.alert('Failed to remove collaborator');
    }
  }

  async function performDeleteImage(imageId: number) {
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
    <div className="image-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { handleClose(); } }}>
      <div className={`image-dialog editor-dialog${maximized ? ' maximized' : ''}`} role="dialog" aria-modal style={{ width: maximized ? '96vw' : 'min(1000px, 86vw)', ...dialogStyle }}>
        <div className="dialog-header">
          <strong>Edit note</strong>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="tiny toggle-maximize" onClick={() => setMaximized(m => !m)} aria-label="Toggle maximize" title="Toggle maximize">⤢</button>
            <button className="icon-close" onClick={handleClose}>✕</button>
          </div>
        </div>
        <div className="dialog-body">
          <div className="rt-sticky-header">
            <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
              <input
                placeholder="Title"
                value={title}
                onChange={(e) => { setTitle(e.target.value); try { markDirty(); } catch {} }}
                onBlur={() => { try { saveTitleNow(); } catch {} }}
                style={{ flex: 1, background: 'transparent', border: 'none', color: 'inherit', fontWeight: 600, fontSize: 18 }}
              />
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
              <button className="tiny" onClick={applyLink} aria-label="Insert link" title="Insert link"><FontAwesomeIcon icon={faLink} /></button>
            </div>
          </div>
          <div
            onKeyDown={(e) => {
              try {
                const ctrl = e.ctrlKey || e.metaKey;
                if (!ctrl) {
                  const k = String((e as any).key || '');
                  if (k.length === 1 || k === 'Backspace' || k === 'Enter' || k === 'Delete') markDirty();
                }
              } catch {}
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

          {linkPreviews.length > 0 && (
            <div className="note-link-previews" style={{ marginTop: 10 }}>
              {linkPreviews.map((p: any) => {
                const domain = (p.domain || (() => { try { return new URL(p.url).hostname.replace(/^www\./i, ''); } catch { return ''; } })());
                return (
                  <div
                    key={p.id}
                    className="link-preview-row editor-link-preview"
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setPreviewMenu({ x: e.clientX, y: e.clientY, previewId: p.id }); }}
                    onPointerDown={(e) => {
                      clearLongPress();
                      const x = (e as any).clientX ?? 0;
                      const y = (e as any).clientY ?? 0;
                      longPressTimerRef.current = window.setTimeout(() => {
                        try { setPreviewMenu({ x, y, previewId: p.id }); } catch {}
                      }, 520);
                    }}
                    onPointerUp={clearLongPress}
                    onPointerCancel={clearLongPress}
                    onPointerMove={clearLongPress}
                  >
                    <a
                      className="link-preview"
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => { try { e.stopPropagation(); } catch {} }}
                    >
                      <div className="link-preview-image" aria-hidden>
                        {p.imageUrl ? (
                          <img src={String(p.imageUrl)} alt="" loading="lazy" />
                        ) : (
                          <svg viewBox="0 0 24 24" aria-hidden focusable="false"><path d="M9.17 14.83a3 3 0 0 1 0-4.24l2.83-2.83a3 3 0 1 1 4.24 4.24l-.88.88" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M14.83 9.17a3 3 0 0 1 0 4.24l-2.83 2.83a3 3 0 1 1-4.24-4.24l.88-.88" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        )}
                      </div>
                      <div className="link-preview-meta">
                        <div className="link-preview-title">{String(p.title || domain || p.url)}</div>
                        <div className="link-preview-domain">{String(domain || p.url)}</div>
                      </div>
                    </a>
                    <button
                      className="link-preview-menu"
                      type="button"
                      aria-label="URL actions"
                      title="URL actions"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPreviewMenu({ x: e.clientX, y: e.clientY, previewId: p.id }); }}
                    >
                      ⋯
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {previewMenu && createPortal(
            <>
              {previewMenuIsSheet && (
                <div
                  className="more-menu-backdrop"
                  role="presentation"
                  onPointerDown={() => setPreviewMenu(null)}
                  onMouseDown={() => setPreviewMenu(null)}
                />
              )}
              <div
                className={`more-menu${previewMenuIsSheet ? ' more-menu--sheet' : ''}`}
                style={(() => {
                  if (previewMenuIsSheet) {
                    return { position: 'fixed', left: 8, right: 8, bottom: 8, top: 'auto', visibility: 'visible', zIndex: 10000 } as any;
                  }
                  const APPROX_W = 280;
                  const APPROX_H = 210;
                  const pad = 8;
                  let left = Number(previewMenu.x) || 0;
                  let top = Number(previewMenu.y) || 0;
                  if (left + APPROX_W > window.innerWidth - pad) left = window.innerWidth - pad - APPROX_W;
                  if (top + APPROX_H > window.innerHeight - pad) top = window.innerHeight - pad - APPROX_H;
                  left = Math.max(pad, left);
                  top = Math.max(pad, top);
                  return { position: 'fixed', left, top, visibility: 'visible', zIndex: 10000 } as any;
                })()}
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
              >
                <div className="more-group">
                  <button type="button" className="more-item" onClick={() => { const id = previewMenu.previewId; setPreviewMenu(null); editPreview(id); }}>
                    <span className="more-item__icon" aria-hidden="true" />
                    <span className="more-item__label">Edit URL</span>
                  </button>
                  <button type="button" className="more-item more-item--danger" onClick={() => { const id = previewMenu.previewId; setPreviewMenu(null); if (window.confirm('Delete this URL preview?')) deletePreview(id); }}>
                    <span className="more-item__icon" aria-hidden="true" />
                    <span className="more-item__label">Delete URL</span>
                  </button>
                  <button type="button" className="more-item" onClick={() => setPreviewMenu(null)}>
                    <span className="more-item__icon" aria-hidden="true" />
                    <span className="more-item__label">Cancel</span>
                  </button>
                </div>
              </div>
            </>,
            document.body
          )}

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
                      onContextMenu={(e) => {
                        if (!isCoarsePointer) return;
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={() => {
                        if (suppressNextImageClickRef.current) {
                          suppressNextImageClickRef.current = false;
                          return;
                        }
                        setLightboxUrl(img.url);
                      }}
                      onPointerDown={(e) => {
                        if (!isCoarsePointer) return;
                        if (e.pointerType && e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
                        e.preventDefault();
                        clearImageLongPress();
                        imageLongPressStartRef.current = { x: e.clientX, y: e.clientY };
                        imageLongPressTimerRef.current = window.setTimeout(() => {
                          suppressNextImageClickRef.current = true;
                          clearImageLongPress();
                          requestDeleteImage(img.id);
                        }, 520);
                      }}
                      onPointerMove={(e) => {
                        if (!isCoarsePointer) return;
                        const start = imageLongPressStartRef.current;
                        if (!start) return;
                        if (Math.abs(e.clientX - start.x) > 10 || Math.abs(e.clientY - start.y) > 10) {
                          clearImageLongPress();
                        }
                      }}
                      onPointerUp={() => clearImageLongPress()}
                      onPointerCancel={() => clearImageLongPress()}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightboxUrl(img.url); } }}
                      style={{ cursor: 'zoom-in', position: 'relative' }}
                    >
                      <img
                        src={img.url}
                        alt="note image"
                        draggable={false}
                        onContextMenu={(e) => {
                          if (!isCoarsePointer) return;
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      />
                      <button
                        className="image-delete"
                        aria-label="Delete image"
                        title="Delete image"
                        onClick={(e) => { e.stopPropagation(); requestDeleteImage(img.id); }}
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

          <ConfirmDialog
            open={confirmImageDeleteId != null}
            title={'Delete image'}
            message={'Are you sure you want to delete this image?'}
            confirmLabel={'Delete'}
            cancelLabel={'Cancel'}
            danger
            onCancel={() => setConfirmImageDeleteId(null)}
            onConfirm={() => {
              const id = confirmImageDeleteId;
              setConfirmImageDeleteId(null);
              if (typeof id === 'number') performDeleteImage(id);
            }}
          />
        </div>
        <div className="dialog-footer" style={{ borderTop: `1px solid ${textColor || 'rgba(255,255,255,0.15)'}` }}>
          <div className="note-actions" style={{ marginRight: 'auto', display: 'inline-flex', gap: 8, justifyContent: 'flex-start', color: textColor }}>
            <button className="tiny palette" onClick={() => setShowPalette(true)} aria-label="Change color" title="Change color">
              <FontAwesomeIcon icon={faPalette} className="palette-svg" />
            </button>
            <button
              className="tiny"
              onClick={() => { if (isOwner) setShowReminderPicker(true); else window.alert('Only the note owner can set reminders.'); }}
              aria-label="Reminder"
              title={isOwner ? 'Reminder' : 'Reminder (owner-only)'}
              disabled={!isOwner}
              style={!isOwner ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
            >
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
            <button className="btn" onClick={handleClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );

  {showPalette && <ColorPalette anchorRef={undefined as any} onPick={onPickColor} onClose={() => setShowPalette(false)} />}
  {showReminderPicker && (
    <ReminderPicker
      onClose={() => setShowReminderPicker(false)}
      onConfirm={onConfirmReminder}
      onClear={((note as any)?.reminderDueAt ? onClearReminder : undefined)}
      initialDueAtIso={(note as any)?.reminderDueAt || null}
      initialOffsetMinutes={typeof (note as any)?.reminderOffsetMinutes === 'number' ? (note as any).reminderOffsetMinutes : null}
    />
  )}
  {showCollaborator && (
    <CollaboratorModal
      onClose={() => setShowCollaborator(false)}
      onSelect={onCollaboratorSelect}
      current={((): Array<{ collabId?: number; userId: number; email: string; name?: string; userImageUrl?: string }> => {
        const arr: Array<{ collabId?: number; userId: number; email: string; name?: string; userImageUrl?: string }> = [];
        try {
          const currentUserId = (user && (user as any).id) ? Number((user as any).id) : undefined;
          const owner = (note as any).owner || null;
          if (owner && typeof owner.id === 'number' && owner.id !== currentUserId) {
            arr.push({
              userId: Number(owner.id),
              email: String(owner.email || ''),
              name: (typeof owner.name === 'string' ? owner.name : undefined),
              userImageUrl: (typeof (owner as any).userImageUrl === 'string' ? String((owner as any).userImageUrl) : undefined),
            });
          }
          for (const c of collaborators) {
            if (typeof c.userId === 'number' && c.email) {
              arr.push({ collabId: c.collabId, userId: c.userId, email: c.email, name: c.name, userImageUrl: c.userImageUrl });
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
          itemsCount={((note as any)?.trashedAt ? 2 : (moreMenu.onMoveToCollection ? 5 : 4))}
          onClose={() => setShowMore(false)}
          onDelete={moreMenu.onDelete}
          deleteLabel={moreMenu.deleteLabel}
          onRestore={moreMenu.onRestore}
          restoreLabel={moreMenu.restoreLabel}
          onMoveToCollection={moreMenu.onMoveToCollection}
          onAddLabel={moreMenu.onAddLabel}
          onSetWidth={moreMenu.onSetWidth}
        />
      )}
      {showPalette && <ColorPalette anchorRef={undefined as any} onPick={onPickColor} onClose={() => setShowPalette(false)} />}
      {showReminderPicker && (
        <ReminderPicker
          onClose={() => setShowReminderPicker(false)}
          onConfirm={onConfirmReminder}
          onClear={((note as any)?.reminderDueAt ? onClearReminder : undefined)}
          initialDueAtIso={(note as any)?.reminderDueAt || null}
          initialOffsetMinutes={typeof (note as any)?.reminderOffsetMinutes === 'number' ? (note as any).reminderOffsetMinutes : null}
        />
      )}
      {showCollaborator && (
        <CollaboratorModal
          onClose={() => setShowCollaborator(false)}
          onSelect={onCollaboratorSelect}
          current={((): Array<{ collabId?: number; userId: number; email: string; name?: string; userImageUrl?: string }> => {
            const arr: Array<{ collabId?: number; userId: number; email: string; name?: string; userImageUrl?: string }> = [];
            try {
              const currentUserId = (user && (user as any).id) ? Number((user as any).id) : undefined;
              const owner = (note as any).owner || null;
              if (owner && typeof owner.id === 'number' && owner.id !== currentUserId) {
                arr.push({
                  userId: Number(owner.id),
                  email: String(owner.email || ''),
                  name: (typeof owner.name === 'string' ? owner.name : undefined),
                  userImageUrl: (typeof (owner as any).userImageUrl === 'string' ? String((owner as any).userImageUrl) : undefined),
                });
              }
              for (const c of collaborators) {
                if (typeof c.userId === 'number' && c.email) {
                  arr.push({ collabId: c.collabId, userId: c.userId, email: c.email, name: c.name, userImageUrl: c.userImageUrl });
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
