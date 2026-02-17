import React, { useState, useRef, useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
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
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLink, faPalette } from '@fortawesome/free-solid-svg-icons';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import UrlEntryModal from './UrlEntryModal';
import { enqueueHttpJsonMutation, enqueueImageUpload, kickOfflineSync } from '../lib/offline';
import { noteCollabRoom } from '../lib/collabRoom';

export default function TakeNoteBar({
  onCreated,
  openRequest,
  activeCollection,
}: {
  onCreated?: () => void;
  openRequest?: { nonce: number; mode: 'text' | 'checklist' };
  activeCollection?: { id: number; path: string } | null;
}): JSX.Element {
  const { token, user } = useAuth();

  const CHECKLIST_DRAG = {
    directionLockPx: 7,
    indentPx: 34,
    maxIndent: 8,
  } as const;

  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<'text' | 'checklist'>('text');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [maximized, setMaximized] = useState(false);
  const [pendingLinkUrls, setPendingLinkUrls] = useState<string[]>([]);
  const [showUrlModal, setShowUrlModal] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Underline,
      Link.configure({ openOnClick: true, autolink: true }),
      Extension.create({
        name: 'paragraphEnterFix',
        priority: 1000,
        addKeyboardShortcuts() {
          return {
            'Shift-Enter': () => { const e = this.editor; e.commands.splitBlock(); e.commands.setParagraph(); return true; },
            'Mod-Enter': () => { const e = this.editor; e.commands.splitBlock(); e.commands.setParagraph(); return true; },
          };
        },
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'rt-editor',
      },
    },
  });

  function applyTextLink() {
    try { ignoreNextDocClickRef.current = true; } catch {}
    try { setShowUrlModal(true); } catch {}
  }

  function applyChecklistLink() {
    try { ignoreNextDocClickRef.current = true; } catch {}
    try { setShowUrlModal(true); } catch {}
  }

  function shouldFullscreenOnMobile(): boolean {
    try {
      const mq = window.matchMedia;
      if (!mq) return false;
      const touchLike = mq('(pointer: coarse)').matches || mq('(any-pointer: coarse)').matches;
      const small = mq('(max-width: 720px)').matches;
      return !!(touchLike && small);
    } catch {
      return false;
    }
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

  const backIdRef = useRef<string>('');
  if (!backIdRef.current) {
    try {
      backIdRef.current = `take-note-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    } catch {
      backIdRef.current = `take-note-${Math.random()}`;
    }
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

  const ignoreNextDocClickRef = useRef(false);
  const lastExternalOpenRef = useRef(0);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const activeCollectionId = (activeCollection && Number.isFinite(Number(activeCollection.id))) ? Number(activeCollection.id) : null;
  const activeCollectionPath = (activeCollection && typeof activeCollection.path === 'string') ? String(activeCollection.path) : '';
  const [addToCurrentCollection, setAddToCurrentCollection] = useState(false);

  useEffect(() => {
    const nonce = Number(openRequest?.nonce || 0);
    if (!nonce) return;
    if (nonce === lastExternalOpenRef.current) return;
    lastExternalOpenRef.current = nonce;

    const nextMode = openRequest?.mode || 'text';
    setMode(nextMode);
    try { ignoreNextDocClickRef.current = true; } catch {}
    try { setAddToCurrentCollection(activeCollectionId != null); } catch {}
    setExpanded(true);
    setMaximized(shouldFullscreenOnMobile());

    if (nextMode === 'checklist') {
      setItems((cur) => (cur && cur.length ? cur : [{ content: '', indent: 0 }]));
      // On open: ensure no checklist row starts focused/highlighted.
      try { setActiveChecklistRowIdx(null); } catch {}
      requestAnimationFrame(() => {
        try {
          const active = document.activeElement as HTMLElement | null;
          if (active && active.closest('.checklist-item')) active.blur();
        } catch {}
        try {
          const active = document.activeElement as HTMLElement | null;
          if (active && active.closest('.checklist-item')) document.getSelection()?.removeAllRanges();
        } catch {}
      });
    } else {
      try { setActiveChecklistRowIdx(null); } catch {}
    }
  }, [openRequest?.nonce, openRequest?.mode, editor]);

  // When opening checklist mode, clear any lingering focus/selection on items.
  useEffect(() => {
    if (!expanded) return;
    if (mode !== 'checklist') return;
    const id = window.setTimeout(() => {
      try {
        const root = rootRef.current as HTMLElement | null;
        const active = document.activeElement as HTMLElement | null;
        if (root && active && root.contains(active) && active.closest('.checklist-item')) {
          active.blur();
          try { document.getSelection()?.removeAllRanges(); } catch {}
        }
      } catch {}
      try { setActiveChecklistRowIdx(null); } catch {}
    }, 0);
    return () => window.clearTimeout(id);
  }, [expanded, mode]);

  // Treat the expanded create editor like a modal: disable background interactions
  // and hook the mobile Back button to close it instead of exiting.
  const modalDepthRef = useRef(false);
  useEffect(() => {
    try {
      if (expanded && !modalDepthRef.current) {
        modalDepthRef.current = true;
        window.dispatchEvent(new Event('freemannotes:editor-modal-open'));
      }
      if (!expanded && modalDepthRef.current) {
        modalDepthRef.current = false;
        window.dispatchEvent(new Event('freemannotes:editor-modal-close'));
      }
    } catch {}
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const id = backIdRef.current;
    const onBack = () => {
      try {
        const st = overlayStateRef.current;
        if (st.showImageDialog) { setShowImageDialog(false); return; }
        if (st.showCollaborator) { setShowCollaborator(false); return; }
        if (st.showReminderPicker) { setShowReminderPicker(false); return; }
        if (st.showPalette) { setShowPalette(false); return; }
      } catch {}
      try {
        // Discard on Back (do not create notes unless user explicitly clicks Save)
        discardAndClose();
      } catch {
        try { discardAndClose(); } catch {}
      }
    };

    try {
      window.dispatchEvent(new CustomEvent('freemannotes:back/register', { detail: { id, onBack } }));
    } catch {}
    return () => {
      try { window.dispatchEvent(new CustomEvent('freemannotes:back/unregister', { detail: { id } })); } catch {}
    };
  }, [expanded]);

  const [items, setItems] = useState<{ content: string; checked?: boolean; indent?: number }[]>([]);
  const [activeChecklistRowIdx, setActiveChecklistRowIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const draggingIdx = useRef<number | null>(null);
  const [checklistDragging, setChecklistDragging] = useState<number | null>(null);
  const [checklistHoverIndex, setChecklistHoverIndex] = useState<number | null>(null);
  const [checklistHoverEdge, setChecklistHoverEdge] = useState<'top' | 'bottom' | null>(null);
  const [checklistHiddenDragChildIndices, setChecklistHiddenDragChildIndices] = useState<number[]>([]);
  const checklistHiddenDragChildSet = React.useMemo(() => new Set(checklistHiddenDragChildIndices), [checklistHiddenDragChildIndices]);
  const checklistHiddenDragChildSetRef = useRef<Set<number>>(new Set());
  const checklistGhostRef = useRef<HTMLDivElement | null>(null);
  const checklistDocDragOverRef = useRef<((e: DragEvent) => void) | null>(null);
  const checklistDragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const checklistDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const checklistDragDirectionRef = useRef<'horizontal' | 'vertical' | null>(null);
  const checklistSourceLeftRef = useRef<number>(0);
  const checklistSourceTopRef = useRef<number>(0);
  const checklistLastDragYRef = useRef<number>(0);
  const checklistRafRef = useRef<number | null>(null);
  const checklistClearHoverTimeoutRef = useRef<number | null>(null);
  const transparentDragImgRef = useRef<HTMLImageElement | null>(null);
  const activeChecklistEditor = useRef<any | null>(null);
  const itemEditorRefs = useRef<Array<any | null>>([]);
  const [, setChecklistToolbarTick] = useState(0);
  const skipNextChecklistToolbarClickRef = useRef(false);
  const [bg, setBg] = useState<string>('');
  const [textColor, setTextColor] = useState<string | undefined>(undefined);
  const [showPalette, setShowPalette] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [pendingReminder, setPendingReminder] = useState<ReminderDraft | null>(null);
  const [showCollaborator, setShowCollaborator] = useState(false);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [selectedCollaborators, setSelectedCollaborators] = useState<Array<{id:number;email:string}>>([]);

  useEffect(() => {
    checklistHiddenDragChildSetRef.current = new Set(checklistHiddenDragChildIndices);
  }, [checklistHiddenDragChildIndices]);

  const overlayStateRef = useRef({
    showPalette: false,
    showReminderPicker: false,
    showCollaborator: false,
    showImageDialog: false,
  });
  useEffect(() => {
    overlayStateRef.current = {
      showPalette,
      showReminderPicker,
      showCollaborator,
      showImageDialog,
    };
  }, [showPalette, showReminderPicker, showCollaborator, showImageDialog]);

  useEffect(() => {
    // Used to hide the browser-native drag image so only our custom ghost is visible.
    try {
      if (transparentDragImgRef.current) return;
      const img = new Image();
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
      transparentDragImgRef.current = img;
    } catch {}
  }, []);

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

  function cleanupChecklistDrag() {
    try { if (checklistGhostRef.current) { checklistGhostRef.current.remove(); checklistGhostRef.current = null; } } catch {}
    try { if (checklistDocDragOverRef.current) { document.removeEventListener('dragover', checklistDocDragOverRef.current as any); checklistDocDragOverRef.current = null; } } catch {}
    try { document.querySelectorAll('.checklist-item.drag-source').forEach(el => el.classList.remove('drag-source')); } catch {}
    try { if (checklistRafRef.current) { cancelAnimationFrame(checklistRafRef.current); checklistRafRef.current = null; } } catch {}
    try { if (checklistClearHoverTimeoutRef.current) { clearTimeout(checklistClearHoverTimeoutRef.current); checklistClearHoverTimeoutRef.current = null; } } catch {}
    try { checklistDragOffsetRef.current = null; } catch {}
    try { checklistDragStartRef.current = null; } catch {}
    try { checklistDragDirectionRef.current = null; } catch {}
    try { draggingIdx.current = null; } catch {}
    try { setChecklistDragging(null); } catch {}
    try { setChecklistHoverIndex(null); } catch {}
    try { setChecklistHoverEdge(null); } catch {}
    try { setChecklistHiddenDragChildIndices([]); } catch {}
    try { checklistHiddenDragChildSetRef.current = new Set(); } catch {}

    // After a drag, clear focus/selection so no item stays highlighted.
    try { setActiveChecklistRowIdx(null); } catch {}
    try {
      const ed: any = getCurrentChecklistEditor();
      if (ed?.commands?.blur) ed.commands.blur();
      else if (ed?.view?.dom) (ed.view.dom as HTMLElement).blur();
    } catch {}
    try { (document.activeElement as HTMLElement | null)?.blur(); } catch {}
    try { document.getSelection()?.removeAllRanges(); } catch {}
    try { activeChecklistEditor.current = null; } catch {}
    try { setChecklistToolbarTick((t) => t + 1); } catch {}

    try { (rootRef.current as any)?.style?.removeProperty?.('--checklist-item-shift'); } catch {}
    try { (rootRef.current as HTMLElement | null)?.classList?.remove?.('is-dragging'); } catch {}
  }

  function applyChecklistMarkAcrossLine(mark: 'bold' | 'italic' | 'underline') {
    const ed = getCurrentChecklistEditor() as any;
    if (!ed) return;
    const sel: any = ed.state?.selection;
    if (!sel || !sel.empty) {
      const chain = ed.chain().focus();
      if (mark === 'bold') chain.toggleBold().run();
      else if (mark === 'italic') chain.toggleItalic().run();
      else chain.toggleUnderline().run();
      try { setChecklistToolbarTick(t => t + 1); } catch {}
      try {
        const restorePos = sel?.from;
        requestAnimationFrame(() => {
          try {
            const ch = ed.chain().focus();
            if (typeof restorePos === 'number') ch.setTextSelection(restorePos);
            ch.run();
          } catch {}
        });
      } catch {}
      return;
    }
    const $from = sel.$from; let depth = $from.depth; while (depth > 0 && !$from.node(depth).isBlock) depth--;
    const from = $from.start(depth); const to = $from.end(depth);

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
      try { setChecklistToolbarTick(t => t + 1); } catch {}
      return;
    }

    const chain = ed.chain().focus().setTextSelection({ from, to });
    if (mark === 'bold') chain.toggleBold().run();
    else if (mark === 'italic') chain.toggleItalic().run();
    else chain.toggleUnderline().run();
    try { ed.chain().focus().setTextSelection(sel.from).run(); } catch {}
    try {
      const restorePos = sel.from;
      requestAnimationFrame(() => {
        try {
          try { (ed as any).view?.focus?.(); } catch {}
          ed.chain().focus().setTextSelection(restorePos).run();
        } catch {}
      });
    } catch {}
    try { setChecklistToolbarTick(t => t + 1); } catch {}
  }

  function isCurrentLineMarked(mark: 'bold' | 'italic' | 'underline'): boolean {
    const ed = getCurrentChecklistEditor() as any;
    if (!ed) return false;
    const sel: any = ed.state?.selection;
    if (!sel) return false;
    const markType = (ed.schema?.marks || {})[mark];
    if (!markType) return false;
    const $from = sel.$from; let depth = $from.depth; while (depth > 0 && !$from.node(depth).isBlock) depth--; const from = $from.start(depth); const to = $from.end(depth);
    let hasText = false; let allMarked = true;
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

  function stripHtmlToText(html: string): string {
    const raw = String(html || '');
    if (!raw) return '';
    // Fast path for plain text.
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
      .map((it) => ({ content: String(it?.content || ''), checked: !!it?.checked, indent: (typeof it?.indent === 'number' ? Number(it.indent) : 0) }))
      .filter((it) => stripHtmlToText(it.content).length > 0);
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

  function discardAndClose() {
    try { setExpanded(false); } catch {}
    try { setMaximized(false); } catch {}
    try { setShowPalette(false); } catch {}
    try { setShowReminderPicker(false); } catch {}
    try { setShowCollaborator(false); } catch {}
    try { setShowImageDialog(false); } catch {}
    try { setShowUrlModal(false); } catch {}
    try { setTitle(''); setBody(''); setItems([]); setActiveChecklistRowIdx(null); setBg(''); setImageUrls([]); setSelectedCollaborators([]); setPendingReminder(null); } catch {}
    try { setPendingLinkUrls([]); } catch {}
    try { editor?.commands.clearContent(); } catch {}
  }

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!expanded) return;
      // When opening, the click target can be removed during the same click event,
      // causing composedPath/contains checks to fail and immediately closing.
      if (ignoreNextDocClickRef.current) {
        ignoreNextDocClickRef.current = false;
        return;
      }
      // If an inner control intentionally prevented default (e.g. formatting buttons,
      // empty-state actions), don't treat it as a click-away.
      if (e.defaultPrevented) return;
      const el = rootRef.current;
      if (!el) return;
      // Ignore clicks inside any overlay/popover elements so the creation dialog stays open
      const t = e.target as Node;
      const inPalette = document.querySelector('.palette-popover')?.contains(t);
      const inReminder = document.querySelector('.reminder-popover')?.contains(t);
      const inCollab = document.querySelector('.collab-modal')?.contains(t);
      const inImageDlg = document.querySelector('.image-dialog')?.contains(t);
      const inUrlModal = document.querySelector('.url-entry-dialog')?.contains(t) || document.querySelector('.url-entry-backdrop')?.contains(t);
      if (inPalette || inReminder || inCollab || inImageDlg || inUrlModal) return;

      // Prefer composedPath: it's resilient even if the click target is removed
      // during the same event (e.g. state updates that replace the button).
      try {
        const path = (e.composedPath?.() || []) as unknown[];
        if (path.includes(el)) return;
      } catch {}

      if (e.target instanceof Node && el.contains(e.target)) return;

      // Discard on click-away (do not create notes unless user explicitly clicks Save)
      discardAndClose();
    }

    function onKey(e: KeyboardEvent) {
      if (!expanded) return;
      if (e.key === 'Escape') {
        discardAndClose();
      }
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
      setTextColor(undefined);
    } else {
      setTextColor(contrastColorForBackground(bg));
    }
  }, [bg]);

  function addItem() {
    setItems(s => {
      const next = [...s, { content: '', indent: 0 }];
      return next;
    });
  }

  function updateItem(idx: number, content: string) {
    setItems(s => s.map((it, i) => i === idx ? { ...it, content } : it));
  }

  function toggleLocalItemChecked(idx: number) {
    setItems(s => s.map((it, i) => i === idx ? { ...it, checked: !it.checked } : it));
    clearChecklistRowSelectionState();
  }

  function clearChecklistRowSelectionState() {
    const clearOnce = () => {
      try { setActiveChecklistRowIdx(null); } catch {}
      try {
        const ed: any = activeChecklistEditor.current;
        if (ed?.commands?.blur) ed.commands.blur();
        else if (ed?.view?.dom) (ed.view.dom as HTMLElement).blur();
      } catch {}
      try {
        const root = rootRef.current as HTMLElement | null;
        const active = document.activeElement as HTMLElement | null;
        if (active && (!root || root.contains(active)) && active.closest('.checklist-item')) {
          active.blur();
        }
      } catch {}
      try { document.getSelection()?.removeAllRanges(); } catch {}
      try { activeChecklistEditor.current = null; } catch {}
      try { setChecklistToolbarTick((t) => t + 1); } catch {}
    };
    clearOnce();
    try { window.setTimeout(clearOnce, 0); } catch {}
  }

  function focusItem(idx: number) {
    // Slight delay to allow newly inserted item to mount and register its editor ref
    setTimeout(() => {
      const ed = itemEditorRefs.current[idx];
      try { ed && ed.chain().focus().run(); } catch {}
    }, 30);
  }

  function getChecklistBlockRange(list: Array<{ content: string; indent?: number; checked?: boolean }>, idx: number) {
    const start = idx;
    const baseIndent = Number(list[idx]?.indent || 0);
    let end = idx + 1;
    while (end < list.length && Number(list[end]?.indent || 0) > baseIndent) end++;
    return [start, end] as const;
  }

  function moveChecklistBlock(
    srcStart: number,
    srcEnd: number,
    dstIndex: number,
    indentDelta: number = 0,
  ) {
    setItems((s) => {
      const copy = [...s];
      const block = copy.slice(srcStart, srcEnd).map((it) => ({
        ...it,
        indent: Math.max(0, Number((it as any).indent || 0) + Number(indentDelta || 0)),
      }));
      copy.splice(srcStart, srcEnd - srcStart);
      let insertAt = dstIndex;
      if (insertAt > srcStart) insertAt = insertAt - (srcEnd - srcStart);
      if (insertAt < 0) insertAt = 0;
      if (insertAt > copy.length) insertAt = copy.length;
      copy.splice(insertAt, 0, ...block);
      return copy;
    });
  }

  function vibrateDragStart(ms: number = 10) {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(Math.max(1, Number(ms || 10)));
      }
    } catch {}
  }

  function getChecklistHitTestEdge(inputY: number, rect: { top: number; bottom: number }, multilineDeadZone: boolean): 'top' | 'bottom' | null {
    const h = Math.max(1, Number(rect.bottom - rect.top));
    const rel = Math.max(0, Math.min(1, (Number(inputY || 0) - Number(rect.top)) / h));
    if (multilineDeadZone) {
      if (rel < 0.4) return 'top';
      if (rel > 0.6) return 'bottom';
      return null;
    }
    return rel < 0.5 ? 'top' : 'bottom';
  }

  function getChecklistShiftClass(idx: number): '' | 'shift-up' | 'shift-down' {
    if (checklistDragging == null || checklistHoverIndex == null) return '';
    if (checklistHiddenDragChildSet.has(idx)) return '';
    const current = items as any[];
    if (!current.length) return '';
    const [sStart, sEnd] = getChecklistBlockRange(current as any, checklistDragging);
    const useSingleDragShift = checklistHiddenDragChildSet.size > 0;
    const dragStart = checklistDragging;
    const dragEnd = useSingleDragShift ? Math.min(current.length, checklistDragging + 1) : sEnd;
    if (idx >= dragStart && idx < dragEnd) return '';
    if (checklistDragging < checklistHoverIndex) {
      return (idx > (dragEnd - 1) && idx <= checklistHoverIndex) ? 'shift-up' : '';
    }
    if (checklistDragging > checklistHoverIndex) {
      return (idx >= checklistHoverIndex && idx < dragStart) ? 'shift-down' : '';
    }
    return '';
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
    setLoading(true);
    try {
      if (!token) throw new Error('Not authenticated');

      // Discard empty notes/checklists (Google Keep-style).
      if (mode === 'checklist') {
        const filtered = getNonEmptyChecklistItems();
        if (!title.trim() && filtered.length === 0) {
          discardAndClose();
          return;
        }
      } else {
        const hasTitle = !!title.trim();
        const hasText = !!((editor?.getText() || '').trim());
        if (!hasTitle && !hasText) {
          discardAndClose();
          return;
        }
      }

      // For text notes, capture content JSON to seed Yjs after creation.
      const bodyJson = mode === 'text' ? (editor?.getJSON() || {}) : {};
      // Do not store body for text notes; rely on Yjs collaboration persistence.
      const payload: any = { title, body: null, type: mode === 'checklist' ? 'CHECKLIST' : 'TEXT', color: bg || null };
      if (mode === 'checklist') {
        const filtered = getNonEmptyChecklistItems();
        payload.items = filtered.map((it, i) => ({ content: it.content, checked: !!it.checked, indent: (typeof (it as any).indent === 'number' ? Number((it as any).indent) : 0), ord: i }));
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

        discardAndClose();
        try { onCreated && onCreated(); } catch {}
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
      // For text notes, push initial content into the Yjs doc so it persists canonically.
      if (noteId && mode === 'text') {
        try {
          const ydoc = new Y.Doc();
          const room = noteCollabRoom(Number(noteId), noteCreatedAt);
          const provider = new WebsocketProvider(makeWebSocketUrl('/collab'), room, ydoc);
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
          try { await requestJsonOrQueue({ method: 'PATCH', path: `/api/notes/${noteId}`, body: { body: JSON.stringify(bodyJson), type: 'TEXT' } }); } catch {}
        } catch (e) {
          console.warn('Failed to seed Yjs content for new note', e);
        }
      }
      // post-create additions: collaborators and image
      if (noteId && selectedCollaborators.length) {
        for (const u of selectedCollaborators) {
          try { await requestJsonOrQueue({ method: 'POST', path: `/api/notes/${noteId}/collaborators`, body: { email: u.email } }); } catch {}
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
      setTitle(''); setBody(''); setItems([]); setActiveChecklistRowIdx(null); setExpanded(false); setBg(''); setImageUrls([]); setSelectedCollaborators([]); setPendingReminder(null);
      try { setPendingLinkUrls([]); } catch {}
      try { setAddToCurrentCollection(activeCollectionId != null); } catch {}
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
        <div className="take-note-bar" role="group" aria-label="Create new note or checklist">
          <button
            type="button"
            className="take-note-action"
            onMouseDown={(e) => { try { e.preventDefault(); } catch {} try { e.stopPropagation(); } catch {} }}
            onClick={(e) => {
              try { e.preventDefault(); } catch {}
              try { e.stopPropagation(); } catch {}
              ignoreNextDocClickRef.current = true;
              try { setAddToCurrentCollection(activeCollectionId != null); } catch {}
              setMode('text');
              setExpanded(true);
            }}
            aria-label="Click to create a new note"
          >
            <span className="take-note-action__icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" focusable="false">
                <path d="M6 3h8l4 4v14H6z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M14 3v4h4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9 12h6M9 16h6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="take-note-action__text">Create a new note</span>
          </button>

          <button
            type="button"
            className="take-note-action"
            onMouseDown={(e) => { try { e.preventDefault(); } catch {} try { e.stopPropagation(); } catch {} }}
            onClick={(e) => {
              try { e.preventDefault(); } catch {}
              try { e.stopPropagation(); } catch {}
              ignoreNextDocClickRef.current = true;
              try { setAddToCurrentCollection(activeCollectionId != null); } catch {}
              setMode('checklist');
              setItems([{ content: '', indent: 0 }]);
              try { setActiveChecklistRowIdx(null); } catch {}
              setExpanded(true);
              requestAnimationFrame(() => {
                try {
                  const active = document.activeElement as HTMLElement | null;
                  if (active && active.closest('.checklist-item')) active.blur();
                } catch {}
                try {
                  const active = document.activeElement as HTMLElement | null;
                  if (active && active.closest('.checklist-item')) document.getSelection()?.removeAllRanges();
                } catch {}
              });
            }}
            aria-label="Click to create a new checklist"
          >
            <span className="take-note-action__icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" focusable="false">
                <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" />
                <path d="M8 9h8M8 13h8M8 17h5" stroke="currentColor" strokeLinecap="round" />
                <path d="M6.5 13.5l1.5 1.5 2.5-2.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="take-note-action__text">Create a new checklist</span>
          </button>
        </div>
      </div>
    );
  }

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

  return (
    <div className={`take-note-expanded${maximized ? ' maximized' : ''}`} ref={rootRef} style={{ padding: 12, ...dialogStyle }}>
      <div className="take-note-editor-scroll-area">
      {mode === 'text' ? (
        <div>
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
            <div style={{ display: 'flex', justifyContent: 'flex-start', ...(titleStripStyle || {}) }}>
              <input className="note-title-input" ref={titleInputRef} placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} style={{ flex: 1, width: '100%', fontSize: 18, fontWeight: 600, border: 'none', background: 'transparent', color: 'inherit' }} />
            </div>

            <div className="rt-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8, marginBottom: 0, overflowX: 'auto' }}>
            <button className="tiny" onClick={() => toggleMarkAcrossLine('bold')} aria-pressed={editor?.isActive('bold')}>B</button>
            <button className="tiny" onClick={() => toggleMarkAcrossLine('italic')} aria-pressed={editor?.isActive('italic')}>I</button>
            <button className="tiny" onClick={() => toggleMarkAcrossLine('underline')} aria-pressed={editor?.isActive('underline')}>U</button>
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
            <button className="tiny" onClick={applyTextLink} aria-label="Add URL preview" title="Add URL preview"><FontAwesomeIcon icon={faLink} /></button>
            <button className="tiny" onClick={() => setMaximized(m => !m)} aria-label="Toggle maximize" title="Toggle maximize">⤢</button>
            </div>
          </div>
          <div
            onKeyDown={(e) => {
              if (!editor) return;
              const ctrl = e.ctrlKey || e.metaKey;
              if (!ctrl) return;
              // scope shortcuts when editor is focused
              if (!editor.isFocused) return;
              switch (e.key.toLowerCase()) {
                case 'b': e.preventDefault(); toggleMarkAcrossLine('bold'); break;
                case 'i': e.preventDefault(); toggleMarkAcrossLine('italic'); break;
                case 'u': e.preventDefault(); toggleMarkAcrossLine('underline'); break;
                case 'k': e.preventDefault(); applyTextLink(); break;
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
        <div>
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
            <div style={{ display: 'flex', justifyContent: 'flex-start', ...(titleStripStyle || {}) }}>
              <input className="note-title-input" ref={titleInputRef} placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} style={{ flex: 1, width: '100%', fontSize: 18, fontWeight: 600, border: 'none', background: 'transparent', color: 'inherit' }} />
            </div>

            <div
              className="rt-toolbar"
              style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8, marginBottom: 0 }}
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
            </div>
          </div>

          <div
            style={{ marginTop: 8 }}
            onDragOver={(e) => {
              if (checklistDragging == null) return;
              e.preventDefault();
            }}
            onDrop={(e) => {
              // Fallback drop handler (e.g. when source row has pointer-events disabled)
              if (checklistDragging == null) return;
              e.preventDefault();
              const src = draggingIdx.current ?? parseInt(e.dataTransfer.getData('text/plain') || '-1', 10);
              if (src < 0) { cleanupChecklistDrag(); return; }

              const dir = checklistDragDirectionRef.current;
              if (dir === 'horizontal') {
                const start = checklistDragStartRef.current;
                const dx = start ? ((e.clientX || 0) - start.x) : 0;
                if (Math.abs(dx) >= CHECKLIST_DRAG.indentPx) {
                  const current = items;
                  const [bStart, bEnd] = getChecklistBlockRange(current as any, src);
                  const delta = dx > 0 ? 1 : -1;
                  moveChecklistBlock(bStart, bEnd, bStart, delta);
                }
                cleanupChecklistDrag();
                return;
              }

              // Vertical reorder fallback: use current hover index.
              const dst = (typeof checklistHoverIndex === 'number' ? checklistHoverIndex : src);
              if (dst >= 0 && dst !== src) {
                const current = items;
                const [sStart, sEnd] = getChecklistBlockRange(current as any, src);
                const dstIndex = Math.max(0, Math.min(current.length, dst + (checklistHoverEdge === 'bottom' ? 1 : 0)));
                if (!(dstIndex >= sStart && dstIndex < sEnd)) {
                  const len = Math.max(0, sEnd - sStart);
                  const firstIndent = Number((current as any)?.[sStart]?.indent || 0);
                  let insertAt = dstIndex;
                  if (insertAt > sStart) insertAt = insertAt - len;
                  if (insertAt < 0) insertAt = 0;
                  const baseWithout = (current as any[]).slice();
                  baseWithout.splice(sStart, len);
                  const forceTopLevel = insertAt <= 0;
                  const prevIndent = insertAt > 0 ? Number(baseWithout?.[insertAt - 1]?.indent || 0) : 0;
                  const nextIndent = insertAt < baseWithout.length ? Number(baseWithout?.[insertAt]?.indent || 0) : 0;
                  const desiredIndent = forceTopLevel ? 0 : (nextIndent > prevIndent ? nextIndent : prevIndent);
                  const indentDelta = desiredIndent - firstIndent;
                  moveChecklistBlock(sStart, sEnd, dstIndex, indentDelta);
                }
              }
              cleanupChecklistDrag();
            }}
          >
          {items.length === 0 && (
            <div style={{ marginBottom: 8 }}>
              <button
                className="btn"
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setItems([{ content: '', indent: 0 }]);
                  setActiveChecklistRowIdx(0);
                  // wait for ChecklistItemRT to mount + register
                  setTimeout(() => focusItem(0), 30);
                }}
              >Add an item</button>
            </div>
          )}
          {items.map((it, idx) => (
            <div
              key={idx}
              className={`checklist-item${activeChecklistRowIdx === idx ? ' is-active' : ''}${(() => {
                const c = getChecklistShiftClass(idx);
                return c ? ` ${c}` : '';
              })()}${checklistHiddenDragChildSet.has(idx) ? ' drag-hidden-child' : ''}`}
              data-item-idx={idx}
              onDragOver={(e) => {
                e.preventDefault();
                if (checklistDragging == null) return;
                if (checklistDragDirectionRef.current === 'horizontal') return;
                if (checklistGhostRef.current) return;
                const target = e.currentTarget as HTMLElement;
                const rect = target.getBoundingClientRect();

                // Throttle hover calculations to animation frames to reduce jitter.
                try { if (checklistRafRef.current) cancelAnimationFrame(checklistRafRef.current); } catch {}
                checklistRafRef.current = requestAnimationFrame(() => {
                  if (checklistDragging == null) return;
                  let shouldHover = false;
                  let hitEdge: 'top' | 'bottom' | null = null;
                  try {
                    const y = (e as unknown as React.DragEvent<HTMLElement>).clientY || 0;
                    shouldHover = y >= rect.top && y <= rect.bottom;
                    const rowH = Math.max(1, rect.bottom - rect.top);
                    const minH = 22;
                    const multiline = rowH > (minH * 1.35);
                    hitEdge = getChecklistHitTestEdge(y, rect, multiline);
                  } catch {}

                  if (shouldHover && hitEdge) {
                    try { if (checklistClearHoverTimeoutRef.current) { clearTimeout(checklistClearHoverTimeoutRef.current); checklistClearHoverTimeoutRef.current = null; } } catch {}
                    try { setChecklistHoverIndex((prev) => (prev === idx ? prev : idx)); } catch {}
                    try { setChecklistHoverEdge(hitEdge); } catch {}
                  } else if (shouldHover && !hitEdge) {
                    // dead zone: keep current hover to avoid oscillation
                    return;
                  } else {
                    if (checklistHoverIndex === idx && checklistClearHoverTimeoutRef.current === null) {
                      checklistClearHoverTimeoutRef.current = window.setTimeout(() => {
                        try { setChecklistHoverIndex((prev) => (prev === idx ? null : prev)); } catch {}
                        checklistClearHoverTimeoutRef.current = null;
                      }, 80);
                    }
                  }
                });
              }}
              onDrop={(e) => {
                e.stopPropagation();
                e.preventDefault();
                const src = draggingIdx.current ?? parseInt(e.dataTransfer.getData('text/plain') || '-1', 10);
                const dst = idx;
                const dir = checklistDragDirectionRef.current;
                if (dir === 'horizontal') {
                  const start = checklistDragStartRef.current;
                  const dx = start ? ((e.clientX || 0) - start.x) : 0;
                  if (src >= 0 && Math.abs(dx) >= CHECKLIST_DRAG.indentPx) {
                    setItems((s) => s.map((it, i) => {
                      if (i !== src) return it;
                      const curIndent = (typeof it.indent === 'number' ? Number(it.indent) : 0);
                      const nextIndent = dx > 0
                        ? Math.min(CHECKLIST_DRAG.maxIndent, curIndent + 1)
                        : Math.max(0, curIndent - 1);
                      return { ...it, indent: nextIndent };
                    }));
                  }
                  cleanupChecklistDrag();
                  return;
                }

                if (src >= 0 && src !== dst) {
                  const current = items;
                  const [sStart, sEnd] = getChecklistBlockRange(current as any, src);
                  const dstIndex = Math.max(0, Math.min(current.length, dst + (checklistHoverEdge === 'bottom' ? 1 : 0)));
                  if (!(dstIndex >= sStart && dstIndex < sEnd)) {
                    const len = Math.max(0, sEnd - sStart);
                    const firstIndent = Number((current as any)?.[sStart]?.indent || 0);
                    let insertAt = dstIndex;
                    if (insertAt > sStart) insertAt = insertAt - len;
                    if (insertAt < 0) insertAt = 0;
                    const baseWithout = (current as any[]).slice();
                    baseWithout.splice(sStart, len);
                    const forceTopLevel = insertAt <= 0;
                    const prevIndent = insertAt > 0 ? Number(baseWithout?.[insertAt - 1]?.indent || 0) : 0;
                    const nextIndent = insertAt < baseWithout.length ? Number(baseWithout?.[insertAt]?.indent || 0) : 0;
                    const desiredIndent = forceTopLevel ? 0 : (nextIndent > prevIndent ? nextIndent : prevIndent);
                    const indentDelta = desiredIndent - firstIndent;
                    moveChecklistBlock(sStart, sEnd, dstIndex, indentDelta);
                  }
                }
                cleanupChecklistDrag();
              }}
              style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginLeft: (typeof it.indent === 'number' ? Number(it.indent) : 0) * 18 }}
            >
              <div
                className="drag-handle"
                draggable
                onDragStart={(e) => {
                  vibrateDragStart(10);
                  draggingIdx.current = idx;
                  try { e.dataTransfer.effectAllowed = 'move'; } catch {}
                  try { e.dataTransfer.dropEffect = 'move'; } catch {}
                  try { e.dataTransfer?.setData('text/plain', String(idx)); } catch {}

                  // Desktop: create a visual lift ghost and set shift distance (mirrors ChecklistEditor logic).
                  try {
                    const handle = e.currentTarget as HTMLElement;
                    const row = (handle.closest('.checklist-item') as HTMLElement | null) || handle;
                    const rect = row.getBoundingClientRect();
                    const offsetX = (e.clientX || 0) - rect.left;
                    const offsetY = (e.clientY || 0) - rect.top;
                    const current = items as any[];
                    const [sStart, sEnd] = getChecklistBlockRange(current as any, idx);
                    const childIdxs: number[] = [];
                    for (let i = sStart + 1; i < sEnd; i++) childIdxs.push(i);
                    setChecklistHiddenDragChildIndices(childIdxs);
                    checklistHiddenDragChildSetRef.current = new Set(childIdxs);

                    let blockHeight = Math.max(1, rect.height);
                    try {
                      const rows = Array.from((rootRef.current?.querySelectorAll('.checklist-item[data-item-idx]') || [])) as HTMLElement[];
                      let top = Number.POSITIVE_INFINITY;
                      let bottom = Number.NEGATIVE_INFINITY;
                      for (const el of rows) {
                        const realIdx = Number(el.getAttribute('data-item-idx'));
                        if (!Number.isFinite(realIdx)) continue;
                        if (realIdx >= sStart && realIdx < sEnd) {
                          const rr = el.getBoundingClientRect();
                          top = Math.min(top, rr.top);
                          bottom = Math.max(bottom, rr.bottom);
                        }
                      }
                      if (Number.isFinite(top) && Number.isFinite(bottom) && bottom > top) {
                        blockHeight = Math.max(1, Math.round(bottom - top));
                      }
                    } catch {}

                    checklistDragOffsetRef.current = { x: offsetX, y: offsetY };
                    checklistDragStartRef.current = { x: (e.clientX || 0), y: (e.clientY || 0) };
                    checklistDragDirectionRef.current = null;
                    checklistSourceLeftRef.current = rect.left;
                    checklistSourceTopRef.current = rect.top;
                    checklistLastDragYRef.current = (e.clientY || 0);

                    const ghost = row.cloneNode(true) as HTMLElement;
                    ghost.style.position = 'fixed';
                    ghost.style.left = ((e.clientX || 0) - offsetX) + 'px';
                    ghost.style.top = ((e.clientY || 0) - offsetY) + 'px';
                    ghost.style.width = rect.width + 'px';
                    ghost.style.pointerEvents = 'none';
                    ghost.style.zIndex = '9999';
                    ghost.style.opacity = '0.98';
                    ghost.classList.add('checklist-ghost');
                    document.body.appendChild(ghost);
                    checklistGhostRef.current = ghost as any;

                    // Initialize dragging state after drag image is set to avoid drag-start flicker.
                    try { setChecklistDragging(idx); } catch {}
                    try { setChecklistHoverIndex(idx); } catch {}
                    try { setChecklistHoverEdge('top'); } catch {}
                    setTimeout(() => { try { row.classList.add('drag-source'); } catch {} }, 0);

                    // Hide browser-native drag image; our ghost provides the visuals.
                    try {
                      const timg = transparentDragImgRef.current;
                      if (timg && e.dataTransfer) e.dataTransfer.setDragImage(timg, 0, 0);
                    } catch {}
                    try { (rootRef.current as any)?.style?.setProperty?.('--checklist-item-shift', `${Math.round(blockHeight)}px`); } catch {}
                    try { (rootRef.current as HTMLElement | null)?.classList?.add?.('is-dragging'); } catch {}

                    const onDocDragOver = (ev: DragEvent) => {
                      if (!checklistGhostRef.current) return;
                      const off = checklistDragOffsetRef.current || { x: 12, y: 12 };
                      const start = checklistDragStartRef.current;

                      if (checklistDragDirectionRef.current === null && start) {
                        const dx = Math.abs((ev.clientX || 0) - start.x);
                        const dy = Math.abs((ev.clientY || 0) - start.y);
                        const THRESH = CHECKLIST_DRAG.directionLockPx;
                        if (dx > THRESH || dy > THRESH) {
                          checklistDragDirectionRef.current = dx > dy ? 'horizontal' : 'vertical';
                        }
                      }
                      try {
                        if (checklistDragDirectionRef.current === 'vertical') {
                          checklistGhostRef.current.style.left = checklistSourceLeftRef.current + 'px';
                          checklistGhostRef.current.style.top = ((ev.clientY || 0) - off.y) + 'px';
                          try {
                            const rows = Array.from((rootRef.current?.querySelectorAll('.checklist-item[data-item-idx]') || [])) as HTMLElement[];
                            if (rows.length) {
                              const ghostRect = checklistGhostRef.current.getBoundingClientRect();
                              const ghostCenterY = (ghostRect.top + ghostRect.bottom) / 2;
                              const movingDown = ghostCenterY >= (checklistLastDragYRef.current || ghostCenterY);
                              checklistLastDragYRef.current = ghostCenterY;
                              const gh = Math.max(1, ghostRect.bottom - ghostRect.top);
                              const refY = movingDown
                                ? (ghostRect.bottom - gh * 0.25)
                                : (ghostRect.top + gh * 0.25);

                              let chosen: number | null = null;
                              let chosenEdge: 'top' | 'bottom' | null = null;
                              const src = draggingIdx.current;
                              const hidden = checklistHiddenDragChildSetRef.current;
                              const minRowH = 22;
                              for (let i = 0; i < rows.length; i++) {
                                const realIdx = Number(rows[i].getAttribute('data-item-idx'));
                                if (!Number.isFinite(realIdx)) continue;
                                if (typeof src === 'number' && realIdx === src) continue;
                                if (hidden.has(realIdx)) continue;
                                const r = rows[i].getBoundingClientRect();
                                const rowH = Math.max(1, r.bottom - r.top);
                                const edge = getChecklistHitTestEdge(refY, r, rowH > (minRowH * 1.35));
                                if (edge == null) continue;
                                const centerY = (r.top + r.bottom) / 2;
                                if (refY < centerY) { chosen = realIdx; chosenEdge = edge; break; }
                                chosen = realIdx;
                                chosenEdge = edge;
                              }
                              if (chosen != null && chosenEdge) {
                                setChecklistHoverIndex((prev) => (prev === chosen ? prev : chosen));
                                setChecklistHoverEdge((prev) => (prev === chosenEdge ? prev : chosenEdge));
                              }
                            }
                          } catch {}
                        } else if (checklistDragDirectionRef.current === 'horizontal') {
                          checklistGhostRef.current.style.left = ((ev.clientX || 0) - off.x) + 'px';
                          checklistGhostRef.current.style.top = ((start?.y || checklistSourceTopRef.current) - off.y) + 'px';
                        } else {
                          checklistGhostRef.current.style.left = checklistSourceLeftRef.current + 'px';
                          checklistGhostRef.current.style.top = ((ev.clientY || 0) - off.y) + 'px';
                        }
                      } catch {}
                    };
                    checklistDocDragOverRef.current = onDocDragOver;
                    document.addEventListener('dragover', onDocDragOver);
                  } catch {}
                }}
                onDragEnd={() => { cleanupChecklistDrag(); }}
                style={{ cursor: 'grab', userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none', msUserSelect: 'none', touchAction: 'none', WebkitTapHighlightColor: 'transparent' }}
                aria-label="Drag to reorder"
                title="Drag to reorder"
              />
              <div className="checkbox-visual" onClick={(e) => { try { e.stopPropagation(); } catch {} toggleLocalItemChecked(idx); }} aria-hidden>
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
                  onRequestUrlPreview={() => { try { ignoreNextDocClickRef.current = true; } catch {} try { setShowUrlModal(true); } catch {} }}
                  onEnter={() => {
                    try { setActiveChecklistRowIdx(idx + 1); } catch {}
                    setItems(s => {
                      const copy = [...s];
                      const curIndent = (typeof copy[idx]?.indent === 'number' ? Number(copy[idx]?.indent) : 0);
                      copy.splice(idx + 1, 0, { content: '', indent: curIndent });
                      return copy;
                    });
                    focusItem(idx + 1);
                  }}
                  onArrowUp={() => focusItem(Math.max(0, idx - 1))}
                  onArrowDown={() => focusItem(Math.min(items.length - 1, idx + 1))}
                  onBackspaceEmpty={() => {
                    if (idx > 0) {
                      try { setActiveChecklistRowIdx(idx - 1); } catch {}
                      setItems(s => { const copy = [...s]; copy.splice(idx, 1); return copy; });
                      focusItem(idx - 1);
                    }
                  }}
                  onFocus={(ed: any) => {
                    activeChecklistEditor.current = ed;
                    itemEditorRefs.current[idx] = ed;
                    try {
                      // ChecklistItemRT calls `onFocus` once on mount to register refs.
                      // Only treat it as an active/highlighted row when actually focused.
                      if ((ed as any)?.isFocused) setActiveChecklistRowIdx(idx);
                    } catch {}
                    setChecklistToolbarTick(t => t + 1);
                  }}
                  placeholder={''}
                  autoFocus={false}
                />
              </div>
              <button
                className="delete-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setItems(s => {
                    const next = s.filter((_, i) => i !== idx);
                    // if we deleted the last item, clear active editor refs
                    if (next.length === 0) {
                      activeChecklistEditor.current = null;
                      itemEditorRefs.current = [];
                      try { setActiveChecklistRowIdx(null); } catch {}
                      return next;
                    }
                    // focus previous (or first) after the list updates
                    const focusIdx = Math.max(0, Math.min(idx - 1, next.length - 1));
                    try { setActiveChecklistRowIdx(focusIdx); } catch {}
                    setTimeout(() => focusItem(focusIdx), 30);
                    return next;
                  });
                }}
                aria-label="Delete item"
                title="Delete item"
              >✕</button>
            </div>
          ))}
          </div>
        </div>
      )}

      {imageUrls.length > 0 && (
        mode === 'checklist' ? (
          <div className="editor-images editor-images-dock" style={{ marginTop: 10 }}>
            <div className="editor-images-grid">
              {imageUrls.map((url, idx) => (
                <div key={`${url}-${idx}`} className="note-image" style={{ position: 'relative' }}>
                  <img src={url} alt="selected" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                  <button
                    className="image-delete"
                    type="button"
                    aria-label="Remove image"
                    title="Remove image"
                    style={{ position: 'absolute', right: 6, bottom: 6 }}
                    onClick={() => setImageUrls((cur) => (cur || []).filter((_, i) => i !== idx))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, fontSize: 13, opacity: 0.9 }}>Images ({imageUrls.length})</div>
              <button className="btn" type="button" onClick={() => setImageUrls([])} style={{ padding: '6px 10px' }}>Remove all</button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {imageUrls.slice(0, 3).map((url, idx) => (
                <div key={`${url}-${idx}`} className="note-image" style={{ width: 56, height: 42, flex: '0 0 auto' }}>
                  <img src={url} alt="selected" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                </div>
              ))}
            </div>
            <div style={{ flex: 1, fontSize: 13, opacity: 0.9 }}>{imageUrls.length} image{imageUrls.length === 1 ? '' : 's'} selected</div>
            <button className="btn" type="button" onClick={() => setImageUrls([])} style={{ padding: '6px 10px' }}>Remove</button>
          </div>
        )
      )}
      </div>

      <UrlEntryModal
        open={showUrlModal}
        title="Add URL preview"
        onCancel={() => {
          try { ignoreNextDocClickRef.current = true; } catch {}
          setShowUrlModal(false);
        }}
        onSubmit={(url) => {
          try { ignoreNextDocClickRef.current = true; } catch {}
          setShowUrlModal(false);
          setPendingLinkUrls((cur) => {
            const next = Array.isArray(cur) ? cur.slice() : [];
            if (next.includes(String(url))) return next;
            next.push(String(url));
            return next;
          });
        }}
      />

      {pendingLinkUrls.length > 0 && (
        <div className="note-link-previews" style={{ marginTop: 10 }}>
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
      )}

      <div className="note-footer" aria-hidden={false} style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <div style={{ marginRight: 'auto', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          {!!activeCollectionId && !!activeCollectionPath && (
            <label className="create-collection-toggle" title={activeCollectionPath}>
              <input
                type="checkbox"
                checked={!!addToCurrentCollection}
                onChange={(e) => setAddToCurrentCollection(!!e.target.checked)}
              />
              <span className="create-collection-toggle__text">Add to current collection:</span>
              <span className="create-collection-toggle__path">{activeCollectionPath}</span>
            </label>
          )}

          <div className="note-actions" style={{ display: 'inline-flex', gap: 8 }}>
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
        </div>
        <button className="btn" onClick={async () => {
          discardAndClose();
        }}>Cancel</button>
        <button className="btn" onClick={save} disabled={loading || !hasContentToSave()}>{loading ? 'Saving...' : 'Save'}</button>
      </div>

      {showPalette && <ColorPalette anchorRef={rootRef} onPick={(c) => { setBg(c); /* keep palette open */ }} onClose={() => setShowPalette(false)} />}
      {showReminderPicker && (
        <ReminderPicker
          onClose={() => setShowReminderPicker(false)}
          onConfirm={(draft) => {
            setShowReminderPicker(false);
            try {
              // Request permission while we still have a user gesture.
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
      {showImageDialog && (
        <ImageDialog
          onClose={() => setShowImageDialog(false)}
          onAdd={(url) => setImageUrls((cur) => {
            const next = Array.isArray(cur) ? cur.slice() : [];
            const val = String(url || '').trim();
            if (!val || next.includes(val)) return next;
            next.push(val);
            return next;
          })}
          onAddMany={(urls) => setImageUrls((cur) => {
            const next = new Set(Array.isArray(cur) ? cur.map((u) => String(u || '').trim()).filter((u) => !!u) : []);
            for (const url of (Array.isArray(urls) ? urls : [])) {
              const val = String(url || '').trim();
              if (val) next.add(val);
            }
            return Array.from(next);
          })}
        />
      )}
    </div>
  );
}

