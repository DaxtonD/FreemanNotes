import React from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { makeWebSocketUrl } from '../lib/ws';
import { useAuth } from '../authContext';
import ChecklistItemRT from './ChecklistItemRT';
import ColorPalette from './ColorPalette';
import ReminderPicker, { type ReminderDraft } from './ReminderPicker';
import CollaboratorModal from './CollaboratorModal';
import ImageDialog from './ImageDialog';
import MediaSheet, { type MediaView } from './MediaSheet';
import CreateMoreMenu from './CreateMoreMenu';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLink, faPalette, faTrashCan } from '@fortawesome/free-solid-svg-icons';
import UrlEntryModal from './UrlEntryModal';
import { enqueueHttpJsonMutation, enqueueImageUpload, kickOfflineSync } from '../lib/offline';
import { noteCollabRoom } from '../lib/collabRoom';

export default function MobileCreateModal({
  open,
  mode,
  onClose,
  onCreated,
  activeCollection,
}: {
  open: boolean;
  mode: 'text' | 'checklist';
  onClose: () => void;
  onCreated: () => void;
  activeCollection?: { id: number; path: string } | null;
}) {
  const { token, user } = useAuth();

  function genUid(): string {
    try { return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; } catch { return `u${Math.random()}`; }
  }

  const [title, setTitle] = React.useState('');
  const [items, setItems] = React.useState<Array<{ uid: string; content: string; checked: boolean; indent: number }>>([]);
  const [activeChecklistRowKey, setActiveChecklistRowKey] = React.useState<string | null>(null);
  const [bg, setBg] = React.useState<string>('');
  const [textColor, setTextColor] = React.useState<string | undefined>(undefined);
  const [showPalette, setShowPalette] = React.useState(false);
  const [showReminderPicker, setShowReminderPicker] = React.useState(false);
  const [pendingReminder, setPendingReminder] = React.useState<ReminderDraft | null>(null);
  const [showCollaborator, setShowCollaborator] = React.useState(false);
  const [showImageDialog, setShowImageDialog] = React.useState(false);
  const [imageUrls, setImageUrls] = React.useState<string[]>([]);
  const [selectedCollaborators, setSelectedCollaborators] = React.useState<Array<{ id: number; email: string }>>([]);
  const [pendingLinkUrls, setPendingLinkUrls] = React.useState<string[]>([]);
  const [showUrlModal, setShowUrlModal] = React.useState(false);
  const [mediaSheetOpen, setMediaSheetOpen] = React.useState(false);
  const [activeMediaView, setActiveMediaView] = React.useState<MediaView>('images');
  const mediaLaunchStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const [mediaLaunchDrag, setMediaLaunchDrag] = React.useState(0);

  const activeCollectionId = (activeCollection && Number.isFinite(Number(activeCollection.id))) ? Number(activeCollection.id) : null;
  const activeCollectionPath = (activeCollection && typeof activeCollection.path === 'string') ? String(activeCollection.path) : '';
  const [addToCurrentCollection, setAddToCurrentCollection] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const titleInputRef = React.useRef<HTMLInputElement | null>(null);
  const moreBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const skipNextChecklistToolbarClickRef = React.useRef(false);
  const [showMore, setShowMore] = React.useState(false);
  const hasMedia = imageUrls.length > 0 || pendingLinkUrls.length > 0;

  // local tiptap for creation (not collaborative until persisted)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Underline,
      Link.configure({ openOnClick: true, autolink: true }),
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
    content: '',
  });

  function applyTextLink() {
    try { setShowUrlModal(true); } catch {}
  }

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

  function applyChecklistLink() {
    try { setShowUrlModal(true); } catch {}
  }

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

  const overlayStateRef = React.useRef({
    showPalette: false,
    showReminderPicker: false,
    showCollaborator: false,
    showImageDialog: false,
    mediaSheetOpen: false,
    showMore: false,
  });
  React.useEffect(() => {
    overlayStateRef.current = {
      showPalette,
      showReminderPicker,
      showCollaborator,
      showImageDialog,
      mediaSheetOpen,
      showMore,
    };
  }, [showPalette, showReminderPicker, showCollaborator, showImageDialog, mediaSheetOpen, showMore]);

  React.useEffect(() => {
    if (!hasMedia) {
      setMediaSheetOpen(false);
      return;
    }
    if (activeMediaView === 'images' && imageUrls.length === 0 && pendingLinkUrls.length > 0) {
      setActiveMediaView('urlPreviews');
    } else if (activeMediaView === 'urlPreviews' && pendingLinkUrls.length === 0 && imageUrls.length > 0) {
      setActiveMediaView('images');
    }
  }, [hasMedia, activeMediaView, imageUrls.length, pendingLinkUrls.length]);

  const onMediaLaunchTouchStart = (e: React.TouchEvent<HTMLButtonElement>) => {
    const t = e.touches?.[0];
    if (!t) return;
    mediaLaunchStartRef.current = { x: t.clientX, y: t.clientY };
    setMediaLaunchDrag(0);
  };

  const onMediaLaunchTouchMove = (e: React.TouchEvent<HTMLButtonElement>) => {
    const st = mediaLaunchStartRef.current;
    if (!st) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dx = t.clientX - st.x;
    const dy = t.clientY - st.y;
    if (Math.abs(dx) > Math.abs(dy) * 1.2) return;
    const up = Math.max(0, -dy);
    if (up > 0) {
      try { e.preventDefault(); } catch {}
      setMediaLaunchDrag(Math.min(56, up));
    }
  };

  const onMediaLaunchTouchEnd = () => {
    if (mediaLaunchDrag >= 28) {
      try { setMediaSheetOpen(true); } catch {}
    }
    mediaLaunchStartRef.current = null;
    setMediaLaunchDrag(0);
  };

  const backIdRef = React.useRef<string>((() => {
    try { return `mcreate-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; } catch { return `mcreate-${Math.random()}`; }
  })());

  React.useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new Event('freemannotes:editor-modal-open'));
    try {
      const id = backIdRef.current;
      const onBack = () => {
        try {
          const st = overlayStateRef.current;
          if (st.showMore) { setShowMore(false); return; }
          if (st.mediaSheetOpen) { setMediaSheetOpen(false); return; }
          if (st.showImageDialog) { setShowImageDialog(false); return; }
          if (st.showCollaborator) { setShowCollaborator(false); return; }
          if (st.showReminderPicker) { setShowReminderPicker(false); return; }
          if (st.showPalette) { setShowPalette(false); return; }
        } catch {}
        try { discard(); } catch {}
      };
      window.dispatchEvent(new CustomEvent('freemannotes:back/register', { detail: { id, onBack } }));
    } catch {}

    return () => {
      try { window.dispatchEvent(new CustomEvent('freemannotes:back/unregister', { detail: { id: backIdRef.current } })); } catch {}
      window.dispatchEvent(new Event('freemannotes:editor-modal-close'));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    // initialize per-open
    setTitle('');
    setBg('');
    setImageUrls([]);
    setSelectedCollaborators([]);
    setPendingReminder(null);
    setShowPalette(false);
    setShowReminderPicker(false);
    setShowCollaborator(false);
    setShowImageDialog(false);
    setMediaSheetOpen(false);
    setShowMore(false);
    setActiveMediaView('images');

    try { setAddToCurrentCollection(activeCollectionId != null); } catch {}

    if (mode === 'checklist') {
      const firstUid = genUid();
      setItems([{ uid: firstUid, content: '', checked: false, indent: 0 }]);
      // On open: ensure no checklist row starts focused/highlighted.
      setActiveChecklistRowKey(null);
      window.setTimeout(() => {
        try {
          const root = dialogRef.current as HTMLElement | null;
          const active = document.activeElement as HTMLElement | null;
          if (root && active && root.contains(active) && active.closest('.checklist-item')) active.blur();
        } catch {}
        try { document.getSelection()?.removeAllRanges(); } catch {}
      }, 0);
    } else {
      setItems([]);
      setActiveChecklistRowKey(null);
    }

    try { editor?.commands.clearContent(); } catch {}
  }, [open, mode, editor]);

  React.useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      const input = titleInputRef.current;
      if (!input) return;
      try {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
      } catch {}
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, mode]);

  React.useEffect(() => {
    if (!bg) setTextColor(undefined);
    else setTextColor(contrastColorForBackground(bg));
  }, [bg]);

  const [, setToolbarTick] = React.useState(0);
  React.useEffect(() => {
    if (!editor) return;
    const handler = () => setToolbarTick((t) => t + 1);
    editor.on('selectionUpdate', handler);
    editor.on('transaction', handler);
    return () => {
      editor.off('selectionUpdate', handler);
      editor.off('transaction', handler);
    };
  }, [editor]);

  function discard() {
    if (saving) return;
    try { endDragCleanup(); } catch {}
    try { setShowMore(false); } catch {}
    try { setShowPalette(false); } catch {}
    try { setShowReminderPicker(false); } catch {}
    try { setShowCollaborator(false); } catch {}
    try { setShowImageDialog(false); } catch {}
    try { setMediaSheetOpen(false); } catch {}
    try { setShowUrlModal(false); } catch {}
    try { editor?.commands.clearContent(); } catch {}
    try { setTitle(''); setItems([]); setActiveChecklistRowKey(null); setBg(''); setImageUrls([]); setSelectedCollaborators([]); setPendingReminder(null); } catch {}
    try { setPendingLinkUrls([]); } catch {}
    onClose();
  }

  function hasContentToSave(): boolean {
    try {
      if (mode === 'checklist') {
        const hasTitle = !!title.trim();
        const anyItem = getNonEmptyChecklistItems().length > 0;
        return hasTitle || anyItem;
      }

      const hasTitle = !!title.trim();
      const hasText = !!((editor?.getText() || '').trim());
      return hasTitle || hasText;
    } catch {
      return false;
    }
  }

  function stripHtmlToText(html: string): string {
    const raw = String(html || '');
    if (!raw) return '';
    if (raw.indexOf('<') === -1 && raw.indexOf('&') === -1) return raw.replace(/\u00a0/g, ' ').trim();
    try {
      const doc = new DOMParser().parseFromString(raw, 'text/html');
      return String(doc.body?.textContent || '').replace(/\u00a0/g, ' ').trim();
    } catch {
      return raw.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/\u00a0/g, ' ').trim();
    }
  }

  function getNonEmptyChecklistItems() {
    return (items || [])
      .map((it) => ({ uid: String((it as any)?.uid || ''), content: String((it as any)?.content || ''), checked: !!(it as any)?.checked, indent: Number((it as any)?.indent || 0) }))
      .filter((it) => stripHtmlToText(it.content).length > 0);
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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      if (!token) throw new Error('Not authenticated');

      // Discard empty notes/checklists (Google Keep-style).
      if (mode === 'checklist') {
        const filtered = getNonEmptyChecklistItems();
        if (!title.trim() && filtered.length === 0) {
          discard();
          return;
        }
      } else {
        const hasTitle = !!title.trim();
        const hasText = !!((editor?.getText() || '').trim());
        if (!hasTitle && !hasText) {
          discard();
          return;
        }
      }

      const bodyJson = mode === 'text' ? (editor?.getJSON() || {}) : {};
      const payload: any = { title, body: null, type: mode === 'checklist' ? 'CHECKLIST' : 'TEXT', color: bg || null };
      if (mode === 'checklist') {
        const filtered = getNonEmptyChecklistItems();
        payload.items = filtered.map((it, i) => ({ content: it.content, checked: !!it.checked, indent: typeof it.indent === 'number' ? it.indent : 0, ord: i }));
      }
      if (pendingReminder && pendingReminder.dueAtIso) {
        payload.reminderDueAt = pendingReminder.dueAtIso;
        payload.reminderOffsetMinutes = pendingReminder.offsetMinutes;
      }

      const queueCreateForLater = async (message: string) => {
        const tempId = -Math.floor(Date.now() + Math.random() * 1000);
        const opId = await enqueueHttpJsonMutation({
          method: 'POST',
          path: '/api/notes',
          body: payload,
          meta: {
            tempClientNoteId: tempId,
            mode,
            bodyJson,
            pendingLinkUrls,
            addToCurrentCollection,
            activeCollectionId,
            selectedCollaborators: selectedCollaborators.map((u) => String(u?.email || '').trim()).filter((v) => !!v),
            imageUrls,
            imageUrl: (Array.isArray(imageUrls) && imageUrls.length > 0) ? String(imageUrls[0]) : null,
          },
        });
        void kickOfflineSync();

        const optimisticItems = Array.isArray(payload.items)
          ? payload.items.map((it: any, i: number) => ({
              id: -(Math.floor(Date.now() / 10) + i + 1),
              content: String(it?.content || ''),
              checked: !!it?.checked,
              ord: i,
              indent: Number(it?.indent || 0),
            }))
          : [];
        const optimisticCollaborators = (selectedCollaborators || []).map((u: any, i: number) => ({
          id: -(Math.floor(Date.now() / 7) + i + 1),
          userId: Number(u?.id),
          user: {
            id: Number(u?.id),
            email: String(u?.email || ''),
            name: String(u?.email || '').split('@')[0],
          },
        })).filter((c: any) => Number.isFinite(c.userId) && !!String(c?.user?.email || ''));
        const optimisticLinkPreviews = (pendingLinkUrls || []).map((url: string, i: number) => {
          const safe = String(url || '').trim();
          let domain = '';
          try { domain = new URL(safe.startsWith('http') ? safe : `https://${safe}`).hostname.replace(/^www\./i, ''); } catch {}
          return {
            id: -(Math.floor(Date.now() / 9) + i + 1),
            url: safe,
            title: domain || safe,
            description: null,
            imageUrl: null,
            domain: domain || null,
          };
        }).filter((p: any) => !!p.url);
        const optimisticNote: any = {
          id: tempId,
          title: String(title || ''),
          type: mode === 'checklist' ? 'CHECKLIST' : 'TEXT',
          body: mode === 'text' ? JSON.stringify(bodyJson || {}) : null,
          items: optimisticItems,
          collaborators: optimisticCollaborators,
          linkPreviews: optimisticLinkPreviews,
          color: bg || null,
          viewerColor: bg || null,
          images: (imageUrls || []).map((url, i) => ({ id: -(Math.floor(Date.now() / 5) + i + 1), url: String(url) })),
          imagesCount: (imageUrls || []).length,
          pinned: false,
          archived: false,
          trashedAt: null,
          offlinePendingCreate: true,
          offlineOpId: opId,
        };
        try { window.dispatchEvent(new CustomEvent('freemannotes:offline-note-created', { detail: { opId, note: optimisticNote } })); } catch {}

        discard();
        try { onCreated(); } catch {}
        try { window.alert(message); } catch {}
      };

      if (navigator.onLine === false) {
        await queueCreateForLater('You are offline. Note creation has been queued and will sync when online.');
        return;
      }

      let noteId: number | null = null;
      let noteCreatedAt: unknown = null;
      try {
        const res = await fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        noteId = Number(data?.note?.id);
        noteCreatedAt = data?.note?.createdAt ?? null;
      } catch {
        await queueCreateForLater('Network issue. Note creation has been queued and will retry automatically.');
        return;
      }

      if (noteId && pendingLinkUrls.length) {
        for (const url of pendingLinkUrls) {
          try { await requestJsonOrQueue({ method: 'POST', path: `/api/notes/${noteId}/link-preview`, body: { url } }); } catch {}
        }
      }

      if (noteId && addToCurrentCollection && activeCollectionId != null) {
        try {
          const cres = await requestJsonOrQueue({
            method: 'POST',
            path: `/api/notes/${noteId}/collections`,
            body: { collectionId: activeCollectionId },
          });
          if (cres.status === 'failed') throw new Error('Failed to add to collection');
        } catch (e) {
          console.warn('Created note but failed to add to collection', e);
          try { window.alert('Note created, but failed to add it to the current collection.'); } catch {}
        }
      }

      // Seed initial Yjs content for new text notes.
      if (noteId && mode === 'text') {
        try {
          const ydoc = new Y.Doc();
          const room = noteCollabRoom(Number(noteId), noteCreatedAt);
          const provider = new WebsocketProvider(makeWebSocketUrl('/collab'), room, ydoc);
          const tempEditor = new Editor({
            extensions: [
              StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
              TextAlign.configure({ types: ['heading', 'paragraph'] }),
              Collaboration.configure({ document: ydoc }),
            ],
            content: '',
          });
          // Do not block on websocket sync in mobile/PWA create flow.
          // Apply content immediately and allow provider/network to catch up.
          try { tempEditor?.commands.setContent(bodyJson); } catch {}
          await new Promise(r => setTimeout(r, 120));
          try { tempEditor?.destroy(); } catch {}
          try { provider.destroy(); } catch {}
          try { ydoc.destroy(); } catch {}
          try {
            await requestJsonOrQueue({ method: 'PATCH', path: `/api/notes/${noteId}`, body: { body: JSON.stringify(bodyJson), type: 'TEXT' } });
          } catch {}
        } catch (e) {
          console.warn('Failed to seed Yjs content for new note', e);
        }
      }

      if (noteId && selectedCollaborators.length) {
        for (const u of selectedCollaborators) {
          try {
            await requestJsonOrQueue({ method: 'POST', path: `/api/notes/${noteId}/collaborators`, body: { email: u.email } });
          } catch {}
        }
      }

      if (noteId && imageUrls.length) {
        for (const imageUrl of imageUrls) {
          try {
            const res = await fetch(`/api/notes/${noteId}/images`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ url: imageUrl }),
            });
            if (!res.ok) throw new Error(await res.text());
          } catch {
            try {
              await enqueueImageUpload(Number(noteId), String(imageUrl));
              void kickOfflineSync();
            } catch {}
          }
        }
      }

      try { editor?.commands.clearContent(); } catch {}
  try { setPendingLinkUrls([]); } catch {}
      onCreated();
      onClose();
    } catch (err) {
      console.error('Failed to create note', err);
      window.alert('Failed to create note');
    } finally {
      setSaving(false);
    }
  }

  const itemEditorRefs = React.useRef<Array<any | null>>([]);

  // Match ChecklistEditor drag behavior (ghost + shift animations)
  const [dragging, setDragging] = React.useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
  const [previewItems, setPreviewItems] = React.useState<Array<{ uid: string; content: string; checked: boolean; indent: number }> | null>(null);
  const ghostRef = React.useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragDirectionRef = React.useRef<'vertical' | 'horizontal' | null>(null);
  const sourceLeftRef = React.useRef<number>(0);
  const pointerTrackRef = React.useRef<{ active: boolean; startX: number; startY: number; idx: number; pointerId?: number } | null>(null);
  const lastPointerYRef = React.useRef<number>(0);
  const autoScrollRafRef = React.useRef<number | null>(null);
  const autoScrollPointerYRef = React.useRef<number>(0);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);

  const isCoarsePointer = React.useMemo(() => {
    try {
      return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    } catch {
      return false;
    }
  }, []);

  const DRAG = React.useMemo(() => {
    const base = {
      directionLockPx: 0,
      indentPx: 16,
      ghostOverlapUpPct: 0.7,
      ghostOverlapDownPct: 0.7,
    };
    if (isCoarsePointer) return base;
    return { ...base, directionLockPx: 6 };
  }, [isCoarsePointer]);

  function getBlockRange(list: any[], idx: number) {
    const start = idx;
    const baseIndent = Number(list[idx]?.indent || 0);
    let end = idx + 1;
    while (end < list.length && Number(list[end]?.indent || 0) > baseIndent) end++;
    return [start, end] as const;
  }

  function moveBlock(srcStart: number, srcEnd: number, dstIndex: number, indentDelta: number = 0) {
    setItems((s) => {
      const copy = [...(s || [])];
      const block = copy.slice(srcStart, srcEnd);
      copy.splice(srcStart, srcEnd - srcStart);
      let insertAt = dstIndex;
      if (insertAt > srcStart) insertAt = insertAt - (srcEnd - srcStart);
      if (insertAt < 0) insertAt = 0;
      if (insertAt > copy.length) insertAt = copy.length;
      const moved = block.map((it) => ({ ...it, indent: Math.max(0, Number(it.indent || 0) + Number(indentDelta || 0)) }));
      copy.splice(insertAt, 0, ...moved);
      return copy;
    });
  }

  function shiftClassForIndex(realIdx: number, list: any[]) {
    if (dragDirectionRef.current !== 'vertical') return '';
    if (dragging === null) return '';
    const [sStart, sEnd] = getBlockRange(list, dragging);
    if (hoverIndex === null) return '';
    if (realIdx >= sStart && realIdx < sEnd) return '';
    if (dragging < hoverIndex) {
      if (realIdx > (sEnd - 1) && realIdx <= hoverIndex) return 'shift-up';
      return '';
    }
    if (dragging > hoverIndex) {
      if (realIdx >= hoverIndex && realIdx < sStart) return 'shift-down';
      return '';
    }
    return '';
  }

  function startAutoScroll() {
    if (autoScrollRafRef.current != null) return;
    const step = () => {
      autoScrollRafRef.current = null;
      const body = dialogRef.current?.querySelector('.dialog-body') as HTMLElement | null;
      if (!body) return;
      const rect = body.getBoundingClientRect();
      const y = autoScrollPointerYRef.current;
      const margin = 60;
      const speed = 12;
      if (y < rect.top + margin) body.scrollTop -= speed;
      else if (y > rect.bottom - margin) body.scrollTop += speed;
      if (pointerTrackRef.current?.active && dragDirectionRef.current === 'vertical' && ghostRef.current) {
        autoScrollRafRef.current = window.requestAnimationFrame(step);
      }
    };
    autoScrollRafRef.current = window.requestAnimationFrame(step);
  }

  function stopAutoScroll() {
    if (autoScrollRafRef.current != null) {
      window.cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
  }

  function endDragCleanup() {
    stopAutoScroll();
    if (ghostRef.current) {
      try { ghostRef.current.remove(); } catch {}
      ghostRef.current = null;
    }
    try { (dialogRef.current as any)?.style?.removeProperty?.('--checklist-item-shift'); } catch {}
    setDragging(null);
    setHoverIndex(null);
    setPreviewItems(null);
    pointerTrackRef.current = null;
    dragDirectionRef.current = null;
    lastPointerYRef.current = 0;
  }

  function addItem() {
    setItems((cur) => [...(cur || []), { uid: genUid(), content: '', checked: false, indent: 0 }]);
  }

  function updateItem(idx: number, content: string) {
    setItems((cur) => (cur || []).map((it, i) => (i === idx ? { ...it, content } : it)));
  }

  function toggleLocalItemChecked(idx: number) {
    setItems((cur) => {
      const copy = [...(cur || [])];
      const it = copy[idx];
      if (!it) return copy;
      const nextChecked = !it.checked;
      const baseIndent = Number(it.indent || 0);
      copy[idx] = { ...it, checked: nextChecked };
      // match ChecklistEditor: if indent=0, cascade to children
      if (baseIndent === 0) {
        for (let j = idx + 1; j < copy.length; j++) {
          const childIndent = Number(copy[j]?.indent || 0);
          if (childIndent > 0) copy[j] = { ...copy[j], checked: nextChecked };
          else break;
        }
      }
      return copy;
    });
  }

  function focusItem(idx: number) {
    window.setTimeout(() => {
      const ed = itemEditorRefs.current[idx];
      try { ed && ed.chain().focus().run(); } catch {}
    }, 30);
  }

  const activeChecklistEditor = React.useRef<any | null>(null);
  const [, setChecklistToolbarTick] = React.useState(0);

  function getCurrentChecklistEditor(): any | null {
    let ed = activeChecklistEditor.current as any;
    if (ed && (ed as any).isFocused) return ed;
    const selNode = typeof document !== 'undefined' ? (document.getSelection()?.anchorNode || null) : null;
    if (selNode) {
      const bySel = itemEditorRefs.current.find((x) => {
        try { return !!(x && (x as any).view?.dom && (x as any).view.dom.contains(selNode as Node)); } catch { return false; }
      });
      if (bySel) ed = bySel;
    } else {
      const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
      if (activeEl) {
        const byDom = itemEditorRefs.current.find((x) => {
          try { return !!(x && (x as any).view && (x as any).view.dom && ((x as any).view.dom === activeEl || (x as any).view.dom.contains(activeEl))); } catch { return false; }
        });
        if (byDom) ed = byDom;
      }
    }
    if (!ed || !(ed as any)?.isFocused) {
      const focused = itemEditorRefs.current.find((x) => !!(x && (x as any).isFocused));
      if (focused) ed = focused;
    }
    return ed || null;
  }

  function applyChecklistMarkAcrossLine(mark: 'bold' | 'italic' | 'underline') {
    const ed = getCurrentChecklistEditor() as any;
    if (!ed) return;
    const sel: any = ed.state?.selection;
    if (!sel) return;

    if (!sel.empty) {
      const chain = ed.chain().focus();
      if (mark === 'bold') chain.toggleBold();
      else if (mark === 'italic') chain.toggleItalic();
      else chain.toggleUnderline();
      chain.run();
      try { setChecklistToolbarTick((t) => t + 1); } catch {}
      return;
    }

    let from = sel.from;
    let to = sel.to;
    try {
      const $from = sel.$from;
      let depth = $from.depth;
      while (depth > 0 && !$from.node(depth).isBlock) depth--;
      from = $from.start(depth);
      to = $from.end(depth);
    } catch {}

    let hasTextInBlock = false;
    try {
      ed.state.doc.nodesBetween(from, to, (node: any) => {
        if (node?.isText && String(node.text || '').length > 0) hasTextInBlock = true;
      });
    } catch {}

    if (!hasTextInBlock) {
      const chain: any = ed.chain().focus();
      const active = !!ed.isActive(mark);
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
      try { setChecklistToolbarTick((t) => t + 1); } catch {}
      return;
    }

    const chain = ed.chain().focus().setTextSelection({ from, to });
    if (mark === 'bold') chain.toggleBold();
    else if (mark === 'italic') chain.toggleItalic();
    else chain.toggleUnderline();
    chain.run();

    try { ed.chain().focus().setTextSelection(sel.from).run(); } catch {}
    try { setChecklistToolbarTick((t) => t + 1); } catch {}
  }

  function isCurrentLineMarked(mark: 'bold' | 'italic' | 'underline'): boolean {
    const ed = getCurrentChecklistEditor() as any;
    if (!ed) return false;
    const sel: any = ed.state?.selection;
    if (!sel) return false;
    const markType = (ed.schema?.marks || {})[mark];
    if (!markType) return false;
    const $from = sel.$from;
    let depth = $from.depth;
    while (depth > 0 && !$from.node(depth).isBlock) depth--;
    const from = $from.start(depth);
    const to = $from.end(depth);
    let hasText = false;
    let allMarked = true;
    try {
      ed.state.doc.nodesBetween(from, to, (node: any) => {
        if (node && node.isText) {
          hasText = true;
          const hasMark = !!markType.isInSet(node.marks);
          if (!hasMark) allMarked = false;
        }
      });
    } catch {}
    if (!hasText) return !!ed.isActive(mark);
    return hasText && allMarked;
  }

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

  if (!open) return null;

  const dialogStyle: React.CSSProperties = {} as any;
  const titleStripStyle: React.CSSProperties | undefined = bg
    ? {
        background: bg,
        color: textColor || 'inherit',
        borderRadius: 8,
        padding: '8px 10px',
        marginBottom: 8,
      }
    : undefined;

  const label = mode === 'checklist' ? 'New checklist' : 'New note';

  const dialog = (
    <div
      className="image-dialog-backdrop"
      ref={rootRef}
      onMouseDown={(e) => {
        // Fullscreen creation modal: do not close on backdrop click.
        if (e.target === e.currentTarget) {
          try { e.preventDefault(); } catch {}
        }
      }}
    >
      <div
        ref={dialogRef}
        className={`image-dialog editor-dialog maximized${mode === 'checklist' ? ' checklist-editor' : ''}`}
        role="dialog"
        aria-modal
        style={{ width: '100vw', ...dialogStyle }}
      >
        <div className="dialog-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <button className="btn" type="button" onClick={discard} disabled={saving}>Cancel</button>
          <strong>{label}</strong>
          <button className="btn" type="button" onClick={save} disabled={saving || !hasContentToSave()}>{saving ? 'Saving…' : 'Save'}</button>
        </div>

        <div className="dialog-body">
          <div className="editor-scroll-area">
          <UrlEntryModal
            open={showUrlModal}
            title="Add URL preview"
            onCancel={() => setShowUrlModal(false)}
            onSubmit={(url) => {
              setShowUrlModal(false);
              setPendingLinkUrls((cur) => {
                const next = Array.isArray(cur) ? cur.slice() : [];
                if (next.includes(String(url))) return next;
                next.push(String(url));
                return next;
              });
              try {
                setActiveMediaView('urlPreviews');
                setMediaSheetOpen(true);
              } catch {}
            }}
          />

          {mode === 'text' ? (
            <>
              <div className="rt-sticky-header">
                {pendingReminder?.dueAtIso && (() => {
                  const dueMs = Date.parse(String(pendingReminder.dueAtIso));
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
                    ref={titleInputRef}
                    placeholder="Title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    style={{ flex: 1, background: 'transparent', border: 'none', color: 'inherit', fontWeight: 600, fontSize: 18 }}
                  />
                </div>
                <div className="rt-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 0, marginBottom: 0, overflowX: 'auto' }}>
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
                  <button className="tiny" onClick={applyTextLink} aria-label="Add URL preview" title="Add URL preview"><FontAwesomeIcon icon={faLink} /></button>
                </div>
              </div>
              <EditorContent editor={editor} />
            </>
          ) : (
            <>
              <div className="rt-sticky-header">
                {pendingReminder?.dueAtIso && (() => {
                  const dueMs = Date.parse(String(pendingReminder.dueAtIso));
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
                    ref={titleInputRef}
                    placeholder="Title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    style={{ flex: 1, background: 'transparent', border: 'none', color: 'inherit', fontWeight: 600, fontSize: 18 }}
                  />
                </div>
                <div
                  className="rt-toolbar"
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 0, marginBottom: 0, overflowX: 'auto' }}
                  onPointerDown={(e) => e.preventDefault()}
                  onPointerUp={(e) => e.preventDefault()}
                >
                  <button
                    className="tiny"
                    type="button"
                    tabIndex={-1}
                    onPointerDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); skipNextChecklistToolbarClickRef.current = true; applyChecklistMarkAcrossLine('bold'); }}
                    onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onMouseDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onMouseUp={(e) => e.preventDefault()}
                    onClick={() => { if (skipNextChecklistToolbarClickRef.current) { skipNextChecklistToolbarClickRef.current = false; return; } applyChecklistMarkAcrossLine('bold'); }}
                    aria-pressed={isCurrentLineMarked('bold')}
                    aria-label="Bold"
                    title="Bold"
                  >B</button>
                  <button
                    className="tiny"
                    type="button"
                    tabIndex={-1}
                    onPointerDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); skipNextChecklistToolbarClickRef.current = true; applyChecklistMarkAcrossLine('italic'); }}
                    onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onMouseDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onMouseUp={(e) => e.preventDefault()}
                    onClick={() => { if (skipNextChecklistToolbarClickRef.current) { skipNextChecklistToolbarClickRef.current = false; return; } applyChecklistMarkAcrossLine('italic'); }}
                    aria-pressed={isCurrentLineMarked('italic')}
                    aria-label="Italic"
                    title="Italic"
                  >I</button>
                  <button
                    className="tiny"
                    type="button"
                    tabIndex={-1}
                    onPointerDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); skipNextChecklistToolbarClickRef.current = true; applyChecklistMarkAcrossLine('underline'); }}
                    onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onMouseDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onMouseUp={(e) => e.preventDefault()}
                    onClick={() => { if (skipNextChecklistToolbarClickRef.current) { skipNextChecklistToolbarClickRef.current = false; return; } applyChecklistMarkAcrossLine('underline'); }}
                    aria-pressed={isCurrentLineMarked('underline')}
                    aria-label="Underline"
                    title="Underline"
                  >U</button>
                  <button
                    className="tiny"
                    type="button"
                    tabIndex={-1}
                    onPointerDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); skipNextChecklistToolbarClickRef.current = true; applyChecklistLink(); }}
                    onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onMouseDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onMouseUp={(e) => e.preventDefault()}
                    onClick={() => { if (skipNextChecklistToolbarClickRef.current) { skipNextChecklistToolbarClickRef.current = false; return; } applyChecklistLink(); }}
                    aria-label="Add URL preview"
                    title="Add URL preview"
                  ><FontAwesomeIcon icon={faLink} /></button>
                  <button className="btn" type="button" onClick={() => { const newUid = genUid(); setItems((cur) => [...(cur || []), { uid: newUid, content: '', checked: false, indent: 0 }]); setActiveChecklistRowKey(newUid); focusItem(items.length); }} style={{ padding: '6px 10px' }}>Add item</button>
                </div>
              </div>

              <div className="checklist-items">
                {(previewItems ?? items ?? []).map((it, idx) => {
                  const currentList = (previewItems ?? items ?? []);
                  const shiftClass = shiftClassForIndex(idx, currentList);
                  const isActive = activeChecklistRowKey != null && String(activeChecklistRowKey) === String(it.uid);
                  return (
                    <div
                      key={it.uid || String(idx)}
                      className={`checklist-item${isActive ? ' is-active' : ''}${dragging === idx ? ' drag-source' : ''}${shiftClass ? ' ' + shiftClass : ''}`}
                      style={{ marginLeft: Number(it.indent || 0) * 18 }}
                      draggable={false}
                      onClick={(e) => { try { e.stopPropagation(); } catch {} }}
                    >
                      <div
                        className="drag-gutter"
                        style={{ cursor: 'grab', userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none', msUserSelect: 'none', touchAction: 'none' }}
                        onMouseDown={(e) => { e.preventDefault(); }}
                        onPointerDown={(e) => {
                          try { e.preventDefault(); } catch {}
                          try { e.stopPropagation(); } catch {}
                          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                          autoScrollPointerYRef.current = e.clientY;
                          pointerTrackRef.current = { active: true, startX: e.clientX, startY: e.clientY, idx, pointerId: e.pointerId };
                          dragDirectionRef.current = null;
                          setPreviewItems(null);
                        }}
                        onPointerMove={(e) => {
                          const p = pointerTrackRef.current;
                          if (!p || !p.active) return;
                          try { e.preventDefault(); } catch {}
                          autoScrollPointerYRef.current = e.clientY;
                          const dx = e.clientX - p.startX;
                          const dy = e.clientY - p.startY;
                          const TH = DRAG.directionLockPx;
                          if (dragDirectionRef.current === null && (Math.abs(dx) > TH || Math.abs(dy) > TH)) {
                            dragDirectionRef.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
                          }

                          if (dragDirectionRef.current === 'vertical') {
                            const srcIdx = p.idx;
                            if (!ghostRef.current) {
                              const nodes = Array.from(dialogRef.current?.querySelectorAll('.checklist-item') || []) as HTMLElement[];
                              const srcEl = nodes[srcIdx];
                              if (srcEl) {
                                const rect = srcEl.getBoundingClientRect();
                                dragOffsetRef.current = { x: (e.clientX - rect.left), y: (e.clientY - rect.top) };
                                const ghost = srcEl.cloneNode(true) as HTMLElement;
                                ghost.style.position = 'fixed';
                                ghost.style.left = rect.left + 'px';
                                ghost.style.top = (e.clientY - (dragOffsetRef.current.y || 0)) + 'px';
                                ghost.style.width = rect.width + 'px';
                                ghost.style.pointerEvents = 'none';
                                ghost.style.zIndex = '9999';
                                ghost.style.opacity = '0.98';
                                ghost.classList.add('checklist-ghost');
                                document.body.appendChild(ghost);
                                ghostRef.current = ghost as HTMLDivElement;
                                setDragging(srcIdx);
                                setHoverIndex(srcIdx);
                                sourceLeftRef.current = rect.left;
                                try { (dialogRef.current as any)?.style?.setProperty?.('--checklist-item-shift', `${Math.round(rect.height)}px`); } catch {}
                              }
                            }
                            if (ghostRef.current) {
                              ghostRef.current.style.left = sourceLeftRef.current + 'px';
                              ghostRef.current.style.top = (e.clientY - (dragOffsetRef.current.y || 0)) + 'px';
                              startAutoScroll();
                            }

                            const nodes = Array.from(dialogRef.current?.querySelectorAll('.checklist-item') || []) as HTMLElement[];
                            if (nodes.length) {
                              let chosenDomIdx: number | null = null;
                              const ghostRect = ghostRef.current ? ghostRef.current.getBoundingClientRect() : { top: e.clientY - 10, bottom: e.clientY + 10 } as any;
                              const ghostCenterY = ((ghostRect.top + ghostRect.bottom) / 2);
                              const movingDown = ghostCenterY >= (lastPointerYRef.current || ghostCenterY);
                              lastPointerYRef.current = ghostCenterY;
                              const ghostH = Math.max(1, (ghostRect.bottom - ghostRect.top));
                              const refY = movingDown
                                ? (ghostRect.bottom - ghostH * 0.25)
                                : (ghostRect.top + ghostH * 0.25);
                              for (let i = 0; i < nodes.length; i++) {
                                const r = nodes[i].getBoundingClientRect();
                                const centerY = (r.top + r.bottom) / 2;
                                if (refY < centerY) { chosenDomIdx = i; break; }
                                chosenDomIdx = i;
                              }
                              if (chosenDomIdx != null && chosenDomIdx !== hoverIndex) setHoverIndex(chosenDomIdx);
                            }
                            return;
                          }

                          const INDENT_TH = DRAG.indentPx;
                          if (dragDirectionRef.current === 'horizontal') {
                            const src = p.idx;
                            if (src === 0 && dx > 0) { setPreviewItems(null); return; }
                            const current = items;
                            if (dx > INDENT_TH) {
                              const [bStart, bEnd] = getBlockRange(current, src);
                              const copy = [...current];
                              const block = copy.splice(bStart, bEnd - bStart);
                              let parentIdx: number | null = null;
                              for (let j = src - 1; j >= 0; j--) { if (Number(current[j]?.indent || 0) === 0) { parentIdx = j; break; } }
                              if (parentIdx != null) {
                                const parentUid = current[parentIdx].uid;
                                const foundParentIdx = copy.findIndex(x => x.uid === parentUid);
                                let insertAt = foundParentIdx >= 0 ? foundParentIdx + 1 : Math.min(bStart, copy.length);
                                while (insertAt < copy.length && Number(copy[insertAt]?.indent || 0) > 0) insertAt++;
                                const inc = block.map(it2 => ({ ...it2, indent: 1 }));
                                copy.splice(insertAt, 0, ...inc);
                              } else {
                                let insertAt = Math.min(bStart, copy.length);
                                while (insertAt < copy.length && Number(copy[insertAt]?.indent || 0) > 0) insertAt++;
                                const inc = block.map(it2 => ({ ...it2, indent: 1 }));
                                copy.splice(insertAt, 0, ...inc);
                              }
                              setPreviewItems(copy);
                            } else if (dx < -INDENT_TH) {
                              const [bStart, bEnd] = getBlockRange(current, src);
                              const copy = [...current];
                              for (let i = bStart; i < bEnd && i < copy.length; i++) copy[i] = { ...copy[i], indent: Math.max(0, Number(copy[i].indent || 0) - 1) };
                              setPreviewItems(copy);
                            } else {
                              setPreviewItems(null);
                            }
                          } else {
                            stopAutoScroll();
                          }
                        }}
                        onPointerUp={(e) => {
                          try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
                          pointerTrackRef.current = null;
                          if (previewItems) {
                            setItems(previewItems);
                            setPreviewItems(null);
                            dragDirectionRef.current = null;
                            endDragCleanup();
                            return;
                          }
                          if (dragDirectionRef.current === 'vertical' && dragging !== null) {
                            const srcIdx = dragging;
                            const current = items;
                            const [sStart, sEnd] = getBlockRange(current, srcIdx);
                            if (hoverIndex !== null) {
                              const dstIdx = srcIdx < hoverIndex ? hoverIndex + 1 : hoverIndex;
                              if (!(dstIdx >= sStart && dstIdx < sEnd)) {
                                const len = Math.max(0, sEnd - sStart);
                                const firstIndent = Number(current?.[sStart]?.indent || 0);
                                let insertAt = dstIdx;
                                if (insertAt > sStart) insertAt = insertAt - len;
                                const baseWithout = current.slice();
                                baseWithout.splice(sStart, len);
                                const prevIndent = insertAt > 0 ? Number(baseWithout?.[insertAt - 1]?.indent || 0) : 0;
                                const nextIndent = insertAt < baseWithout.length ? Number(baseWithout?.[insertAt]?.indent || 0) : 0;
                                const desiredIndent = nextIndent > prevIndent ? nextIndent : prevIndent;
                                const indentDelta = desiredIndent - firstIndent;
                                moveBlock(sStart, sEnd, dstIdx, indentDelta);
                              }
                            }
                          }
                          dragDirectionRef.current = null;
                          endDragCleanup();
                        }}
                      >
                        <div className="drag-handle" aria-hidden />
                        <div
                          className={`checkbox-visual ${it.checked ? 'checked' : ''}`}
                          onClick={(e) => { e.stopPropagation(); toggleLocalItemChecked(idx); }}
                          onPointerDown={(e) => { e.stopPropagation(); }}
                          onPointerUp={(e) => { e.stopPropagation(); }}
                        >
                          {it.checked && (
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
                              <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <ChecklistItemRT
                          value={it.content}
                          onChange={(html) => updateItem(idx, html)}
                          onRequestUrlPreview={() => { try { setShowUrlModal(true); } catch {} }}
                          onEnter={() => {
                            const newUid = genUid();
                            try { setActiveChecklistRowKey(newUid); } catch {}
                            setItems((cur) => {
                              const copy = [...(cur || [])];
                              copy.splice(idx + 1, 0, { uid: newUid, content: '', checked: false, indent: Number(it.indent || 0) });
                              return copy;
                            });
                            focusItem(idx + 1);
                          }}
                          onArrowUp={() => focusItem(Math.max(0, idx - 1))}
                          onArrowDown={() => focusItem(Math.min(items.length - 1, idx + 1))}
                          onBackspaceEmpty={() => {
                            if (idx > 0) {
                              try { setActiveChecklistRowKey(items[idx - 1]?.uid || null); } catch {}
                              setItems((cur) => { const copy = [...(cur || [])]; copy.splice(idx, 1); return copy; });
                              focusItem(idx - 1);
                            }
                          }}
                          onFocus={(ed: any) => {
                            activeChecklistEditor.current = ed;
                            itemEditorRefs.current[idx] = ed;
                            try {
                              // ChecklistItemRT calls `onFocus` once on mount to register refs.
                              // Only treat it as an active/highlighted row when actually focused.
                              if ((ed as any)?.isFocused) setActiveChecklistRowKey(it.uid);
                            } catch {}
                            try { setChecklistToolbarTick(t => t + 1); } catch {}
                          }}
                          placeholder={''}
                          autoFocus={false}
                        />
                      </div>

                      <button
                        className="delete-item"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setItems((cur) => {
                            const next = (cur || []).filter((_, i) => i !== idx);
                            if (next.length === 0) {
                              activeChecklistEditor.current = null;
                              itemEditorRefs.current = [];
                              try { setActiveChecklistRowKey(null); } catch {}
                              return next;
                            }
                            const focusIdx = Math.max(0, Math.min(idx - 1, next.length - 1));
                            try { setActiveChecklistRowKey(next[focusIdx]?.uid || null); } catch {}
                            window.setTimeout(() => focusItem(focusIdx), 30);
                            return next;
                          });
                        }}
                        aria-label="Delete item"
                        title="Delete item"
                      >✕</button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          </div>
        </div>

        <div className="dialog-footer" style={{ display: 'block' }}>
          {!!activeCollectionId && !!activeCollectionPath && (
            <label className="create-collection-toggle" title={activeCollectionPath} style={{ margin: '0 0 10px' }}>
              <input
                type="checkbox"
                checked={!!addToCurrentCollection}
                onChange={(e) => setAddToCurrentCollection(!!e.target.checked)}
              />
              <span className="create-collection-toggle__text">Add to current collection:</span>
              <span className="create-collection-toggle__path">{activeCollectionPath}</span>
            </label>
          )}

          <div className="note-actions" style={{ display: 'inline-flex', gap: 8, justifyContent: 'flex-start' }}>
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
            {hasMedia && (
              <button
                className="tiny media-launch-btn"
                type="button"
                onClick={() => setMediaSheetOpen((v) => !v)}
                aria-label="Open media"
                title="Open media"
                aria-pressed={mediaSheetOpen}
              >
                {`Media (${imageUrls.length + pendingLinkUrls.length})`}
              </button>
            )}
            <button
              ref={moreBtnRef}
              className="tiny editor-more"
              onClick={(e) => { e.stopPropagation(); setShowMore(s => !s); }}
              aria-label="More"
              title="More"
            >⋮</button>
          </div>
        </div>
      </div>

      {hasMedia && (
        <div className="media-launch-strip media-launch-strip--outside-footer">
          <button
            type="button"
            className="media-launch-handle"
            onClick={() => setMediaSheetOpen((v) => !v)}
            onTouchStart={onMediaLaunchTouchStart}
            onTouchMove={onMediaLaunchTouchMove}
            onTouchEnd={onMediaLaunchTouchEnd}
            onTouchCancel={onMediaLaunchTouchEnd}
            style={{ transform: mediaLaunchDrag > 0 ? `translateY(${-Math.round(Math.min(24, mediaLaunchDrag * 0.35))}px)` : undefined }}
            aria-label="Media"
            title="Drag up for media"
            aria-pressed={mediaSheetOpen}
          >
            <span className="media-launch-handle__bar" aria-hidden="true" />
            <span className="media-launch-handle__label">Media</span>
          </button>
        </div>
      )}

      {showPalette && <ColorPalette anchorRef={rootRef as any} onPick={(c) => { setBg(c); }} onClose={() => setShowPalette(false)} />}
      {showReminderPicker && (
        <ReminderPicker
          onClose={() => setShowReminderPicker(false)}
          onConfirm={(draft) => {
            setShowReminderPicker(false);
            try {
              if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
                Notification.requestPermission();
              }
            } catch {}
            setPendingReminder(draft);
          }}
          onClear={pendingReminder ? (() => setPendingReminder(null)) : undefined}
          initialDueAtIso={pendingReminder?.dueAtIso || null}
          initialOffsetMinutes={typeof pendingReminder?.offsetMinutes === 'number' ? pendingReminder.offsetMinutes : null}
        />
      )}
      {showCollaborator && (
        <CollaboratorModal
          onClose={() => setShowCollaborator(false)}
          onSelect={(u) => { setSelectedCollaborators((s) => (s.find(x => x.id === u.id) ? s : [...s, u])); setShowCollaborator(false); }}
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
      {showImageDialog && (
        <ImageDialog
          onClose={() => setShowImageDialog(false)}
          onAdd={(url) => {
            setImageUrls((cur) => {
              const next = Array.isArray(cur) ? cur.slice() : [];
              const val = String(url || '').trim();
              if (!val || next.includes(val)) return next;
              next.push(val);
              return next;
            });
            try {
              setActiveMediaView('images');
              setMediaSheetOpen(true);
            } catch {}
          }}
          onAddMany={(urls) => {
            setImageUrls((cur) => {
              const next = new Set(Array.isArray(cur) ? cur.map((u) => String(u || '').trim()).filter((u) => !!u) : []);
              for (const url of (Array.isArray(urls) ? urls : [])) {
                const val = String(url || '').trim();
                if (val) next.add(val);
              }
              return Array.from(next);
            });
            try {
              setActiveMediaView('images');
              setMediaSheetOpen(true);
            } catch {}
          }}
        />
      )}

      <MediaSheet
        open={mediaSheetOpen && hasMedia}
        onClose={() => setMediaSheetOpen(false)}
        activeView={activeMediaView}
        onChangeView={setActiveMediaView}
        imageCount={imageUrls.length}
        urlPreviewCount={pendingLinkUrls.length}
      >
        {{
          images: (
            imageUrls.length > 0 ? (
              <div className="editor-images-grid media-sheet-images-grid">
                {imageUrls.map((url, idx) => (
                  <div key={`${url}-${idx}`} className="note-image" style={{ position: 'relative' }}>
                    <img src={url} alt="selected" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                    <button
                      className="image-delete media-image-delete"
                      type="button"
                      aria-label="Remove image"
                      title="Remove image"
                      style={{ position: 'absolute', right: 6, bottom: 6 }}
                      onClick={() => setImageUrls((cur) => (cur || []).filter((_, i) => i !== idx))}
                    >
                      <FontAwesomeIcon icon={faTrashCan} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="media-sheet-empty">No images yet.</div>
            )
          ),
          urlPreviews: (
            pendingLinkUrls.length > 0 ? (
              <div className="note-link-previews media-sheet-link-previews" style={{ marginBottom: 0 }}>
                {pendingLinkUrls.map((u) => {
                  const domain = (() => { try { return new URL(u).hostname.replace(/^www\./i, ''); } catch { return ''; } })();
                  return (
                    <div key={u} className="link-preview-row editor-link-preview" style={{ alignItems: 'center' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{domain || u}</div>
                        <div style={{ fontSize: 12, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u}</div>
                      </div>
                      <button className="tiny" type="button" onClick={() => setPendingLinkUrls((cur) => (cur || []).filter((x) => x !== u))} aria-label="Remove URL" title="Remove URL">✕</button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="media-sheet-empty">No URL previews yet.</div>
            )
          ),
        }}
      </MediaSheet>

      {showMore && (
        <CreateMoreMenu
          anchorRef={moreBtnRef as any}
          onClose={() => setShowMore(false)}
          onDiscard={discard}
        />
      )}
    </div>
  );

  return createPortal(dialog, document.body);
}
