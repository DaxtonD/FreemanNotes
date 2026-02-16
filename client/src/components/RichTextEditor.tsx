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
import { enqueueHttpJsonMutation, enqueueImageUpload, kickOfflineSync } from '../lib/offline';
import { noteCollabRoomFromNote } from '../lib/collabRoom';

function formatReminderDueIdentifier(dueMs: number): string {
  if (!Number.isFinite(dueMs)) return 'Reminder set';
  const due = new Date(dueMs);
  const now = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startOf(due).getTime() - startOf(now).getTime()) / 86400000);
  const timeLabel = due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (dayDiff === 0) return `Today at ${timeLabel}`;
  if (dayDiff === 1) return `Tomorrow at ${timeLabel}`;
  if (dayDiff === -1) return `Yesterday at ${timeLabel}`;
  if (dayDiff > 1 && dayDiff < 7) return `${due.toLocaleDateString([], { weekday: 'short' })} at ${timeLabel}`;
  return due.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function reminderDueColorClass(dueMs: number): string {
  if (!Number.isFinite(dueMs)) return '';
  const now = new Date();
  const due = new Date(dueMs);
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const dueUtc = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
  const calendarDayDiff = Math.trunc((dueUtc - todayUtc) / 86400000);
  const elapsedDayDiff = Math.max(0, Math.ceil((dueMs - Date.now()) / 86400000));
  const dayDiff = Math.max(calendarDayDiff, elapsedDayDiff);
  if (dayDiff <= 1) return 'note-reminder-due--red';
  if (dayDiff >= 2 && dayDiff <= 7) return 'note-reminder-due--orange';
  if (dayDiff >= 8 && dayDiff <= 14) return 'note-reminder-due--yellow';
  return '';
}

/** choose '#000' or '#fff' based on best WCAG contrast vs provided hex color */
function contrastColorForBackground(hex?: string | null): string | undefined {
  if (!hex) return undefined;
  const h = String(hex).replace('#', '');
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
      pinned?: boolean;
      onTogglePin?: () => void;
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
  const dialogRef = React.useRef<HTMLDivElement | null>(null);

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

  // Open in view mode: do not keep any field focused/selected.
  React.useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const active = document.activeElement as HTMLElement | null;
        if (active && (active.matches?.('input, textarea, [contenteditable="true"]') || active.closest?.('[contenteditable="true"]'))) {
          active.blur();
        }
      } catch {}
      try {
        const root = dialogRef.current as HTMLElement | null;
        const active = document.activeElement as HTMLElement | null;
        if (root && active && root.contains(active)) active.blur();
      } catch {}
      try {
        const root = dialogRef.current as HTMLElement | null;
        const pm = root?.querySelector?.('.ProseMirror[contenteditable="true"]') as HTMLElement | null;
        pm?.blur?.();
      } catch {}
      try { document.getSelection()?.removeAllRanges(); } catch {}
    }, 0);
    return () => window.clearTimeout(id);
  }, [note.id]);

  const [title, setTitle] = React.useState<string>(note.title || '');
  const initialBg = React.useMemo(() => {
    try {
      return String((noteBg ?? (note as any)?.viewerColor ?? (note as any)?.color ?? '') || '');
    } catch {
      return '';
    }
  }, [noteBg, (note as any)?.viewerColor, (note as any)?.color]);
  const [bg, setBg] = React.useState<string>(initialBg);
  const [maximized, setMaximized] = React.useState<boolean>(false);
  const lastSavedTitleRef = React.useRef<string>(note.title || '');
  const titleSaveTimerRef = React.useRef<number | null>(null);
  const [showPalette, setShowPalette] = React.useState(false);
  const [showReminderPicker, setShowReminderPicker] = React.useState(false);
  const [showCollaborator, setShowCollaborator] = React.useState(false);
  const [showImageDialog, setShowImageDialog] = React.useState(false);
  const [images, setImages] = React.useState<Array<{ id:number; url:string }>>(((note as any).images || []).map((i:any)=>({ id:Number(i.id), url:String(i.url) })));
  const setImagesWithNotify = React.useCallback((updater: (prev: Array<{ id:number; url:string }>) => Array<{ id:number; url:string }>) => {
    setImages((prev) => {
      const next = updater(prev);
      try {
        window.setTimeout(() => {
          try { onImagesUpdated && onImagesUpdated(next); } catch {}
        }, 0);
      } catch {}
      return next;
    });
  }, [onImagesUpdated]);
  const editorThumbRequestSize = React.useMemo(() => {
    try {
      const root = document.documentElement;
      const cs = window.getComputedStyle(root);
      const raw = String(cs.getPropertyValue('--editor-image-thumb-size') || '').trim();
      const base = Number.parseFloat(raw || '115');
      const dpr = Math.max(1, Math.min(3, Number(window.devicePixelRatio || 1)));
      return Math.max(96, Math.min(1024, Math.round((Number.isFinite(base) ? base : 115) * dpr)));
    } catch {
      return 230;
    }
  }, []);
  const getEditorImageThumbSrc = React.useCallback((img: { id: number; url: string }) => {
    const noteIdNum = Number((note as any)?.id);
    const id = Number((img as any)?.id);
    if (!Number.isFinite(noteIdNum) || noteIdNum <= 0) return String((img as any)?.url || '');
    if (!Number.isFinite(id) || id <= 0) return String((img as any)?.url || '');
    if (!token) return String((img as any)?.url || '');
    return `/api/notes/${noteIdNum}/images/${id}/thumb?w=${editorThumbRequestSize}&q=74&token=${encodeURIComponent(String(token))}`;
  }, [note.id, editorThumbRequestSize, token]);
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

  function normalizeLinkPreviews(rawInput: any): any[] {
    const raw = Array.isArray(rawInput) ? rawInput : [];
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
  }

  async function requestJsonOrQueue(input: {
    method: 'PATCH' | 'PUT' | 'POST' | 'DELETE';
    path: string;
    body?: any;
  }): Promise<{ status: 'ok' | 'queued' | 'failed'; data?: any }> {
    const method = String(input.method || 'PATCH').toUpperCase() as any;
    const path = String(input.path || '');
    const body = input.body;
    if (!path) return { status: 'failed' };

    const queueNow = async () => {
      try {
        await enqueueHttpJsonMutation({ method, path, body });
        void kickOfflineSync();
        return { status: 'queued' as const };
      } catch {
        return { status: 'failed' as const };
      }
    };

    if (navigator.onLine === false) return await queueNow();

    try {
      const hasBody = typeof body !== 'undefined';
      const res = await fetch(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: hasBody ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(await res.text());
      let data: any = null;
      try { data = await res.json(); } catch {}
      return { status: 'ok', data };
    } catch {
      return await queueNow();
    }
  }

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

      const result = await requestJsonOrQueue({
        method: 'PATCH',
        path: `/api/notes/${note.id}`,
        body: { reminderDueAt: draft.dueAtIso, reminderOffsetMinutes: draft.offsetMinutes },
      });
      if (result.status === 'failed') throw new Error('Failed to set reminder');
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
      const result = await requestJsonOrQueue({
        method: 'PATCH',
        path: `/api/notes/${note.id}`,
        body: { reminderDueAt: null },
      });
      if (result.status === 'failed') throw new Error('Failed to clear reminder');
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
    try {
      setBg(String((noteBg ?? (note as any)?.viewerColor ?? (note as any)?.color ?? '') || ''));
    } catch {
      setBg('');
    }
    seededOnceRef.current = false;
    syncedRef.current = false;
    dirtyRef.current = false;
  }, [note.id, noteBg, (note as any)?.viewerColor, (note as any)?.color]);

  const saveTitleNow = React.useCallback(async (nextTitle?: string) => {
    const t = (typeof nextTitle === 'string' ? nextTitle : title);
    if ((lastSavedTitleRef.current || '') === (t || '')) return;
    lastSavedTitleRef.current = t || '';
    try {
      const result = await requestJsonOrQueue({
        method: 'PATCH',
        path: `/api/notes/${note.id}`,
        body: { title: t || '' },
      });
      if (result.status === 'failed') throw new Error('Failed to update title');
    } catch (err) {
      // revert saved pointer so we retry on next change
      lastSavedTitleRef.current = note.title || '';
      console.error('Failed to update title', err);
      window.alert('Failed to update title');
    }
  }, [note.id, note.title, title]);

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
    const room = noteCollabRoomFromNote(note);
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
      try { onImagesUpdated && onImagesUpdated(next); } catch {}
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

    // Empty line: toggle the stored mark so upcoming typed text uses this style.
    let hasTextInBlock = false;
    try {
      editor.state.doc.nodesBetween(from, to, (node: any) => {
        if (node?.isText && String(node.text || '').length > 0) hasTextInBlock = true;
      });
    } catch {}
    if (!hasTextInBlock) {
      const chain: any = editor.chain().focus();
      const active = !!editor.isActive(mark);
      if (mark === 'bold') {
        if (active) chain.unsetBold();
        else chain.setBold();
      } else if (mark === 'italic') {
        if (active) chain.unsetItalic();
        else chain.setItalic();
      } else {
        if (active) chain.unsetUnderline();
        else chain.setUnderline();
      }
      chain.run();
      return;
    }

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

  // Fallback seed for offline/open-race cases:
  // retry seeding for a short window so provider sync races don't leave an empty editor.
  React.useEffect(() => {
    if (!editor) return;
    const rawBody = String((note as any)?.body || '');
    if (!rawBody.trim()) return;
    let attempts = 0;
    const MAX_ATTEMPTS = 8;

    const trySeed = () => {
      try {
        const currentText = String(editor.getText?.() || '').trim();
        if (currentText) {
          seededOnceRef.current = true;
          return true;
        }
        if (dirtyRef.current) return true;

        let parsed: any = null;
        try {
          parsed = JSON.parse(rawBody);
        } catch {
          parsed = rawBody;
        }

        if (parsed && typeof parsed === 'object') {
          editor.commands.setContent(parsed as any, { emitUpdate: false } as any);
          return false;
        }

        const text = String(parsed || '').trim();
        if (!text) return true;
        editor.commands.setContent({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        } as any, { emitUpdate: false } as any);
      } catch {}
      return false;
    };

    const initialTimer = window.setTimeout(() => {
      trySeed();
    }, 120);

    const interval = window.setInterval(() => {
      attempts += 1;
      const done = trySeed();
      if (done || attempts >= MAX_ATTEMPTS) {
        try { window.clearInterval(interval); } catch {}
      }
    }, 250);

    return () => {
      try { window.clearTimeout(initialTimer); } catch {}
      try { window.clearInterval(interval); } catch {}
    };
  }, [editor, note.id, (note as any).body]);

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
      const result = await requestJsonOrQueue({
        method: 'POST',
        path: `/api/notes/${note.id}/link-preview`,
        body: { url },
      });
      if (result.status === 'ok') {
        setLinkPreviews(normalizeLinkPreviews(result.data?.previews));
      } else if (result.status === 'queued') {
        const normalizedUrl = String(url || '').trim();
        if (!normalizedUrl) return;
        const domain = (() => { try { return new URL(normalizedUrl).hostname.replace(/^www\./i, ''); } catch { return ''; } })();
        setLinkPreviews((prev) => {
          const existing = Array.isArray(prev) ? prev : [];
          if (existing.some((p: any) => String(p?.url || '') === normalizedUrl)) return existing;
          const temp = {
            id: -Math.floor(Date.now() + Math.random() * 1000),
            url: normalizedUrl,
            title: normalizedUrl,
            description: null,
            imageUrl: null,
            domain: domain || null,
          };
          return normalizeLinkPreviews([temp, ...existing]);
        });
      }
    } catch {}
  }

  async function submitEditPreview(previewId: number, nextUrl: string) {
    const previous = [...linkPreviews];
    const optimistic = previous.map((p: any) => (Number(p?.id) === Number(previewId) ? { ...p, url: String(nextUrl || '').trim() } : p));
    setLinkPreviews(optimistic);
    try {
      const result = await requestJsonOrQueue({
        method: 'PATCH',
        path: `/api/notes/${note.id}/link-previews/${previewId}`,
        body: { url: nextUrl },
      });
      if (result.status === 'failed') throw new Error('Failed to edit URL');
      if (result.status === 'ok') setLinkPreviews(normalizeLinkPreviews(result.data?.previews));
    } catch (e) {
      console.error(e);
      setLinkPreviews(previous);
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
    const previous = [...linkPreviews];
    const optimistic = previous.filter((p: any) => Number(p?.id) !== Number(previewId));
    setLinkPreviews(optimistic);
    try {
      const result = await requestJsonOrQueue({
        method: 'DELETE',
        path: `/api/notes/${note.id}/link-previews/${previewId}`,
      });
      if (result.status === 'failed') throw new Error('Failed to delete URL');
      if (result.status === 'ok') setLinkPreviews(normalizeLinkPreviews(result.data?.previews));
    } catch (e) {
      console.error(e);
      setLinkPreviews(previous);
      window.alert('Failed to delete URL');
    }
  }
  async function editPreview(previewId: number) {
    const nextUrl = window.prompt('Edit URL:');
    if (!nextUrl) return;
    await submitEditPreview(previewId, nextUrl);
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
        try {
          void requestJsonOrQueue({ method: 'DELETE', path: `/api/notes/${note.id}` });
        } catch {}
        onClose();
        return;
      }
      const bodySnapshot = (() => {
        try {
          const next = JSON.stringify(editor?.getJSON() || {});
          if (!dirtyRef.current && !txt && String(note.body || '').trim()) return String(note.body || '');
          return next;
        } catch {
          return note.body || '';
        }
      })();
      onSaved && onSaved({ title, body: bodySnapshot });
    } catch {}
    onClose();
  }

  // Keep editor dialog on current app theme colors.
  const dialogStyle: React.CSSProperties = {} as any;
  const textColor: string | undefined = undefined;
  const titleTextColor = contrastColorForBackground(bg);
  const titleStripStyle: React.CSSProperties | undefined = bg
    ? {
        background: bg,
        color: titleTextColor || 'inherit',
        borderRadius: 8,
        padding: '8px 10px',
        marginBottom: 8,
      }
    : undefined;

  async function onPickColor(color: string) {
    const nextBg = color || '';
    setBg(nextBg);
    const result = await requestJsonOrQueue({
      method: 'PATCH',
      path: `/api/notes/${note.id}/prefs`,
      body: { color: nextBg },
    });
    if (result.status === 'failed') {
      console.error('Failed to save color preference');
      window.alert('Failed to save color preference');
    }
    try { (onColorChanged as any)?.(nextBg); } catch {}
  }

  function onAddImageUrl(url?: string | null) {
    setShowImageDialog(false);
    if (!url) return;
    const tempId = -Math.floor(Date.now() + Math.random() * 1000000);
    // Optimistically show immediately
    setImagesWithNotify((s) => {
      const exists = s.some((x) => String(x.url) === String(url));
      const next = exists ? s : [...s, { id: tempId, url: String(url) }];
      return next;
    });
    try { setImagesOpen(true); } catch {}
    (async () => {
      const normalized = String(url || '').trim();
      if (!normalized) return;
      const queueForLater = async () => {
        try {
          await enqueueImageUpload(Number(note.id), normalized, tempId);
          void kickOfflineSync();
        } catch (err) {
          console.error('Failed to queue image upload', err);
        }
      };

      if (navigator.onLine === false) {
        await queueForLater();
        return;
      }

      try {
        const res = await fetch(`/api/notes/${note.id}/images`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ url: normalized }) });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const img = data.image || null;
        if (img && img.id && img.url) {
          setImagesWithNotify((s) => {
            const serverId = Number(img.id);
            const serverUrl = String(img.url);
            // Replace the optimistic temp entry if present; otherwise merge by url/id.
            const replaced = s.map((x) => (Number(x.id) === tempId || String(x.url) === String(url)) ? ({ id: serverId, url: serverUrl }) : x);
            const hasServer = replaced.some((x) => Number(x.id) === serverId);
            const next = hasServer ? replaced : [...replaced, { id: serverId, url: serverUrl }];
            return next;
          });
          broadcastImagesChanged();
        }
      } catch (err) {
        console.error('Failed to attach image', err);
        await queueForLater();
      }
    })();
  }

  function onAddImageUrls(urls?: string[] | null) {
    setShowImageDialog(false);
    const list = Array.isArray(urls)
      ? urls.map((u) => String(u || '').trim()).filter((u) => !!u)
      : [];
    if (!list.length) return;
    for (const u of list) onAddImageUrl(u);
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
        const result = await requestJsonOrQueue({
          method: 'POST',
          path: `/api/notes/${note.id}/collaborators`,
          body: { email: u.email },
        });
        if (result.status === 'failed') throw new Error('Failed to add collaborator');
        const collab = (result.status === 'ok') ? (result.data && (result.data.collaborator || null)) : null;
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
    const previous = [...collaborators];
    setCollaborators((s) => {
      const next = s.filter(c => c.collabId !== collabId);
      try { (onCollaboratorsChanged as any)?.(next); } catch {}
      return next;
    });
    try {
      const result = await requestJsonOrQueue({ method: 'DELETE', path: `/api/notes/${note.id}/collaborators/${collabId}` });
      if (result.status === 'failed') throw new Error('Failed to remove collaborator');
    } catch (err) {
      console.error('Failed to remove collaborator', err);
      setCollaborators(previous);
      try { (onCollaboratorsChanged as any)?.(previous); } catch {}
      window.alert('Failed to remove collaborator');
    }
  }

  async function performDeleteImage(imageId: number) {
    const prev = images;
    const next = prev.filter(i => Number(i.id) !== Number(imageId));
    setImages(next);
    onImagesUpdated && onImagesUpdated(next);
    try {
      const result = await requestJsonOrQueue({ method: 'DELETE', path: `/api/notes/${note.id}/images/${imageId}` });
      if (result.status === 'failed') throw new Error('Failed to delete image');
      broadcastImagesChanged();
    } catch (err) {
      console.error('Failed to delete image', err);
      setImages(prev);
      onImagesUpdated && onImagesUpdated(prev);
      window.alert('Failed to delete image');
    }
  }

  const dialog = (
    <div className="image-dialog-backdrop editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { handleClose(); } }}>
      <div ref={dialogRef} className={`image-dialog editor-dialog${maximized ? ' maximized' : ''}${imagesOpen ? ' images-open' : ''}`} role="dialog" aria-modal style={{ width: maximized ? '96vw' : 'min(1000px, 86vw)', ...dialogStyle }}>
        <div className="dialog-header">
          <strong aria-hidden="true" />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="tiny toggle-maximize" onClick={() => setMaximized(m => !m)} aria-label="Toggle maximize" title="Toggle maximize">⤢</button>
            <button className="icon-close" onClick={handleClose}>✕</button>
          </div>
        </div>
        <div className="dialog-body">
          <div className="editor-scroll-area">
          <div className="rt-sticky-header">
            {(() => {
              const due = (note as any)?.reminderDueAt;
              if (!due) return null;
              const dueMs = Date.parse(String(due));
              const urgencyClass = Number.isFinite(dueMs) ? reminderDueColorClass(dueMs) : '';
              return (
                <div className={`note-reminder-due editor-reminder-chip${urgencyClass ? ` ${urgencyClass}` : ''}`} title={`Reminder: ${Number.isFinite(dueMs) ? new Date(dueMs).toLocaleString() : 'Set'}`}>
                  {Number.isFinite(dueMs) ? formatReminderDueIdentifier(dueMs) : 'Reminder set'}
                </div>
              );
            })()}
            <div style={{ display: 'flex', gap: 12, marginBottom: 8, ...(titleStripStyle || {}) }}>
              <input
                className={`note-title-input${!String(title || '').trim() ? ' note-title-input-missing' : ''}`}
                placeholder="Title"
                value={title}
                onChange={(e) => { setTitle(e.target.value); try { markDirty(); } catch {} }}
                onBlur={() => { try { saveTitleNow(); } catch {} }}
                style={{ flex: 1, background: 'transparent', border: 'none', color: 'inherit', fontWeight: 600, fontSize: 18 }}
              />
            </div>
            <div className="rt-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 0, marginBottom: 0, overflowX: 'auto', color: textColor }}>
              <button className="tiny" type="button" onClick={() => toggleMarkAcrossLine('bold')} aria-pressed={editor?.isActive('bold')} aria-label="Bold" title="Bold">B</button>
              <button className="tiny" type="button" onClick={() => toggleMarkAcrossLine('italic')} aria-pressed={editor?.isActive('italic')} aria-label="Italic" title="Italic">I</button>
              <button className="tiny" type="button" onClick={() => toggleMarkAcrossLine('underline')} aria-pressed={editor?.isActive('underline')} aria-label="Underline" title="Underline">U</button>
              <button className="tiny" type="button" onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} aria-pressed={editor?.isActive('heading', { level: 1 })} aria-label="Heading 1" title="Heading 1">H1</button>
              <button className="tiny" type="button" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} aria-pressed={editor?.isActive('heading', { level: 2 })} aria-label="Heading 2" title="Heading 2">H2</button>
              <button className="tiny" type="button" onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} aria-pressed={editor?.isActive('heading', { level: 3 })} aria-label="Heading 3" title="Heading 3">H3</button>
              <button className="tiny" type="button" onClick={() => editor?.chain().focus().toggleBulletList().run()} aria-pressed={editor?.isActive('bulletList')} aria-label="Bulleted list" title="Bulleted list">
                <svg viewBox="0 0 24 24" aria-hidden focusable="false"><circle cx="5" cy="6" r="1.5" /><rect x="9" y="5" width="10" height="2" rx="1" /><circle cx="5" cy="12" r="1.5" /><rect x="9" y="11" width="10" height="2" rx="1" /><circle cx="5" cy="18" r="1.5" /><rect x="9" y="17" width="10" height="2" rx="1" /></svg>
              </button>
              <button className="tiny" type="button" onClick={() => editor?.chain().focus().toggleOrderedList().run()} aria-pressed={editor?.isActive('orderedList')} aria-label="Numbered list" title="Numbered list">
                <svg viewBox="0 0 24 24" aria-hidden focusable="false"><text x="3.5" y="7" fontSize="6" fontFamily="system-ui, Arial" fill="currentColor">1.</text><rect x="9" y="5" width="10" height="2" rx="1" /><text x="3.5" y="13" fontSize="6" fontFamily="system-ui, Arial" fill="currentColor">2.</text><rect x="9" y="11" width="10" height="2" rx="1" /><text x="3.5" y="19" fontSize="6" fontFamily="system-ui, Arial" fill="currentColor">3.</text><rect x="9" y="17" width="10" height="2" rx="1" /></svg>
              </button>
              <button className="tiny" type="button" onClick={() => editor?.chain().focus().setTextAlign('left').run()} aria-pressed={editor?.isActive({ textAlign: 'left' })} aria-label="Align left" title="Align left"><svg viewBox="0 0 24 24" aria-hidden focusable="false"><rect x="4" y="5" width="14" height="2" rx="1" /><rect x="4" y="9" width="10" height="2" rx="1" /><rect x="4" y="13" width="14" height="2" rx="1" /><rect x="4" y="17" width="8" height="2" rx="1" /></svg></button>
              <button className="tiny" type="button" onClick={() => editor?.chain().focus().setTextAlign('center').run()} aria-pressed={editor?.isActive({ textAlign: 'center' })} aria-label="Align center" title="Align center"><svg viewBox="0 0 24 24" aria-hidden focusable="false"><rect x="5" y="5" width="14" height="2" rx="1" /><rect x="7" y="9" width="10" height="2" rx="1" /><rect x="5" y="13" width="14" height="2" rx="1" /><rect x="8" y="17" width="8" height="2" rx="1" /></svg></button>
              <button className="tiny" type="button" onClick={() => editor?.chain().focus().setTextAlign('right').run()} aria-pressed={editor?.isActive({ textAlign: 'right' })} aria-label="Align right" title="Align right"><svg viewBox="0 0 24 24" aria-hidden focusable="false"><rect x="6" y="5" width="14" height="2" rx="1" /><rect x="10" y="9" width="10" height="2" rx="1" /><rect x="6" y="13" width="14" height="2" rx="1" /><rect x="12" y="17" width="8" height="2" rx="1" /></svg></button>
              <button className="tiny" type="button" onClick={() => editor?.chain().focus().setTextAlign('justify').run()} aria-pressed={editor?.isActive({ textAlign: 'justify' })} aria-label="Justify" title="Justify"><svg viewBox="0 0 24 24" aria-hidden focusable="false"><rect x="5" y="5" width="14" height="2" rx="1" /><rect x="5" y="9" width="14" height="2" rx="1" /><rect x="5" y="13" width="14" height="2" rx="1" /><rect x="5" y="17" width="14" height="2" rx="1" /></svg></button>
              <button
                className="tiny"
                type="button"
                onClick={(e) => { try { e.preventDefault(); e.stopPropagation(); } catch {} applyLink(); }}
                aria-label="Insert link"
                title="Insert link"
              ><FontAwesomeIcon icon={faLink} /></button>
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

          </div>

          {images && images.length > 0 && (
            <div className="editor-images editor-images-dock">
              {imagesOpen && (
                <div className="editor-images-grid">
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
                        src={getEditorImageThumbSrc(img)}
                        alt="note image"
                        loading="lazy"
                        decoding="async"
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
  {showImageDialog && <ImageDialog onClose={() => setShowImageDialog(false)} onAdd={onAddImageUrl} onAddMany={onAddImageUrls} />}

  if (typeof document !== 'undefined') {
    const portal = createPortal(dialog, document.body);
    return (<>{portal}
      {moreMenu && showMore && (
        <MoreMenu
          anchorRef={moreBtnRef as any}
          itemsCount={((note as any)?.trashedAt
            ? 2
            : ((moreMenu.onMoveToCollection ? 1 : 0)
              + (moreMenu.onTogglePin ? 1 : 0)
              + 4))}
          pinned={moreMenu.pinned}
          onTogglePin={moreMenu.onTogglePin}
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
      {showImageDialog && <ImageDialog onClose={() => setShowImageDialog(false)} onAdd={onAddImageUrl} onAddMany={onAddImageUrls} />}
      <UrlEntryModal
        open={!!urlModal}
        title="Add URL preview"
        initialUrl={urlModal?.initialUrl}
        onCancel={() => setUrlModal(null)}
        onSubmit={(url) => {
          setUrlModal(null);
          try { requestLinkPreview(String(url)); } catch {}
        }}
      />
      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </>);
  }
  return dialog;
}
