import React, { useRef, useState } from "react";
import { createPortal } from 'react-dom';
import { useTheme } from '../themeContext';
import DOMPurify from 'dompurify';
import { useAuth } from '../authContext';
import { getOrCreateDeviceProfile } from '../lib/deviceProfile';
import ChecklistEditor from "./ChecklistEditor";
import RichTextEditor from "./RichTextEditor";
import CollaboratorModal from "./CollaboratorModal";
import MoreMenu from "./MoreMenu";
import MoveToCollectionModal from "./MoveToCollectionModal";
import UrlEntryModal from "./UrlEntryModal";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPalette, faUsers, faTag, faFolder, faImage, faUser, faNoteSticky, faListCheck, faPaperclip } from '@fortawesome/free-solid-svg-icons';
import LabelsDialog from "./LabelsDialog";
import ColorPalette from "./ColorPalette";
import ImageDialog from "./ImageDialog";
import NoteImagesModal from "./NoteImagesModal";
import ReminderPicker, { type ReminderDraft } from "./ReminderPicker";
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Collaboration from '@tiptap/extension-collaboration';
import { bindYDocPersistence, enqueueHttpJsonMutation, enqueueImageUpload, kickOfflineSync } from '../lib/offline';
import { noteCollabRoomFromNote } from '../lib/collabRoom';

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
  viewerImagesExpanded?: boolean | null;
  viewerCollections?: Array<{ id: number; name: string; parentId: number | null }>;
  noteLabels?: Array<{ id: number; label?: { id: number; name: string } }>;
  images?: Array<{ id: number; url?: string; ocrSearchText?: string | null; ocrText?: string | null; ocrStatus?: string | null }>
  imagesCount?: number;
  cardSpan?: number;
  offlinePendingCreate?: boolean;
  offlineOpId?: string;
  offlineSyncFailed?: boolean;
  offlineSyncError?: string;
};

function formatReminderDueIdentifier(dueMs: number): string {
  if (!Number.isFinite(dueMs) || dueMs <= 0) return 'Due soon';
  const now = Date.now();
  const diff = dueMs - now;
  const dueDate = new Date(dueMs);
  const time = dueDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const startOfDayAfterTomorrow = new Date(startOfTomorrow.getTime() + 24 * 60 * 60 * 1000);

  if (diff < 0) {
    const overdueMs = Math.abs(diff);
    const mins = Math.max(1, Math.round(overdueMs / 60000));
    if (mins < 60) return `Overdue ${mins}m`;
    const hours = Math.max(1, Math.round(mins / 60));
    if (hours < 24) return `Overdue ${hours}h`;
    const days = Math.max(1, Math.round(hours / 24));
    return `Overdue ${days}d`;
  }

  if (dueDate >= startOfToday && dueDate < startOfTomorrow) return `Due today ${time}`;
  if (dueDate >= startOfTomorrow && dueDate < startOfDayAfterTomorrow) return `Due tomorrow ${time}`;

  const withinWeek = dueMs - now <= (7 * 24 * 60 * 60 * 1000);
  if (withinWeek) {
    const weekday = dueDate.toLocaleDateString([], { weekday: 'short' });
    return `Due ${weekday} ${time}`;
  }

  const date = dueDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `Due ${date} ${time}`;
}

function reminderDueColorClass(dueMs: number): string {
  if (!Number.isFinite(dueMs) || dueMs <= 0) return '';

  const now = new Date();
  const due = new Date(dueMs);
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const dueUtc = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
  const calendarDayDiff = Math.trunc((dueUtc - todayUtc) / 86400000);
  const elapsedDayDiff = Math.max(0, Math.ceil((dueMs - Date.now()) / 86400000));
  const dayDiff = Math.max(calendarDayDiff, elapsedDayDiff);

  // Overdue, due today, or due tomorrow => red.
  if (dayDiff <= 1) return 'note-reminder-due--red';
  // 2 days through 1 week => orange.
  if (dayDiff >= 2 && dayDiff <= 7) return 'note-reminder-due--orange';
  // 1-2 weeks => yellow.
  if (dayDiff >= 8 && dayDiff <= 14) return 'note-reminder-due--yellow';
  return '';
}

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

export default function NoteCard({
  note,
  onChange,
  openRequest,
  onOpenRequestHandled,
  showDueIdentifier = true,
  dragHandleAttributes,
  dragHandleListeners,
}: {
  note: Note;
  onChange?: (ev?: any) => void;
  openRequest?: number;
  onOpenRequestHandled?: (noteId: number) => void;
  showDueIdentifier?: boolean;
  dragHandleAttributes?: Record<string, any>;
  dragHandleListeners?: Record<string, any>;
}) {
  const noteRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const imagesWrapRef = useRef<HTMLDivElement | null>(null);
  const imagesToggleRef = useRef<HTMLDivElement | null>(null);
  const snapRafRef = useRef<number | null>(null);
  const lastSnapUnitRef = useRef<number | null>(null);
  const lastSnapBaseRef = useRef<number | null>(null);
  const theme = (() => { try { return useTheme(); } catch { return { effective: 'dark' } as any; } })();

  const [bg, setBg] = useState<string>((note as any).viewerColor || note.color || ""); // empty = theme card color
  const [archived, setArchived] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [images, setImages] = useState<Array<{ id:number; url:string }>>((note.images as any) || []);
  const [thumbsPerRow, setThumbsPerRow] = useState<number>(3);
  const [imagesExpanded, setImagesExpanded] = React.useState<boolean>(() => !!(note as any).viewerImagesExpanded);
  const [imagesExpandDirection, setImagesExpandDirection] = React.useState<'up' | 'down'>('up');
  const [imagesDownTop, setImagesDownTop] = React.useState<number>(0);
  const [noteItems, setNoteItems] = useState<any[]>(note.items || []);
  const [title, setTitle] = useState<string>(note.title || '');
  const [textBody, setTextBody] = useState<string>(note.body || '');

  React.useEffect(() => {
    try {
      const arr = (note as any).images;
      if (!Array.isArray(arr)) return;
      const next = arr
        .filter((i: any) => i && typeof i.url === 'string' && String(i.url || '').length > 0)
        .map((i: any) => ({ id: Number(i.id), url: String(i.url) }));

      // Important: notes returned from `/api/notes` may include `images` metadata without URLs.
      // Don't clobber already-fetched local preview URLs in that case.
      if (next.length > 0) {
        setImages(next);
        return;
      }

      const count = Number((note as any).imagesCount ?? 0);
      if (!Number.isFinite(count) || count <= 0) {
        setImages([]);
      }
    } catch {}
  }, [note.id, (note as any).images, (note as any).imagesCount]);

  React.useEffect(() => {
    try { setArchived(!!(note as any).archived); } catch {}
  }, [note.id, (note as any).archived]);

  React.useEffect(() => {
    try { setPinned(!!(note as any).pinned); } catch {}
  }, [note.id, (note as any).pinned]);

  function notifyImages(next: Array<{ id: number; url: string }>) {
    try { (onChange as any)?.({ type: 'images', noteId: note.id, images: next }); } catch {}
  }

  function notifyColor(next: string) {
    try { (onChange as any)?.({ type: 'color', noteId: note.id, color: next || '' }); } catch {}
  }

  function setImagesWithNotify(updater: (prev: Array<{ id: number; url: string }>) => Array<{ id: number; url: string }>) {
    setImages((prev) => {
      const next = updater(prev);
      try { setTimeout(() => notifyImages(next), 0); } catch {}
      return next;
    });
  }

  const [showCollaborator, setShowCollaborator] = useState(false);
  const [collaborators, setCollaborators] = useState<Array<{ collabId?: number; userId: number; email: string; name?: string; userImageUrl?: string }>>([]);
  const [labels, setLabels] = useState<Array<{ id: number; name: string }>>(() => (note.noteLabels || []).map((nl:any) => nl.label).filter((l:any) => l && typeof l.id === 'number' && typeof l.name === 'string'));
  const [viewerCollections, setViewerCollections] = React.useState<Array<{ id: number; name: string; parentId: number | null }>>(() => {
    try {
      const arr = (note as any).viewerCollections;
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((c: any) => c && typeof c.id === 'number' && typeof c.name === 'string')
        .map((c: any) => ({ id: Number(c.id), name: String(c.name), parentId: (c.parentId == null ? null : Number(c.parentId)) }));
    } catch {
      return [];
    }
  });
  const [showMore, setShowMore] = useState(false);
  const [moreAnchorPoint, setMoreAnchorPoint] = useState<{ x:number; y:number } | null>(null);
  const [showMoveToCollection, setShowMoveToCollection] = useState(false);

  const [expandedMeta, setExpandedMeta] = React.useState<null | 'collab' | 'labels' | 'collections'>(null);
  const [collectionPathById, setCollectionPathById] = React.useState<Record<number, string>>({});
  const metaWrapRef = React.useRef<HTMLDivElement | null>(null);
  const metaPanelRef = React.useRef<HTMLDivElement | null>(null);
  const metaAnimTimersRef = React.useRef<number[]>([]);
  const [metaVisibleCount, setMetaVisibleCount] = React.useState<number>(0);
  const [metaPanelHeight, setMetaPanelHeight] = React.useState<number>(0);

  const clearMetaAnimTimers = React.useCallback(() => {
    try {
      for (const id of metaAnimTimersRef.current) {
        try { window.clearTimeout(id); } catch {}
      }
    } catch {}
    metaAnimTimersRef.current = [];
  }, []);

  const [showPalette, setShowPalette] = useState(false);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [showImagesModal, setShowImagesModal] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showTextEditor, setShowTextEditor] = useState(false);
  const [showCompleted, setShowCompleted] = useState<boolean>(true);
  const myDeviceKey = React.useMemo(() => {
    try { return getOrCreateDeviceProfile().deviceKey; } catch { return ''; }
  }, []);

  React.useEffect(() => {
    try {
      if (!myDeviceKey) return;
      const k = `fn.note.showCompleted.${myDeviceKey}.${note.id}`;
      const v = localStorage.getItem(k);
      if (v !== null) setShowCompleted(v === 'true');
    } catch {}
  }, [myDeviceKey, note.id]);
  const [rtHtmlFromY, setRtHtmlFromY] = React.useState<string | null>(null);
  const [previewClipped, setPreviewClipped] = useState(false);

  React.useEffect(() => {
    try {
      const arr = (note as any).viewerCollections;
      if (!Array.isArray(arr)) { setViewerCollections([]); return; }
      const next = arr
        .filter((c: any) => c && typeof c.id === 'number' && typeof c.name === 'string')
        .map((c: any) => ({ id: Number(c.id), name: String(c.name), parentId: (c.parentId == null ? null : Number(c.parentId)) }));
      setViewerCollections(next);
    } catch {
      setViewerCollections([]);
    }
  }, [note.id, (note as any).viewerCollections]);

  const previewRowAlignItems: React.CSSProperties['alignItems'] = 'flex-start';

  React.useEffect(() => {
    clearMetaAnimTimers();
    if (!expandedMeta) {
      setMetaVisibleCount(0);
      setMetaPanelHeight(0);
      return;
    }

    // Stepwise animation:
    // - show the container sized for item 1
    // - pop item 1
    // - expand to item 2, then pop item 2
    // - ...
    setMetaVisibleCount(0);
    const raf = window.requestAnimationFrame(() => {
      try {
        const panel = metaPanelRef.current;
        if (!panel) return;
        const items = Array.from(panel.querySelectorAll<HTMLElement>('.note-meta-item'));
        if (!items.length) {
          setMetaPanelHeight(0);
          return;
        }

        const cs = window.getComputedStyle(panel);
        const padBottom = (() => {
          const v = parseFloat(cs.paddingBottom || '0');
          return Number.isFinite(v) ? v : 0;
        })();

        const heights = items.map((el) => {
          try {
            // offsetTop includes paddingTop; we only need to add paddingBottom.
            return Math.ceil(el.offsetTop + el.offsetHeight + padBottom);
          } catch {
            return 0;
          }
        }).filter((h) => h > 0);

        if (!heights.length) {
          setMetaPanelHeight(0);
          return;
        }

        // Container appears first, already sized for item 1.
        setMetaPanelHeight(heights[0]);

        const ITEM_IN_MS = 55;
        const CONTAINER_MS = 40;
        const BETWEEN_MS = 20;

        const tShowFirst = window.setTimeout(() => {
          setMetaVisibleCount(1);
        }, 10);
        metaAnimTimersRef.current.push(tShowFirst);

        for (let i = 2; i <= heights.length; i++) {
          const idx = i - 1;
          const tExpandAt = 10 + ITEM_IN_MS + BETWEEN_MS + ((i - 2) * (CONTAINER_MS + ITEM_IN_MS + BETWEEN_MS));
          const tShowAt = tExpandAt + CONTAINER_MS;

          const tExpand = window.setTimeout(() => {
            setMetaPanelHeight(heights[idx]);
          }, tExpandAt);
          metaAnimTimersRef.current.push(tExpand);

          const tShow = window.setTimeout(() => {
            setMetaVisibleCount(i);
          }, tShowAt);
          metaAnimTimersRef.current.push(tShow);
        }
      } catch {}
    });

    return () => {
      try { window.cancelAnimationFrame(raf); } catch {}
      clearMetaAnimTimers();
    };
  }, [expandedMeta, note.id, labels.length, viewerCollections.length, collaborators.length, clearMetaAnimTimers]);

  React.useEffect(() => {
    if (!expandedMeta) return;
    const onDoc = (e: any) => {
      try {
        const wrap = metaWrapRef.current;
        const t = (e?.target as Node | null) || null;
        if (wrap && t && wrap.contains(t)) return;
        setExpandedMeta(null);
      } catch {}
    };
    // Capture so we can close even if inner handlers stopPropagation.
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('mousedown', onDoc, true);
    return () => {
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('mousedown', onDoc, true);
    };
  }, [expandedMeta]);

  const openEditor = React.useCallback(() => {
    try { setExpandedMeta(null); } catch {}
    try { setImagesExpanded(false); } catch {}
    if (note.type === 'CHECKLIST' || (note.items && note.items.length)) setShowEditor(true);
    else setShowTextEditor(true);
  }, [note.type, note.items]);

  React.useEffect(() => {
    const onAnyEditorOpen = () => {
      try { setExpandedMeta(null); } catch {}
      try { setImagesExpanded(false); } catch {}
    };
    window.addEventListener('freemannotes:editor-modal-open', onAnyEditorOpen as any);
    return () => {
      window.removeEventListener('freemannotes:editor-modal-open', onAnyEditorOpen as any);
    };
  }, []);

  const lastOpenRequestRef = React.useRef<number>(0);
  React.useEffect(() => {
    const req = Number(openRequest || 0);
    if (!req) return;
    if (req === lastOpenRequestRef.current) return;
    lastOpenRequestRef.current = req;
    openEditor();
    try { onOpenRequestHandled && onOpenRequestHandled(Number(note.id)); } catch {}
  }, [openRequest, openEditor, onOpenRequestHandled, note.id]);

  const isInteractiveTarget = React.useCallback((target: HTMLElement | null): boolean => {
    if (!target) return false;
    try {
      return !!target.closest('button, a, input, textarea, select, [contenteditable="true"], [role="button"], .more-menu, .dropdown, .color-palette');
    } catch {
      return false;
    }
  }, []);

  const maybeBeginBodyDragMouse = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    try {
      if (showMore) return;
      const target = e.target as HTMLElement | null;
      if (isInteractiveTarget(target)) return;
      // Mark pending swap-drag activation so native scroll is disabled while the
      // touch/mouse activation delay elapses. Cleared on pointerup/cancel.
      try { document.documentElement.classList.add('is-note-swap-dragging-pending'); } catch {}
      const clearPending = () => { try { document.documentElement.classList.remove('is-note-swap-dragging-pending'); } catch {} };
      try { window.addEventListener('pointerup', clearPending, { once: true }); } catch {}
      try { window.addEventListener('pointercancel', clearPending, { once: true }); } catch {}
      const fn = (dragHandleListeners as any)?.onMouseDown;
      if (typeof fn === 'function') fn(e);
    } catch {}
  }, [dragHandleListeners, isInteractiveTarget, showMore]);

  const maybeBeginBodyDragPointer = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    try {
      if (showMore) return;
      const target = e.target as HTMLElement | null;
      if (isInteractiveTarget(target)) return;
      try { document.documentElement.classList.add('is-note-swap-dragging-pending'); } catch {}
      const clearPending = () => { try { document.documentElement.classList.remove('is-note-swap-dragging-pending'); } catch {} };
      try { window.addEventListener('pointerup', clearPending, { once: true }); } catch {}
      try { window.addEventListener('pointercancel', clearPending, { once: true }); } catch {}
      const fn = (dragHandleListeners as any)?.onPointerDown;
      if (typeof fn === 'function') fn(e);
    } catch {}
  }, [dragHandleListeners, isInteractiveTarget, showMore]);

  const maybeBeginBodyDragTouch = React.useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    try {
      if (showMore) return;
      const target = e.target as HTMLElement | null;
      if (isInteractiveTarget(target)) return;
      try { document.documentElement.classList.add('is-note-swap-dragging-pending'); } catch {}
      const clearPending = () => { try { document.documentElement.classList.remove('is-note-swap-dragging-pending'); } catch {} };
      try { window.addEventListener('touchend', clearPending, { once: true }); } catch {}
      try { window.addEventListener('touchcancel', clearPending, { once: true }); } catch {}
      const fn = (dragHandleListeners as any)?.onTouchStart;
      if (typeof fn === 'function') fn(e);
    } catch {}
  }, [dragHandleListeners, isInteractiveTarget, showMore]);

  const scheduleSnapPreview = React.useCallback((forceMeasure = false) => {
    if (snapRafRef.current != null) return;
    snapRafRef.current = requestAnimationFrame(() => {
      snapRafRef.current = null;
      const el = bodyRef.current;
      if (!el) return;
      try {
        // Only snap when something is actually clipped; avoid shrinking previews unnecessarily.
        const clipped = el.scrollHeight > el.clientHeight + 1;
        if (!clipped) {
          // Clear any previous snap.
          if (el.style.maxHeight) el.style.maxHeight = '';
          lastSnapUnitRef.current = null;
          lastSnapBaseRef.current = null;
          return;
        }

        // Measure how much vertical space the preview area *would* have without our snapping.
        // We only clear max-height on explicit recalc/resize to avoid ResizeObserver feedback loops.
        const prevMaxHeight = el.style.maxHeight;
        if (forceMeasure && prevMaxHeight) {
          el.style.maxHeight = '';
          void el.getBoundingClientRect();
        }

        const available = el.clientHeight;
        if (!Number.isFinite(available) || available <= 0) {
          if (forceMeasure && prevMaxHeight) el.style.maxHeight = prevMaxHeight;
          return;
        }

        let unit = 0;
        // Snap to computed line-height so we don't cut text mid-line.
        // For checklists, items can wrap (up to 4 lines), so row height isn't a stable unit.
        const lhSource = (noteItems && noteItems.length > 0)
          ? ((el.querySelector('.note-item-text') as HTMLElement | null) ?? el)
          : el;
        const lh = parseFloat(getComputedStyle(lhSource).lineHeight || '0');
        if (Number.isFinite(lh) && lh > 0) unit = lh;

        // Guardrails.
        if (!Number.isFinite(unit) || unit < 12) {
          if (prevMaxHeight) el.style.maxHeight = prevMaxHeight;
          return;
        }

        // If we're re-measuring, but base space & unit haven't changed, do nothing.
        if (
          forceMeasure &&
          lastSnapUnitRef.current != null &&
          lastSnapBaseRef.current != null &&
          Math.abs(lastSnapUnitRef.current - unit) < 0.5 &&
          Math.abs(lastSnapBaseRef.current - available) < 0.5
        ) {
          return;
        }

        const remainder = available % unit;
        // If we're already very close to a boundary, don't thrash.
        if (remainder < 2 || unit - remainder < 2) {
          // If we cleared max-height to measure, restore it.
          if (forceMeasure && prevMaxHeight) el.style.maxHeight = prevMaxHeight;
          return;
        }

        const snapped = Math.max(unit, Math.floor(available - remainder));
        // Apply the snap (shrink a tiny amount to end on a full row/line).
        el.style.maxHeight = `${snapped}px`;
        lastSnapUnitRef.current = unit;
        lastSnapBaseRef.current = available;
      } catch {
        // no-op
      }
    });
  }, [noteItems]);

  React.useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const check = () => {
      try {
        const bodyClipped = el.scrollHeight > el.clientHeight + 1;
        setPreviewClipped(bodyClipped);
      } catch {}
    };

    // Run after paint so layout has settled.
    const raf = requestAnimationFrame(() => {
      check();
      scheduleSnapPreview(true);
    });
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(() => {
        check();
        scheduleSnapPreview();
      });
      ro.observe(el);
    } catch {}

    const onRecalc = () => scheduleSnapPreview(true);
    window.addEventListener('notes-grid:recalc', onRecalc as any);
    window.addEventListener('resize', onRecalc as any);

    return () => {
      try { cancelAnimationFrame(raf); } catch {}
      try { ro && ro.disconnect(); } catch {}
      try { window.removeEventListener('notes-grid:recalc', onRecalc as any); } catch {}
      try { window.removeEventListener('resize', onRecalc as any); } catch {}
      if (snapRafRef.current != null) {
        try { cancelAnimationFrame(snapRafRef.current); } catch {}
        snapRafRef.current = null;
      }
    };
  }, [note.id, title, noteItems.length, showCompleted, rtHtmlFromY, textBody, images.length, labels.length, scheduleSnapPreview]);

  React.useEffect(() => {
    const el = imagesWrapRef.current;
    if (!imagesExpanded) return;
    if (!el) return;
    const GAP = 6;
    const compute = () => {
      try {
        const css = getComputedStyle(document.documentElement);
        const thumbRaw = css.getPropertyValue('--image-thumb-size') || '';
        const thumbW = Math.max(24, parseInt(String(thumbRaw).trim(), 10) || 96);
        const w = el.clientWidth || 0;
        const perRow = Math.max(1, Math.floor((w + GAP) / (thumbW + GAP)));
        setThumbsPerRow(perRow);
      } catch {}
    };
    compute();
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(() => compute());
      ro.observe(el);
    } catch {}
    window.addEventListener('resize', compute);
    window.addEventListener('notes-grid:recalc', compute as any);
    return () => {
      try { ro && ro.disconnect(); } catch {}
      window.removeEventListener('resize', compute);
      window.removeEventListener('notes-grid:recalc', compute as any);
    };
  }, [imagesExpanded]);

  React.useEffect(() => {
    if (!imagesExpanded) return;
    const computeDirection = () => {
      try {
        const card = noteRef.current as HTMLElement | null;
        const toggle = imagesToggleRef.current as HTMLElement | null;
        if (!card || !toggle) return;

        const toggleRect = toggle.getBoundingClientRect();
        const topReserve = (() => {
          // Sticky header + take-note region safety so expanded images aren't hidden behind them.
          const header = document.querySelector('.app-header') as HTMLElement | null;
          const take = document.querySelector('.take-note-sticky') as HTMLElement | null;
          const hb = header ? Math.max(0, Math.ceil(header.getBoundingClientRect().bottom)) : 56;
          const tb = take ? Math.max(0, Math.ceil(take.getBoundingClientRect().bottom)) : 64;
          return Math.max(hb, tb) + 8;
        })();

        const availableAbove = Math.max(0, toggleRect.top - topReserve);
        const availableBelow = Math.max(0, window.innerHeight - toggleRect.bottom - 12);
        const desired = (() => {
          const countFromNote = Number((note as any).imagesCount ?? 0);
          const count = Number.isFinite(countFromNote) && countFromNote > 0
            ? countFromNote
            : (Array.isArray(images) ? images.length : 0);
          const perRow = Math.max(1, Number(thumbsPerRow || 0) || 3);
          const rows = Math.max(1, Math.ceil(Math.max(1, count) / perRow));
          const css = getComputedStyle(document.documentElement);
          const thumbRaw = css.getPropertyValue('--image-thumb-size') || '';
          const thumbW = Math.max(24, parseInt(String(thumbRaw).trim(), 10) || 96);
          const GAP = 6;
          const padY = 16;
          const estimated = rows * thumbW + Math.max(0, rows - 1) * GAP + padY;
          return Math.min(260, Math.max(84, estimated));
        })();

        const shouldExpandDown = availableAbove < (desired + 8) && availableBelow >= Math.min(desired, availableAbove + 80);
        setImagesExpandDirection(shouldExpandDown ? 'down' : 'up');

        if (shouldExpandDown) {
          const nextTop = Math.max(8, Math.round(toggle.offsetTop + toggle.offsetHeight + 8));
          setImagesDownTop(nextTop);
        }
      } catch {}
    };

    computeDirection();
    window.addEventListener('resize', computeDirection);
    window.addEventListener('scroll', computeDirection, true);
    window.addEventListener('notes-grid:recalc', computeDirection as any);
    try { window.visualViewport?.addEventListener('resize', computeDirection as any); } catch {}
    try { window.visualViewport?.addEventListener('scroll', computeDirection as any); } catch {}

    return () => {
      window.removeEventListener('resize', computeDirection);
      window.removeEventListener('scroll', computeDirection, true);
      window.removeEventListener('notes-grid:recalc', computeDirection as any);
      try { window.visualViewport?.removeEventListener('resize', computeDirection as any); } catch {}
      try { window.visualViewport?.removeEventListener('scroll', computeDirection as any); } catch {}
    };
  }, [imagesExpanded, images.length, thumbsPerRow, note.id, (note as any).imagesCount]);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const { token, user } = useAuth();

  // Since `/api/notes` no longer ships full `images` arrays (to avoid huge payloads),
  // fetch images per-note only when the note indicates it has images.
  const imagesFetchInFlightRef = React.useRef(false);
  React.useEffect(() => {
    imagesFetchInFlightRef.current = false;
  }, [note.id]);
  React.useEffect(() => {
    if (!imagesExpanded) return;
    const count = Number((note as any).imagesCount ?? 0);
    const provided = (note as any).images;
    if (Array.isArray(provided) && provided.some((i: any) => i && typeof i.url === 'string' && String(i.url || '').length > 0)) return; // parent already provided image URLs
    if (!Number.isFinite(count) || count <= 0) return;
    if (Array.isArray(images) && images.length > 0) return;
    if (!token) return;
    if (imagesFetchInFlightRef.current) return;
    imagesFetchInFlightRef.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/notes/${note.id}/images`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        const imgs = Array.isArray(data?.images) ? data.images : [];
        const next = imgs
          .filter((img: any) => img && typeof img.url === 'string')
          .map((img: any) => ({ id: Number(img.id || Date.now()), url: String(img.url) }));
        setImages(next);
      } catch {}
      finally {
        imagesFetchInFlightRef.current = false;
      }
    })();
  }, [imagesExpanded, note.id, (note as any).imagesCount, (note as any).images, token, images]);

  function notifyImagesExpanded(next: boolean) {
    try { (onChange as any)?.({ type: 'imagesExpanded', noteId: note.id, imagesExpanded: !!next }); } catch {}
  }

  React.useEffect(() => {
    setImagesExpanded(!!(note as any).viewerImagesExpanded);
  }, [note.id, (note as any).viewerImagesExpanded]);

  async function persistImagesExpanded(next: boolean) {
    const result = await requestJsonOrQueue({
      method: 'PATCH',
      path: `/api/notes/${note.id}/prefs`,
      body: { imagesExpanded: !!next },
    });
    if (result.status === 'failed') {
      console.error('Failed to save image preview preference');
    }
  }
  const disableNoteCardLinks = (() => {
    try {
      const stored = localStorage.getItem('prefs.disableNoteCardLinks');
      if (stored !== null) return stored === 'true';
      const v = (user as any)?.disableNoteCardLinks;
      if (typeof v === 'boolean') return v;
    } catch {}
    return false;
  })();
  const disableNoteCardLinkClicksNow = !!disableNoteCardLinks;

  const [previewMenu, setPreviewMenu] = useState<{ x: number; y: number; previewId: number } | null>(null);
  const bodyLongPressTimerRef = useRef<number | null>(null);
  const bodyLongPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextBodyClickRef = useRef(false);
  const [previewMenuIsSheet, setPreviewMenuIsSheet] = useState(false);
  const [urlModal, setUrlModal] = useState<{ previewId: number; initialUrl: string } | null>(null);

  const isCoarsePointer = React.useMemo(() => {
    try {
      const mq = window.matchMedia;
      return !!(mq && (mq('(pointer: coarse)').matches || mq('(any-pointer: coarse)').matches));
    } catch {
      return false;
    }
  }, []);
  const canToggleChecklistPreview = !isCoarsePointer;

  function isMoreMenuLongPressExcluded(target: HTMLElement | null): boolean {
    try {
      if (!target) return false;
      // Don't hijack long-press for actual form controls / editing surfaces.
      if ((target as any).closest?.('input, textarea, select, [contenteditable="true"]')) return true;
      // Don't hijack long-press on checklist toggles.
      if ((target as any).closest?.('.note-checkbox')) return true;
      // Keep URL preview actions available via its own menu button.
      if ((target as any).closest?.('.link-preview-menu')) return true;
    } catch {}
    return false;
  }

  function maybeBeginMoreMenuLongPress(e: React.PointerEvent<any>) {
    try {
      // Mobile/PWA: long-press anywhere on the card (including images / URL previews)
      // to open the More menu. Avoid interactive controls where long-press is meaningful.
      if (showMore) return;
      const pt = String((e as any).pointerType || '');
      const touchLike = pt === 'touch' || isCoarsePointer;
      if (!touchLike) return;
      const target = (e.target as HTMLElement | null) || null;
      if (isMoreMenuLongPressExcluded(target)) return;

      clearBodyLongPress();
      bodyLongPressStartRef.current = { x: e.clientX, y: e.clientY };
      const x = e.clientX;
      const y = e.clientY;
      bodyLongPressTimerRef.current = window.setTimeout(() => {
        clearBodyLongPress();
        try {
          const root = document.documentElement;
          // Only cancel if drag has actually moved (not merely picked up).
          if (root.classList.contains('is-note-swap-dragging-moving') || root.classList.contains('is-note-rearrange-dragging')) return;
        } catch {}
        suppressNextBodyClickRef.current = true;
        try { setMoreAnchorPoint({ x, y }); } catch {}
        try { setShowMore(true); } catch {}
      }, 520);
    } catch {}
  }

  function maybeCancelMoreMenuLongPressOnMove(e: React.PointerEvent<any>) {
    try {
      const start = bodyLongPressStartRef.current;
      if (!start) return;
      const dx = Math.abs((e.clientX || 0) - start.x);
      const dy = Math.abs((e.clientY || 0) - start.y);
      if (dx > 10 || dy > 10) clearBodyLongPress();
    } catch {}
  }

  function clearBodyLongPress() {
    if (bodyLongPressTimerRef.current != null) window.clearTimeout(bodyLongPressTimerRef.current);
    bodyLongPressTimerRef.current = null;
    bodyLongPressStartRef.current = null;
  }

  React.useEffect(() => {
    try {
      const root = document.documentElement;
      if (showMore) {
        root.classList.add('is-note-more-menu-open');
        root.classList.remove('is-note-swap-dragging-pending');
        try { window.dispatchEvent(new CustomEvent('freemannotes:more-menu-open')); } catch {}
      } else {
        root.classList.remove('is-note-more-menu-open');
        try { window.dispatchEvent(new CustomEvent('freemannotes:more-menu-close')); } catch {}
      }
    } catch {}
    return () => {
      try { document.documentElement.classList.remove('is-note-more-menu-open'); } catch {}
    };
  }, [showMore]);

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
    const previous = Array.isArray((note as any)?.linkPreviews) ? (note as any).linkPreviews : [];
    const optimistic = previous.filter((p: any) => Number(p?.id) !== Number(previewId));
    try { onChange?.({ type: 'linkPreviews', noteId: note.id, linkPreviews: optimistic }); } catch {}

    try {
      const result = await requestJsonOrQueue({
        method: 'DELETE',
        path: `/api/notes/${note.id}/link-previews/${previewId}`,
      });
      if (result.status === 'failed') throw new Error('Failed to delete URL');
      if (result.status === 'ok') {
        const previews = Array.isArray(result.data?.previews) ? result.data.previews : optimistic;
        try { onChange?.({ type: 'linkPreviews', noteId: note.id, linkPreviews: previews }); } catch {}
      }
    } catch (e) {
      console.error(e);
      try { onChange?.({ type: 'linkPreviews', noteId: note.id, linkPreviews: previous }); } catch {}
      window.alert('Failed to delete URL');
    }
  }

  async function editPreview(previewId: number) {
    const currentUrl = (() => {
      try {
        const list = Array.isArray((note as any)?.linkPreviews) ? (note as any).linkPreviews : [];
        const found = list.find((p: any) => Number(p?.id) === Number(previewId));
        return found?.url ? String(found.url) : '';
      } catch { return ''; }
    })();
    setUrlModal({ previewId: Number(previewId), initialUrl: currentUrl });
  }

  async function submitEditPreview(previewId: number, nextUrl: string) {
    const previous = Array.isArray((note as any)?.linkPreviews) ? (note as any).linkPreviews : [];
    const optimistic = previous.map((p: any) => {
      if (Number(p?.id) !== Number(previewId)) return p;
      return { ...p, url: String(nextUrl || '').trim() };
    });
    try { onChange?.({ type: 'linkPreviews', noteId: note.id, linkPreviews: optimistic }); } catch {}

    try {
      const result = await requestJsonOrQueue({
        method: 'PATCH',
        path: `/api/notes/${note.id}/link-previews/${previewId}`,
        body: { url: nextUrl },
      });
      if (result.status === 'failed') throw new Error('Failed to edit URL');
      if (result.status === 'ok') {
        const previews = Array.isArray(result.data?.previews) ? result.data.previews : optimistic;
        try { onChange?.({ type: 'linkPreviews', noteId: note.id, linkPreviews: previews }); } catch {}
      }
    } catch (e) {
      console.error(e);
      try { onChange?.({ type: 'linkPreviews', noteId: note.id, linkPreviews: previous }); } catch {}
      window.alert('Failed to edit URL');
    }
  }

  React.useEffect(() => {
    const onCollectionsChanged = (ev: Event) => {
      try {
        const ce = ev as CustomEvent<any>;
        const detail = ce?.detail || {};
        if (detail?.invalidateAll) {
          setCollectionPathById({});
          return;
        }
        const ids = Array.isArray(detail?.ids) ? detail.ids : (Number.isFinite(Number(detail?.id)) ? [Number(detail.id)] : []);
        if (!ids.length) return;
        setCollectionPathById((prev) => {
          const next = { ...prev };
          for (const id of ids) {
            try { delete (next as any)[Number(id)]; } catch {}
          }
          return next;
        });
      } catch {}
    };

    try { window.addEventListener('collections:changed', onCollectionsChanged as any); } catch {}
    return () => {
      try { window.removeEventListener('collections:changed', onCollectionsChanged as any); } catch {}
    };
  }, []);

  const neededCollectionIdsKey = React.useMemo(() => {
    try {
      const ids = viewerCollections
        .map((c) => Number(c.id))
        .filter((id) => Number.isFinite(id));
      if (expandedMeta !== 'collections') return '';
      return ids.join(',');
    } catch {
      return '';
    }
  }, [viewerCollections, expandedMeta]);

  React.useEffect(() => {
    if (!token) return;
    if (!viewerCollections.length) return;

    const neededIds = (neededCollectionIdsKey ? neededCollectionIdsKey.split(',').map((s) => Number(s)).filter((n) => Number.isFinite(n)) : []);
    if (!neededIds.length) return;

    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        const missing = neededIds.filter((id) => !collectionPathById[id]);
        if (!missing.length) return;

        const results = await Promise.all(missing.map(async (id) => {
          try {
            const res = await fetch(`/api/collections/${id}/breadcrumb`, {
              headers: { Authorization: token ? `Bearer ${token}` : '' },
              signal: controller.signal,
            });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            const breadcrumb = Array.isArray(data?.breadcrumb) ? data.breadcrumb : [];
            const names = breadcrumb.map((b: any) => String(b?.name || '')).filter(Boolean);
            const path = names.join(' / ');
            return [id, path || (viewerCollections.find((c) => Number(c.id) === id)?.name || String(id))] as const;
          } catch {
            return [id, viewerCollections.find((c) => Number(c.id) === id)?.name || String(id)] as const;
          }
        }));

        if (cancelled) return;
        const patch: Record<number, string> = {};
        for (const [id, path] of results) patch[Number(id)] = String(path || '');
        setCollectionPathById((prev) => ({ ...prev, ...patch }));
      } catch {}
    })();

    return () => {
      cancelled = true;
      try { controller.abort(); } catch {}
    };
  }, [token, viewerCollections, neededCollectionIdsKey, collectionPathById]);
  // Subscribe to Yjs checklist for live card updates
  const ydoc = React.useMemo(() => new Y.Doc(), [note.id]);
  const collabRoom = React.useMemo(() => noteCollabRoomFromNote(note), [note.id, (note as any)?.createdAt]);
  const providerRef = React.useRef<WebsocketProvider | null>(null);
  const yarrayRef = React.useRef<Y.Array<Y.Map<any>> | null>(null);

  React.useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        cleanup = await bindYDocPersistence(collabRoom, ydoc);
        if (disposed && cleanup) {
          try { cleanup(); } catch {}
          cleanup = null;
        }
      } catch {}
    })();

    return () => {
      disposed = true;
      try { cleanup && cleanup(); } catch {}
    };
  }, [collabRoom, ydoc]);

  React.useEffect(() => {
    const room = collabRoom;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const serverUrl = `${proto}://${window.location.host}/collab`;
    const provider = new WebsocketProvider(serverUrl, room, ydoc);
    providerRef.current = provider;
    const yarr = ydoc.getArray<Y.Map<any>>('checklist');
    yarrayRef.current = yarr;
    const updateFromY = () => {
      try {
        if (yarr.length === 0) return; // avoid overwriting DB items until doc has content
        const arr = yarr.toArray().map((m) => ({
          id: (typeof m.get('id') === 'number' ? Number(m.get('id')) : undefined),
          uid: (m.get('uid') ? String(m.get('uid')) : undefined),
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
  }, [collabRoom, ydoc]);

  React.useEffect(() => {
    const onUploadSuccess = (evt: Event) => {
      try {
        const detail = (evt as CustomEvent<any>).detail || {};
        if (Number(detail.noteId) !== Number(note.id)) return;
        const image = detail.image || null;
        if (!image || typeof image !== 'object') return;
        const imageId = Number((image as any).id);
        const imageUrl = String((image as any).url || '');
        if (!Number.isFinite(imageId) || !imageUrl) return;
        const tempId = Number(detail.tempClientId);
        setImagesWithNotify((prev) => {
          const filtered = Number.isFinite(tempId)
            ? prev.filter((it: any) => Number(it?.id) !== tempId)
            : prev;
          if (filtered.some((it: any) => Number(it?.id) === imageId)) return filtered;
          return [...filtered, { id: imageId, url: imageUrl }];
        });
      } catch {}
    };

    window.addEventListener('freemannotes:offline-upload/success', onUploadSuccess as EventListener);
    return () => window.removeEventListener('freemannotes:offline-upload/success', onUploadSuccess as EventListener);
  }, [note.id]);

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
      // Only use Yjs-derived HTML after the provider signals a successful sync.
      let providerSynced = false;
      const compute = () => {
        try {
          if (!providerSynced) return; // avoid applying possibly-stale editor updates
          const html = ed?.getHTML() || '';
          const safe = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
          const plain = String(safe || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          setRtHtmlFromY(plain ? safe : null);
        } catch {}
      };
      ed.on('update', compute);
      // On provider sync, mark synced and compute once
      const provider = providerRef.current;
      const onSync = (isSynced: boolean) => {
        try {
          providerSynced = !!isSynced;
        } catch {}
        if (isSynced) compute();
      };
      provider?.on('sync', onSync);
      return () => { try { ed?.destroy(); } catch {}; try { provider?.off('sync', onSync as any); } catch {}; };
    } catch {
      // ignore editor init failures
    }
  }, [note.id, note.type, ydoc]);
  // Render a minimal formatted HTML preview from TipTap JSON stored in note.body
  function bodyHtmlPreview(): string {
    const raw = textBody || '';
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

  function hasVisibleHtmlContent(html: any): boolean {
    const plain = String(html || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return plain.length > 0;
  }

  // keep local bg in sync when the parent reloads the note (e.g., after page refresh)
  React.useEffect(() => {
    const base = ((note as any).viewerColor || note.color || '') as string;
    setBg(base || '');
  }, [note.id, (note as any).viewerColor, note.color]);
  React.useEffect(() => {
    setLabels((note.noteLabels || []).map((nl:any) => nl.label).filter((l:any) => l && typeof l.id === 'number' && typeof l.name === 'string'));
  }, [note.noteLabels]);
  React.useEffect(() => { setTitle(note.title || ''); }, [note.title]);
  React.useEffect(() => { setTextBody(note.body || ''); }, [note.id, note.body]);
  // Keep collaborators in sync with server-provided data on note reloads
  React.useEffect(() => {
    try {
      const arr = ((note as any).collaborators || []).map((c:any) => {
        const u = (c && (c.user || {}));
        if (u && typeof u.id === 'number' && typeof u.email === 'string') {
          const img = (typeof (u as any).userImageUrl === 'string')
            ? String((u as any).userImageUrl)
            : (typeof (c as any).userImageUrl === 'string' ? String((c as any).userImageUrl) : undefined);
          return { collabId: Number(c.id), userId: Number(u.id), email: String(u.email), name: (typeof u.name === 'string' ? String(u.name) : undefined), userImageUrl: img };
        }
        return null;
      }).filter(Boolean);
      setCollaborators(arr as any);
    } catch {}
  }, [(note as any).collaborators]);

  // track pointer down/up to distinguish clicks from small drags (prevents accidental reflows)
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = React.useRef(false);

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

    if (navigator.onLine === false) {
      return await queueNow();
    }

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

  async function onPickColor(color: string) {
    // first palette entry is the "Default" swatch (empty string).
    // Selecting it restores the app's default background and sets text to the original muted color.
    const next = color || '';
    const saveResult = await requestJsonOrQueue({
      method: 'PATCH',
      path: `/api/notes/${note.id}/prefs`,
      body: { color: next },
    });
    if (saveResult.status === 'failed') {
      try { window.alert('Failed to save color preference'); } catch {}
      return;
    }
    setBg(next || '');
    try { notifyColor(next); } catch {}
    setShowPalette(false);
  }

  async function attachImageUrl(url: string) {
    const normalizedUrl = String(url || '').trim();
    if (!normalizedUrl) return;
    const tempClientId = Date.now() + Math.floor(Math.random() * 1000);

    const addOptimistic = () => {
      setImagesWithNotify((s) => {
        const exists = s.some(x => String(x.url) === normalizedUrl || Number(x.id) === tempClientId);
        if (exists) return s;
        return [...s, { id: tempClientId, url: normalizedUrl }];
      });
    };

    const queueForLater = async (reason?: string) => {
      try {
        addOptimistic();
        await enqueueImageUpload(Number(note.id), normalizedUrl, tempClientId);
        void kickOfflineSync();
      } catch (err) {
        console.error('Failed to queue image upload', err);
      }
      if (reason) {
        try { window.alert(reason); } catch {}
      }
    };

    if (navigator.onLine === false) {
      await queueForLater('You are offline. Image queued and will upload automatically when back online.');
      return;
    }

    try {
      const res = await fetch(`/api/notes/${note.id}/images`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' }, body: JSON.stringify({ url: normalizedUrl }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const img = data.image || null;
      if (img && img.id && img.url) {
        setImagesWithNotify((s) => {
          const exists = s.some(x => Number(x.id) === Number(img.id));
          if (exists) return s;
          return [...s, { id: Number(img.id), url: String(img.url) }];
        });
      }
    } catch (err) {
      console.error('Failed to attach image', err);
      await queueForLater('Upload failed right now. Image queued and will retry automatically.');
    }
  }

  function onAddImageUrl(url?: string | null) {
    setShowImageDialog(false);
    if (!url) return;
    void attachImageUrl(String(url));
  }

  function onAddImageUrls(urls?: string[] | null) {
    setShowImageDialog(false);
    const list = Array.isArray(urls)
      ? urls.map((u) => String(u || '').trim()).filter((u) => !!u)
      : [];
    if (!list.length) return;
    (async () => {
      for (const u of list) {
        await attachImageUrl(u);
      }
    })();
  }

  async function toggleItemChecked(target: { id?: number; uid?: string }, checked: boolean) {
    const itemId = (typeof target?.id === 'number' && Number.isFinite(target.id)) ? Number(target.id) : undefined;
    const itemUid = (typeof target?.uid === 'string' && target.uid) ? String(target.uid) : undefined;

    const yarr = yarrayRef.current;
    if (yarr) {
      const idx = yarr.toArray().findIndex((m) => {
        const idVal = (typeof m.get('id') === 'number') ? Number(m.get('id')) : undefined;
        const uidVal = m.get('uid') ? String(m.get('uid')) : undefined;
        if (typeof itemId === 'number' && idVal === itemId) return true;
        if (itemUid && uidVal && uidVal === itemUid) return true;
        return false;
      });
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

    // No Yjs match (or Yjs unavailable): update local state by id/uid so preview remains interactive.
    setNoteItems((s) => s.map((it: any) => {
      const sameId = (typeof itemId === 'number' && typeof it?.id === 'number' && Number(it.id) === itemId);
      const sameUid = (!!itemUid && typeof it?.uid === 'string' && String(it.uid) === itemUid);
      if (!sameId && !sameUid) return it;
      return { ...it, checked };
    }));

    // Without a numeric id we cannot PATCH this specific row via REST endpoint.
    if (typeof itemId !== 'number') return;

    // Fallback to REST if Yjs not available
    const result = await requestJsonOrQueue({
      method: 'PATCH',
      path: `/api/notes/${note.id}/items/${itemId}`,
      body: { checked },
    });
    if (result.status === 'failed') {
      try { window.alert('Failed to update checklist item — please try again.'); } catch {}
    }
  }

  async function onConfirmReminder(draft: ReminderDraft) {
    setShowReminderPicker(false);
    if (!isOwner) {
      window.alert('Only the note owner can set reminders.');
      return;
    }
    try {
      // Request permission while we still have a user gesture.
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
      const updated = result.status === 'ok' ? (result.data?.note || {}) : {};
      try {
        (onChange as any)?.({
          type: 'reminder',
          noteId: Number(note.id),
          reminderDueAt: updated.reminderDueAt ?? draft.dueAtIso,
          reminderOffsetMinutes: (typeof updated.reminderOffsetMinutes === 'number') ? updated.reminderOffsetMinutes : draft.offsetMinutes,
          reminderAt: updated.reminderAt ?? null,
        });
      } catch {
        onChange && onChange();
      }
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
      try { (onChange as any)?.({ type: 'reminder', noteId: Number(note.id), reminderDueAt: null, reminderAt: null }); }
      catch { onChange && onChange(); }
    } catch (err) {
      console.error(err);
      window.alert('Failed to clear reminder');
    }
  }

  async function toggleArchive() {
    if (!!((note as any)?.trashedAt)) {
      window.alert('This note is in Trash. Restore it before archiving.');
      return;
    }
    const next = !archived;
    if (next) {
      const ok = window.confirm('Archive this note?');
      if (!ok) return;
    }

    const prev = archived;
    setArchived(next);
    const result = await requestJsonOrQueue({
      method: 'PATCH',
      path: `/api/notes/${note.id}`,
      body: { archived: next },
    });
    if (result.status === 'failed') {
      setArchived(prev);
      try { window.alert('Failed to archive note'); } catch {}
      return;
    }
    try { (onChange as any)?.({ type: 'archive', noteId: Number(note.id), archived: next }); } catch { onChange && onChange(); }
  }

  const isTrashed = !!((note as any)?.trashedAt);
  const ownerId = (typeof (note as any).owner?.id === 'number' ? Number((note as any).owner.id) : undefined);
  const currentUserId = (user && (user as any).id) ? Number((user as any).id) : undefined;
  const isOwner = !!(ownerId && currentUserId && ownerId === currentUserId);

  async function togglePinned() {
    if (isTrashed) return;
    if (!isOwner) {
      window.alert('Only the note owner can pin this note.');
      return;
    }
    const next = !pinned;
    const prev = pinned;
    setPinned(next);
    const result = await requestJsonOrQueue({
      method: 'PATCH',
      path: `/api/notes/${note.id}`,
      body: { pinned: next },
    });
    if (result.status === 'failed') {
      setPinned(prev);
      try { window.alert('Failed to update pinned state'); } catch {}
      return;
    }
    try { (onChange as any)?.({ type: 'pin', noteId: Number(note.id), pinned: next }); } catch { onChange && onChange(); }
  }

  async function onRestoreNote() {
    if (!isOwner) {
      window.alert('Only the note owner can restore this note.');
      return;
    }
    const result = await requestJsonOrQueue({ method: 'POST', path: `/api/notes/${note.id}/restore` });
    if (result.status === 'failed') {
      window.alert('Failed to restore note');
      return;
    }
    onChange && onChange();
  }

  async function onDeleteNote() {
    try {
      if (isTrashed) {
        if (!isOwner) {
          window.alert('Only the note owner can permanently delete this note.');
          return;
        }
        const ok = window.confirm('Delete this note permanently? This cannot be undone.');
        if (!ok) return;
        const purge = await requestJsonOrQueue({ method: 'DELETE', path: `/api/notes/${note.id}/purge` });
        if (purge.status === 'failed') throw new Error('Failed to purge note');
        onChange && onChange();
        return;
      }

      if (ownerId && currentUserId && ownerId !== currentUserId) {
        // Collaborator: remove self from this note
        const self = collaborators.find(c => typeof c.userId === 'number' && c.userId === currentUserId);
        if (self && typeof self.collabId === 'number') {
          const leave = await requestJsonOrQueue({ method: 'DELETE', path: `/api/notes/${note.id}/collaborators/${self.collabId}` });
          if (leave.status === 'failed') throw new Error('Failed to leave note');
          onChange && onChange();
          return;
        }
        window.alert('You are not the owner and could not find your collaborator entry to remove.');
        return;
      }
      // Owner: move note to trash for everyone
      const trash = await requestJsonOrQueue({ method: 'DELETE', path: `/api/notes/${note.id}` });
      if (trash.status === 'failed') throw new Error('Failed to trash note');
      onChange && onChange();
    } catch (err) {
      console.error(err);
      window.alert('Failed to move to trash or leave note');
    }
  }
  const [showLabels, setShowLabels] = useState(false);
  function onAddLabel() { setShowLabels(true); }
  async function onUncheckAll() {
    try {
      const updated = (noteItems || []).map((it:any, idx:number) => ({ id: it.id, content: it.content, checked: false, ord: typeof it.ord === 'number' ? it.ord : idx, indent: typeof it.indent === 'number' ? it.indent : 0 }));
      setNoteItems(updated);

      // Also update the Yjs checklist so it persists across refresh and syncs to collaborators.
      try {
        const yarr = yarrayRef.current;
        if (yarr && yarr.length > 0) {
          for (let i = 0; i < yarr.length; i++) {
            const m = yarr.get(i) as any;
            if (!m) continue;
            // Preserve id field if present (helps downstream DB sync assign IDs).
            try { if (typeof m.get('id') === 'number') m.set('id', m.get('id')); } catch {}
            try { m.set('checked', false); } catch {}
          }
        }
      } catch {}

      const result = await requestJsonOrQueue({
        method: 'PUT',
        path: `/api/notes/${note.id}/items`,
        body: { items: updated, replaceMissing: true },
      });
      if (result.status === 'failed') throw new Error('Failed to uncheck all items');
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

      // Also update the Yjs checklist so it persists across refresh and syncs to collaborators.
      try {
        const yarr = yarrayRef.current;
        if (yarr && yarr.length > 0) {
          for (let i = 0; i < yarr.length; i++) {
            const m = yarr.get(i) as any;
            if (!m) continue;
            try { if (typeof m.get('id') === 'number') m.set('id', m.get('id')); } catch {}
            try { m.set('checked', true); } catch {}
          }
        }
      } catch {}

      const result = await requestJsonOrQueue({
        method: 'PUT',
        path: `/api/notes/${note.id}/items`,
        body: { items: updated, replaceMissing: true },
      });
      if (result.status === 'failed') throw new Error('Failed to check all items');
      // no full reload needed; local state already reflects changes
    } catch (err) {
      console.error(err);
      window.alert('Failed to check all items');
    }
  }

  function onCollaboratorSelect(selected: { id: number; email: string; name?: string; userImageUrl?: string }) {
    setCollaborators((s) => {
      if (s.find(x => x.userId === selected.id)) return s;
      return [...s, { userId: selected.id, email: selected.email, name: selected.name, userImageUrl: selected.userImageUrl }];
    });
    setShowCollaborator(false);
    // Persist collaborator on server
    (async () => {
      try {
        const result = await requestJsonOrQueue({
          method: 'POST',
          path: `/api/notes/${note.id}/collaborators`,
          body: { email: selected.email },
        });
        if (result.status === 'failed') throw new Error('Failed to add collaborator');
        const collab = (result.status === 'ok') ? (result.data && (result.data.collaborator || null)) : null;
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
      const previous = [...collaborators];
      setCollaborators((s) => s.filter(c => c.collabId !== collabId));
    try {
        const result = await requestJsonOrQueue({ method: 'DELETE', path: `/api/notes/${note.id}/collaborators/${collabId}` });
        if (result.status === 'failed') throw new Error('Failed to remove collaborator');
      onChange && onChange();
    } catch (err) {
      console.error('Failed to remove collaborator', err);
        setCollaborators(previous);
      window.alert('Failed to remove collaborator');
    }
  }

  async function onSetCardWidth(span: 1 | 2 | 3) {
    try {
        const result = await requestJsonOrQueue({
          method: 'PATCH',
          path: `/api/notes/${note.id}`,
          body: { cardSpan: span },
      });
        if (result.status === 'failed') throw new Error('Failed to set card width');
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

  // When a custom note color is selected, apply it to the title/header strip only.
  const titleTextColor: string | undefined = normalizedBg ? contrastColorForBackground(normalizedBg) : undefined;

    // Compute participant chips (owner + collaborators), excluding current user
    const chipParticipants: Array<{ key: string | number; userId: number; name: string; email: string; userImageUrl?: string }> = [];
    try {
      const currentUserId = (user && (user as any).id) ? Number((user as any).id) : undefined;
      const owner = (note as any).owner || null;
      if (owner && typeof owner.id === 'number' && owner.id !== currentUserId) {
        const ownerName = (typeof owner.name === 'string' && owner.name) ? owner.name : String(owner.email || '').split("@")[0];
        chipParticipants.push({ key: `owner-${owner.id}`, userId: Number(owner.id), name: ownerName, email: String(owner.email || ''), userImageUrl: (typeof (owner as any).userImageUrl === 'string' ? String((owner as any).userImageUrl) : undefined) });
      }
      for (const c of collaborators) {
        if (typeof c.userId === 'number' && c.userId !== currentUserId) {
          const nm = (c.name && c.name.length) ? c.name : String(c.email).split('@')[0];
          chipParticipants.push({ key: c.collabId || `u-${c.userId}`, userId: Number(c.userId), name: nm, email: c.email, userImageUrl: c.userImageUrl });
        }
      }
    } catch {}

    const styleVars: React.CSSProperties = {
      opacity: archived ? 0.6 : 1,
      position: 'relative',
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      ['--note-title-bg' as any]: normalizedBg || undefined,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      ['--note-title-color' as any]: titleTextColor || undefined,
    } as React.CSSProperties;

    const isChecklistType = note.type === 'CHECKLIST' || (noteItems && noteItems.length > 0);
    const hasHeaderIcons = !!(pinned || (note as any)?.reminderDueAt);

    return (
    <article
      ref={(el) => { noteRef.current = el as HTMLElement | null; }}
      className={`note-card${expandedMeta ? ' is-meta-expanded' : ''}${imagesExpanded ? ' is-images-expanded' : ''}${labels.length > 0 ? ' has-labels' : ''}${viewerCollections.length > 0 ? ' has-collections' : ''}${(noteItems && noteItems.length > 0) ? ' has-checklist' : ''}${hasHeaderIcons ? ' has-header-icons' : ''}`}
      style={styleVars}
      {...(!title ? (dragHandleAttributes || {}) : {})}
      {...(!title ? (() => {
        const ls: any = dragHandleListeners || {};
        const { onKeyDown: _dragKeyDown, ...rest } = ls;
        return rest;
      })() : {})}
      data-clipped={previewClipped ? '1' : undefined}
      onClick={(e) => {
        const t = e.target as HTMLElement | null;
        if (isInteractiveTarget(t)) return;
        openEditor();
      }}
    >
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} />

      {(() => {
        const due = (note as any)?.reminderDueAt;
        const showBell = !!due;
        const showPin = !!pinned;
        if (!showBell && !showPin) return null;
        const dueMs = showBell ? Date.parse(String(due)) : NaN;

        const bellTitle = (() => {
          if (!showBell) return '';
          const d = Number.isFinite(dueMs) ? new Date(dueMs) : null;
          return d ? `Reminder: ${d.toLocaleString()}` : 'Reminder set';
        })();

        const bellUrgencyClass = Number.isFinite(dueMs) ? reminderDueColorClass(dueMs) : '';

        return (
          <div className="note-corner-icons">
            {showPin && (
              <div className="note-pin-icon" title="Pinned" aria-hidden>
                <FontAwesomeIcon icon={faPaperclip} />
              </div>
            )}
            {showBell && (
              <div className={`note-reminder-bell${bellUrgencyClass ? ` ${bellUrgencyClass}` : ''}`} title={bellTitle} aria-hidden>
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2z"/>
                  <path d="M18 8V7a6 6 0 1 0-12 0v1c0 3.5-2 5-2 5h16s-2-1.5-2-5z"/>
                </svg>
              </div>
            )}
            {showBell && isOwner && !isTrashed && (
              <button
                type="button"
                className={`note-reminder-clear-control${bellUrgencyClass ? ` ${bellUrgencyClass}` : ''}`}
                title="Mark reminder complete"
                aria-label="Mark reminder complete"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void onClearReminder();
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        );
      })()}

      <div
        className={`note-title${!String(title || '').trim() ? ' note-title--empty' : ''}${hasHeaderIcons ? ' note-title--with-icons' : ''}`}
        {...(dragHandleAttributes || {})}
        {...(() => {
          const ls: any = dragHandleListeners || {};
          const { onKeyDown: _dragKeyDown, ...rest } = ls;
          return rest;
        })()}
        style={{ cursor: 'pointer' }}
        onPointerDown={maybeBeginMoreMenuLongPress}
        onPointerUp={() => { clearBodyLongPress(); }}
        onPointerCancel={() => { clearBodyLongPress(); }}
        onPointerMove={maybeCancelMoreMenuLongPressOnMove}
        onClick={() => {
          try {
            if (suppressNextBodyClickRef.current) {
              suppressNextBodyClickRef.current = false;
              return;
            }
          } catch {}
          openEditor();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          try {
            const dragKeyDown = (dragHandleListeners as any)?.onKeyDown;
            if (typeof dragKeyDown === 'function') dragKeyDown(e);
          } catch {}
          if ((e as any).defaultPrevented) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openEditor();
          }
        }}
      >
        <span className={`note-type-icon${isChecklistType ? ' is-checklist' : ' is-note'}`} aria-hidden>
          <FontAwesomeIcon icon={isChecklistType ? faListCheck : faNoteSticky} />
        </span>
        <span className="note-title-text">{!String(title || '').trim() ? 'Add a title....' : title}</span>
      </div>

      {!!(note as any)?.offlinePendingCreate && (
        <div
          className={`note-sync-badge note-sync-badge--inline${(note as any)?.offlineSyncFailed ? ' note-sync-badge--failed' : ''}`}
          title={(note as any)?.offlineSyncFailed
            ? 'Sync delayed: still retrying in background. Will keep retrying automatically.'
            : 'Pending sync: this note was created offline and will finish syncing automatically.'}
          aria-label={(note as any)?.offlineSyncFailed ? 'Sync delayed' : 'Pending sync'}
        >
          {(note as any)?.offlineSyncFailed ? 'Sync delayed' : 'Syncing…'}
        </div>
      )}

      {(() => {
        const due = (note as any)?.reminderDueAt;
        if (!showDueIdentifier || !due) return null;
        const dueMs = Date.parse(String(due));
        if (!Number.isFinite(dueMs)) return null;
        const fullTitle = `Reminder: ${new Date(dueMs).toLocaleString()}`;
        const urgencyClass = reminderDueColorClass(dueMs);
        return (
          <div className={`note-reminder-due note-reminder-due--inline${urgencyClass ? ` ${urgencyClass}` : ''}`} title={fullTitle}>
            {formatReminderDueIdentifier(dueMs)}
          </div>
        );
      })()}

      {(() => {
        const imageCount = (() => {
          const fromNote = Number((note as any).imagesCount ?? 0);
          if (Number.isFinite(fromNote) && fromNote > 0) return fromNote;
          return Array.isArray(images) ? images.length : 0;
        })();
        const hasAnyMeta = (chipParticipants.length > 0) || (labels.length > 0) || (viewerCollections.length > 0) || (imageCount > 0);
        if (!hasAnyMeta) return null;

        const panelId = `note-meta-panel-${Number(note.id)}`;
        const withPath = viewerCollections
          .map((c) => ({ ...c, path: collectionPathById[Number(c.id)] || String(c.name || '') }))
          .sort((a, b) => String(a.path).localeCompare(String(b.path)));

        return (
          <div
            className={`note-meta${expandedMeta ? ' is-expanded' : ''}`}
            ref={metaWrapRef}
            onPointerDown={(e) => { e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); }}
            onBlurCapture={(e) => {
              const next = (e.relatedTarget as HTMLElement | null);
              if (next && (e.currentTarget as HTMLElement).contains(next)) return;
              setExpandedMeta(null);
            }}
          >
            <div className="note-meta-bar">
              {chipParticipants.length > 0 && (
                <button
                  type="button"
                  className={`chip chip--meta${expandedMeta === 'collab' ? ' is-active' : ''}`}
                  aria-expanded={expandedMeta === 'collab'}
                  aria-controls={panelId}
                  title="Collaborators"
                  onFocus={(e) => {
                    // On mobile, taps often trigger focus before click. If we open on focus,
                    // the subsequent click toggles it closed, which feels like a double-tap.
                    // Only auto-open on keyboard focus.
                    try {
                      const isFocusVisible = (e.currentTarget as any)?.matches?.(':focus-visible');
                      if (!isFocusVisible) return;
                    } catch {}
                    setExpandedMeta('collab');
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedMeta((s) => s === 'collab' ? null : 'collab');
                  }}
                >
                  <FontAwesomeIcon icon={faUsers} className="meta-fa-icon" />
                  <span>{chipParticipants.length}</span>
                </button>
              )}

              {labels.length > 0 && (
                <button
                  type="button"
                  className={`chip chip--meta${expandedMeta === 'labels' ? ' is-active' : ''}`}
                  aria-expanded={expandedMeta === 'labels'}
                  aria-controls={panelId}
                  title="Labels"
                  onFocus={(e) => {
                    try {
                      const isFocusVisible = (e.currentTarget as any)?.matches?.(':focus-visible');
                      if (!isFocusVisible) return;
                    } catch {}
                    setExpandedMeta('labels');
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedMeta((s) => s === 'labels' ? null : 'labels');
                  }}
                >
                  <FontAwesomeIcon icon={faTag} className="meta-fa-icon" />
                  <span>{labels.length}</span>
                </button>
              )}

              {viewerCollections.length > 0 && (
                <button
                  type="button"
                  className={`chip chip--meta chip--meta-collections${expandedMeta === 'collections' ? ' is-active' : ''}`}
                  aria-expanded={expandedMeta === 'collections'}
                  aria-controls={panelId}
                  title={`${viewerCollections.length} collections`}
                  onFocus={(e) => {
                    try {
                      const isFocusVisible = (e.currentTarget as any)?.matches?.(':focus-visible');
                      if (!isFocusVisible) return;
                    } catch {}
                    setExpandedMeta('collections');
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedMeta((s) => s === 'collections' ? null : 'collections');
                  }}
                >
                  <FontAwesomeIcon icon={faFolder} className="meta-fa-icon" />
                  <span>{viewerCollections.length}</span>
                </button>
              )}

              {imageCount > 0 && (
                <button
                  type="button"
                  className={`chip chip--meta${showImagesModal ? ' is-active' : ''}`}
                  aria-haspopup="dialog"
                  title={`${imageCount} images`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedMeta(null);
                    setShowImagesModal(true);
                  }}
                >
                  <FontAwesomeIcon icon={faImage} className="meta-fa-icon" />
                  <span>{imageCount}</span>
                </button>
              )}
            </div>

            <div
              id={panelId}
              className={`note-meta-panel${expandedMeta ? ' is-open' : ''}`}
              role="region"
              aria-label="Note metadata"
              ref={metaPanelRef}
              style={expandedMeta ? ({ height: Math.max(0, metaPanelHeight || 0) } as any) : ({ height: 0 } as any)}
            >
              {expandedMeta === 'collab' && (
                <div className="collab-chips" aria-label="Collaborators">
                  {chipParticipants.map((p, idx) => {
                    const mode = ((user as any)?.chipDisplayMode) || 'image+text';
                    const showImg = (mode === 'image' || mode === 'image+text') && !!p.userImageUrl;
                    const showText = (mode === 'text' || mode === 'image+text');
                    return (
                      <div key={`collab-${String(p.key)}-${idx}`} className={`note-meta-item${idx < metaVisibleCount ? ' is-visible' : ''}`}>
                        <button
                          type="button"
                          className="chip note-meta-chip"
                          title={p.email}
                          onClick={(e) => {
                            e.stopPropagation();
                              setExpandedMeta(null);
                            try { (onChange as any)?.({ type: 'filter:collaborator', noteId: Number(note.id), userId: Number(p.userId), name: String(p.name || '') }); } catch {}
                          }}
                        >
                          {!showImg ? (
                            <FontAwesomeIcon icon={faUser} className="note-meta-chip__icon" />
                          ) : null}
                          {showImg ? (
                            <img src={p.userImageUrl!} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover' }} />
                          ) : null}
                          {showText ? (<span className="note-meta-chip__text">{p.name}</span>) : null}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {expandedMeta === 'labels' && (
                <div className="label-chips" aria-label="Labels">
                  {labels.map((l, idx) => (
                    <div key={`label-${Number(l.id)}-${idx}`} className={`note-meta-item${idx < metaVisibleCount ? ' is-visible' : ''}`}>
                      <button
                        type="button"
                        className="chip note-meta-chip"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedMeta(null);
                          try { (onChange as any)?.({ type: 'filter:labels', noteId: Number(note.id), labelId: Number(l.id), labelName: String(l.name || '') }); } catch {}
                        }}
                      >
                        <FontAwesomeIcon icon={faTag} className="note-meta-chip__icon" />
                        <span className="note-meta-chip__text">{l.name}</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {expandedMeta === 'collections' && (
                <div className="note-collections" aria-label="Collections">
                  <div className="note-collections-list" role="list">
                    {withPath.map((c, idx) => (
                      <div key={`collection-${Number(c.id)}-${idx}`} className={`note-meta-item${idx < metaVisibleCount ? ' is-visible' : ''}`}
                        role="listitem"
                      >
                        <button
                          type="button"
                          className="chip note-meta-chip note-collection-chip"
                          title={c.path}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedMeta(null);
                            try { (onChange as any)?.({ type: 'filter:collection', noteId: Number(note.id), collectionId: Number(c.id), collectionName: String(c.name || '') }); } catch {}
                          }}
                        >
                          <FontAwesomeIcon icon={faFolder} className="note-meta-chip__icon" />
                          <span className="note-meta-chip__text">{c.path}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </div>
        );
      })()}

      <div
        className="note-body"
        ref={bodyRef}
        onMouseDown={maybeBeginBodyDragMouse}
        onPointerDown={(e) => {
          maybeBeginMoreMenuLongPress(e);
          maybeBeginBodyDragPointer(e);
        }}
        onTouchStart={maybeBeginBodyDragTouch}
        onPointerUp={() => { clearBodyLongPress(); }}
        onPointerCancel={() => { clearBodyLongPress(); }}
        onPointerMove={maybeCancelMoreMenuLongPressOnMove}
        onClickCapture={(e) => {
          try {
            if (suppressNextBodyClickRef.current) {
              suppressNextBodyClickRef.current = false;
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            if (!disableNoteCardLinkClicksNow) return;
            const target = e.target as HTMLElement | null;
            const a = target && (target as any).closest ? (target as any).closest('a') as HTMLAnchorElement | null : null;
            if (!a || !a.getAttribute) return;
            const href = a.getAttribute('href');
            if (!href) return;
            e.preventDefault();
            e.stopPropagation();
            openEditor();
          } catch {}
        }}
        onClick={() => {
          try {
            if (suppressNextBodyClickRef.current) {
              suppressNextBodyClickRef.current = false;
              return;
            }
          } catch {}
          openEditor();
        }}
      >
        {noteItems && noteItems.length > 0 ? (
          <div>
            {/** Show incomplete first, then optionally completed items. Preserve indent in preview. */}
            <div className="note-items-list">
              {(noteItems.filter((it:any) => !it.checked)).map((it, idx) => (
                <div key={`item-${(typeof (it as any)?.uid === 'string' && (it as any).uid) ? String((it as any).uid) : (typeof it.id === 'number' ? String(it.id) : 'i')}-${idx}`} className="note-item" style={{ display: 'flex', gap: 8, alignItems: previewRowAlignItems, marginLeft: ((it.indent || 0) * 16) }}>
                  <button
                    className={`note-checkbox ${it.checked ? 'checked' : ''}`}
                    type="button"
                    disabled={!canToggleChecklistPreview}
                    onPointerDown={(e) => { try { e.stopPropagation(); } catch {} }}
                    onPointerUp={(e) => { try { e.stopPropagation(); } catch {} }}
                    onMouseDown={(e) => { try { e.stopPropagation(); } catch {} }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canToggleChecklistPreview) return;
                      const id = (typeof (it as any)?.id === 'number' && Number.isFinite((it as any)?.id)) ? Number((it as any).id) : undefined;
                      const uid = (typeof (it as any)?.uid === 'string' && (it as any).uid) ? String((it as any).uid) : undefined;
                      if (typeof id !== 'number' && !uid) return;
                      void toggleItemChecked({ id, uid }, !it.checked);
                    }}
                    aria-pressed={!!it.checked}
                    aria-disabled={!canToggleChecklistPreview}
                    style={{ background: 'var(--checkbox-bg)', border: '2px solid var(--checkbox-border)', color: 'var(--checkbox-stroke)' }}
                  >
                    {it.checked && (
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
                        <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                  <div className="note-item-text">
                    <div className="rt-html" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(String(it.content || ''), { USE_PROFILES: { html: true } }) }} />
                  </div>
                </div>
              ))}
            </div>

            {/** Completed items block */}
            {noteItems.some((it:any) => it.checked) && (
              <div style={{ marginTop: 6 }}>
                <button className="btn completed-toggle" onClick={(e) => {
                  try { e.stopPropagation(); } catch {}
                  setShowCompleted(s => {
                    const next = !s;
                    try {
                      if (myDeviceKey) localStorage.setItem(`fn.note.showCompleted.${myDeviceKey}.${note.id}`, String(next));
                    } catch {}
                    return next;
                  });
                }} aria-expanded={showCompleted} aria-controls={`completed-${note.id}`}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ transform: showCompleted ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>{'▸'}</span>
                    <span>{noteItems.filter((it:any)=>it.checked).length} completed items</span>
                  </span>
                </button>
              </div>
            )}

            {showCompleted && noteItems.some((it:any) => it.checked) && (
              <div className="note-items-list" style={{ marginTop: 6 }}>
                {noteItems.filter((it:any) => it.checked).map((it, idx) => (
                  <div key={`c-${(typeof (it as any)?.uid === 'string' && (it as any).uid) ? String((it as any).uid) : (typeof it.id === 'number' ? String(it.id) : 'i')}-${idx}`} className="note-item completed" style={{ display: 'flex', gap: 8, alignItems: previewRowAlignItems, marginLeft: ((it.indent || 0) * 16), opacity: 0.7 }}>
                    <button
                      className={`note-checkbox ${it.checked ? 'checked' : ''}`}
                      type="button"
                      disabled={!canToggleChecklistPreview}
                      onPointerDown={(e) => { try { e.stopPropagation(); } catch {} }}
                      onPointerUp={(e) => { try { e.stopPropagation(); } catch {} }}
                      onMouseDown={(e) => { try { e.stopPropagation(); } catch {} }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!canToggleChecklistPreview) return;
                        const id = (typeof (it as any)?.id === 'number' && Number.isFinite((it as any)?.id)) ? Number((it as any).id) : undefined;
                        const uid = (typeof (it as any)?.uid === 'string' && (it as any).uid) ? String((it as any).uid) : undefined;
                        if (typeof id !== 'number' && !uid) return;
                        void toggleItemChecked({ id, uid }, !it.checked);
                      }}
                      aria-pressed={!!it.checked}
                      aria-disabled={!canToggleChecklistPreview}
                      style={{ background: 'var(--checkbox-bg)', border: '2px solid var(--checkbox-border)', color: 'var(--checkbox-stroke)' }}
                    >
                      {it.checked && (
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
                          <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                    <div className="note-item-text" style={{ textDecoration: 'line-through' }}>
                      <div className="rt-html" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(String(it.content || ''), { USE_PROFILES: { html: true } }) }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          (hasVisibleHtmlContent(rtHtmlFromY) || textBody) ? (
            <div className="note-html" dangerouslySetInnerHTML={{ __html: (hasVisibleHtmlContent(rtHtmlFromY) ? String(rtHtmlFromY) : bodyHtmlPreview()) }} />
          ) : null
        )}
      </div>

      {null}

      {(() => {
        try {
          const listRaw = Array.isArray((note as any).linkPreviews) ? (note as any).linkPreviews : [];
          const list = listRaw
            .map((p: any) => ({
              id: Number(p?.id),
              url: String(p?.url || ''),
              title: (p?.title == null ? null : String(p.title)),
              imageUrl: (p?.imageUrl == null ? null : String(p.imageUrl)),
              domain: (p?.domain == null ? null : String(p.domain)),
            }))
            .filter((p: any) => Number.isFinite(p.id) && p.url);
          if (!list.length) return null;
          const max = 3;
          const visible = list.slice(0, max);
          const hiddenCount = Math.max(0, list.length - max);
          return (
            <div
              className="note-link-previews"
              onPointerDown={maybeBeginMoreMenuLongPress}
              onPointerUp={() => { clearBodyLongPress(); }}
              onPointerCancel={() => { clearBodyLongPress(); }}
              onPointerMove={maybeCancelMoreMenuLongPressOnMove}
              onClickCapture={(e) => {
                try {
                  if (!suppressNextBodyClickRef.current) return;
                  suppressNextBodyClickRef.current = false;
                  e.preventDefault();
                  e.stopPropagation();
                } catch {}
              }}
              onClick={(e) => { try { e.stopPropagation(); } catch {} }}
            >
              {visible.map((p: any, idx: number) => {
                const domain = (p.domain || (() => { try { return new URL(p.url).hostname.replace(/^www\./i, ''); } catch { return ''; } })());
                return (
                  <div
                    key={`preview-${Number(p.id)}-${idx}`}
                    className="link-preview-row note-link-preview"
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setPreviewMenu({ x: e.clientX, y: e.clientY, previewId: p.id }); }}
                  >
                    <a
                      className="link-preview"
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={p.title || domain || p.url}
                      onClick={(e) => {
                        try {
                          if (!disableNoteCardLinkClicksNow) return;
                          e.preventDefault();
                          e.stopPropagation();
                          openEditor();
                        } catch {}
                      }}
                    >
                      <div className="link-preview-image" aria-hidden>
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt="" loading="lazy" />
                        ) : (
                          <svg viewBox="0 0 24 24" aria-hidden focusable="false"><path d="M9.17 14.83a3 3 0 0 1 0-4.24l2.83-2.83a3 3 0 1 1 4.24 4.24l-.88.88" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M14.83 9.17a3 3 0 0 1 0 4.24l-2.83 2.83a3 3 0 1 1-4.24-4.24l.88-.88" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        )}
                      </div>
                      <div className="link-preview-meta">
                        <div className="link-preview-title">{p.title || domain || p.url}</div>
                        <div className="link-preview-domain">{domain || p.url}</div>
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
              {hiddenCount > 0 && (
                <div className="link-preview-more">+{hiddenCount} more</div>
              )}
            </div>
          );
        } catch { return null; }
      })()}

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



      {/* Hover zone to reveal footer only near the bottom */}
      <div className="footer-hover-zone" aria-hidden />
      {/* Protected footer region for actions (not affected by note bg/text color) */}
      <div className="note-footer" aria-hidden={false}>
        <div className="note-actions">
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

          {!!(note as any)?.reminderDueAt && isOwner && !isTrashed && (
            <button
              className="tiny"
              onClick={() => { void onClearReminder(); }}
              aria-label="Mark reminder complete"
              title="Mark reminder complete"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}

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

          <button
            className="tiny"
            onClick={toggleArchive}
            aria-label={archived ? 'Unarchive' : 'Archive'}
            title={isTrashed ? 'Cannot archive from Trash' : (archived ? 'Unarchive' : 'Archive')}
            disabled={isTrashed}
            style={isTrashed ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
          >
            {archived ? (
              // Unarchive icon (box with upward arrow)
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M20.54 5.23L19.4 4H4.6L3.46 5.23 3 6v2h18V6l-.46-.77zM6 10v9h12v-9H6z"/>
                <path d="M12 17l-4-4h3V9h2v4h3l-4 4z"/>
              </svg>
            ) : (
              // Archive icon
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M20.54 5.23L19.4 4H4.6L3.46 5.23 3 6v2h18V6l-.46-.77zM6 10v9h12V10H6zm3 2h6v2H9v-2z"/>
              </svg>
            )}
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
          itemsCount={isTrashed ? 2 : 9}
          onClose={() => setShowMore(false)}
          pinned={pinned}
          onTogglePin={(!isTrashed && isOwner) ? togglePinned : undefined}
          onAddCollaborator={isTrashed ? undefined : (() => setShowCollaborator(true))}
          onAddImage={isTrashed ? undefined : (() => setShowImageDialog(true))}
          onAddReminder={(isTrashed || !isOwner) ? undefined : (() => setShowReminderPicker(true))}
          onDelete={onDeleteNote}
          deleteLabel={isTrashed ? 'Delete permanently' : (isOwner ? 'Move to trash' : 'Leave note')}
          onRestore={isTrashed && isOwner ? onRestoreNote : undefined}
          restoreLabel="Restore"
          onMoveToCollection={isTrashed ? undefined : (() => setShowMoveToCollection(true))}
          onAddLabel={isTrashed ? undefined : onAddLabel}
          onUncheckAll={isTrashed ? undefined : ((note.type === 'CHECKLIST' || (noteItems && noteItems.length > 0)) ? onUncheckAll : undefined)}
          onCheckAll={isTrashed ? undefined : ((note.type === 'CHECKLIST' || (noteItems && noteItems.length > 0)) ? onCheckAll : undefined)}
          onSetWidth={isTrashed ? undefined : onSetCardWidth}
        />
      )}

      {showMoveToCollection && (
        <MoveToCollectionModal
          noteId={Number(note.id)}
          onClose={() => setShowMoveToCollection(false)}
          onChanged={(collections) => {
            try {
              const next = Array.isArray(collections)
                ? collections
                    .map((c: any) => ({ id: Number(c.id), name: String(c.name || ''), parentId: (c.parentId == null ? null : Number(c.parentId)) }))
                    .filter((c: any) => Number.isFinite(c.id) && c.name.length)
                : [];
              setViewerCollections(next);
            } catch {}
            try { (onChange as any)?.({ type: 'collections', noteId: Number(note.id), collections }); } catch {}
          }}
        />
      )}
      {showLabels && (
        <LabelsDialog
          noteId={note.id}
          onClose={() => setShowLabels(false)}
          onUpdated={(ls) => {
            setLabels(ls);
            try { (onChange as any)?.({ type: 'labels', noteId: note.id, labels: ls }); } catch {}
          }}
        />
      )}

      <UrlEntryModal
        open={!!urlModal}
        title="Edit URL preview"
        initialUrl={urlModal?.initialUrl}
        onCancel={() => setUrlModal(null)}
        onSubmit={(url) => {
          const st = urlModal;
          setUrlModal(null);
          if (!st) return;
          submitEditPreview(Number(st.previewId), String(url));
        }}
      />

      {showCollaborator && (
        <CollaboratorModal
          onClose={() => setShowCollaborator(false)}
          onSelect={onCollaboratorSelect}
          current={(() => {
            const arr: Array<{ collabId?: number; userId: number; email: string; name?: string; userImageUrl?: string }> = [];
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
              if (typeof c.userId === 'number') {
                arr.push({ collabId: c.collabId, userId: c.userId, email: c.email, name: c.name, userImageUrl: c.userImageUrl });
              }
            }
            return arr;
          })()}
          ownerId={(typeof (note as any).owner?.id === 'number' ? Number((note as any).owner.id) : ((user as any)?.id))}
          onRemove={onRemoveCollaborator}
        />
      )}

      {showPalette && <ColorPalette anchorRef={noteRef} onPick={onPickColor} onClose={() => setShowPalette(false)} />}

      {showImageDialog && <ImageDialog onClose={() => setShowImageDialog(false)} onAdd={onAddImageUrl} onAddMany={onAddImageUrls} />}
      {showImagesModal && (
        <NoteImagesModal
          noteId={Number(note.id)}
          initialImages={images}
          onClose={() => setShowImagesModal(false)}
          onImagesChanged={(next) => {
            try { setImagesWithNotify(() => next); } catch {}
          }}
        />
      )}

      {showReminderPicker && (
        <ReminderPicker
          onClose={() => setShowReminderPicker(false)}
          onConfirm={onConfirmReminder}
          onClear={((note as any)?.reminderDueAt ? onClearReminder : undefined)}
          initialDueAtIso={(note as any)?.reminderDueAt || null}
          initialOffsetMinutes={typeof (note as any)?.reminderOffsetMinutes === 'number' ? Number((note as any).reminderOffsetMinutes) : 30}
        />
      )}
      {showEditor && (
        <ChecklistEditor
          note={{ ...note, items: noteItems, images }}
          noteBg={bg}
          onCollaboratorsChanged={(next) => { try { setCollaborators(next as any); } catch {} }}
          onColorChanged={(next: string) => {
            try {
              const v = String(next || '');
              setBg(v);
              notifyColor(v);
            } catch {}
          }}
          onClose={() => setShowEditor(false)}
          onSaved={({ items, title }) => { setNoteItems(items); setTitle(title); }}
          onImagesUpdated={(imgs) => { setImagesWithNotify(() => imgs); }}
          moreMenu={{
            onDelete: onDeleteNote,
            deleteLabel: isTrashed ? 'Delete permanently' : undefined,
            onRestore: (isTrashed && isOwner) ? onRestoreNote : undefined,
            restoreLabel: 'Restore',
            pinned,
            onTogglePin: (!isTrashed && isOwner) ? togglePinned : undefined,
            onAddLabel: isTrashed ? undefined : onAddLabel,
            onMoveToCollection: isTrashed ? undefined : (() => setShowMoveToCollection(true)),
            onUncheckAll: isTrashed ? undefined : onUncheckAll,
            onCheckAll: isTrashed ? undefined : onCheckAll,
            onSetWidth: isTrashed ? undefined : onSetCardWidth,
          }}
        />
      )}
      {showTextEditor && (
        <RichTextEditor
          note={{ ...note, images, body: textBody }}
          noteBg={bg}
          onCollaboratorsChanged={(next) => { try { setCollaborators(next as any); } catch {} }}
          onColorChanged={(next: string) => {
            try {
              const v = String(next || '');
              setBg(v);
              notifyColor(v);
            } catch {}
          }}
          onClose={() => setShowTextEditor(false)}
          onSaved={({ title, body }) => { setTitle(title); setTextBody(String(body || '')); }}
          onImagesUpdated={(imgs) => { setImagesWithNotify(() => imgs); }}
          moreMenu={{
            onDelete: onDeleteNote,
            deleteLabel: isTrashed ? 'Delete permanently' : undefined,
            onRestore: (isTrashed && isOwner) ? onRestoreNote : undefined,
            restoreLabel: 'Restore',
            pinned,
            onTogglePin: (!isTrashed && isOwner) ? togglePinned : undefined,
            onAddLabel: isTrashed ? undefined : onAddLabel,
            onMoveToCollection: isTrashed ? undefined : (() => setShowMoveToCollection(true)),
            onSetWidth: isTrashed ? undefined : onSetCardWidth,
          }}
        />
      )}
    </article>
  );
}
