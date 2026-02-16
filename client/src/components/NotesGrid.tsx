import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  pointerWithin,
  type DragCancelEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import NoteCard from "./NoteCard";
import { useAuth } from "../authContext";
import { getOrCreateDeviceProfile } from "../lib/deviceProfile";
import TakeNoteBar from "./TakeNoteBar";
import MobileCreateModal from "./MobileCreateModal";
import ConfirmDialog from "./ConfirmDialog";
import ImageLightbox from "./ImageLightbox";
import { DEFAULT_SORT_CONFIG, type SortConfig } from '../sortTypes';
import {
  enqueueNotesOrderPatch,
  getSyncState,
  kickOfflineSync,
  loadCachedNotes,
  saveCachedNotes,
  setSyncTokenProvider,
  subscribeSyncState,
} from '../lib/offline';

type NoteLabelLite = { id: number; name: string };
type NoteImageLite = { id: number; url?: string; ocrSearchText?: string | null; ocrText?: string | null; ocrStatus?: string | null; createdAt?: string | null };
type ViewerCollectionLite = { id: number; name: string; parentId: number | null };
const MOBILE_FAB_ICON = '/icons/version.png';

function normalizeForSearch(input: any): string {
  try {
    return String(input || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/[\t\r\n\f\v]+/g, ' ')
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  } catch {
    return String(input || '').toLowerCase().trim();
  }
}

function buildNoteLoadSignature(note: any): string {
  const id = Number((note as any)?.id);
  const updatedAt = String((note as any)?.updatedAt || '');
  const title = String((note as any)?.title || '');
  const body = String((note as any)?.body || '');
  const pinned = (note as any)?.pinned ? '1' : '0';
  const archived = (note as any)?.archived ? '1' : '0';
  const trashedAt = String((note as any)?.trashedAt || '');
  const reminderDueAt = String((note as any)?.reminderDueAt || '');
  const reminderOffsetMinutes = String((note as any)?.reminderOffsetMinutes ?? '');
  const reminderAt = String((note as any)?.reminderAt || '');
  const imagesExpanded = (note as any)?.viewerImagesExpanded ? '1' : '0';
  const noteLabels = Array.isArray((note as any)?.noteLabels) ? (note as any).noteLabels : [];
  const labelsSig = noteLabels
    .map((nl: any) => Number((nl as any)?.label?.id || (nl as any)?.id || 0))
    .filter((n: number) => Number.isFinite(n) && n > 0)
    .sort((a: number, b: number) => a - b)
    .join(',');
  const images = Array.isArray((note as any)?.images) ? (note as any).images : [];
  const imagesSig = images
    .map((img: any) => {
      const imgId = Number((img as any)?.id || 0);
      const status = String((img as any)?.ocrStatus || '');
      const textLen = String((img as any)?.ocrText || '').length;
      const searchLen = String((img as any)?.ocrSearchText || '').length;
      return `${imgId}:${status}:${textLen}:${searchLen}`;
    })
    .sort()
    .join(',');
  const offlinePending = (note as any)?.offlinePendingCreate ? '1' : '0';
  const offlineFailed = (note as any)?.offlineSyncFailed ? '1' : '0';
  const offlineOpId = String((note as any)?.offlineOpId || '');

  return [
    id,
    updatedAt,
    title,
    body,
    pinned,
    archived,
    trashedAt,
    reminderDueAt,
    reminderOffsetMinutes,
    reminderAt,
    imagesExpanded,
    labelsSig,
    imagesSig,
    offlinePending,
    offlineFailed,
    offlineOpId,
  ].join('|');
}

function buildNotesLoadSignature(notes: any[]): string {
  const list = Array.isArray(notes) ? notes : [];
  return list.map(buildNoteLoadSignature).join('||');
}

function dedupeNotesById(notes: any[]): any[] {
  const list = Array.isArray(notes) ? notes : [];
  if (list.length <= 1) return list;

  const out: any[] = [];
  const idxById = new Map<number, number>();
  for (const note of list) {
    const id = Number((note as any)?.id);
    if (!Number.isFinite(id)) {
      out.push(note);
      continue;
    }
    const existingIdx = idxById.get(id);
    if (existingIdx == null) {
      idxById.set(id, out.length);
      out.push(note);
      continue;
    }
    const existing = out[existingIdx];
    const existingPending = !!(existing as any)?.offlinePendingCreate;
    const incomingPending = !!(note as any)?.offlinePendingCreate;
    const preferred = (existingPending && !incomingPending)
      ? ({ ...existing, ...note, offlinePendingCreate: true, offlineOpId: (existing as any)?.offlineOpId || (note as any)?.offlineOpId })
      : ({ ...existing, ...note });
    out[existingIdx] = preferred;
  }
  return out;
}

function mergePendingOptimisticNotes(serverNotes: any[], currentNotes: any[]): any[] {
  const server = Array.isArray(serverNotes) ? serverNotes : [];
  const current = Array.isArray(currentNotes) ? currentNotes : [];
  if (!current.length) return dedupeNotesById(server);

  const serverIds = new Set<number>();
  for (const n of server) {
    const id = Number((n as any)?.id);
    if (Number.isFinite(id)) serverIds.add(id);
  }

  const pending = current.filter((n: any) => {
    const pendingCreate = !!(n as any)?.offlinePendingCreate;
    const opId = String((n as any)?.offlineOpId || '');
    const id = Number((n as any)?.id);
    return pendingCreate && !!opId && !serverIds.has(id);
  });

  const merged = pending.length ? [...pending, ...server] : server;
  return dedupeNotesById(merged);
}

const SwapNoteItem = React.memo(function SwapNoteItem({
  note,
  setItemRef,
  isDragSource,
  isDragTarget,
  disabled,
  onChange,
  openRequest,
  onOpenRequestHandled,
  style,
}: {
  note: any;
  setItemRef: (el: HTMLElement | null, noteId: number) => void;
  isDragSource: boolean;
  isDragTarget: boolean;
  disabled: boolean;
  onChange: (evt?: any) => void;
  openRequest?: number;
  onOpenRequestHandled?: (noteId: number) => void;
  style?: React.CSSProperties;
}) {
  const noteId = Number(note?.id);
  const { setNodeRef: setDragRef, listeners, attributes } = useDraggable({ id: noteId, disabled });
  const { setNodeRef: setDropRef } = useDroppable({ id: noteId });

  const setRefs = useCallback((el: HTMLElement | null) => {
    setDragRef(el);
    setDropRef(el);
    setItemRef(el, noteId);
  }, [setDragRef, setDropRef, setItemRef, noteId]);

  const cls = (isDragSource ? ' note-drag-source' : '') + (isDragTarget ? ' note-drag-target' : '');

  return (
    <div
      data-note-id={noteId}
      ref={setRefs}
      className={cls.trim()}
      style={style}
    >
      <NoteCard
        note={note}
        onChange={onChange}
        openRequest={openRequest}
        onOpenRequestHandled={onOpenRequestHandled}
        dragHandleAttributes={disabled ? undefined : (attributes as any)}
        dragHandleListeners={disabled ? undefined : (listeners as any)}
      />
    </div>
  );
});

export default function NotesGrid({
  selectedLabelIds = [],
  selectedCollectionId = null,
  collectionStack = [],
  selectedCollaboratorId = null,
  searchQuery = '',
  sortConfig = DEFAULT_SORT_CONFIG,
  viewMode = 'cards',
  onClearAllFilters,
  onSetSelectedLabelIds,
  onSetSelectedCollaboratorId,
  onSelectCollectionById,
  onSetCollectionStack,
  onSetSearchQuery,
  onSortConfigChange,
}: {
  selectedLabelIds?: number[];
  selectedCollectionId?: number | null;
  collectionStack?: Array<{ id: number; name: string }>;
  selectedCollaboratorId?: number | null;
  searchQuery?: string;
  sortConfig?: SortConfig;
  viewMode?: 'cards' | 'list-1' | 'list-2';
  onClearAllFilters?: () => void;
  onSetSelectedLabelIds?: (ids: number[]) => void;
  onSetSelectedCollaboratorId?: (id: number | null) => void;
  onSelectCollectionById?: (collectionId: number, fallbackName?: string) => void;
  onSetCollectionStack?: (next: Array<{ id: number; name: string }>) => void;
  onSetSearchQuery?: (q: string) => void;
  onSortConfigChange?: (next: SortConfig) => void;
}) {
  const { token } = useAuth();
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [syncState, setSyncState] = useState(() => getSyncState());
  const notesRef = useRef<any[]>([]);
  const [emptyingTrash, setEmptyingTrash] = useState(false);
  const [galleryLightboxUrl, setGalleryLightboxUrl] = useState<string | null>(null);
  const [galleryDeleteTarget, setGalleryDeleteTarget] = useState<{ noteId: number; imageId: number; title: string } | null>(null);
  const [openNoteRequest, setOpenNoteRequest] = useState<{ noteId: number; nonce: number } | null>(null);
  const [returnToImagesOnEditorClose, setReturnToImagesOnEditorClose] = useState<null | { noteId: number; sortSnapshot: SortConfig }>(null);
  const [imagesSidebarThumbSize, setImagesSidebarThumbSize] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('freemannotes.imagesSidebar.thumbSize');
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return 220;
      return Math.max(96, Math.min(340, Math.round(parsed)));
    } catch {
      return 220;
    }
  });
  const galleryLongPressTimerRef = useRef<number | null>(null);
  const galleryLongPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextGalleryClickRef = useRef(false);

  // Auto-detected layout bucket.
  // "Phone" here means small viewport + touch-first; tablets keep the normal responsive layout.
  type LayoutBucket = 'desktop' | 'phone' | 'tablet-portrait' | 'tablet-landscape';
  const [layoutBucket, setLayoutBucket] = useState<LayoutBucket>('desktop');
  const layoutBucketRef = useRef<LayoutBucket>('desktop');

  // DOM-computed column counts (updated by `updateCols()` on resize).
  // Swap-mode masonry needs these in React state so it can re-render with a
  // different number of columns (instead of showing horizontal scrollbars).
  const [pinnedDomCols, setPinnedDomCols] = useState(1);
  const [othersDomCols, setOthersDomCols] = useState(1);
  const pinnedDomColsRef = useRef(1);
  const othersDomColsRef = useRef(1);

  // When an editor modal is open (Checklist/RichText), disable note dragging so
  // text selection inside the modal can't accidentally pick up cards behind it.
  const [editorModalDepth, setEditorModalDepth] = useState(0);
  useEffect(() => {
    const onOpen = () => setEditorModalDepth((d) => d + 1);
    const onClose = () => setEditorModalDepth((d) => Math.max(0, d - 1));
    window.addEventListener('freemannotes:editor-modal-open', onOpen);
    window.addEventListener('freemannotes:editor-modal-close', onClose);
    return () => {
      window.removeEventListener('freemannotes:editor-modal-open', onOpen);
      window.removeEventListener('freemannotes:editor-modal-close', onClose);
    };
  }, []);

  const disableNoteDnD = editorModalDepth > 0;
  useEffect(() => {
    try {
      localStorage.setItem('freemannotes.imagesSidebar.thumbSize', String(imagesSidebarThumbSize));
    } catch {}
  }, [imagesSidebarThumbSize]);

  useEffect(() => {
    const root = document.documentElement;
    if (disableNoteDnD) root.classList.add('is-editor-modal-open');
    else root.classList.remove('is-editor-modal-open');
    return () => { try { root.classList.remove('is-editor-modal-open'); } catch {} };
  }, [disableNoteDnD]);

  // Safety: if the depth counter ever gets out of sync, recover so the grid
  // doesn't become permanently unclickable.
  useEffect(() => {
    if (editorModalDepth <= 0) return;
    const timerId = window.setTimeout(() => {
      try {
        const hasAnyModal = !!document.querySelector('[aria-modal="true"]');
        if (!hasAnyModal) setEditorModalDepth(0);
      } catch {}
    }, 400);
    return () => { try { window.clearTimeout(timerId); } catch {} };
  }, [editorModalDepth]);
  const itemRefs = useRef(new Map<number, HTMLElement>());
  const lastSpliceAt = useRef<number>(0);
  const draggingIdxRef = useRef<number | null>(null);
  const draggingNoteIdRef = useRef<number | null>(null);
  const suppressNextRecalcRef = useRef(false);

  const [mobileAddOpen, setMobileAddOpen] = useState(false);
  const [takeNoteOpenNonce, setTakeNoteOpenNonce] = useState(0);
  const [takeNoteOpenMode, setTakeNoteOpenMode] = useState<'text' | 'checklist'>('text');
  const [mobileCreateMode, setMobileCreateMode] = useState<null | 'text' | 'checklist'>(null);
  const isImagesView = ((sortConfig || DEFAULT_SORT_CONFIG).smartFilter === 'images');

  // Mobile back button: if the FAB menu is open, Back should close it.
  const mobileAddBackIdRef = useRef<string>('');
  const imagesViewBackIdRef = useRef<string>('');
  const sortConfigRef = useRef<SortConfig>(sortConfig || DEFAULT_SORT_CONFIG);

  useEffect(() => {
    sortConfigRef.current = sortConfig || DEFAULT_SORT_CONFIG;
  }, [sortConfig]);

  const activeCollection = useMemo(() => {
    const stack = Array.isArray(collectionStack) ? collectionStack : [];
    if (!stack.length) return null;
    const leaf = stack[stack.length - 1];
    const id = Number((leaf as any)?.id);
    const path = stack.map((s) => String((s as any)?.name || '')).filter(Boolean).join(' / ');
    if (!Number.isFinite(id) || !path) return null;
    return { id, path };
  }, [collectionStack]);

  const openTakeNote = useCallback((mode: 'text' | 'checklist') => {
    setMobileAddOpen(false);

    // Mobile: open a dedicated fullscreen create modal; note is created only on Save.
    setMobileCreateMode(mode);
  }, []);

  // Keep-style rearrange drag (floating card + spacer)
  const rearrangeDraggingRef = useRef(false);
  const rearrangePendingRef = useRef<null | {
    noteId: number;
    section: 'pinned' | 'others';
    sectionIds: number[];
    startClientX: number;
    startClientY: number;
    lastClientX?: number;
    lastClientY?: number;
    pointerId: number;
    pointerType: string;
    touchArmed?: boolean;
    longPressTimerId?: number | null;
    captureEl?: HTMLElement | null;
  }>(null);
  const rearrangeActiveIdRef = useRef<number | null>(null);
  const rearrangeSectionRef = useRef<'pinned' | 'others' | null>(null);
  const rearrangeSpacerIndexRef = useRef<number>(-1);
  const rearrangeRenderIdsRef = useRef<Array<number | 'spacer'>>([]);
  const rearrangeBaseRectRef = useRef<DOMRect | null>(null);
  const rearrangePointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const rearrangeOverlayRef = useRef<HTMLDivElement | null>(null);
  const rearrangeSpacerRef = useRef<HTMLDivElement | null>(null);
  const rearrangeMoveRafRef = useRef<number | null>(null);
  const rearrangeSlotRectsRef = useRef<Array<null | { left: number; top: number; width: number; height: number; cx: number; cy: number }>>([]);
  const rearrangeBoundsRef = useRef<null | { left: number; top: number; right: number; bottom: number }>(null);
  const rearrangeRowSpanRef = useRef<number>(2);
  const rearrangeColSpanRef = useRef<number>(1);
  const rearrangeSettlingRef = useRef(false);
  const rearrangeFlipPendingRef = useRef<null | { before: Map<number, DOMRect>; ms: number }>(null);
  const rearrangeBodyScrollLockRef = useRef<null | {
    x: number;
    y: number;
    position: string;
    top: string;
    left: string;
    right: string;
    width: string;
    overflow: string;
  }>(null);
  const [rearrangeActiveId, setRearrangeActiveId] = useState<number | null>(null);
  const [rearrangeSection, setRearrangeSection] = useState<'pinned' | 'others' | null>(null);
  const [rearrangeRenderIds, setRearrangeRenderIds] = useState<Array<number | 'spacer'>>([]);
  const pinnedGridRef = useRef<HTMLDivElement | null>(null);
  const othersGridRef = useRef<HTMLDivElement | null>(null);
  const [pinnedLayout, setPinnedLayout] = useState<number[][] | null>(null);
  const [othersLayout, setOthersLayout] = useState<number[][] | null>(null);
  const pinnedLayoutRef = useRef<number[][] | null>(null);
  const othersLayoutRef = useRef<number[][] | null>(null);

  // Swap drag autoscroll (mobile): keep drag stable while scrolling to far targets.
  const swapDraggingRef = useRef(false);
  const swapHasMovedRef = useRef(false);
  const swapPointerRef = useRef<{ x: number; y: number } | null>(null);
  const swapAutoScrollRafRef = useRef<number | null>(null);
  const swapUnsubMoveRef = useRef<null | (() => void)>(null);

  const readClientPoint = useCallback((ev: any): { x: number; y: number } | null => {
    if (!ev) return null;
    // TouchEvent
    const t = (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]);
    if (t && typeof t.clientX === 'number' && typeof t.clientY === 'number') {
      return { x: t.clientX, y: t.clientY };
    }
    // Pointer/Mouse
    if (typeof ev.clientX === 'number' && typeof ev.clientY === 'number') {
      return { x: ev.clientX, y: ev.clientY };
    }
    return null;
  }, []);

  const startSwapPointerTracking = useCallback((startEvent?: any) => {
    const pt = readClientPoint(startEvent);
    if (pt) swapPointerRef.current = pt;

    const onPointerMove = (e: PointerEvent) => {
      if (!swapDraggingRef.current) return;
      swapPointerRef.current = { x: e.clientX, y: e.clientY };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!swapDraggingRef.current) return;
      const tt = e.touches && e.touches[0];
      if (tt) swapPointerRef.current = { x: tt.clientX, y: tt.clientY };
    };
    // capture so we still see moves even if other handlers run
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false } as any);
    window.addEventListener('touchmove', onTouchMove, { capture: true, passive: true } as any);
    swapUnsubMoveRef.current = () => {
      try { window.removeEventListener('pointermove', onPointerMove, { capture: true } as any); } catch {}
      try { window.removeEventListener('touchmove', onTouchMove, { capture: true } as any); } catch {}
    };
  }, [readClientPoint]);

  const stopSwapPointerTracking = useCallback(() => {
    try { swapUnsubMoveRef.current && swapUnsubMoveRef.current(); } catch {}
    swapUnsubMoveRef.current = null;
    swapPointerRef.current = null;
  }, []);

  const getScrollContainer = useCallback((): HTMLElement | null => {
    // In this app, `.main-area` is the primary scroller.
    const el = document.querySelector('.main-area') as HTMLElement | null;
    if (el && el.scrollHeight > el.clientHeight + 1) return el;
    // Fallback to document scroller
    const s = document.scrollingElement as HTMLElement | null;
    if (s && s.scrollHeight > s.clientHeight + 1) return s;
    return null;
  }, []);

  const startSwapAutoScroll = useCallback(() => {
    if (swapAutoScrollRafRef.current != null) return;
    const edge = 96; // px from top/bottom edge to start scrolling
    const maxSpeed = 12; // px per frame at strongest pull

    const tick = () => {
      if (!swapDraggingRef.current) {
        swapAutoScrollRafRef.current = null;
        return;
      }
      const pt = swapPointerRef.current;
      if (!pt) {
        swapAutoScrollRafRef.current = requestAnimationFrame(tick);
        return;
      }
      const vh = window.innerHeight || 0;
      const distTop = pt.y;
      const distBottom = Math.max(0, vh - pt.y);

      let delta = 0;
      if (distTop < edge) {
        const strength = Math.max(0, (edge - distTop) / edge);
        delta = -Math.ceil(Math.pow(strength, 1.6) * maxSpeed);
      } else if (distBottom < edge) {
        const strength = Math.max(0, (edge - distBottom) / edge);
        delta = Math.ceil(Math.pow(strength, 1.6) * maxSpeed);
      }

      if (delta !== 0) {
        const scroller = getScrollContainer();
        if (scroller && scroller !== document.body && scroller !== document.documentElement) {
          const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          const next = Math.max(0, Math.min(maxTop, scroller.scrollTop + delta));
          scroller.scrollTop = next;
        } else {
          window.scrollBy(0, delta);
        }
      }

      swapAutoScrollRafRef.current = requestAnimationFrame(tick);
    };

    swapAutoScrollRafRef.current = requestAnimationFrame(tick);
  }, [getScrollContainer]);

  const stopSwapAutoScroll = useCallback(() => {
    if (swapAutoScrollRafRef.current != null) {
      try { cancelAnimationFrame(swapAutoScrollRafRef.current); } catch {}
      swapAutoScrollRafRef.current = null;
    }
  }, []);
  const [manualDragActive, setManualDragActive] = useState(false);
  const [swapActiveId, setSwapActiveId] = useState<number | null>(null);
  const [swapTargetId, setSwapTargetId] = useState<number | null>(null);
  const [swapOverlayRect, setSwapOverlayRect] = useState<null | { width: number; height: number }>(null);
  const swapCandidateIdRef = useRef<number | null>(null);
  const swapDwellTimerRef = useRef<number | null>(null);
  const swapAnimColsRef = useRef<null | { section: 'pinned' | 'others'; heights: number[] }>(null);

  function getAnimMs(kind: 'resize'|'swap'|'rearrange') {
    try {
      const speed = (localStorage.getItem('prefs.animationSpeed') || 'normal').toLowerCase();
      const map = {
        fast:   { resize: 250, swap: 250, rearrange: 250 },
        normal: { resize: 600, swap: 500, rearrange: 480 },
        slow:   { resize: 1000, swap: 1000, rearrange: 1000 }
      } as const;
      const sel = (map as any)[speed] || map.normal;
      return sel[kind];
    } catch { return kind === 'resize' ? 600 : kind === 'swap' ? 500 : 480; }
  }

  function lockBodyScrollForRearrange() {
    if (rearrangeBodyScrollLockRef.current) return;
    try {
      const x = window.scrollX || 0;
      const y = window.scrollY || 0;
      const body = document.body;
      rearrangeBodyScrollLockRef.current = {
        x,
        y,
        position: body.style.position || '',
        top: body.style.top || '',
        left: body.style.left || '',
        right: body.style.right || '',
        width: body.style.width || '',
        overflow: body.style.overflow || '',
      };
      body.style.position = 'fixed';
      body.style.top = `-${y}px`;
      body.style.left = `-${x}px`;
      body.style.right = '0px';
      body.style.width = '100%';
      body.style.overflow = 'hidden';
    } catch {}
  }

  function unlockBodyScrollForRearrange() {
    const st = rearrangeBodyScrollLockRef.current;
    if (!st) return;
    rearrangeBodyScrollLockRef.current = null;
    try {
      const body = document.body;
      body.style.position = st.position;
      body.style.top = st.top;
      body.style.left = st.left;
      body.style.right = st.right;
      body.style.width = st.width;
      body.style.overflow = st.overflow;
      window.scrollTo(st.x, st.y);
    } catch {}
  }

  useLayoutEffect(() => {
    rearrangeActiveIdRef.current = rearrangeActiveId;
  }, [rearrangeActiveId]);
  useLayoutEffect(() => {
    rearrangeSectionRef.current = rearrangeSection;
  }, [rearrangeSection]);
  useLayoutEffect(() => {
    rearrangeRenderIdsRef.current = rearrangeRenderIds;
    const idx = rearrangeRenderIds.indexOf('spacer');
    rearrangeSpacerIndexRef.current = idx;
  }, [rearrangeRenderIds]);

  useEffect(() => {
    const root = document.documentElement;
    if (rearrangeActiveId != null) root.classList.add('is-note-rearrange-dragging');
    else root.classList.remove('is-note-rearrange-dragging');
    return () => { try { root.classList.remove('is-note-rearrange-dragging'); } catch {} };
  }, [rearrangeActiveId]);

  useEffect(() => {
    return subscribeSyncState((s) => setSyncState(s));
  }, []);

  useEffect(() => {
    try {
      setSyncTokenProvider(() => token || '');
      void kickOfflineSync();
    } catch {}
  }, [token]);

  useEffect(() => {
    void saveCachedNotes(notes || []);
  }, [notes]);

  useEffect(() => {
    const onOfflineUploadSuccess = (evt: Event) => {
      try {
        const detail = (evt as CustomEvent<any>).detail || {};
        const noteId = Number(detail.noteId);
        if (!Number.isFinite(noteId)) return;
        const image = detail.image || null;
        if (!image || typeof image !== 'object') return;
        const imageId = Number((image as any).id);
        const imageUrl = String((image as any).url || '');
        if (!Number.isFinite(imageId) || !imageUrl) return;

        setNotes((s) => s.map((n: any) => {
          if (Number(n?.id) !== noteId) return n;
          const prevImages = Array.isArray(n?.images) ? n.images : [];
          const tempId = Number(detail.tempClientId);
          const filtered = Number.isFinite(tempId)
            ? prevImages.filter((img: any) => Number(img?.id) !== tempId)
            : prevImages;
          if (filtered.some((img: any) => Number(img?.id) === imageId)) return n;
          const nextImages = [...filtered, {
            id: imageId,
            url: imageUrl,
            ocrSearchText: (image as any).ocrSearchText ?? null,
            ocrText: (image as any).ocrText ?? null,
            ocrStatus: (image as any).ocrStatus ?? null,
            createdAt: (image as any).createdAt ?? null,
          }];
          return { ...n, images: nextImages, imagesCount: nextImages.length };
        }));
      } catch {}
    };
    window.addEventListener('freemannotes:offline-upload/success', onOfflineUploadSuccess as EventListener);
    return () => window.removeEventListener('freemannotes:offline-upload/success', onOfflineUploadSuccess as EventListener);
  }, []);

  useEffect(() => {
    const onOfflineNoteCreated = (evt: Event) => {
      try {
        const detail = (evt as CustomEvent<any>).detail || {};
        const note = detail.note || null;
        const opId = String(detail.opId || '');
        if (!note || typeof note !== 'object') return;
        const noteId = Number((note as any).id);
        if (!Number.isFinite(noteId)) return;

        setNotes((prev) => {
          if (opId && prev.some((n: any) => String((n as any)?.offlineOpId || '') === opId)) return prev;
          if (prev.some((n: any) => Number(n?.id) === noteId)) return prev;
          const optimistic = { ...(note as any), offlinePendingCreate: true, offlineOpId: opId };
          return [optimistic, ...prev];
        });
      } catch {}
    };

    const onOfflineNoteReconciled = (evt: Event) => {
      try {
        const detail = (evt as CustomEvent<any>).detail || {};
        const opId = String(detail.opId || '');
        const serverNote = detail.note || null;
        const serverId = Number(serverNote?.id);
        if (!opId || !Number.isFinite(serverId)) return;

        setNotes((prev) => {
          const withoutTemp = prev.filter((n: any) => String((n as any)?.offlineOpId || '') !== opId);
          const idx = withoutTemp.findIndex((n: any) => Number(n?.id) === serverId);
          if (idx >= 0) {
            const merged = [...withoutTemp];
            merged[idx] = { ...merged[idx], ...serverNote, offlinePendingCreate: false, offlineSyncFailed: false, offlineOpId: undefined };
            return dedupeNotesById(merged);
          }
          return dedupeNotesById([{ ...serverNote, offlinePendingCreate: false, offlineSyncFailed: false, offlineOpId: undefined }, ...withoutTemp]);
        });
      } catch {}
    };

    const onOfflineNoteCreateRetry = (evt: Event) => {
      try {
        const detail = (evt as CustomEvent<any>).detail || {};
        const opId = String(detail.opId || '');
        const attempt = Number(detail.attempt || 0);
        const error = String(detail.error || '');
        if (!opId) return;

        setNotes((prev) => prev.map((n: any) => {
          if (String((n as any)?.offlineOpId || '') !== opId) return n;
          return {
            ...n,
            offlinePendingCreate: true,
            offlineSyncFailed: attempt >= 3,
            offlineSyncError: error || undefined,
          };
        }));
      } catch {}
    };

    window.addEventListener('freemannotes:offline-note-created', onOfflineNoteCreated as EventListener);
    window.addEventListener('freemannotes:offline-note-reconciled', onOfflineNoteReconciled as EventListener);
    window.addEventListener('freemannotes:offline-note-create-retry', onOfflineNoteCreateRetry as EventListener);
    return () => {
      window.removeEventListener('freemannotes:offline-note-created', onOfflineNoteCreated as EventListener);
      window.removeEventListener('freemannotes:offline-note-reconciled', onOfflineNoteReconciled as EventListener);
      window.removeEventListener('freemannotes:offline-note-create-retry', onOfflineNoteCreateRetry as EventListener);
    };
  }, []);

  async function load() {
    setLoading(true);
    let hadCached = false;
    try {
      const cached = await loadCachedNotes();
      if (Array.isArray(cached) && cached.length) {
        hadCached = true;
        setNotes((prev) => {
          const mergedCached = mergePendingOptimisticNotes(cached, prev);
          if (buildNotesLoadSignature(mergedCached) === buildNotesLoadSignature(prev)) return prev;
          return mergedCached;
        });
        setLoading(false);
      }
    } catch {}

    try {
      const res = await fetch('/api/notes', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      let nextNotes: any[] = data.notes || [];

      // apply any locally saved order (for unauthenticated or offline sessions)
      try {
        const raw = localStorage.getItem('notesOrder');
        if (raw) {
          const ids: number[] = JSON.parse(raw || '[]');
          if (Array.isArray(ids) && ids.length) {
            const map = new Map(nextNotes.map((n: any) => [n.id, n]));
            const ordered: any[] = [];
            const seen = new Set<number>();
            for (const id of ids) {
              if (map.has(id) && !seen.has(id)) { ordered.push(map.get(id)); seen.add(id); }
            }
            // Prepend any notes not in saved order (e.g. newly created notes)
            // so "newest" stays at the top-left by default.
            const missing: any[] = [];
            for (const n of nextNotes) if (!seen.has(n.id)) missing.push(n);
            nextNotes = [...missing, ...ordered];
          }
        }
      } catch (e) { /* ignore malformed localStorage */ }

      const mergedFromSnapshot = mergePendingOptimisticNotes(nextNotes, notesRef.current);
      const hasMaterialChange = buildNotesLoadSignature(mergedFromSnapshot) !== buildNotesLoadSignature(notesRef.current);

      setNotes((prev) => {
        const merged = mergePendingOptimisticNotes(nextNotes, prev);
        if (buildNotesLoadSignature(merged) === buildNotesLoadSignature(prev)) return prev;
        return merged;
      });

      if (hasMaterialChange) {
        try { await saveCachedNotes(mergedFromSnapshot); } catch {}
        // After notes render, ask grid to recalc so width/columns lock immediately
        try { setTimeout(() => window.dispatchEvent(new Event('notes-grid:recalc')), 0); } catch {}
      }
    } catch (err) {
      console.error('Failed to load notes', err);
      if (!hadCached) setNotes([]);
    } finally { setLoading(false); }
  }

  function applyLabelsToNote(noteId: number, labels: NoteLabelLite[]) {
    setNotes((s) => s.map((n) => {
      if (Number(n.id) !== Number(noteId)) return n;
      const nextNoteLabels = (Array.isArray(labels) ? labels : [])
        .filter((l) => l && typeof l.id === 'number' && typeof l.name === 'string')
        .map((l) => ({ id: l.id, label: { id: l.id, name: l.name } }));
      return { ...n, noteLabels: nextNoteLabels };
    }));
  }

  function applyImagesToNote(noteId: number, images: NoteImageLite[]) {
    setNotes((s) => s.map((n) => {
      if (Number(n.id) !== Number(noteId)) return n;
      const prevImages = Array.isArray((n as any).images) ? (n as any).images : [];
      const prevById = new Map<number, any>(prevImages.map((img: any) => [Number(img?.id), img]));
      const nextImages = (Array.isArray(images) ? images : [])
        .filter((img) => img && (typeof (img as any).id === 'number' || Number.isFinite(Number((img as any).id))))
        .map((img: any) => ({
          id: Number(img.id || Date.now()),
          url: (typeof img.url === 'string' ? String(img.url) : (prevById.get(Number(img.id))?.url)),
          ocrSearchText: (img.ocrSearchText == null ? (prevById.get(Number(img.id))?.ocrSearchText ?? null) : String(img.ocrSearchText)),
          ocrText: (img.ocrText == null ? (prevById.get(Number(img.id))?.ocrText ?? null) : String(img.ocrText)),
          ocrStatus: (img.ocrStatus == null ? (prevById.get(Number(img.id))?.ocrStatus ?? null) : String(img.ocrStatus)),
          createdAt: (img.createdAt == null ? (prevById.get(Number(img.id))?.createdAt ?? null) : String(img.createdAt)),
        }));
      return { ...n, images: nextImages, imagesCount: nextImages.length };
    }));
  }

  function applyColorToNote(noteId: number, color: string | null | undefined) {
    const next = (typeof color === 'string' ? color : '') || '';
    setNotes((s) => s.map((n) => {
      if (Number(n.id) !== Number(noteId)) return n;
      // `viewerColor` is per-user preference (from /prefs); keep `color` untouched.
      return { ...n, viewerColor: next.length ? next : null };
    }));
  }

  function applyImagesExpandedToNote(noteId: number, imagesExpanded: boolean) {
    setNotes((s) => s.map((n: any) => {
      if (Number(n.id) !== Number(noteId)) return n;
      return { ...n, viewerImagesExpanded: !!imagesExpanded };
    }));
  }

  function applyCollectionsToNote(noteId: number, collections: ViewerCollectionLite[]) {
    const nextCollections = (Array.isArray(collections) ? collections : [])
      .filter((c) => c && typeof (c as any).id === 'number' && typeof (c as any).name === 'string')
      .map((c: any) => ({ id: Number(c.id), name: String(c.name), parentId: (c.parentId == null ? null : Number(c.parentId)) }));
    setNotes((s) => s.map((n) => {
      if (Number(n.id) !== Number(noteId)) return n;
      return { ...n, viewerCollections: nextCollections };
    }));
  }

  function applyPinnedToNote(noteId: number, pinned: boolean) {
    setNotes((prev) => {
      const idx = prev.findIndex((n: any) => Number(n?.id) === Number(noteId));
      if (idx < 0) return prev;
      const existing = prev[idx];
      const nextNote = { ...existing, pinned: !!pinned };
      const copy = [...prev];
      copy.splice(idx, 1);

      if (pinned) {
        const firstPinned = copy.findIndex((n: any) => !!(n as any)?.pinned);
        const insertAt = firstPinned >= 0 ? firstPinned : 0;
        copy.splice(insertAt, 0, nextNote);
      } else {
        let lastPinned = -1;
        for (let i = 0; i < copy.length; i++) {
          if (!!(copy[i] as any)?.pinned) lastPinned = i;
          else break;
        }
        copy.splice(lastPinned + 1, 0, nextNote);
      }
      return copy;
    });
  }

  const hasOcrInFlight = useMemo(() => {
    try {
      const list = Array.isArray(notes) ? notes : [];
      for (const n of list) {
        const imgs = Array.isArray((n as any)?.images) ? (n as any).images : [];
        for (const img of imgs) {
          const st = String((img as any)?.ocrStatus || '').toLowerCase();
          if (st === 'pending' || st === 'running') return true;
        }
      }
    } catch {}
    return false;
  }, [notes]);

  // Fallback sync for OCR completion on flaky/mobile networks where realtime events can be missed.
  useEffect(() => {
    if (!token) return;
    if (!hasOcrInFlight) return;

    let stopped = false;
    const tick = () => {
      if (stopped) return;
      try {
        if (document.visibilityState !== 'visible') return;
      } catch {}
      void load();
    };

    const first = window.setTimeout(tick, 1400);
    const every = window.setInterval(tick, 5000);
    return () => {
      stopped = true;
      try { window.clearTimeout(first); } catch {}
      try { window.clearInterval(every); } catch {}
    };
  }, [token, hasOcrInFlight]);

  useEffect(() => { if (token) load(); else setNotes([]); }, [token]);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { pinnedLayoutRef.current = pinnedLayout; }, [pinnedLayout]);
  useEffect(() => { othersLayoutRef.current = othersLayout; }, [othersLayout]);

  const isPhoneLike = (() => {
    try {
      const mq = window.matchMedia;
      const touchLike = !!(mq && (mq('(pointer: coarse)').matches || mq('(any-pointer: coarse)').matches));
      const vw = (window.visualViewport && typeof window.visualViewport.width === 'number') ? window.visualViewport.width : window.innerWidth;
      const vh = (window.visualViewport && typeof window.visualViewport.height === 'number') ? window.visualViewport.height : window.innerHeight;
      const shortSide = Math.min(vw, vh);
      return touchLike && shortSide <= 600;
    } catch { return false; }
  })();

  useEffect(() => {
    if (!isPhoneLike) return;
    if (!mobileAddOpen) return;
    try {
      if (!mobileAddBackIdRef.current) mobileAddBackIdRef.current = `mobile-add-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const id = mobileAddBackIdRef.current;
      const onBack = () => { try { setMobileAddOpen(false); } catch {} };
      window.dispatchEvent(new CustomEvent('freemannotes:back/register', { detail: { id, onBack } }));
      return () => {
        try { window.dispatchEvent(new CustomEvent('freemannotes:back/unregister', { detail: { id } })); } catch {}
      };
    } catch {
      return;
    }
  }, [isPhoneLike, mobileAddOpen]);

  useEffect(() => {
    if (!isPhoneLike) return;
    if (!isImagesView) return;
    if (!onSortConfigChange) return;
    try {
      if (!imagesViewBackIdRef.current) imagesViewBackIdRef.current = `images-view-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const id = imagesViewBackIdRef.current;
      const onBack = () => {
        try {
          const cfg = sortConfigRef.current || DEFAULT_SORT_CONFIG;
          if (cfg.smartFilter !== 'images') return;
          onSortConfigChange({ ...DEFAULT_SORT_CONFIG });
        } catch {}
      };
      window.dispatchEvent(new CustomEvent('freemannotes:back/register', { detail: { id, onBack } }));
      return () => {
        try { window.dispatchEvent(new CustomEvent('freemannotes:back/unregister', { detail: { id } })); } catch {}
      };
    } catch {
      return;
    }
  }, [isPhoneLike, isImagesView, onSortConfigChange]);

  useEffect(() => {
    const onForceClose = () => {
      try { setMobileAddOpen(false); } catch {}
    };
    window.addEventListener('freemannotes:mobile-add/close', onForceClose as EventListener);
    return () => {
      window.removeEventListener('freemannotes:mobile-add/close', onForceClose as EventListener);
    };
  }, []);

  const canManualReorder = !!(sortConfig && sortConfig.sortKey === 'default' && sortConfig.groupBy === 'none' && sortConfig.smartFilter === 'none');
  const storedDragBehavior = (() => {
    try { return (localStorage.getItem('prefs.dragBehavior') || 'swap'); } catch { return 'swap'; }
  })();
  // Mobile: rearrange is disabled.
  const dragBehavior = isPhoneLike ? 'swap' : storedDragBehavior;

  useEffect(() => {
    if (!isPhoneLike) return;
    try {
      if (storedDragBehavior !== 'rearrange') return;
      localStorage.setItem('prefs.dragBehavior', 'swap');
    } catch {}
  }, [isPhoneLike, storedDragBehavior]);
  const manualSwapEnabled = canManualReorder && dragBehavior === 'swap';
  const keepRearrangeEnabled = canManualReorder && dragBehavior === 'rearrange';
  const usePinnedPlacements = manualSwapEnabled && manualDragActive;

  // Resize can change the target column count; ensure our cached swap layouts
  // can't hold onto an old column length (which would force horizontal scroll).
  useEffect(() => {
    if (!manualSwapEnabled) return;
    setPinnedLayout(null);
    setOthersLayout(null);
    const id = requestAnimationFrame(() => {
      try { syncLayoutsFromDOM(); } catch {}
    });
    return () => { try { cancelAnimationFrame(id); } catch {} };
  }, [manualSwapEnabled, pinnedDomCols, othersDomCols]);

  function getSectionForNoteId(noteId: number): 'pinned' | 'others' | null {
    const n = noteById.get(noteId);
    if (!n) return null;
    return n.pinned ? 'pinned' : 'others';
  }

  function clearSwapDwellTimer() {
    if (swapDwellTimerRef.current != null) {
      try { window.clearTimeout(swapDwellTimerRef.current); } catch {}
      swapDwellTimerRef.current = null;
    }
  }

  const swapSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Long-press to reorder on touch so scrolling still works.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 12 } })
  );

  function onSwapDragStart(evt: DragStartEvent) {
    if (!manualSwapEnabled) return;
    try {
      const root = document.documentElement;
      if (root.classList.contains('is-note-more-menu-open')) return;
    } catch {}
    swapHasMovedRef.current = false;
    try { document.documentElement.classList.remove('is-note-swap-dragging-moving'); } catch {}
    const id = Number(evt.active.id);
    if (!Number.isFinite(id)) return;
    swapDraggingRef.current = true;
    startSwapPointerTracking((evt as any).activatorEvent);
    startSwapAutoScroll();
    setSwapActiveId(id);
    const el = itemRefs.current.get(id);
    const r = el?.getBoundingClientRect?.();
    if (r && r.width > 0 && r.height > 0) setSwapOverlayRect({ width: r.width, height: r.height });
    else setSwapOverlayRect(null);
    setSwapTargetId(null);
    swapCandidateIdRef.current = null;
    clearSwapDwellTimer();
    setManualDragActive(true);
  }

  function onSwapDragMove(evt: DragMoveEvent) {
    if (!manualSwapEnabled) return;
    if (swapHasMovedRef.current) return;
    const dx = Math.abs(Number((evt as any)?.delta?.x || 0));
    const dy = Math.abs(Number((evt as any)?.delta?.y || 0));
    if (dx < 6 && dy < 6) return;
    swapHasMovedRef.current = true;
    try { document.documentElement.classList.add('is-note-swap-dragging-moving'); } catch {}
  }

  function onSwapDragOver(evt: DragOverEvent) {
    if (!manualSwapEnabled) return;
    const activeId = Number(evt.active.id);
    const overIdRaw = evt.over?.id;
    const overId = overIdRaw == null ? NaN : Number(overIdRaw);
    if (!Number.isFinite(activeId)) return;

    // If we're not over a note (or over ourselves), clear any pending/selected target.
    if (!Number.isFinite(overId) || activeId === overId) {
      if (swapCandidateIdRef.current != null || swapTargetId != null) {
        swapCandidateIdRef.current = null;
        clearSwapDwellTimer();
        if (swapTargetId != null) setSwapTargetId(null);
      }
      return;
    }

    const activeSection = getSectionForNoteId(activeId);
    const overSection = getSectionForNoteId(overId);
    if (!activeSection || !overSection || activeSection !== overSection) {
      if (swapCandidateIdRef.current != null) {
        swapCandidateIdRef.current = null;
        clearSwapDwellTimer();
        setSwapTargetId(null);
      }
      return;
    }

    if (swapCandidateIdRef.current === overId) return;
    swapCandidateIdRef.current = overId;
    clearSwapDwellTimer();
    setSwapTargetId(null);

    swapDwellTimerRef.current = window.setTimeout(() => {
      if (swapCandidateIdRef.current !== overId) return;
      setSwapTargetId(overId);
    }, 380) as any;
  }

  function finishSwapDrag() {
    clearSwapDwellTimer();
    swapCandidateIdRef.current = null;
    swapDraggingRef.current = false;
    stopSwapAutoScroll();
    stopSwapPointerTracking();
    setSwapActiveId(null);
    setSwapTargetId(null);
    setManualDragActive(false);
    setSwapOverlayRect(null);
    swapHasMovedRef.current = false;
    try { document.documentElement.classList.remove('is-note-swap-dragging-moving'); } catch {}
  }

  useEffect(() => {
    const onMoreMenuOpen = () => {
      try {
        if (swapDraggingRef.current || swapActiveId != null) finishSwapDrag();
      } catch {}
    };
    try { window.addEventListener('freemannotes:more-menu-open', onMoreMenuOpen as any); } catch {}
    return () => {
      try { window.removeEventListener('freemannotes:more-menu-open', onMoreMenuOpen as any); } catch {}
    };
  }, [swapActiveId]);

  // While swap-dragging, disable native touch scrolling so auto-scroll is controlled
  // and the drag stays stable even near the viewport edges.
  useEffect(() => {
    const root = document.documentElement;
    if (manualSwapEnabled && swapActiveId != null) root.classList.add('is-note-swap-dragging');
    else root.classList.remove('is-note-swap-dragging');
    return () => { try { root.classList.remove('is-note-swap-dragging'); } catch {} };
  }, [manualSwapEnabled, swapActiveId]);

  function onSwapDragCancel(_evt: DragCancelEvent) {
    if (!manualSwapEnabled) return;
    finishSwapDrag();
  }

  function onSwapDragEnd(evt: DragEndEvent) {
    if (!manualSwapEnabled) return;
    const fromId = Number(evt.active.id);
    const toId = swapTargetId != null ? Number(swapTargetId) : NaN;
    const section = Number.isFinite(fromId) ? getSectionForNoteId(fromId) : null;

    // Capture heights BEFORE swap (animate only columns).
    if (section) {
      const container = section === 'pinned' ? pinnedGridRef.current : othersGridRef.current;
      if (container) {
        const cols = Array.from(container.querySelectorAll('.notes-masonry-col')) as HTMLElement[];
        swapAnimColsRef.current = { section, heights: cols.map(c => c.getBoundingClientRect().height) };
      }
    }

    finishSwapDrag();

    if (!Number.isFinite(fromId) || !Number.isFinite(toId) || fromId === toId || !section) return;
    // Ensure still same section.
    if (getSectionForNoteId(toId) !== section) return;

    setNotes((prev) => {
      const a = prev.findIndex((n: any) => Number(n?.id) === fromId);
      const b = prev.findIndex((n: any) => Number(n?.id) === toId);
      if (a < 0 || b < 0) return prev;
      if (!!prev[a].pinned !== !!prev[b].pinned) return prev;
      const next = [...prev];
      const tmp = next[a];
      next[a] = next[b];
      next[b] = tmp;
      requestAnimationFrame(() => { try { persistOrder(next); } catch {} });
      return next;
    });
  }

  const noteById = useMemo(() => {
    const m = new Map<number, any>();
    for (const n of notes) {
      const id = Number(n?.id);
      if (Number.isFinite(id)) m.set(id, n);
    }
    return m;
  }, [notes]);

  const clampIndex = (i: number, len: number) => Math.max(0, Math.min(len, Math.floor(i)));

  function captureRectsForIds(ids: number[]): Map<number, DOMRect> {
    const before = new Map<number, DOMRect>();
    for (const id of ids) {
      const el = itemRefs.current.get(id);
      if (el) before.set(id, el.getBoundingClientRect());
    }
    return before;
  }

  function animateFlipIds(before: Map<number, DOMRect>, ms: number) {
    const moves: Array<{ el: HTMLElement; dx: number; dy: number }> = [];
    for (const [id, prev] of before.entries()) {
      const el = itemRefs.current.get(id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const dx = prev.left - rect.left;
      const dy = prev.top - rect.top;
      if (dx === 0 && dy === 0) continue;
      moves.push({ el, dx, dy });
    }
    if (!moves.length) return;

    // Apply inverted transforms without transitions.
    for (const m of moves) {
      m.el.style.transition = 'none';
      m.el.style.transform = `translate(${m.dx}px, ${m.dy}px)`;
    }

    // Force a single reflow, then animate all back to identity.
    void document.body.getBoundingClientRect();
    for (const m of moves) {
      const el = m.el;
      el.style.transition = `transform ${ms}ms cubic-bezier(.2,.9,.2,1)`;
      el.style.transform = '';
      const cleanup = () => {
        try {
          el.style.transition = '';
          el.removeEventListener('transitionend', cleanup);
        } catch {}
      };
      el.addEventListener('transitionend', cleanup);
    }
  }

  function updateRearrangeSlotRects() {
    const ids = rearrangeRenderIdsRef.current;
    if (!ids.length) {
      rearrangeSlotRectsRef.current = [];
      rearrangeBoundsRef.current = null;
      return;
    }
    const prev = rearrangeSlotRectsRef.current;
    const rects: Array<null | { left: number; top: number; width: number; height: number; cx: number; cy: number }> = new Array(ids.length);

    // `getBoundingClientRect()` includes transforms. During FLIP, elements may be
    // mid-transition, which makes slot targeting jitter. Measure stable layout
    // rects by temporarily disabling inline transform/transition for this pass.
    const toRestore: Array<{ el: HTMLElement; transition: string; transform: string }> = [];
    try {
      for (let i = 0; i < ids.length; i++) {
        const key = ids[i];
        const el = (key === 'spacer')
          ? rearrangeSpacerRef.current
          : itemRefs.current.get(Number(key));
        if (!el) continue;
        toRestore.push({ el, transition: el.style.transition || '', transform: el.style.transform || '' });
      }
      for (const r of toRestore) {
        r.el.style.transition = 'none';
        r.el.style.transform = 'none';
      }
      // Force a single reflow so subsequent rects reflect the untransformed layout.
      void document.body.getBoundingClientRect();
    } catch {}

    for (let i = 0; i < ids.length; i++) {
      const key = ids[i];
      const el = (key === 'spacer')
        ? rearrangeSpacerRef.current
        : itemRefs.current.get(Number(key));
      if (!el) {
        rects[i] = prev[i] ?? null;
        continue;
      }
      const r = el.getBoundingClientRect();
      rects[i] = {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
      };
    }
    rearrangeSlotRectsRef.current = rects;

    // Track the bounding box of all slots so we can clamp overlay movement and
    // avoid dragging into empty space beyond the last note.
    try {
      let minL = Number.POSITIVE_INFINITY;
      let minT = Number.POSITIVE_INFINITY;
      let maxR = Number.NEGATIVE_INFINITY;
      let maxB = Number.NEGATIVE_INFINITY;
      for (const r of rects) {
        if (!r) continue;
        minL = Math.min(minL, r.left);
        minT = Math.min(minT, r.top);
        maxR = Math.max(maxR, r.left + r.width);
        maxB = Math.max(maxB, r.top + r.height);
      }
      if (Number.isFinite(minL) && Number.isFinite(minT) && Number.isFinite(maxR) && Number.isFinite(maxB)) {
        rearrangeBoundsRef.current = { left: minL, top: minT, right: maxR, bottom: maxB };
      } else {
        rearrangeBoundsRef.current = null;
      }
    } catch {
      rearrangeBoundsRef.current = null;
    }

    try {
      for (const r of toRestore) {
        r.el.style.transition = r.transition;
        r.el.style.transform = r.transform;
      }
    } catch {}
  }

  function chooseNearestSlotIndex(clientX: number, clientY: number): number {
    const rects = rearrangeSlotRectsRef.current;
    if (!rects.length) return -1;

    // Prefer the slot the pointer is currently inside (reduces jitter).
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (!r) continue;
      if (clientX >= r.left && clientX <= (r.left + r.width) && clientY >= r.top && clientY <= (r.top + r.height)) {
        return i;
      }
    }

    let bestIdx = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (!r) continue;
      const dx = clientX - r.cx;
      const dy = clientY - r.cy;
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function rectIntersectionArea(
    a: { left: number; top: number; right: number; bottom: number },
    b: { left: number; top: number; right: number; bottom: number },
  ): number {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    const w = right - left;
    const h = bottom - top;
    if (w <= 0 || h <= 0) return 0;
    return w * h;
  }

  function chooseSlotIndexByOverlap(dragRect: { left: number; top: number; right: number; bottom: number }): { idx: number; area: number } {
    const rects = rearrangeSlotRectsRef.current;
    if (!rects.length) return { idx: -1, area: 0 };
    let bestIdx = -1;
    let bestArea = 0;

    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (!r) continue;
      const slot = { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height };
      const area = rectIntersectionArea(dragRect, slot);
      if (area > bestArea) {
        bestArea = area;
        bestIdx = i;
      }
    }
    return { idx: bestIdx, area: bestArea };
  }

  function buildRenderIds(idsInSection: number[], activeId: number, spacerIndex: number): Array<number | 'spacer'> {
    const ids = idsInSection.filter((id) => Number(id) !== Number(activeId));
    const idx = clampIndex(spacerIndex, ids.length);
    const next: Array<number | 'spacer'> = [];
    for (let i = 0; i < ids.length; i++) {
      if (i === idx) next.push('spacer');
      next.push(ids[i]);
    }
    if (idx === ids.length) next.push('spacer');
    return next;
  }

  function idsBetweenSpacerMoves(renderIds: Array<number | 'spacer'>, fromIdx: number, toIdx: number): number[] {
    if (fromIdx === toIdx) return [];
    const lo = Math.min(fromIdx, toIdx);
    const hi = Math.max(fromIdx, toIdx);
    const slice = renderIds.slice(lo, hi + 1).filter((k) => k !== 'spacer') as number[];
    return slice.map((x) => Number(x)).filter((id) => Number.isFinite(id));
  }

  function moveRearrangeSpacerTo(newIdx: number) {
    const current = rearrangeRenderIdsRef.current;
    const fromIdx = current.indexOf('spacer');
    if (fromIdx < 0) return;
    const toIdx = clampIndex(newIdx, current.length - 1);
    if (toIdx === fromIdx) return;

    const affectedIds = idsBetweenSpacerMoves(current, fromIdx, toIdx);
    const before = captureRectsForIds(affectedIds);

    const next = [...current];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, 'spacer');
    const ms = Math.max(150, Math.min(650, getAnimMs('rearrange')));
    rearrangeFlipPendingRef.current = { before, ms };
    setRearrangeRenderIds(next);
  }

  // After React commits the new spacer position, update cached slot rects and
  // run the FLIP animation in a layout effect (pre-paint) to avoid jump/jitter.
  useLayoutEffect(() => {
    if (rearrangeActiveId == null) return;
    try { updateRearrangeSlotRects(); } catch {}
    const pending = rearrangeFlipPendingRef.current;
    if (!pending) return;
    rearrangeFlipPendingRef.current = null;
    try { animateFlipIds(pending.before, pending.ms); } catch {}
  }, [rearrangeActiveId, rearrangeRenderIds]);

  function endRearrangeDragCleanup() {
    rearrangeDraggingRef.current = false;
    rearrangePendingRef.current = null;
    rearrangePointerStartRef.current = null;
    rearrangeBaseRectRef.current = null;
    rearrangeSlotRectsRef.current = [];
    rearrangeBoundsRef.current = null;
    rearrangeSettlingRef.current = false;
    rearrangeRowSpanRef.current = 2;
    rearrangeColSpanRef.current = 1;
    try { document.documentElement.classList.remove('is-note-rearrange-dragging'); } catch {}
    unlockBodyScrollForRearrange();
    if (rearrangeMoveRafRef.current != null) {
      try { cancelAnimationFrame(rearrangeMoveRafRef.current); } catch {}
      rearrangeMoveRafRef.current = null;
    }
  }

  function finishRearrangeDrag() {
    setRearrangeActiveId(null);
    setRearrangeSection(null);
    setRearrangeRenderIds([]);
    endRearrangeDragCleanup();

    // We intentionally skip ResizeObserver-driven span/column recalcs while dragging.
    // After we reinsert the card into the grid, force a single recalc so every
    // wrapper gets the correct `gridRowEnd` span and cards don’t overlap.
    try {
      requestAnimationFrame(() => {
        try {
          window.dispatchEvent(new Event('notes-grid:recalc'));
          window.dispatchEvent(new Event('resize'));
        } catch {}
      });
    } catch {}
  }

  function isInteractiveTarget(target: HTMLElement | null): boolean {
    if (!target) return false;
    try {
      return !!target.closest('button, a, input, textarea, select, [contenteditable="true"], .more-menu, .dropdown, .color-palette');
    } catch { return false; }
  }

  function getRowSpanForId(noteId: number): number {
    const el = itemRefs.current.get(noteId);
    const raw = el?.dataset?.__rowspan;
    const s = raw ? Number(raw) : NaN;
    return Number.isFinite(s) && s > 0 ? s : 2;
  }

  type Placement = { colStart: number; colSpan: number; rowStart: number; rowSpan: number };

  function sameLayout(a: number[][] | null, b: number[][] | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const ca = a[i];
      const cb = b[i];
      if (ca.length !== cb.length) return false;
      for (let j = 0; j < ca.length; j++) {
        if (Number(ca[j]) !== Number(cb[j])) return false;
      }
    }
    return true;
  }

  function computePlacements(layout: number[][], cols: number): Map<number, Placement> {
    const out = new Map<number, Placement>();
    const c = Math.max(1, Math.min(12, Number(cols) || 1));
    const heights = Array.from({ length: c }, () => 1);
    for (let col = 0; col < c; col++) {
      const list = Array.isArray(layout[col]) ? layout[col] : [];
      for (const rawId of list) {
        const id = Number(rawId);
        if (!Number.isFinite(id)) continue;
        const n = noteById.get(id);
        const rowSpan = getRowSpanForId(id);
        const reqSpan = Math.max(1, Math.min(c, Number((n as any)?.cardSpan || 1)));
        const colSpan = Math.max(1, Math.min(reqSpan, c - col));
        let start = 1;
        for (let k = col; k < col + colSpan; k++) start = Math.max(start, heights[k]);
        out.set(id, { colStart: col + 1, colSpan, rowStart: start, rowSpan });
        const end = start + rowSpan;
        for (let k = col; k < col + colSpan; k++) heights[k] = end;
      }
    }
    return out;
  }

  function buildLayoutFromGrid(grid: HTMLElement | null): number[][] | null {
    if (!grid) return null;
    const colsWanted = Math.max(1, Number(grid.dataset.__cols || '1') || 1);
    const children = Array.from(grid.children) as HTMLElement[];
    const points: Array<{ id: number; left: number; top: number }> = [];
    for (const child of children) {
      const id = Number(child.getAttribute('data-note-id'));
      if (!Number.isFinite(id)) continue;
      const r = child.getBoundingClientRect();
      points.push({ id, left: r.left, top: r.top });
    }
    if (!points.length) return Array.from({ length: colsWanted }, () => []);

    // Derive column buckets from actual rendered left positions (robust to zoom/gap prefs).
    const tol = 10; // px
    const lefts = points.map((p) => p.left).sort((a, b) => a - b);
    const buckets: number[] = [];
    for (const l of lefts) {
      const last = buckets[buckets.length - 1];
      if (buckets.length === 0 || Math.abs(l - last) > tol) buckets.push(l);
    }
    const cols = Math.max(colsWanted, buckets.length, 1);
    const columns: Array<Array<{ id: number; top: number }>> = Array.from({ length: cols }, () => []);
    for (const p of points) {
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < buckets.length; i++) {
        const d = Math.abs(p.left - buckets[i]);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      const colIdx = Math.max(0, Math.min(cols - 1, best));
      columns[colIdx].push({ id: p.id, top: p.top });
    }
    return columns.map((col) => col.sort((a, b) => a.top - b.top).map((x) => x.id));
  }

  function syncLayoutsFromDOM() {
    if (!manualSwapEnabled) return;
    try {
      const p = buildLayoutFromGrid(pinnedGridRef.current);
      const o = buildLayoutFromGrid(othersGridRef.current);
      if (p) setPinnedLayout((prev) => (sameLayout(prev, p) ? prev : p));
      if (o) setOthersLayout((prev) => (sameLayout(prev, o) ? prev : o));
    } catch {}
  }

  useEffect(() => {
    if (!manualSwapEnabled) {
      setPinnedLayout(null);
      setOthersLayout(null);
      return;
    }
    const t = window.setTimeout(() => {
      // Wait until spans are computed, then snapshot current columns.
      syncLayoutsFromDOM();
    }, 0) as any;
    return () => { try { clearTimeout(t); } catch {} };
  }, [manualSwapEnabled, notes]);

  const pinnedCols = useMemo(() => {
    try {
      const ds = Math.max(1, Number(pinnedDomCols) || 1);
      const ll = (pinnedLayout && pinnedLayout.length) ? pinnedLayout.length : 0;
      // If cached layout cols don't match, ignore them to allow responsive reflow.
      const effectiveLayoutCols = (ll === ds ? ll : 0);
      return Math.max(ds, effectiveLayoutCols, 1);
    } catch { return 1; }
  }, [manualSwapEnabled, pinnedLayout, pinnedDomCols]);
  const othersCols = useMemo(() => {
    try {
      const ds = Math.max(1, Number(othersDomCols) || 1);
      const ll = (othersLayout && othersLayout.length) ? othersLayout.length : 0;
      const effectiveLayoutCols = (ll === ds ? ll : 0);
      return Math.max(ds, effectiveLayoutCols, 1);
    } catch { return 1; }
  }, [manualSwapEnabled, othersLayout, othersDomCols]);

  const pinnedPlacements = useMemo(() => {
    if (!usePinnedPlacements || !pinnedLayout) return null;
    return computePlacements(pinnedLayout, pinnedCols);
  }, [usePinnedPlacements, pinnedLayout, pinnedCols, noteById]);
  const othersPlacements = useMemo(() => {
    if (!usePinnedPlacements || !othersLayout) return null;
    return computePlacements(othersLayout, othersCols);
  }, [usePinnedPlacements, othersLayout, othersCols, noteById]);

  function swapInLayout(section: 'pinned' | 'others', fromId: number, toId: number) {
    const setter = section === 'pinned' ? setPinnedLayout : setOthersLayout;
    setter((prev) => {
      if (!prev) return prev;
      const next = prev.map((c) => c.slice());
      let aCol = -1, aIdx = -1, bCol = -1, bIdx = -1;
      for (let c = 0; c < next.length; c++) {
        const col = next[c];
        const ia = col.indexOf(fromId);
        if (ia >= 0) { aCol = c; aIdx = ia; }
        const ib = col.indexOf(toId);
        if (ib >= 0) { bCol = c; bIdx = ib; }
      }
      if (aCol < 0 || bCol < 0 || aIdx < 0 || bIdx < 0) return prev;
      next[aCol][aIdx] = toId;
      next[bCol][bIdx] = fromId;
      return next;
    });
  }

  function buildPersistNotes(layout: number[][] | null, placements: Map<number, Placement> | null, currentNotes: any[]): any[] {
    if (!layout || !placements) return [];
    const byId = new Map<number, any>(currentNotes.map((n: any) => [Number(n?.id), n]));
    const ids: number[] = [];
    for (const col of layout) for (const id of col) ids.push(Number(id));
    ids.sort((a, b) => {
      const pa = placements.get(a);
      const pb = placements.get(b);
      if (!pa || !pb) return 0;
      if (pa.rowStart !== pb.rowStart) return pa.rowStart - pb.rowStart;
      return pa.colStart - pb.colStart;
    });
    const out: any[] = [];
    for (const id of ids) {
      const n = byId.get(id);
      if (n) out.push(n);
    }
    return out;
  }

  function parseDateMaybe(v: any): number {
    if (!v) return 0;
    if (v instanceof Date) return v.getTime();
    const t = Date.parse(String(v));
    return Number.isFinite(t) ? t : 0;
  }

  function isSameLocalDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function startOfLocalDayMs(d: Date): number {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  }

  function addDaysMs(ms: number, days: number): number {
    return ms + (days * 24 * 60 * 60 * 1000);
  }

  function reminderDueMs(n: any): number {
    return parseDateMaybe((n as any)?.reminderDueAt);
  }

  function applySort(list: any[]): any[] {
    const cfg = sortConfig || DEFAULT_SORT_CONFIG;
    if (cfg.sortKey === 'default') return list;
    const dir = cfg.sortDir === 'asc' ? 1 : -1;
    const copy = [...list];
    copy.sort((a, b) => {
      if (cfg.sortKey === 'createdAt') {
        return (parseDateMaybe(a.createdAt) - parseDateMaybe(b.createdAt)) * dir;
      }
      if (cfg.sortKey === 'updatedAt') {
        return (parseDateMaybe(a.updatedAt) - parseDateMaybe(b.updatedAt)) * dir;
      }
      if (cfg.sortKey === 'reminderDueAt') {
        const ra = reminderDueMs(a);
        const rb = reminderDueMs(b);
        // Notes without reminders should sink to bottom in reminder view.
        if (!ra && !rb) return 0;
        if (!ra) return 1;
        if (!rb) return -1;
        if (ra !== rb) return (ra - rb) * dir;
        // stable-ish fallback
        return (parseDateMaybe(a.createdAt) - parseDateMaybe(b.createdAt)) * -1;
      }
      if (cfg.sortKey === 'title') {
        const ta = String(a.title || '').trim();
        const tb = String(b.title || '').trim();
        const cmp = ta.localeCompare(tb, undefined, { sensitivity: 'base' });
        if (cmp !== 0) return cmp * dir;
        // stable-ish fallback
        return (parseDateMaybe(a.createdAt) - parseDateMaybe(b.createdAt)) * -1;
      }
      return 0;
    });
    return copy;
  }

  function startOfWeekMs(d: Date): number {
    // Monday-based week
    const date = new Date(d);
    const day = (date.getDay() + 6) % 7; // Mon=0..Sun=6
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - day);
    return date.getTime();
  }

  function groupNotes(list: any[]): Array<{ key: string; title: string; notes: any[]; sortMs: number }> {
    const cfg = sortConfig || DEFAULT_SORT_CONFIG;
    if (cfg.groupBy === 'none') return [{ key: 'all', title: '', notes: list, sortMs: 0 }];
    const buckets = new Map<string, { title: string; notes: any[]; sortMs: number }>();

    if (cfg.groupBy === 'week') {
      const now = new Date();
      const thisWeek = startOfWeekMs(now);
      const lastWeek = thisWeek - 7 * 24 * 60 * 60 * 1000;
      for (const n of list) {
        const ms = parseDateMaybe(n.createdAt);
        const wk = startOfWeekMs(new Date(ms || 0));
        let key = 'older';
        let title = 'Older';
        let sortMs = 0;
        if (wk >= thisWeek) { key = 'thisWeek'; title = 'This week'; sortMs = thisWeek; }
        else if (wk >= lastWeek) { key = 'lastWeek'; title = 'Last week'; sortMs = lastWeek; }
        const b = buckets.get(key) || { title, notes: [], sortMs };
        b.notes.push(n);
        buckets.set(key, b);
      }
      const order = ['thisWeek', 'lastWeek', 'older'];
      return order
        .filter(k => buckets.has(k))
        .map(k => ({ key: k, title: buckets.get(k)!.title, notes: buckets.get(k)!.notes, sortMs: buckets.get(k)!.sortMs }));
    }

    if (cfg.groupBy === 'month') {
      for (const n of list) {
        const ms = parseDateMaybe(n.createdAt);
        const d = new Date(ms || 0);
        const y = d.getFullYear();
        const m = d.getMonth();
        const key = `${y}-${String(m + 1).padStart(2, '0')}`;
        const title = d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
        const sortMs = new Date(y, m, 1).getTime();
        const b = buckets.get(key) || { title, notes: [], sortMs };
        b.notes.push(n);
        buckets.set(key, b);
      }
      const groups = Array.from(buckets.entries()).map(([key, v]) => ({ key, title: v.title, notes: v.notes, sortMs: v.sortMs }));
      // Default to newest month first. If explicitly sorting by createdAt asc, show oldest month first.
      const monthDir = (cfg.sortKey === 'createdAt' && cfg.sortDir === 'asc') ? 1 : -1;
      groups.sort((a, b) => (a.sortMs - b.sortMs) * monthDir);
      return groups;
    }

    return [{ key: 'all', title: '', notes: list, sortMs: 0 }];
  }

  // Recalculate grid packing when filters/search change or notes update
  useEffect(() => {
    if (suppressNextRecalcRef.current) {
      suppressNextRecalcRef.current = false;
      return;
    }
    // Wait for DOM to update, then trigger a grid recalculation
    requestAnimationFrame(() => {
      try { window.dispatchEvent(new Event('notes-grid:recalc')); } catch {}
    });
  }, [selectedLabelIds, selectedCollectionId, searchQuery, notes, sortConfig?.groupBy, sortConfig?.sortKey, sortConfig?.sortDir, sortConfig?.smartFilter]);

  // Subscribe to lightweight server events to refresh list on share/unshare and update chips
  useEffect(() => {
    // Observe child size changes and trigger span recalculation to prevent overlaps
    const observedChildren = new WeakSet<Element>();
    let childRO: ResizeObserver | null = null;
    if (!token) return;

    const myDeviceKey = (() => {
      try {
        return getOrCreateDeviceProfile().deviceKey;
      } catch {
        return null;
      }
    })();

    let ws: WebSocket | null = null;
    let disposed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimer != null) {
        try { window.clearTimeout(reconnectTimer); } catch {}
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      if (reconnectTimer != null) return;
      const base = Math.min(12_000, 500 * Math.pow(2, reconnectAttempt));
      const jitter = Math.floor(Math.random() * 350);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        reconnectAttempt += 1;
        connectEvents();
      }, base + jitter);
    };

    const connectEvents = () => {
      if (disposed || !token) return;
      clearReconnectTimer();
      try {
        if (ws) {
          try { ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null; } catch {}
          try { ws.close(); } catch {}
          ws = null;
        }
      } catch {}

      try {
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const url = `${proto}://${window.location.host}/events?token=${encodeURIComponent(token)}`;
        ws = new WebSocket(url);
        ws.onopen = () => {
          reconnectAttempt = 0;
          // Resync once on (re)connect so missed events while offline/network-switching are recovered.
          try { load(); } catch {}
        };
        ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data || '{}'));
          if (!msg || !msg.type) return;
          switch (msg.type) {
            case 'note-title-changed': {
              const payload = msg.payload || {};
              const noteId = Number(payload.noteId);
              if (!Number.isFinite(noteId)) break;
              const title = (typeof payload.title === 'string') ? String(payload.title) : (payload.title == null ? null : String(payload.title));
              const updatedAt = (typeof payload.updatedAt === 'string') ? String(payload.updatedAt) : null;
              setNotes((s) => s.map((n) => {
                if (Number(n.id) !== noteId) return n;
                const next: any = { ...n, title: (title == null ? null : title) };
                if (updatedAt) next.updatedAt = updatedAt;
                return next;
              }));
              break;
            }
            case 'note-created':
              // Another session for this user created a note
              load();
              break;
            case 'notes-reordered': {
              const payload = msg.payload || {};
              const idsRaw = Array.isArray(payload.ids) ? payload.ids : [];
              const ids = idsRaw.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n));
              if (!ids.length) break;
              // Update localStorage for consistency across refresh.
              try { localStorage.setItem('notesOrder', JSON.stringify(ids)); } catch {}
              // Reorder current notes state immediately.
              setNotes((prev) => {
                const byId = new Map<number, any>();
                for (const n of prev) {
                  const id = Number((n as any)?.id);
                  if (Number.isFinite(id)) byId.set(id, n);
                }
                const seen = new Set<number>();
                const ordered: any[] = [];
                for (const id of ids) {
                  const n = byId.get(id);
                  if (n) {
                    ordered.push(n);
                    seen.add(id);
                  }
                }
                // Preserve any notes missing from payload (e.g. just-created or filtered edge cases)
                const missing: any[] = [];
                for (const n of prev) {
                  const id = Number((n as any)?.id);
                  if (!Number.isFinite(id) || !seen.has(id)) missing.push(n);
                }
                return [...missing, ...ordered];
              });
              break;
            }
            case 'note-deleted': {
              const payload = msg.payload || {};
              const noteId = Number(payload.noteId);
              if (Number.isFinite(noteId)) {
                setNotes((s) => s.filter((n) => Number(n.id) !== noteId));
              }
              break;
            }
            case 'note-trashed': {
              const payload = msg.payload || {};
              const noteId = Number(payload.noteId);
              const trashedAt = (typeof payload.trashedAt === 'string') ? String(payload.trashedAt) : null;
              if (Number.isFinite(noteId)) {
                setNotes((s) => s.map((n) => {
                  if (Number(n.id) !== noteId) return n;
                  return { ...n, trashedAt: trashedAt || new Date().toISOString() };
                }));
              }
              break;
            }
            case 'note-restored': {
              const payload = msg.payload || {};
              const noteId = Number(payload.noteId);
              if (Number.isFinite(noteId)) {
                setNotes((s) => s.map((n) => {
                  if (Number(n.id) !== noteId) return n;
                  return { ...n, trashedAt: null };
                }));
              }
              break;
            }
            case 'note-images-changed': {
              const payload = msg.payload || {};
              const noteId = Number(payload.noteId);
              if (!Number.isFinite(noteId)) break;
              // Refresh just the images for this note, then patch local state.
              (async () => {
                try {
                  const res = await fetch(`/api/notes/${noteId}/images`, { headers: { Authorization: `Bearer ${token}` } });
                  if (!res.ok) return;
                  const data = await res.json();
                  const imgs = Array.isArray(data?.images) ? data.images : [];
                  applyImagesToNote(noteId, imgs);
                } catch {}
              })();
              break;
            }
            case 'note-color-changed': {
              const payload = msg.payload || {};
              const noteId = Number(payload.noteId);
              if (!Number.isFinite(noteId)) break;
              const color = (typeof payload.color === 'string') ? String(payload.color) : '';
              applyColorToNote(noteId, color);
              break;
            }
            case 'note-reminder-changed': {
              const payload = msg.payload || {};
              const noteId = Number(payload.noteId);
              if (!Number.isFinite(noteId)) break;
              const reminderDueAt = (typeof payload.reminderDueAt === 'string') ? String(payload.reminderDueAt) : null;
              const reminderOffsetMinutes = (typeof payload.reminderOffsetMinutes === 'number') ? Number(payload.reminderOffsetMinutes) : null;
              setNotes((s) => s.map((n) => {
                if (Number(n.id) !== noteId) return n;
                return {
                  ...n,
                  reminderDueAt,
                  reminderOffsetMinutes: (reminderOffsetMinutes === null ? (n as any).reminderOffsetMinutes : reminderOffsetMinutes),
                };
              }));
              break;
            }
            case 'note-pin-changed': {
              const payload = msg.payload || {};
              const noteId = Number(payload.noteId);
              if (!Number.isFinite(noteId)) break;
              const pinned = !!payload.pinned;
              applyPinnedToNote(noteId, pinned);
              break;
            }
            case 'note-link-previews-changed': {
              const payload = msg.payload || {};
              const noteId = Number(payload.noteId);
              if (!Number.isFinite(noteId)) break;
              const raw = Array.isArray(payload.previews) ? payload.previews : [];
              const previews = raw
                .map((p: any) => ({
                  id: Number(p?.id),
                  url: String(p?.url || ''),
                  title: (p?.title == null ? null : String(p.title)),
                  description: (p?.description == null ? null : String(p.description)),
                  imageUrl: (p?.imageUrl == null ? null : String(p.imageUrl)),
                  domain: (p?.domain == null ? null : String(p.domain)),
                  createdAt: (p?.createdAt == null ? null : String(p.createdAt)),
                }))
                .filter((p: any) => Number.isFinite(p.id) && p.url);
              setNotes((s) => s.map((n: any) => {
                if (Number(n.id) !== noteId) return n;
                return { ...n, linkPreviews: previews };
              }));
              break;
            }
            case 'note-labels-changed': {
              const payload = msg.payload || {};
              const noteId = Number(payload.noteId);
              if (!Number.isFinite(noteId)) break;
              const labels = Array.isArray(payload.labels) ? payload.labels : [];
              applyLabelsToNote(noteId, labels as any);
              break;
            }
            case 'labels-changed': {
              try {
                window.dispatchEvent(new Event('labels:refresh'));
              } catch {}
              break;
            }
            case 'note-items-changed': {
              const payload = msg.payload || {};
              const noteId = Number(payload.noteId);
              if (!Number.isFinite(noteId)) break;
              const rawItems = Array.isArray(payload.items) ? payload.items : [];
              const items = rawItems
                .map((it: any, idx: number) => ({
                  id: Number(it?.id),
                  content: String(it?.content || ''),
                  checked: !!it?.checked,
                  indent: (typeof it?.indent === 'number' ? Number(it.indent) : 0),
                  ord: (typeof it?.ord === 'number' ? Number(it.ord) : idx),
                }))
                .filter((it: any) => Number.isFinite(it.id))
                .sort((a: any, b: any) => (a.ord || 0) - (b.ord || 0));
              setNotes((s: any[]) => s.map((n: any) => {
                if (Number(n.id) !== noteId) return n;
                return { ...n, items };
              }));
              break;
            }
            case 'collab-added': {
              const payload = msg.payload || {};
              const noteId = Number(payload.noteId);
              if (!Number.isFinite(noteId)) break;
              const c = payload.collaborator || null;
              if (!c) break;
              const collabId = Number(c.collabId);
              const userId = Number(c.userId);
              const email = (typeof c.email === 'string') ? String(c.email) : '';
              const name = (typeof c.name === 'string' ? String(c.name) : (c.name == null ? null : String(c.name)));
              const userImageUrl = (typeof c.userImageUrl === 'string' ? String(c.userImageUrl) : (c.userImageUrl == null ? null : String(c.userImageUrl)));
              const role = (typeof c.role === 'string' ? String(c.role) : null);
              if (!Number.isFinite(userId) || !email) break;
              setNotes((s) => s.map((n: any) => {
                if (Number(n.id) !== noteId) return n;
                const prevCols = Array.isArray(n.collaborators) ? n.collaborators : [];
                const already = prevCols.some((pc: any) => {
                  const u = (pc && (pc.user || {}));
                  const uid = (typeof u.id === 'number' ? Number(u.id) : (typeof pc.userId === 'number' ? Number(pc.userId) : NaN));
                  return Number(uid) === Number(userId);
                });
                if (already) return n;
                const nextCols = prevCols.concat([{ id: (Number.isFinite(collabId) ? collabId : Date.now()), userId, role: role || 'editor', user: { id: userId, email, name: (name == null ? undefined : name), userImageUrl: (userImageUrl == null ? undefined : userImageUrl) } }]);
                return { ...n, collaborators: nextCols };
              }));
              break;
            }
            case 'note-archive-changed': {
              const payload = msg.payload || {};
              const noteId = Number(payload.noteId);
              if (!Number.isFinite(noteId)) break;
              const archived = !!payload.archived;
              setNotes((s) => s.map((n) => {
                if (Number(n.id) !== noteId) return n;
                return { ...n, archived };
              }));
              break;
            }
            case 'note-collections-changed': {
              const payload = msg.payload || {};
              const noteId = Number(payload.noteId);
              if (!Number.isFinite(noteId)) break;
              const collections = Array.isArray(payload.collections) ? payload.collections : [];
              applyCollectionsToNote(noteId, collections);
              break;
            }
            case 'collections-changed': {
              const payload = msg.payload || {};
              try {
                window.dispatchEvent(new CustomEvent('collections:changed', { detail: payload }));
              } catch {}
              break;
            }
            case 'note-collection-changed': {
              // Legacy single-collection event; reload to pick up names/membership.
              load();
              break;
            }
            case 'note-shared':
              // Reload notes so the newly shared note appears immediately
              load();
              break;
            case 'note-unshared': {
              const noteId = Number(msg.noteId || (msg.payload && msg.payload.noteId));
              if (Number.isFinite(noteId)) {
                setNotes((s) => s.filter((n) => Number(n.id) !== noteId));
              }
              break;
            }
            case 'collab-removed': {
              const noteId = Number(msg.noteId || (msg.payload && msg.payload.noteId));
              const userId = Number(msg.userId || (msg.payload && msg.payload.userId));
              if (Number.isFinite(noteId) && Number.isFinite(userId)) {
                setNotes((s) => s.map((n) => {
                  if (Number(n.id) !== noteId) return n;
                  const cols = Array.isArray(n.collaborators) ? n.collaborators : [];
                  const nextCols = cols.filter((c: any) => {
                    const u = (c && (c.user || {}));
                    const uid = (typeof u.id === 'number' ? Number(u.id) : (typeof c.userId === 'number' ? Number(c.userId) : undefined));
                    return uid !== userId;
                  });
                  return { ...n, collaborators: nextCols };
                }));
              }
              break;
            }
            case 'user-photo-updated': {
              const payload = msg.payload || {};
              const uid = Number(payload.userId);
              const url = String(payload.userImageUrl || '');
              if (Number.isFinite(uid)) {
                setNotes((s) => s.map((n) => {
                  const owner = (n as any).owner || null;
                  const updatedOwner = owner && owner.id === uid ? { ...owner, userImageUrl: url } : owner;
                  const cols = Array.isArray(n.collaborators) ? n.collaborators : [];
                  const nextCols = cols.map((c: any) => {
                    const u = (c && (c.user || {}));
                    if (typeof u.id === 'number' && Number(u.id) === uid) {
                      return { ...c, user: { ...u, userImageUrl: url } };
                    }
                    return c;
                  });
                  return { ...n, owner: updatedOwner, collaborators: nextCols };
                }));
              }
              break;
            }
            case 'user-prefs-updated': {
              const payload = msg.payload || {};

              // Per-device prefs: ignore updates coming from other deviceKeys.
              // (Allow legacy/global events with no deviceKey.)
              const incomingDeviceKey = (typeof payload.deviceKey === 'string' && payload.deviceKey)
                ? String(payload.deviceKey)
                : null;
              if (incomingDeviceKey && myDeviceKey && incomingDeviceKey !== myDeviceKey) {
                break;
              }

              try {
                // Mirror server-saved prefs into the DOM + localStorage for other sessions.
                if (typeof payload.noteWidth === 'number') {
                  document.documentElement.style.setProperty('--note-card-width', `${Number(payload.noteWidth)}px`);
                  try { localStorage.setItem('prefs.noteWidth', String(Number(payload.noteWidth))); } catch {}
                }
                // Split appearance prefs (card vs editor)
                if (typeof (payload as any).cardTitleSize === 'number') {
                  document.documentElement.style.setProperty('--card-title-size', `${Number((payload as any).cardTitleSize)}px`);
                  try { localStorage.setItem('prefs.cardTitleSize', String(Number((payload as any).cardTitleSize))); } catch {}
                }
                if (typeof (payload as any).cardChecklistSpacing === 'number') {
                  document.documentElement.style.setProperty('--card-checklist-gap', `${Number((payload as any).cardChecklistSpacing)}px`);
                  try { localStorage.setItem('prefs.cardChecklistSpacing', String(Number((payload as any).cardChecklistSpacing))); } catch {}
                  // legacy fallback
                  document.documentElement.style.setProperty('--checklist-gap', `${Number((payload as any).cardChecklistSpacing)}px`);
                  try { localStorage.setItem('prefs.checklistSpacing', String(Number((payload as any).cardChecklistSpacing))); } catch {}
                }
                if (typeof (payload as any).cardCheckboxSize === 'number') {
                  document.documentElement.style.setProperty('--card-checklist-checkbox-size', `${Number((payload as any).cardCheckboxSize)}px`);
                  try { localStorage.setItem('prefs.cardCheckboxSize', String(Number((payload as any).cardCheckboxSize))); } catch {}
                  document.documentElement.style.setProperty('--checklist-checkbox-size', `${Number((payload as any).cardCheckboxSize)}px`);
                  try { localStorage.setItem('prefs.checkboxSize', String(Number((payload as any).cardCheckboxSize))); } catch {}
                }
                if (typeof (payload as any).cardChecklistTextSize === 'number') {
                  document.documentElement.style.setProperty('--card-checklist-text-size', `${Number((payload as any).cardChecklistTextSize)}px`);
                  try { localStorage.setItem('prefs.cardChecklistTextSize', String(Number((payload as any).cardChecklistTextSize))); } catch {}
                  document.documentElement.style.setProperty('--checklist-text-size', `${Number((payload as any).cardChecklistTextSize)}px`);
                  try { localStorage.setItem('prefs.checklistTextSize', String(Number((payload as any).cardChecklistTextSize))); } catch {}
                }
                if (typeof (payload as any).cardNoteLineSpacing === 'number') {
                  document.documentElement.style.setProperty('--card-note-line-height', String(Number((payload as any).cardNoteLineSpacing)));
                  try { localStorage.setItem('prefs.cardNoteLineSpacing', String(Number((payload as any).cardNoteLineSpacing))); } catch {}
                  document.documentElement.style.setProperty('--note-line-height', String(Number((payload as any).cardNoteLineSpacing)));
                  try { localStorage.setItem('prefs.noteLineSpacing', String(Number((payload as any).cardNoteLineSpacing))); } catch {}
                }

                if (typeof (payload as any).editorChecklistSpacing === 'number') {
                  document.documentElement.style.setProperty('--editor-checklist-gap', `${Number((payload as any).editorChecklistSpacing)}px`);
                  try { localStorage.setItem('prefs.editorChecklistSpacing', String(Number((payload as any).editorChecklistSpacing))); } catch {}
                }
                if (typeof (payload as any).editorCheckboxSize === 'number') {
                  document.documentElement.style.setProperty('--editor-checklist-checkbox-size', `${Number((payload as any).editorCheckboxSize)}px`);
                  try { localStorage.setItem('prefs.editorCheckboxSize', String(Number((payload as any).editorCheckboxSize))); } catch {}
                }
                if (typeof (payload as any).editorChecklistTextSize === 'number') {
                  document.documentElement.style.setProperty('--editor-checklist-text-size', `${Number((payload as any).editorChecklistTextSize)}px`);
                  try { localStorage.setItem('prefs.editorChecklistTextSize', String(Number((payload as any).editorChecklistTextSize))); } catch {}
                }
                if (typeof (payload as any).editorNoteLineSpacing === 'number') {
                  document.documentElement.style.setProperty('--editor-note-line-height', String(Number((payload as any).editorNoteLineSpacing)));
                  try { localStorage.setItem('prefs.editorNoteLineSpacing', String(Number((payload as any).editorNoteLineSpacing))); } catch {}
                }
                if (typeof payload.checklistTextSize === 'number') {
                  document.documentElement.style.setProperty('--checklist-text-size', `${Number(payload.checklistTextSize)}px`);
                  try { localStorage.setItem('prefs.checklistTextSize', String(Number(payload.checklistTextSize))); } catch {}
                }
                if (typeof payload.noteLineSpacing === 'number') {
                  document.documentElement.style.setProperty('--note-line-height', String(Number(payload.noteLineSpacing)));
                  try { localStorage.setItem('prefs.noteLineSpacing', String(Number(payload.noteLineSpacing))); } catch {}
                }
                if (typeof payload.imageThumbSize === 'number') {
                  document.documentElement.style.setProperty('--image-thumb-size', `${Number(payload.imageThumbSize)}px`);
                  try { localStorage.setItem('prefs.imageThumbSize', String(Number(payload.imageThumbSize))); } catch {}
                }
                if (typeof payload.editorImageThumbSize === 'number') {
                  document.documentElement.style.setProperty('--editor-image-thumb-size', `${Number(payload.editorImageThumbSize)}px`);
                  try { localStorage.setItem('prefs.editorImageThumbSize', String(Number(payload.editorImageThumbSize))); } catch {}
                }
                if (typeof payload.fontFamily === 'string' && payload.fontFamily) {
                  document.documentElement.style.setProperty('--app-font-family', String(payload.fontFamily));
                  try { localStorage.setItem('prefs.fontFamily', String(payload.fontFamily)); } catch {}
                }

                if (typeof payload.editorImagesExpandedByDefault === 'boolean') {
                  try { localStorage.setItem('prefs.editorImagesExpandedByDefault', String(payload.editorImagesExpandedByDefault)); } catch {}
                }
                if (typeof payload.disableNoteCardLinks === 'boolean') {
                  try { localStorage.setItem('prefs.disableNoteCardLinks', String(payload.disableNoteCardLinks)); } catch {}
                }

                // User-scoped hyperlink colors (broadcast without deviceKey)
                if ('linkColorDark' in payload) {
                  const v = (payload as any).linkColorDark;
                  if (typeof v === 'string' && v) {
                    document.documentElement.style.setProperty('--link-color-dark', v);
                    try { localStorage.setItem('prefs.linkColorDark', v); } catch {}
                  } else {
                    document.documentElement.style.removeProperty('--link-color-dark');
                    try { localStorage.removeItem('prefs.linkColorDark'); } catch {}
                  }
                }
                if ('linkColorLight' in payload) {
                  const v = (payload as any).linkColorLight;
                  if (typeof v === 'string' && v) {
                    document.documentElement.style.setProperty('--link-color-light', v);
                    try { localStorage.setItem('prefs.linkColorLight', v); } catch {}
                  } else {
                    document.documentElement.style.removeProperty('--link-color-light');
                    try { localStorage.removeItem('prefs.linkColorLight'); } catch {}
                  }
                }
              } catch {}
              // Ensure masonry/grid column counts refresh immediately.
              try {
                window.dispatchEvent(new Event('notes-grid:recalc'));
                window.dispatchEvent(new Event('resize'));
              } catch {}
              break;
            }
          }
        } catch {}
        };
        ws.onerror = () => {
          // Force close so onclose backoff logic runs consistently across browsers.
          try { ws && ws.close(); } catch {}
        };
        ws.onclose = () => {
          scheduleReconnect();
        };
      } catch {
        scheduleReconnect();
      }
    };

    const onOnline = () => {
      reconnectAttempt = 0;
      connectEvents();
      try { load(); } catch {}
    };

    const onVisibility = () => {
      try {
        if (document.visibilityState !== 'visible') return;
        if (!ws || ws.readyState !== WebSocket.OPEN) connectEvents();
        load();
      } catch {}
    };

    try { window.addEventListener('online', onOnline); } catch {}
    try { document.addEventListener('visibilitychange', onVisibility); } catch {}
    connectEvents();

    return () => {
      disposed = true;
      clearReconnectTimer();
      try { window.removeEventListener('online', onOnline); } catch {}
      try { document.removeEventListener('visibilitychange', onVisibility); } catch {}
      try {
        if (ws) {
          try { ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null; } catch {}
          try { ws.close(); } catch {}
        }
      } catch {}
    };
  }, [token]);

  const gridRef = useRef<HTMLDivElement | null>(null);

  // calculate number of columns based on available width and set a CSS
  // variable `--cols` so the grid only changes when the threshold is crossed.
  // Update all `.notes-grid` elements and lock their pixel width to the
  // discrete total for the current column count to avoid mid-resize shifting.
  useEffect(() => {
    // Observe child size changes and update spans to prevent overlaps.
    const observedElements = new WeakSet<Element>();
    const cardToWrap = new WeakMap<Element, HTMLElement>();
    let childRO: ResizeObserver | null = null;
    let scheduledRaf: number | null = null;
    function updateCols() {
      if (rearrangeDraggingRef.current) return;

      const nextBucket: LayoutBucket = (() => {
        try {
          const mq = window.matchMedia;
          const isTouchLike = !!(mq && (mq('(pointer: coarse)').matches || mq('(any-pointer: coarse)').matches));

          // Use the *shortest side* to classify phone vs tablet so orientation changes
          // don't accidentally promote phones into the tablet bucket.
          const vw = (window.visualViewport && typeof window.visualViewport.width === 'number')
            ? window.visualViewport.width
            : window.innerWidth;
          const vh = (window.visualViewport && typeof window.visualViewport.height === 'number')
            ? window.visualViewport.height
            : window.innerHeight;
          const shortSide = Math.min(vw, vh);

          if (isTouchLike) {
            // Typical phones: ~320-480 CSS px short side. Small tablets: ~600+.
            if (shortSide <= 600) return 'phone';
            // Treat anything up to ~1024 short-side as "tablet".
            if (shortSide <= 1024) {
              const isPortrait = vh >= vw;
              return isPortrait ? 'tablet-portrait' : 'tablet-landscape';
            }
          }
          return 'desktop';
        } catch { return 'desktop'; }
      })();
      if (nextBucket !== layoutBucketRef.current) {
        layoutBucketRef.current = nextBucket;
        setLayoutBucket(nextBucket);
      }

      const docStyle = getComputedStyle(document.documentElement);
      let cardWidth = parseInt(docStyle.getPropertyValue('--note-card-width')) || 300;
      // NOTE: `--gap` can be overridden on `body` for smartphone; `docStyle` won't see that.
      // We'll use the grid's computed style for per-grid calculations.
      const rootGap = parseInt(docStyle.getPropertyValue('--gap')) || 16;
      // measure the main content area so sidebar doesn't affect available width.
      // If the `.main-area` appears artificially narrow for any reason, also
      // compute a fallback from the viewport width minus the sidebar and
      // main-area horizontal padding and use the larger value. This prevents
      // the column calc from being overly constrained.
      const main = document.querySelector('.main-area') as HTMLElement | null;
      const availMain = main ? main.clientWidth : 0;
      const notesArea = document.querySelector('.notes-area') as HTMLElement | null;
      const availArea = notesArea ? notesArea.clientWidth : 0;
      const sidebarEl = document.querySelector('.sidebar') as HTMLElement | null;
      const sidebarWidth = sidebarEl ? sidebarEl.clientWidth : (parseInt(docStyle.getPropertyValue('--sidebar-width')) || 220);
      const mainHorizontalPadding = 64; // matches `.main-area{padding:24px 32px}`
      const availFallback = window.innerWidth - sidebarWidth - mainHorizontalPadding;
      const avail = Math.max(availMain, availArea, availFallback, 0);

      // Auto-fit removed: card width remains as set by preferences
      // compute columns per-grid using available width relative to its left edge
      const grids = Array.from(document.querySelectorAll('.notes-area .notes-grid, .notes-area .notes-masonry')) as HTMLElement[];
      const container = (document.querySelector('.notes-area') as HTMLElement) || (document.querySelector('.main-area') as HTMLElement) || document.body;
      const containerRect = container.getBoundingClientRect();
      const containerRight = Math.floor(containerRect.right);
      const containerPaddingRight = parseInt(getComputedStyle(container).paddingRight || '0') || 0;
      let anyColsChanged = false;
      for (const g of grids) {
        const gStyle = getComputedStyle(g);
        const gap = parseInt(gStyle.getPropertyValue('--gap')) || rootGap;
        const left = Math.floor(g.getBoundingClientRect().left);
        // Prefer the container's right edge (notes-area/main-area) to avoid overflowing off-screen
        const rightEdge = containerRight - containerPaddingRight;
        const availableToRight = Math.max(0, rightEdge - left);
        // Cap by the smaller of global avail and the per-grid right availability
        const gridAvail = Math.max(0, Math.min(avail, availableToRight));
        const computedCols = Math.max(1, Math.floor((gridAvail + gap) / (cardWidth + gap)));

        // Layout-specific overrides.
        // Phone: fixed 2 columns, auto-fit note width (ignore preference).
        // Tablet portrait/landscape: keep preference, but cap column counts for a consistent feel.
        let effectiveCols = computedCols;
        let effectiveCardWidth = cardWidth;
        if (nextBucket === 'phone') {
          // Portrait phones: always 2 columns.
          // Landscape phones: fill as many columns as fit (up to 4), still ignoring the user's pref.
          const isLandscape = (() => {
            try {
              const vw = (window.visualViewport && typeof window.visualViewport.width === 'number') ? window.visualViewport.width : window.innerWidth;
              const vh = (window.visualViewport && typeof window.visualViewport.height === 'number') ? window.visualViewport.height : window.innerHeight;
              return vw > vh;
            } catch { return false; }
          })();

          const minCardW = isLandscape ? 120 : 140;
          const maxCols = isLandscape ? 4 : 2;
          let cols = Math.floor((availableToRight + gap) / (minCardW + gap));
          cols = Math.max(2, Math.min(maxCols, cols || 0));
          effectiveCols = cols;

          // Fit width exactly to avoid fractional leftover that can cause weirdness.
          effectiveCardWidth = Math.max(110, Math.floor((availableToRight - Math.max(0, cols - 1) * gap) / cols));
        } else if (nextBucket === 'tablet-portrait') {
          effectiveCols = Math.max(2, Math.min(3, computedCols));
        } else if (nextBucket === 'tablet-landscape') {
          effectiveCols = Math.max(3, Math.min(4, computedCols));
        }

        // Allow per-grid override of card width (cascades to children).
        if (nextBucket === 'phone') g.style.setProperty('--note-card-width', `${effectiveCardWidth}px`);
        else g.style.removeProperty('--note-card-width');

        const gridTotalUncapped = effectiveCols * effectiveCardWidth + Math.max(0, effectiveCols - 1) * gap;
        const gridTotal = Math.min(gridTotalUncapped, availableToRight);
        const prev = Number(g.dataset.__cols || '0');
        if (prev !== effectiveCols) {
          g.style.setProperty('--cols', String(effectiveCols));
          g.dataset.__cols = String(effectiveCols);
          anyColsChanged = true;
        }
        // Grid uses fixed track width via CSS var; no column-width needed
        g.style.width = `${gridTotal}px`;

        // If this grid is one of the swap-mode masonry containers, mirror the
        // computed column count into React state.
        try {
          if (g === pinnedGridRef.current) {
            if (pinnedDomColsRef.current !== effectiveCols) {
              pinnedDomColsRef.current = effectiveCols;
              setPinnedDomCols(effectiveCols);
            }
          } else if (g === othersGridRef.current) {
            if (othersDomColsRef.current !== effectiveCols) {
              othersDomColsRef.current = effectiveCols;
              setOthersDomCols(effectiveCols);
            }
          }
        } catch {}
      }

      // Animations should run ONLY for user drag-to-reorder actions.
      // Column/resize/layout recalculations must not trigger FLIP animations.
      // expose quick diagnostics
      try {
        (window as any).__notesGridDebug = {
          cardWidth,
          gap: rootGap,
          availMain,
          availArea,
          availFallback,
          avail,
          grids: grids.map(g => {
            const gStyle = getComputedStyle(g);
            const gap = parseInt(gStyle.getPropertyValue('--gap')) || rootGap;
            const left = Math.floor(g.getBoundingClientRect().left);
            const rightEdge = containerRight - containerPaddingRight;
            const availableToRight = Math.max(0, rightEdge - left);
            const gridAvail = Math.max(0, Math.min(avail, availableToRight));
            const gridCols = Math.max(1, Math.floor((gridAvail + gap) / (cardWidth + gap)));
            const gridTotal = Math.min(gridCols * cardWidth + Math.max(0, gridCols - 1) * gap, availableToRight);
            return { left, rightEdge, availableToRight, gridAvail, gridCols, gridTotal };
          }),
          autoFit: localStorage.getItem('prefs.autoFitColumns') === '1',
          anim: {
            resizeMs: getAnimMs('resize'),
            swapMs: getAnimMs('swap'),
            rearrangeMs: getAnimMs('rearrange')
          },
          showGuides: (enable: boolean) => {
            for (const g of grids) {
              if (enable) {
                const gap = parseInt(getComputedStyle(g).getPropertyValue('--gap')) || rootGap;
                const spacing = (cardWidth + gap);
                const rowUnit = parseInt(docStyle.getPropertyValue('--row')) || 8;
                const rowSpacing = (rowUnit + gap);
                const colsGuide = `repeating-linear-gradient(to right, rgba(255,255,255,0.08) 0, rgba(255,255,255,0.08) 1px, transparent 1px, transparent ${spacing}px)`;
                const rowsGuide = `repeating-linear-gradient(to bottom, rgba(255,255,255,0.08) 0, rgba(255,255,255,0.08) 1px, transparent 1px, transparent ${rowSpacing}px)`;
                g.style.backgroundImage = `${colsGuide}, ${rowsGuide}`;
                g.style.backgroundSize = `${spacing}px 100%, 100% ${rowSpacing}px`;
                g.style.backgroundPosition = 'left top, left top';
              } else {
                g.style.backgroundImage = '';
                g.style.backgroundSize = '';
              }
            }
          }
        };
      } catch {}
      // Masonry emulation: compute gridRowEnd spans so cards pack tightly.
      try {
        for (const g of grids) {
          const cs = getComputedStyle(g);
          const row = parseInt(cs.getPropertyValue('--row')) || (parseInt(docStyle.getPropertyValue('--row')) || 8);
          const gapPx = parseInt(cs.getPropertyValue('--gap')) || rootGap;
          const wraps = Array.from(g.querySelectorAll('[data-note-id]')) as HTMLElement[];
          for (const wrap of wraps) {
            const card = wrap.querySelector('.note-card') as HTMLElement | null;
            const h = card ? card.getBoundingClientRect().height : wrap.getBoundingClientRect().height;
            // Masonry span: account for the grid row unit plus the gap per row
            // so actual vertical spacing equals the grid's `gap`.
            // Small cushion avoids edge cases where rounding lands items flush
            // against the next row; keeps a consistent visible gap.
            const span = Math.max(1, Math.ceil((h + gapPx) / (row + gapPx)));
            // Avoid thrashing styles if unchanged
            if (wrap.dataset.__rowspan !== String(span)) {
              wrap.style.gridRowEnd = `span ${span}`;
              wrap.dataset.__rowspan = String(span);
            }
            // Continuously observe children; if their size changes (images, fonts, edits), update spans
            try {
              if (childRO) {
                const target = (card || wrap) as Element;
                if (!observedElements.has(target)) {
                  childRO.observe(target);
                  observedElements.add(target);
                  if (card) cardToWrap.set(target, wrap);
                }
              }
            } catch {}
          }
        }
      } catch {}
    }

    function scheduleUpdateCols() {
      if (rearrangeDraggingRef.current) return;
      if (scheduledRaf != null) return;
      scheduledRaf = requestAnimationFrame(() => {
        scheduledRaf = null;
        updateCols();
      });
    }

    updateCols();
    const observerTarget = document.querySelector('.main-area') || document.body;
    const ro = new ResizeObserver(() => scheduleUpdateCols());
    ro.observe(observerTarget as Element);
    try {
      childRO = new ResizeObserver((entries) => {
        try {
          if (rearrangeDraggingRef.current) return;
          const docStyle = getComputedStyle(document.documentElement);
          const rootGap = parseInt(docStyle.getPropertyValue('--gap')) || 16;
          const bodyGap = parseInt(getComputedStyle(document.body).getPropertyValue('--gap')) || rootGap;
          for (const entry of entries) {
            const target = entry.target as HTMLElement;
            const wrap = cardToWrap.get(target) || target;
            const grid = (wrap as any)?.closest ? ((wrap as any).closest('.notes-grid, .notes-masonry') as HTMLElement | null) : null;
            const cs = getComputedStyle(grid || wrap);
            const row = parseInt(cs.getPropertyValue('--row')) || (parseInt(docStyle.getPropertyValue('--row')) || 8);
            const gapPx = parseInt(cs.getPropertyValue('--gap')) || bodyGap;
            // Use boundingClientRect to include borders/padding; contentRect can undercount and cause overlaps.
            const h = target.getBoundingClientRect().height;
            const span = Math.max(1, Math.ceil((h + gapPx) / (row + gapPx)));
            if (wrap.dataset.__rowspan !== String(span)) {
              wrap.style.gridRowEnd = `span ${span}`;
              wrap.dataset.__rowspan = String(span);
            }
          }
        } catch {
          // Fallback to full recalculation
          scheduleUpdateCols();
        }
      });
    } catch {}
    window.addEventListener('resize', scheduleUpdateCols);
    window.addEventListener('notes-grid:recalc', scheduleUpdateCols as EventListener);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', scheduleUpdateCols);
      window.removeEventListener('notes-grid:recalc', scheduleUpdateCols as EventListener);
      try { if (scheduledRaf != null) cancelAnimationFrame(scheduledRaf); } catch {}
      try { childRO && childRO.disconnect(); } catch {}
    };
  }, []);

  const idToIndex = useMemo(() => {
    const m = new Map<number, number>();
    for (let i = 0; i < notes.length; i++) {
      const id = Number((notes[i] as any)?.id);
      if (Number.isFinite(id)) m.set(id, i);
    }
    return m;
  }, [notes]);

  const { pinned, others, pinnedGroups, otherGroups } = useMemo(() => {
    const labelIds = Array.isArray(selectedLabelIds) ? selectedLabelIds : [];
    const colId = (selectedCollectionId == null ? null : Number(selectedCollectionId));
    const q = normalizeForSearch(searchQuery || '');

    const matchesLabels = (n: any): boolean => {
      if (!labelIds.length) return true;
      const labels = (n.noteLabels || []).map((nl: any) => nl.label?.id).filter((id: any) => typeof id === 'number');
      return labelIds.some(id => labels.includes(id));
    };

    const matchesSearch = (n: any): boolean => {
      if (!q) return true;
      if (normalizeForSearch(n.title || '').includes(q)) return true;
      if (normalizeForSearch(n.body || '').includes(q)) return true;
      const items = Array.isArray(n.items) ? n.items : [];
      if (items.some((it: any) => normalizeForSearch(it.content || '').includes(q))) return true;
      const images = Array.isArray((n as any).images) ? (n as any).images : [];
      if (images.some((img: any) => normalizeForSearch(img?.ocrSearchText || img?.ocrText || '').includes(q))) return true;
      const labels = Array.isArray(n.noteLabels) ? n.noteLabels : [];
      if (labels.some((nl: any) => normalizeForSearch(nl.label?.name || '').includes(q))) return true;
      return false;
    };

    const matchesSmartFilter = (n: any): boolean => {
      const cfg = sortConfig || DEFAULT_SORT_CONFIG;
      const key = cfg.smartFilter;
      const isTrashed = !!(n && (n as any).trashedAt);
      const isArchived = !!(n && (n as any).archived);
      // Trash visibility is orthogonal to other smart filters.
      if (key === 'trash') return isTrashed;
      if (isTrashed) return false;
      if (key === 'archive') return isArchived;
      if (isArchived) return false;
      if (key === 'images') {
        const imgs = Array.isArray((n as any)?.images) ? (n as any).images : [];
        return imgs.some((img: any) => !!String(img?.url || '').trim());
      }
      if (!key || key === 'none') return true;

      if (key === 'dueSoon') {
        const dueMs = reminderDueMs(n);
        if (!dueMs) return false;
        const nowMs = Date.now();
        const soonMs = nowMs + (7 * 24 * 60 * 60 * 1000);
        return dueMs >= nowMs && dueMs <= soonMs;
      }

      if (key === 'leastAccessed') {
        // Heuristic: no explicit access counter is stored yet, so use stale update age.
        const updatedMs = parseDateMaybe((n as any)?.updatedAt || (n as any)?.createdAt);
        if (!updatedMs) return false;
        const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
        return updatedMs <= cutoff;
      }

      if (key === 'mostEdited') {
        // Heuristic: no explicit edit counter is stored yet, so use recent update activity.
        const updatedMs = parseDateMaybe((n as any)?.updatedAt || (n as any)?.createdAt);
        if (!updatedMs) return false;
        const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
        return updatedMs >= cutoff;
      }

      if (key === 'remindersAll') {
        return reminderDueMs(n) > 0;
      }

      // Reminder window filters
      const dueMs = reminderDueMs(n);
      if (!dueMs) return false;
      const due = new Date(dueMs);
      const now = new Date();

      if (key === 'remindersToday') {
        return isSameLocalDay(due, now);
      }

      const thisWeekStart = startOfWeekMs(now);
      const nextWeekStart = addDaysMs(thisWeekStart, 7);
      const weekAfterStart = addDaysMs(thisWeekStart, 14);

      if (key === 'remindersThisWeek') {
        return dueMs >= thisWeekStart && dueMs < nextWeekStart;
      }
      if (key === 'remindersNextWeek') {
        return dueMs >= nextWeekStart && dueMs < weekAfterStart;
      }
      if (key === 'remindersNextMonth') {
        const startNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const startMonthAfter = new Date(now.getFullYear(), now.getMonth() + 2, 1);
        const a = startNextMonth.getTime();
        const b = startMonthAfter.getTime();
        return dueMs >= a && dueMs < b;
      }

      // Unknown smart filter keys: don't filter.
      return true;
    };

    const matchesCollection = (n: any): boolean => {
      if (colId == null || !Number.isFinite(colId)) return true;
      const viewerCollections = Array.isArray(n.viewerCollections) ? n.viewerCollections : [];
      for (const c of viewerCollections) {
        const id = (c && typeof (c as any).id === 'number') ? Number((c as any).id) : null;
        if (id != null && Number.isFinite(id) && Number(id) === Number(colId)) return true;
      }

      // Fallback for older payload shapes.
      const noteCollections = Array.isArray(n.noteCollections) ? n.noteCollections : [];
      for (const nc of noteCollections) {
        const id = (nc && typeof (nc as any).collectionId === 'number')
          ? Number((nc as any).collectionId)
          : (typeof (nc as any)?.collection?.id === 'number' ? Number((nc as any).collection.id) : null);
        if (id != null && Number.isFinite(id) && Number(id) === Number(colId)) return true;
      }
      return false;
    };

    const collabId = (selectedCollaboratorId == null ? null : Number(selectedCollaboratorId));
    const matchesCollaborator = (n: any): boolean => {
      if (collabId == null || !Number.isFinite(collabId)) return true;
      try {
        const ownerId = (typeof (n as any)?.owner?.id === 'number') ? Number((n as any).owner.id)
          : (typeof (n as any)?.ownerId === 'number' ? Number((n as any).ownerId) : null);
        if (ownerId != null && Number(ownerId) === Number(collabId)) return true;

        const cols = Array.isArray((n as any)?.collaborators) ? (n as any).collaborators : [];
        for (const c of cols) {
          const uid = (typeof c?.user?.id === 'number') ? Number(c.user.id)
            : (typeof c?.userId === 'number' ? Number(c.userId) : null);
          if (uid != null && Number(uid) === Number(collabId)) return true;
        }
      } catch {}
      return false;
    };

    const pinnedRaw = notes.filter(n => n.pinned).filter(matchesLabels).filter(matchesCollection).filter(matchesCollaborator).filter(matchesSearch).filter(matchesSmartFilter);
    const othersRaw = notes.filter(n => !n.pinned).filter(matchesLabels).filter(matchesCollection).filter(matchesCollaborator).filter(matchesSearch).filter(matchesSmartFilter);
    const pinnedSorted = applySort(pinnedRaw);
    const othersSorted = applySort(othersRaw);
    return {
      pinned: pinnedSorted,
      others: othersSorted,
      pinnedGroups: groupNotes(pinnedSorted),
      otherGroups: groupNotes(othersSorted),
    };
  }, [notes, selectedLabelIds, selectedCollectionId, selectedCollaboratorId, searchQuery, sortConfig]);

  const gridContext = useMemo(() => {
    type Chip = { id: string; text: string; onClear?: () => void };
    const chips: Chip[] = [];
    const stack = Array.isArray(collectionStack) ? collectionStack : [];
    const colPath = stack.length ? stack.map((s) => String(s.name || '')).filter(Boolean).join(' / ') : '';

    if (colPath) {
      chips.push({
        id: 'collection',
        text: `Collection: ${colPath}`,
        onClear: () => {
          try { onSetCollectionStack && onSetCollectionStack([]); } catch {}
        },
      });
    }

    const labelIds = Array.isArray(selectedLabelIds) ? selectedLabelIds : [];
    if (labelIds.length) {
      const nameById = new Map<number, string>();
      for (const n of notes) {
        const nls = Array.isArray((n as any)?.noteLabels) ? (n as any).noteLabels : [];
        for (const nl of nls) {
          const lid = (typeof nl?.label?.id === 'number') ? Number(nl.label.id) : null;
          const nm = (typeof nl?.label?.name === 'string') ? String(nl.label.name) : null;
          if (lid != null && nm) nameById.set(lid, nm);
        }
      }
      const labelNames = labelIds.map((id) => nameById.get(Number(id)) || `#${Number(id)}`).join(', ');
      chips.push({
        id: 'labels',
        text: `Labels: ${labelNames}`,
        onClear: () => {
          try { onSetSelectedLabelIds && onSetSelectedLabelIds([]); } catch {}
        },
      });
    }

    const cid = (selectedCollaboratorId == null ? null : Number(selectedCollaboratorId));
    if (cid != null && Number.isFinite(cid)) {
      let collabName = '';
      try {
        outer: for (const n of notes) {
          const owner = (n as any)?.owner;
          if (owner && typeof owner.id === 'number' && Number(owner.id) === cid) {
            collabName = String(owner.name || owner.email || cid);
            break outer;
          }
          const cols = Array.isArray((n as any)?.collaborators) ? (n as any).collaborators : [];
          for (const c of cols) {
            const u = c?.user;
            if (u && typeof u.id === 'number' && Number(u.id) === cid) {
              collabName = String(u.name || u.email || cid);
              break outer;
            }
          }
        }
      } catch {}
      chips.push({
        id: 'collaborator',
        text: `With: ${collabName || String(cid)}`,
        onClear: () => {
          try { onSetSelectedCollaboratorId && onSetSelectedCollaboratorId(null); } catch {}
        },
      });
    }

    const q = (searchQuery || '').trim();
    if (q) {
      chips.push({
        id: 'search',
        text: `Search: ${q}`,
        onClear: () => {
          try { onSetSearchQuery && onSetSearchQuery(''); } catch {}
        },
      });
    }

    const cfg = sortConfig || DEFAULT_SORT_CONFIG;
    if (cfg.sortKey !== 'default') {
      const sortLabel = (() => {
        if (cfg.sortKey === 'createdAt') return `Date created: ${cfg.sortDir === 'asc' ? 'Ascending' : 'Descending'}`;
        if (cfg.sortKey === 'updatedAt') return `Date updated: ${cfg.sortDir === 'asc' ? 'Ascending' : 'Descending'}`;
        if (cfg.sortKey === 'title') return `Alphabetical: ${cfg.sortDir === 'asc' ? 'A→Z' : 'Z→A'}`;
        return `Sort: ${String(cfg.sortKey)}`;
      })();
      chips.push({
        id: 'sort',
        text: sortLabel,
        onClear: () => {
          try { onSortConfigChange && onSortConfigChange({ ...cfg, sortKey: 'default', sortDir: DEFAULT_SORT_CONFIG.sortDir }); } catch {}
        },
      });
    }
    if (cfg.groupBy && cfg.groupBy !== 'none') {
      chips.push({
        id: 'group',
        text: `Grouping: ${cfg.groupBy === 'week' ? 'Week' : cfg.groupBy === 'month' ? 'Month' : String(cfg.groupBy)}`,
        onClear: () => {
          try { onSortConfigChange && onSortConfigChange({ ...cfg, groupBy: 'none' }); } catch {}
        },
      });
    }
    if (cfg.smartFilter && cfg.smartFilter !== 'none') {
      const smartLabel = (() => {
        if (cfg.smartFilter === 'archive') return 'Archive';
        if (cfg.smartFilter === 'dueSoon') return 'Filter: Due soon';
        if (cfg.smartFilter === 'leastAccessed') return 'Filter: Least accessed';
        if (cfg.smartFilter === 'mostEdited') return 'Filter: Most edited';
        if (cfg.smartFilter === 'images') return 'Images';
        if (cfg.smartFilter === 'trash') return 'Trash';
        if (cfg.smartFilter === 'remindersAll') return 'Reminders: All';
        if (cfg.smartFilter === 'remindersToday') return 'Reminders: Today';
        if (cfg.smartFilter === 'remindersThisWeek') return 'Reminders: This week';
        if (cfg.smartFilter === 'remindersNextWeek') return 'Reminders: Next week';
        if (cfg.smartFilter === 'remindersNextMonth') return 'Reminders: Next month';
        return `Filter: ${String(cfg.smartFilter)}`;
      })();
      chips.push({
        id: 'smartFilter',
        text: smartLabel,
        onClear: () => {
          try { onSortConfigChange && onSortConfigChange({ ...cfg, smartFilter: 'none' }); } catch {}
        },
      });
    }

    const hasAnyFilter = chips.length > 0;
    const title = colPath
      || (cfg.smartFilter === 'trash'
        ? 'Trash'
        : cfg.smartFilter === 'archive'
          ? 'Archive'
          : cfg.smartFilter === 'images'
            ? 'Images'
            : 'All notes');
    return {
      title,
      chips,
      show: true,
      hasAnyFilter,
    };
  }, [collectionStack, selectedLabelIds, selectedCollaboratorId, searchQuery, notes, sortConfig, onSetSelectedLabelIds, onSetSelectedCollaboratorId, onSetCollectionStack, onSetSearchQuery, onSortConfigChange]);

  function applyReminderToNote(noteId: number, reminderDueAt: any, reminderOffsetMinutes?: any, reminderAt?: any) {
    setNotes((s) => s.map((n) => {
      if (Number(n?.id) !== Number(noteId)) return n;
      const next: any = { ...n };
      next.reminderDueAt = (reminderDueAt == null ? null : reminderDueAt);
      if (typeof reminderOffsetMinutes === 'number') next.reminderOffsetMinutes = reminderOffsetMinutes;
      if (typeof reminderOffsetMinutes === 'string' && reminderOffsetMinutes.length) {
        const num = Number(reminderOffsetMinutes);
        if (Number.isFinite(num)) next.reminderOffsetMinutes = num;
      }
      next.reminderAt = (reminderAt == null ? null : reminderAt);
      return next;
    }));
  }

  // Browser notifications for reminders (best-effort; works while app is open).
  useEffect(() => {
    const canNotify = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    if (!canNotify) return;

    // Keep timers per note+timestamp.
    const timers = new Map<string, number>();

    const now = Date.now();
    const horizonMs = 7 * 24 * 60 * 60 * 1000; // schedule up to 7 days out

    for (const n of notes) {
      const noteId = Number((n as any)?.id);
      if (!Number.isFinite(noteId)) continue;
      const reminderAtMs = parseDateMaybe((n as any)?.reminderAt) || (() => {
        const due = parseDateMaybe((n as any)?.reminderDueAt);
        const off = Number((n as any)?.reminderOffsetMinutes || 0);
        return due ? (due - (off * 60 * 1000)) : 0;
      })();
      if (!reminderAtMs) continue;
      if (reminderAtMs <= now) continue;
      if (reminderAtMs > (now + horizonMs)) continue;

      const key = `${noteId}:${reminderAtMs}`;

      // De-dupe across reloads.
      try {
        const last = localStorage.getItem('reminder.fired.' + key);
        if (last) continue;
      } catch {}

      const delay = Math.max(0, Math.min(reminderAtMs - now, 0x7fffffff));
      const id = window.setTimeout(() => {
        try { localStorage.setItem('reminder.fired.' + key, String(Date.now())); } catch {}
        const title = String((n as any)?.title || 'Reminder');
        const dueMs = parseDateMaybe((n as any)?.reminderDueAt);
        const body = dueMs ? `Due: ${new Date(dueMs).toLocaleString()}` : 'Reminder';

        // Prefer SW notifications (works better on Android PWAs).
        try {
          if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
            (async () => {
              try {
                const reg = await navigator.serviceWorker.ready;
                await reg.showNotification(title, {
                  body,
                  icon: '/icons/icon-192.png',
                  badge: '/icons/icon-192.png',
                  tag: `reminder-${noteId}`,
                  data: { url: '/', noteId },
                });
                return;
              } catch {}
              try { new Notification(title, { body }); } catch {}
            })();
            return;
          }
        } catch {}
        try { new Notification(title, { body }); } catch {}
      }, delay) as any;
      timers.set(key, id as any);
    }

    return () => {
      for (const id of timers.values()) {
        try { window.clearTimeout(id); } catch {}
      }
    };
  }, [notes]);

  // Animate only column height adjustments after a swap.
  useEffect(() => {
    if (!manualSwapEnabled) return;
    const pending = swapAnimColsRef.current;
    if (!pending) return;
    swapAnimColsRef.current = null;
    const container = pending.section === 'pinned' ? pinnedGridRef.current : othersGridRef.current;
    if (!container) return;

    const cols = Array.from(container.querySelectorAll('.notes-masonry-col')) as HTMLElement[];
    if (!cols.length) return;

    // Apply old heights, then transition to new heights.
    const oldHeights = pending.heights;
    const newHeights = cols.map(c => c.getBoundingClientRect().height);
    const ms = getAnimMs('swap');
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const oldH = oldHeights[i] ?? c.getBoundingClientRect().height;
      c.style.transition = 'none';
      c.style.height = `${oldH}px`;
    }
    // Force reflow once.
    void container.getBoundingClientRect();
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const newH = newHeights[i] ?? c.getBoundingClientRect().height;
      c.style.transition = `height ${ms}ms ease-in-out`;
      c.style.height = `${newH}px`;
      const cleanup = () => {
        try {
          c.style.transition = '';
          c.style.height = '';
          c.removeEventListener('transitionend', cleanup);
        } catch {}
      };
      c.addEventListener('transitionend', cleanup);
    }
  }, [manualSwapEnabled, notes]);
  function moveNote(from: number, to: number) {
    // FLIP for reordering only: capture before positions, update state, then animate transforms
    const before = new Map<number, DOMRect>();
    itemRefs.current.forEach((el, id) => { if (el) before.set(id, el.getBoundingClientRect()); });

    suppressNextRecalcRef.current = true;
    setNotes(s => {
      const copy = [...s];
      const a = copy[from];
      const b = copy[to];
      if (!a || !b) return s;
      if (!!(a as any).pinned !== !!(b as any).pinned) return s;
      copy[from] = b;
      copy[to] = a;
      return copy;
    });

    requestAnimationFrame(() => {
      const after = new Map<number, DOMRect>();
      itemRefs.current.forEach((el, id) => { if (el) after.set(id, el.getBoundingClientRect()); });

      after.forEach((rect, id) => {
        const prev = before.get(id);
        const el = itemRefs.current.get(id);
        if (!prev || !el) return;
        const dx = prev.left - rect.left;
        const dy = prev.top - rect.top;
        if (dx === 0 && dy === 0) return;
        // FLIP: delta without transition → reflow → animate to identity
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        void el.getBoundingClientRect();
        el.style.transition = `transform ${getAnimMs('swap')}ms ease-in-out`;
        el.style.transform = '';
        const cleanup = () => { try { el.style.transition = ''; el.removeEventListener('transitionend', cleanup); } catch {} };
        el.addEventListener('transitionend', cleanup);
      });
    });
  }

  function moveNoteSplice(from: number, to: number) {
    const before = new Map<number, DOMRect>();
    itemRefs.current.forEach((el, id) => { if (el) before.set(id, el.getBoundingClientRect()); });
    suppressNextRecalcRef.current = true;
    setNotes(s => {
      const copy = [...s];
      if (from < 0 || to < 0 || from >= copy.length || to >= copy.length) return s;
      const moving = copy[from];
      const target = copy[to];
      if (!moving || !target) return s;
      if (!!(moving as any).pinned !== !!(target as any).pinned) return s;
      const [m] = copy.splice(from, 1);
      copy.splice(to, 0, m);
      return copy;
    });
    requestAnimationFrame(() => {
      const after = new Map<number, DOMRect>();
      itemRefs.current.forEach((el, id) => { if (el) after.set(id, el.getBoundingClientRect()); });
      after.forEach((rect, id) => {
        const prev = before.get(id);
        const el = itemRefs.current.get(id);
        if (!prev || !el) return;
        const dx = prev.left - rect.left;
        const dy = prev.top - rect.top;
        if (dx === 0 && dy === 0) return;
        // FLIP: delta without transition → reflow → animate to identity
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        void el.getBoundingClientRect();
        el.style.transition = `transform ${getAnimMs('rearrange')}ms ease-in-out`;
        el.style.transform = '';
        const cleanup = () => { try { el.style.transition = ''; el.removeEventListener('transitionend', cleanup); } catch {} };
        el.addEventListener('transitionend', cleanup);
      });
    });
  }

  function animateFlip(before: Map<number, DOMRect>) {
    requestAnimationFrame(() => {
      const after = new Map<number, DOMRect>();
      itemRefs.current.forEach((el, id) => { if (el) after.set(id, el.getBoundingClientRect()); });
      after.forEach((rect, id) => {
        const prev = before.get(id);
        const el = itemRefs.current.get(id);
        if (!prev || !el) return;
        const dx = prev.left - rect.left;
        const dy = prev.top - rect.top;
        if (dx === 0 && dy === 0) return;
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        void el.getBoundingClientRect();
        el.style.transition = `transform ${getAnimMs('swap')}ms ease-in-out`;
        el.style.transform = '';
        const cleanup = () => { try { el.style.transition = ''; el.removeEventListener('transitionend', cleanup); } catch {} };
        el.addEventListener('transitionend', cleanup);
      });
    });
  }

  function applySwapAndPersist(section: 'pinned' | 'others', fromId: number, toId: number) {
    const before = new Map<number, DOMRect>();
    itemRefs.current.forEach((el, id) => { if (el) before.set(id, el.getBoundingClientRect()); });

    // Ensure we have up-to-date layouts, then swap.
    try { syncLayoutsFromDOM(); } catch {}
    swapInLayout(section, fromId, toId);

    // Persist a row-major order derived from the (soon-to-be) swapped layouts.
    // Compute on the next tick so state refs are updated and spans are available.
    window.setTimeout(() => {
      try {
        const current = notesRef.current || [];
        const pLay = pinnedLayoutRef.current;
        const oLay = othersLayoutRef.current;
        const pCols = Math.max(1, Number(pinnedGridRef.current?.dataset.__cols || '1') || 1, (pLay?.length || 1));
        const oCols = Math.max(1, Number(othersGridRef.current?.dataset.__cols || '1') || 1, (oLay?.length || 1));
        const pPlace = pLay ? computePlacements(pLay, pCols) : null;
        const oPlace = oLay ? computePlacements(oLay, oCols) : null;
        const pinnedNotes = buildPersistNotes(pLay, pPlace, current);
        const othersNotes = buildPersistNotes(oLay, oPlace, current);
        const used = new Set<number>([...pinnedNotes, ...othersNotes].map((n: any) => Number(n?.id)));
        const rest = current.filter((n: any) => !used.has(Number(n?.id)));
        const next = [...pinnedNotes, ...othersNotes, ...rest];
        setNotes(next);
        requestAnimationFrame(() => { try { persistOrder(next); } catch {} });
        animateFlip(before);
      } catch {
        animateFlip(before);
      }
    }, 0);
  }

  async function createNote() {
    const title = window.prompt('Title for new note:');
    if (title === null) return;
    try {
      const res = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ title }) });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (err) {
      window.alert('Failed to create note: ' + String(err));
    }
  }



  async function persistOrder(currentNotes: any[]) {
    // always save locally
    const pinnedIds = currentNotes.filter((n: any) => !!(n as any)?.pinned).map((n: any) => n.id);
    const otherIds = currentNotes.filter((n: any) => !(n as any)?.pinned).map((n: any) => n.id);
    const ids = [...pinnedIds, ...otherIds];
    try { localStorage.setItem('notesOrder', JSON.stringify(ids)); } catch (e) {}
    // attempt server persistence if authenticated
    if (!token) return;
    try {
      const res = await fetch('/api/notes/order', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ ids }) });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      console.error('Failed to persist note order to server', err);
      try {
        await enqueueNotesOrderPatch(ids);
        void kickOfflineSync();
      } catch {}
    }
  }

  const handleNoteChange = useCallback((evt?: any) => {
    if (evt && evt.type === 'filter:collection' && typeof evt.collectionId === 'number') {
      try { onSetSelectedCollaboratorId && onSetSelectedCollaboratorId(null); } catch {}
      try { onSelectCollectionById && onSelectCollectionById(Number(evt.collectionId), (typeof evt.collectionName === 'string' ? String(evt.collectionName) : undefined)); } catch {}
      return;
    }
    if (evt && evt.type === 'filter:collaborator' && typeof evt.userId === 'number') {
      try { onSetSelectedCollaboratorId && onSetSelectedCollaboratorId(Number(evt.userId)); } catch {}
      return;
    }
    if (evt && evt.type === 'filter:labels') {
      const single = (typeof (evt as any).labelId === 'number') ? Number((evt as any).labelId) : null;
      if (single != null && Number.isFinite(single)) {
        try { onSetSelectedLabelIds && onSetSelectedLabelIds([single]); } catch {}
        return;
      }
      if (Array.isArray((evt as any).labelIds)) {
        const ids = (evt as any).labelIds.map((x: any) => Number(x)).filter((x: any) => Number.isFinite(x));
        try { onSetSelectedLabelIds && onSetSelectedLabelIds(ids); } catch {}
        return;
      }
    }
    if (evt && evt.type === 'labels' && typeof evt.noteId === 'number' && Array.isArray(evt.labels)) {
      applyLabelsToNote(evt.noteId, evt.labels);
      return;
    }
    if (evt && evt.type === 'images' && typeof evt.noteId === 'number' && Array.isArray(evt.images)) {
      applyImagesToNote(evt.noteId, evt.images);
      return;
    }
    if (evt && evt.type === 'linkPreviews' && typeof evt.noteId === 'number' && Array.isArray((evt as any).linkPreviews)) {
      const previews = (evt as any).linkPreviews;
      setNotes((s) => s.map((n: any) => {
        if (Number(n?.id) !== Number(evt.noteId)) return n;
        return { ...n, linkPreviews: previews };
      }));
      return;
    }
    if (evt && evt.type === 'color' && typeof evt.noteId === 'number') {
      applyColorToNote(evt.noteId, (typeof evt.color === 'string') ? String(evt.color) : '');
      return;
    }
    if (evt && evt.type === 'imagesExpanded' && typeof evt.noteId === 'number') {
      applyImagesExpandedToNote(evt.noteId, !!(evt as any).imagesExpanded);
      return;
    }
    if (evt && evt.type === 'collections' && typeof evt.noteId === 'number' && Array.isArray(evt.collections)) {
      applyCollectionsToNote(evt.noteId, evt.collections);
      return;
    }
    if (evt && evt.type === 'reminder' && typeof evt.noteId === 'number') {
      applyReminderToNote(evt.noteId, (evt as any).reminderDueAt, (evt as any).reminderOffsetMinutes, (evt as any).reminderAt);
      return;
    }
    if (evt && evt.type === 'archive' && typeof evt.noteId === 'number') {
      const archived = !!(evt as any).archived;
      setNotes((s) => s.map((n) => {
        if (Number(n?.id) !== Number(evt.noteId)) return n;
        return { ...n, archived };
      }));
      return;
    }
    if (evt && evt.type === 'pin' && typeof evt.noteId === 'number') {
      const pinned = !!(evt as any).pinned;
      applyPinnedToNote(Number(evt.noteId), pinned);
      return;
    }
    if (evt && evt.type === 'collection' && typeof evt.noteId === 'number') {
      // Legacy single-collection event; reload to pick up names/membership.
      load();
      return;
    }
    load();
  }, [token, sortConfig, searchQuery, selectedLabelIds, selectedCollectionId, onSetSelectedLabelIds, onSetSelectedCollaboratorId, onSelectCollectionById]);

  useEffect(() => {
    if (!loading && token) setHasLoadedOnce(true);
  }, [loading, token]);

  const spanForNote = (note: any): number => {
    try {
      const raw = Number((note as any)?.cardSpan || 1);
      const maxSpan = layoutBucket === 'phone' ? 2 : 3;
      return Math.max(1, Math.min(maxSpan, Number.isFinite(raw) ? raw : 1));
    } catch { return 1; }
  };

  const activeSwapNote = (manualSwapEnabled && swapActiveId != null) ? (noteById.get(Number(swapActiveId)) || null) : null;

  const activeRearrangeNote = (keepRearrangeEnabled && rearrangeActiveId != null) ? (noteById.get(Number(rearrangeActiveId)) || null) : null;

  function onRearrangePointerDown(e: React.PointerEvent, noteId: number, section: 'pinned' | 'others', sectionIds: number[], colSpan: number) {
    if (!keepRearrangeEnabled) return;
    if (disableNoteDnD) return;
    if (!canManualReorder) return;
    if ((e as any).button != null && (e as any).button !== 0) return;
    if (isInteractiveTarget(e.target as any)) return;
    if (rearrangeActiveIdRef.current != null || rearrangeSettlingRef.current) return;
    const el = itemRefs.current.get(Number(noteId));
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect || rect.width < 10 || rect.height < 10) return;

    const pointerType = String((e as any).pointerType || 'mouse');
    const pointerId = (e as any).pointerId ?? 1;
    const captureEl = (e.currentTarget as any) as HTMLElement;

    rearrangePendingRef.current = {
      noteId: Number(noteId),
      section,
      sectionIds: Array.isArray(sectionIds) ? sectionIds.map((x) => Number(x)).filter((id) => Number.isFinite(id)) : [],
      startClientX: e.clientX,
      startClientY: e.clientY,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      pointerId,
      pointerType,
      touchArmed: false,
      longPressTimerId: null,
      captureEl,
    };
    rearrangePointerStartRef.current = { x: e.clientX, y: e.clientY };
    rearrangeBaseRectRef.current = rect;
    rearrangeColSpanRef.current = Math.max(1, Math.min(3, Number(colSpan) || 1));
    rearrangeRowSpanRef.current = (() => {
      const raw = (el as any)?.dataset?.__rowspan;
      const v = raw ? Number(raw) : NaN;
      return Number.isFinite(v) && v > 0 ? v : 2;
    })();
    // Mobile: allow native scrolling until we intentionally commit to dragging.
    // We arm dragging via a short long-press; if the user moves meaningfully
    // before that, we treat it as scroll and abandon the pending drag.
    if (pointerType === 'touch') {
      const timerId = window.setTimeout(() => {
        const p = rearrangePendingRef.current;
        if (!p) return;
        if (Number(p.pointerId) !== Number(pointerId) || Number(p.noteId) !== Number(noteId)) return;
        if (rearrangeDraggingRef.current || rearrangeActiveIdRef.current != null || rearrangeSettlingRef.current) return;

        // Only arm drag if the finger stayed nearly stationary. This prevents
        // slow scroll gestures from being misclassified as long-press drag.
        const lx = typeof p.lastClientX === 'number' ? p.lastClientX : p.startClientX;
        const ly = typeof p.lastClientY === 'number' ? p.lastClientY : p.startClientY;
        const mdx = lx - p.startClientX;
        const mdy = ly - p.startClientY;
        if ((mdx * mdx + mdy * mdy) > (3 * 3)) {
          rearrangePendingRef.current = null;
          return;
        }

        p.touchArmed = true;
        try { p.captureEl?.setPointerCapture?.(p.pointerId as any); } catch {}
        beginRearrangeDrag(p.sectionIds);
      }, 220);
      rearrangePendingRef.current.longPressTimerId = timerId as any;
      return;
    }
    // Important: do NOT preventDefault here for mouse/pen.
    // We only suppress default actions after the drag has actually activated.
  }

  function beginRearrangeDrag(sectionIds: number[]) {
    const pending = rearrangePendingRef.current;
    const baseRect = rearrangeBaseRectRef.current;
    if (!pending || !baseRect) return;
    const activeId = pending.noteId;
    const startIdx = Math.max(0, sectionIds.findIndex((id) => Number(id) === Number(activeId)));

    rearrangeDraggingRef.current = true;
    setManualDragActive(true);
    setRearrangeActiveId(activeId);
    setRearrangeSection(pending.section);
    setRearrangeRenderIds(buildRenderIds(sectionIds, activeId, startIdx));

    // Mobile needs immediate default-action suppression; waiting for React state
    // to toggle the class is too late and causes scroll/drag fighting.
    try { document.documentElement.classList.add('is-note-rearrange-dragging'); } catch {}
    if (pending.pointerType === 'touch') {
      lockBodyScrollForRearrange();
    }

    // Initialize overlay element transform for immediate feedback.
    requestAnimationFrame(() => {
      const overlay = rearrangeOverlayRef.current;
      if (!overlay) return;
      overlay.style.transform = 'translate(0px, 0px) scale(1.03)';
    });
  }

  function getClampedDragDelta(clientX: number, clientY: number): { dx: number; dy: number } {
    const baseRect = rearrangeBaseRectRef.current;
    const start = rearrangePointerStartRef.current;
    if (!baseRect || !start) return { dx: 0, dy: 0 };
    let dx = clientX - start.x;
    let dy = clientY - start.y;
    const bounds = rearrangeBoundsRef.current;
    if (!bounds) return { dx, dy };

    // Small cushion so it doesn't feel pinned to the edge.
    const pad = 18;
    const minLeft = bounds.left - pad;
    const maxLeft = bounds.right - baseRect.width + pad;
    const minTop = bounds.top - pad;
    const maxTop = bounds.bottom - baseRect.height + pad;

    const nextLeft = baseRect.left + dx;
    const nextTop = baseRect.top + dy;
    const clampedLeft = Math.min(Math.max(nextLeft, minLeft), maxLeft);
    const clampedTop = Math.min(Math.max(nextTop, minTop), maxTop);
    dx = clampedLeft - baseRect.left;
    dy = clampedTop - baseRect.top;
    return { dx, dy };
  }

  function scheduleOverlayMove(clientX: number, clientY: number) {
    const baseRect = rearrangeBaseRectRef.current;
    const start = rearrangePointerStartRef.current;
    const overlay = rearrangeOverlayRef.current;
    if (!baseRect || !start || !overlay) return;
    const { dx, dy } = getClampedDragDelta(clientX, clientY);
    overlay.style.transform = `translate(${dx}px, ${dy}px) scale(1.03)`;
  }

  useEffect(() => {
    if (!keepRearrangeEnabled) return;
    const onMove = (ev: PointerEvent) => {
      const pending = rearrangePendingRef.current;
      if (!pending) return;
      if (pending.pointerId != null && (ev as any).pointerId != null && Number((ev as any).pointerId) !== Number(pending.pointerId)) return;

      if (pending.pointerType === 'touch') {
        pending.lastClientX = ev.clientX;
        pending.lastClientY = ev.clientY;
      }

      const activeId = rearrangeActiveIdRef.current;
      const sectionIds = pending.sectionIds;
      if (!sectionIds || !sectionIds.length) return;

      if (activeId == null && !rearrangeDraggingRef.current) {
        const dx = ev.clientX - pending.startClientX;
        const dy = ev.clientY - pending.startClientY;

        if (pending.pointerType === 'touch') {
          // If the user starts moving before long-press arms, treat as scroll.
          const absX = Math.abs(dx);
          const absY = Math.abs(dy);
          const slop = 4;
          if (!pending.touchArmed) {
            if (absX > slop || absY > slop) {
              try { if (pending.longPressTimerId != null) window.clearTimeout(pending.longPressTimerId); } catch {}
              rearrangePendingRef.current = null;
            }
            return;
          }

          // Armed: allow drag to proceed.
          beginRearrangeDrag(sectionIds);
        } else {
          const activation = 6;
          if ((dx * dx + dy * dy) < activation * activation) {
            return;
          }
          beginRearrangeDrag(sectionIds);
        }
      }

      if (!rearrangeDraggingRef.current) return;

      // Once we're actively dragging, block native actions (scroll/selection).
      try { ev.preventDefault(); } catch {}

      if (rearrangeMoveRafRef.current != null) return;
      rearrangeMoveRafRef.current = requestAnimationFrame(() => {
        rearrangeMoveRafRef.current = null;
        scheduleOverlayMove(ev.clientX, ev.clientY);

        // Determine new spacer index using cached slot rects.
        const idsNow = rearrangeRenderIdsRef.current;
        const rectsNow = rearrangeSlotRectsRef.current;
        if (!idsNow.length || rectsNow.length !== idsNow.length) return;

        // Choose the next slot based on the dragged card's projected rectangle,
        // not the pointer location. This makes behavior consistent regardless
        // of where the drag was initiated within the card.
        const baseRect = rearrangeBaseRectRef.current;
        const start = rearrangePointerStartRef.current;
        if (!baseRect || !start) return;
        const { dx, dy } = getClampedDragDelta(ev.clientX, ev.clientY);
        const dragLeft = baseRect.left + dx;
        const dragTop = baseRect.top + dy;
        const dragRect = {
          left: dragLeft,
          top: dragTop,
          right: dragLeft + baseRect.width,
          bottom: dragTop + baseRect.height,
        };
        const dragCx = dragLeft + baseRect.width / 2;
        const dragCy = dragTop + baseRect.height / 2;

        const byOverlap = chooseSlotIndexByOverlap(dragRect);
        const idx = (byOverlap.idx >= 0 && byOverlap.area > 0)
          ? byOverlap.idx
          : chooseNearestSlotIndex(dragCx, dragCy);
        if (idx < 0) return;
        const currentIdx = rearrangeSpacerIndexRef.current;
        if (idx === currentIdx) return;

        const cur = rectsNow[currentIdx] || null;
        const cand = rectsNow[idx] || null;
        if (!cur || !cand) return;

        // Half-plane test: only allow move when the dragged card center has
        // crossed the bisector between the current slot center and candidate slot.
        const vx = cand.cx - cur.cx;
        const vy = cand.cy - cur.cy;
        const bx = (cand.cx + cur.cx) / 2;
        const by = (cand.cy + cur.cy) / 2;
        const dot = (dragCx - bx) * vx + (dragCy - by) * vy;
        const dist = Math.sqrt(vx * vx + vy * vy) || 1;
        const hysteresis = pending.pointerType === 'touch' ? 10 : 6;
        if (dot <= hysteresis * dist) return;

        moveRearrangeSpacerTo(idx);
      });
    };

    const onUp = (ev: PointerEvent) => {
      const pending = rearrangePendingRef.current;
      if (!pending) return;
      if (pending.pointerId != null && (ev as any).pointerId != null && Number((ev as any).pointerId) !== Number(pending.pointerId)) return;

      try { if (pending.longPressTimerId != null) window.clearTimeout(pending.longPressTimerId); } catch {}

      // If we never activated dragging, just clear pending.
      if (!rearrangeDraggingRef.current || rearrangeActiveIdRef.current == null) {
        rearrangePendingRef.current = null;
        return;
      }

      const activeId = Number(rearrangeActiveIdRef.current);
      const section = rearrangeSectionRef.current;
      const ids = rearrangeRenderIdsRef.current;
      const spacerIdx = ids.indexOf('spacer');
      const afterKey = (spacerIdx >= 0) ? ids[spacerIdx + 1] : null;
      const beforeId = (typeof afterKey === 'number') ? Number(afterKey) : null;

      // Animate overlay settling into the spacer slot.
      rearrangeSettlingRef.current = true;
      const overlay = rearrangeOverlayRef.current;
      const baseRect = rearrangeBaseRectRef.current;
      const ms = Math.max(150, Math.min(650, getAnimMs('rearrange')));
      const spacerEl = rearrangeSpacerRef.current;
      const slotRect = spacerEl ? spacerEl.getBoundingClientRect() : null;

      if (overlay && baseRect && slotRect) {
        const finalDx = slotRect.left - baseRect.left;
        const finalDy = slotRect.top - baseRect.top;
        overlay.style.transition = `transform ${ms}ms cubic-bezier(.2,.9,.2,1)`;
        overlay.style.transform = `translate(${finalDx}px, ${finalDy}px) scale(1)`;
      }

      // Update data order once.
      if (section) {
        setNotes((prev) => {
          const fromIdx = prev.findIndex((n: any) => Number(n?.id) === activeId);
          if (fromIdx < 0) return prev;
          const item = prev[fromIdx];
          if (!!item.pinned !== (section === 'pinned')) return prev;
          const next = [...prev];
          next.splice(fromIdx, 1);
          let toIdx = next.length;
          if (beforeId != null) {
            const idx = next.findIndex((n: any) => Number(n?.id) === beforeId);
            if (idx >= 0) toIdx = idx;
          } else {
            // end of section
            if (section === 'pinned') {
              let lastPinned = -1;
              for (let i = 0; i < next.length; i++) if (!!next[i]?.pinned) lastPinned = i;
              toIdx = lastPinned + 1;
            } else {
              let lastOthers = -1;
              for (let i = 0; i < next.length; i++) if (!next[i]?.pinned) lastOthers = i;
              toIdx = lastOthers + 1;
            }
          }
          next.splice(toIdx, 0, item);
          requestAnimationFrame(() => { try { persistOrder(next); } catch {} });
          return next;
        });
      }

      const cleanup = () => {
        try {
          if (overlay) {
            overlay.style.transition = '';
            overlay.removeEventListener('transitionend', cleanup);
          }
        } catch {}
        setManualDragActive(false);
        finishRearrangeDrag();
      };
      if (overlay) {
        overlay.addEventListener('transitionend', cleanup);
        // safety: if transitionend never fires
        window.setTimeout(cleanup, ms + 80);
      } else {
        cleanup();
      }
    };

    window.addEventListener('pointermove', onMove, { capture: true, passive: false } as any);
    window.addEventListener('pointerup', onUp, { capture: true });
    window.addEventListener('pointercancel', onUp as any, { capture: true });
    return () => {
      try { window.removeEventListener('pointermove', onMove, { capture: true } as any); } catch {}
      try { window.removeEventListener('pointerup', onUp, { capture: true } as any); } catch {}
      try { window.removeEventListener('pointercancel', onUp as any, { capture: true } as any); } catch {}
    };
  }, [keepRearrangeEnabled, disableNoteDnD, token]);

  const isTrashView = ((sortConfig || DEFAULT_SORT_CONFIG).smartFilter === 'trash');
  const trashCount = (() => {
    try { return (notes || []).filter((n: any) => !!(n as any)?.trashedAt).length; } catch { return 0; }
  })();

  const imageEntries = useMemo(() => {
    const cfg = sortConfig || DEFAULT_SORT_CONFIG;
    const source = [...(pinned || []), ...(others || [])];
    const entries: Array<any> = [];
    for (const n of source) {
      const imgs = Array.isArray((n as any)?.images) ? (n as any).images : [];
      for (const img of imgs) {
        const url = String((img as any)?.url || '').trim();
        if (!url) continue;
        entries.push({
          key: `${Number((n as any)?.id)}:${Number((img as any)?.id)}`,
          noteId: Number((n as any)?.id),
          imageId: Number((img as any)?.id),
          url,
          imageCreatedAt: String((img as any)?.createdAt || ''),
          noteCreatedAt: String((n as any)?.createdAt || ''),
          noteUpdatedAt: String((n as any)?.updatedAt || ''),
          noteTitle: String((n as any)?.title || '').trim(),
          noteOwnerName: String((n as any)?.owner?.name || (n as any)?.owner?.email || ''),
          noteCollections: Array.isArray((n as any)?.viewerCollections) ? (n as any)?.viewerCollections : [],
          noteCollaborators: Array.isArray((n as any)?.collaborators) ? (n as any)?.collaborators : [],
          ocrText: String((img as any)?.ocrSearchText || (img as any)?.ocrText || '').trim(),
        });
      }
    }

    const dir = cfg.sortDir === 'asc' ? 1 : -1;
    entries.sort((a, b) => {
      if (cfg.sortKey === 'title') {
        const cmp = String(a.noteTitle || '').localeCompare(String(b.noteTitle || ''), undefined, { sensitivity: 'base' });
        if (cmp !== 0) return cmp * dir;
      } else if (cfg.sortKey === 'updatedAt') {
        const av = parseDateMaybe(a.noteUpdatedAt);
        const bv = parseDateMaybe(b.noteUpdatedAt);
        if (av !== bv) return (av - bv) * dir;
      } else {
        const av = parseDateMaybe(a.imageCreatedAt || a.noteCreatedAt);
        const bv = parseDateMaybe(b.imageCreatedAt || b.noteCreatedAt);
        if (av !== bv) return (av - bv) * dir;
      }
      return (Number(a.imageId) - Number(b.imageId)) * dir;
    });

    return entries;
  }, [pinned, others, sortConfig]);

  async function deleteImageFromGallery(target: { noteId: number; imageId: number }) {
    if (!token) return;
    try {
      const res = await fetch(`/api/notes/${target.noteId}/images/${target.imageId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      setNotes((s) => s.map((n: any) => {
        if (Number(n?.id) !== Number(target.noteId)) return n;
        const imgs = Array.isArray(n?.images) ? n.images : [];
        const nextImgs = imgs.filter((img: any) => Number(img?.id) !== Number(target.imageId));
        return { ...n, images: nextImgs, imagesCount: nextImgs.length };
      }));
    } catch (err) {
      console.error('Failed to delete image', err);
      window.alert('Failed to delete image');
    }
  }

  async function onEmptyTrashNow() {
    if (emptyingTrash) return;
    if (!token) return;
    if (!trashCount) return;
    const ok = window.confirm(`Permanently delete ${trashCount} note${trashCount === 1 ? '' : 's'} from Trash? This cannot be undone.`);
    if (!ok) return;
    setEmptyingTrash(true);
    try {
      const res = await fetch('/api/trash/empty', { method: 'DELETE', headers: { Authorization: token ? `Bearer ${token}` : '' } });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const ids: number[] = Array.isArray(data?.noteIds) ? data.noteIds.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n)) : [];
      if (ids.length) {
        const idSet = new Set<number>(ids);
        setNotes((s) => (s || []).filter((n: any) => !idSet.has(Number((n as any)?.id))));
      } else {
        // Best-effort fallback: clear local trashed notes.
        setNotes((s) => (s || []).filter((n: any) => !(n as any)?.trashedAt));
      }
    } catch (err) {
      console.error('Failed to empty trash', err);
      alert('Failed to empty trash');
    } finally {
      setEmptyingTrash(false);
    }
  }

  const getOpenRequestForNote = useCallback((noteId: number): number => {
    if (!openNoteRequest) return 0;
    return Number(openNoteRequest.noteId) === Number(noteId) ? Number(openNoteRequest.nonce) : 0;
  }, [openNoteRequest]);

  const handleOpenRequestHandled = useCallback((noteId: number) => {
    setOpenNoteRequest((curr) => {
      if (!curr) return curr;
      if (Number(curr.noteId) !== Number(noteId)) return curr;
      return null;
    });
  }, []);

  const openAssociatedNoteFromImage = useCallback((noteId: number) => {
    const nId = Number(noteId);
    if (!Number.isFinite(nId)) return;
    const cfg = sortConfig || DEFAULT_SORT_CONFIG;
    if (cfg.smartFilter === 'images') {
      setReturnToImagesOnEditorClose({ noteId: nId, sortSnapshot: { ...cfg } });
    } else {
      setReturnToImagesOnEditorClose(null);
    }
    if (cfg.smartFilter === 'images' && onSortConfigChange) {
      try { onSortConfigChange({ ...cfg, smartFilter: 'none' }); } catch {}
    }
    setOpenNoteRequest({ noteId: nId, nonce: Date.now() + Math.floor(Math.random() * 1000) });
  }, [sortConfig, onSortConfigChange]);

  useEffect(() => {
    if (!returnToImagesOnEditorClose) return;
    const onEditorClose = () => {
      try {
        if (onSortConfigChange) {
          onSortConfigChange({ ...returnToImagesOnEditorClose.sortSnapshot });
        }
      } catch {}
      setReturnToImagesOnEditorClose(null);
    };
    window.addEventListener('freemannotes:editor-modal-close', onEditorClose as EventListener);
    return () => {
      window.removeEventListener('freemannotes:editor-modal-close', onEditorClose as EventListener);
    };
  }, [returnToImagesOnEditorClose, onSortConfigChange]);

  const isListView = viewMode === 'list-1' || viewMode === 'list-2';
  const gridViewClass = isListView
    ? ` notes-grid--list ${viewMode === 'list-2' ? 'notes-grid--list-2' : 'notes-grid--list-1'}`
    : ' notes-grid--cards';
  const notesAreaViewClass = isListView
    ? ` notes-area--list ${viewMode === 'list-2' ? 'notes-area--list-2' : 'notes-area--list-1'}`
    : '';
  const imagesSliderMin = layoutBucket === 'phone' ? 96 : 140;
  const imagesSliderMax = layoutBucket === 'phone' ? 220 : 340;
  const effectiveImagesSidebarThumbSize = Math.max(imagesSliderMin, Math.min(imagesSliderMax, imagesSidebarThumbSize));
  const isTouchGalleryUi = layoutBucket !== 'desktop';
  const showDesktopQuickCreate = !(isImagesView && layoutBucket === 'desktop');

  const clearGalleryLongPress = useCallback(() => {
    if (galleryLongPressTimerRef.current != null) {
      try { window.clearTimeout(galleryLongPressTimerRef.current); } catch {}
      galleryLongPressTimerRef.current = null;
    }
    galleryLongPressStartRef.current = null;
  }, []);

  useEffect(() => {
    return () => { clearGalleryLongPress(); };
  }, [clearGalleryLongPress]);

  const beginGalleryLongPress = useCallback((e: React.PointerEvent, img: any) => {
    if (!isTouchGalleryUi) return;
    if (e.pointerType === 'mouse') return;
    clearGalleryLongPress();
    galleryLongPressStartRef.current = { x: Number(e.clientX || 0), y: Number(e.clientY || 0) };
    galleryLongPressTimerRef.current = window.setTimeout(() => {
      suppressNextGalleryClickRef.current = true;
      setGalleryDeleteTarget({
        noteId: Number(img?.noteId),
        imageId: Number(img?.imageId),
        title: String(img?.noteTitle || 'Untitled note'),
      });
      clearGalleryLongPress();
    }, 560);
  }, [clearGalleryLongPress, isTouchGalleryUi]);

  const moveGalleryLongPress = useCallback((e: React.PointerEvent) => {
    if (galleryLongPressTimerRef.current == null) return;
    const start = galleryLongPressStartRef.current;
    if (!start) return;
    const dx = Math.abs(Number(e.clientX || 0) - start.x);
    const dy = Math.abs(Number(e.clientY || 0) - start.y);
    if (dx > 10 || dy > 10) clearGalleryLongPress();
  }, [clearGalleryLongPress]);

  const consumeSuppressedGalleryClick = useCallback((): boolean => {
    if (!suppressNextGalleryClickRef.current) return false;
    suppressNextGalleryClickRef.current = false;
    return true;
  }, []);

  const handleMobileCreateCreated = useCallback(async () => {
    await load();
    if (!isImagesView) return;
    if (onSortConfigChange) {
      try { onSortConfigChange({ ...DEFAULT_SORT_CONFIG }); } catch {}
    }
  }, [load, isImagesView, onSortConfigChange]);

  if (loading && !hasLoadedOnce) return <div>Loading notes…</div>;

  return (
    <section className={`notes-area${mobileAddOpen ? ' notes-area--mobile-add-open' : ''}${notesAreaViewClass}`}>
      <div className="take-note-sticky">
        <div className="notes-sticky-search" role="search" aria-label="Search notes">
          <input
            className="search"
            placeholder="Search"
            value={searchQuery ?? ''}
            onChange={(e) => { try { onSetSearchQuery && onSetSearchQuery(e.target.value); } catch {} }}
          />
        </div>
        {showDesktopQuickCreate && (
          <TakeNoteBar onCreated={load} openRequest={{ nonce: takeNoteOpenNonce, mode: takeNoteOpenMode }} activeCollection={activeCollection} />
        )}

        {(() => {
          const offline = navigator.onLine === false;
          const actionableSyncState = syncState === 'OFFLINE' || syncState === 'DEGRADED' || syncState === 'PAUSED';
          if (!offline && !actionableSyncState) return null;
          return (
          <div className="grid-context" aria-label="Sync status">
            <div className="grid-context__text">
              <div className="grid-context__subtitle" style={{ whiteSpace: 'normal' }}>
                {offline
                  ? 'Offline: edits are saved locally and will sync when back online.'
                  : (`Sync: ${String(syncState).toLowerCase().replace(/_/g, ' ')}`)}
              </div>
            </div>
          </div>
          );
        })()}

        {gridContext.show && (
          <div className="grid-context" role="region" aria-label="Current view">
            <div className="grid-context__text">
              <div className="grid-context__title-row">
                {isTrashView && (
                  <button
                    type="button"
                    className="grid-context__clear grid-context__danger"
                    onClick={onEmptyTrashNow}
                    disabled={emptyingTrash || !trashCount || !token}
                    aria-label="Empty trash"
                    title="Permanently delete all trashed notes"
                  >
                    {emptyingTrash ? 'Emptying…' : 'Empty trash'}
                  </button>
                )}
                {!!onClearAllFilters && !!(gridContext as any).hasAnyFilter && (
                  <button
                    type="button"
                    className="grid-context__clear"
                    onClick={() => {
                      try { onClearAllFilters(); } catch {}
                    }}
                    aria-label="Clear all filters"
                    title="Clear"
                  >
                    Clear
                  </button>
                )}
                {isImagesView && (
                  <label className="grid-context__slider" title="Image size">
                    <span className="grid-context__slider-label">Size</span>
                    <input
                      type="range"
                      min={imagesSliderMin}
                      max={imagesSliderMax}
                      step={8}
                      value={effectiveImagesSidebarThumbSize}
                      onChange={(e) => {
                        const next = Number((e.target as HTMLInputElement).value);
                        if (!Number.isFinite(next)) return;
                        setImagesSidebarThumbSize(Math.max(imagesSliderMin, Math.min(imagesSliderMax, Math.round(next))));
                      }}
                      aria-label="Images size"
                    />
                  </label>
                )}
              </div>
              {!!(gridContext as any).chips?.length && (
                <div className="grid-context__chips" aria-label="Active filters">
                  {(gridContext as any).chips.map((c: any) => (
                    <span key={String(c.id)} className="grid-chip">
                      <span className="grid-chip__text" title={String(c.text || '')}>{String(c.text || '')}</span>
                      {typeof c.onClear === 'function' && (
                        <button
                          type="button"
                          className="grid-chip__clear"
                          onClick={() => { try { c.onClear(); } catch {} }}
                          aria-label={`Clear ${String(c.text || 'filter')}`}
                          title="Clear"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {createPortal(
        <>
          {mobileAddOpen && (
            <div
              className="mobile-add-backdrop"
              aria-hidden="true"
              onPointerDown={(e) => {
                // Swallow events so taps don't interact with notes behind the blur.
                try { e.preventDefault(); } catch {}
                try { e.stopPropagation(); } catch {}
              }}
              onClick={(e) => {
                try { e.preventDefault(); } catch {}
                try { e.stopPropagation(); } catch {}
              }}
            />
          )}

          <div className="mobile-add-note" aria-label="Add note">
            {mobileAddOpen && (
              <div className="mobile-add-menu" role="menu" aria-label="Create">
                <button type="button" className="mobile-add-menu-item" role="menuitem" onClick={() => openTakeNote('text')}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden focusable="false">
                    <path fill="currentColor" d="M6 2h9l5 5v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 1.5V8h4.5L14 3.5ZM7 11h10v1.6H7V11Zm0 4h10v1.6H7V15Zm0 4h7v1.6H7V19Z"/>
                  </svg>
                  <span>New note</span>
                </button>
                <button type="button" className="mobile-add-menu-item" role="menuitem" onClick={() => openTakeNote('checklist')}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden focusable="false">
                    <path fill="currentColor" d="M9.2 7.2 7.9 5.9 6 7.8 5.1 6.9 4 8l2 2 3.2-3.2ZM10.5 8H20v1.6h-9.5V8Zm-1.3 6.2-1.3-1.3L6 14.8l-.9-.9L4 15l2 2 3.2-3.2ZM10.5 15H20v1.6h-9.5V15Z"/>
                  </svg>
                  <span>New checklist</span>
                </button>
              </div>
            )}
            <button
              type="button"
              className={`mobile-add-fab${mobileAddOpen ? ' is-open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={mobileAddOpen}
              onClick={() => setMobileAddOpen((s) => !s)}
            >
              <img src={MOBILE_FAB_ICON} alt="" aria-hidden="true" className="about-version-icon mobile-add-fab-icon" />
            </button>
          </div>
        </>,
        document.body
      )}

      <MobileCreateModal
        open={mobileCreateMode != null}
        mode={(mobileCreateMode || 'text') as any}
        onClose={() => setMobileCreateMode(null)}
        onCreated={handleMobileCreateCreated}
        activeCollection={activeCollection}
      />

      {isImagesView ? (
        <div className="notes-section notes-section--images">
          {imageEntries.length === 0 ? (
            <div className="images-gallery-empty">No images match the current filters.</div>
          ) : (
            <div
              className="images-gallery-grid"
              role="list"
              aria-label="Images"
              style={{ '--images-gallery-min': `${effectiveImagesSidebarThumbSize}px` } as React.CSSProperties}
            >
              {imageEntries.map((img: any) => {
                const collectionNames = (Array.isArray(img.noteCollections) ? img.noteCollections : [])
                  .map((c: any) => String(c?.name || '').trim())
                  .filter(Boolean)
                  .slice(0, 2);
                const collabCount = Math.max(0, (Array.isArray(img.noteCollaborators) ? img.noteCollaborators.length : 0));
                return (
                  <article
                    key={img.key}
                    className="images-gallery-card"
                    role="listitem"
                    onPointerDown={(e) => beginGalleryLongPress(e, img)}
                    onPointerMove={moveGalleryLongPress}
                    onPointerUp={clearGalleryLongPress}
                    onPointerCancel={clearGalleryLongPress}
                    onPointerLeave={clearGalleryLongPress}
                  >
                    <button
                      type="button"
                      className="images-gallery-thumb-btn"
                      onClick={() => {
                        if (consumeSuppressedGalleryClick()) return;
                        setGalleryLightboxUrl(String(img.url || ''));
                      }}
                      aria-label="Open full image"
                      title="Open full image"
                    >
                      <img className="images-gallery-thumb" src={img.url} alt={img.noteTitle ? `${img.noteTitle} image` : 'Note image'} loading="lazy" />
                    </button>
                    <div className="images-gallery-meta">
                      <button
                        type="button"
                        className="images-gallery-title images-gallery-title-btn"
                        title={img.noteTitle || 'Untitled note'}
                        onClick={() => {
                          if (consumeSuppressedGalleryClick()) return;
                          openAssociatedNoteFromImage(Number(img.noteId));
                        }}
                        aria-label="Open associated note"
                      >
                        {img.noteTitle || 'Untitled note'}
                      </button>
                      {(collectionNames.length > 0 || collabCount > 0) && (
                        <div className="images-gallery-tags">
                          {collectionNames.map((name: string) => <span key={`${img.key}:${name}`} className="images-gallery-tag">{name}</span>)}
                          {collabCount > 0 ? <span className="images-gallery-tag">+{collabCount} collaborators</span> : null}
                        </div>
                      )}
                    </div>
                    {!isTouchGalleryUi && (
                      <button
                        type="button"
                        className="images-gallery-delete"
                        onClick={() => setGalleryDeleteTarget({ noteId: Number(img.noteId), imageId: Number(img.imageId), title: String(img.noteTitle || 'Untitled note') })}
                        aria-label="Delete image"
                        title="Delete image"
                      >
                        Delete
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : (
      manualSwapEnabled ? (
        <DndContext
          sensors={swapSensors}
          collisionDetection={pointerWithin}
          onDragStart={onSwapDragStart}
          onDragMove={onSwapDragMove}
          onDragOver={onSwapDragOver}
          onDragEnd={onSwapDragEnd}
          onDragCancel={onSwapDragCancel}
        >
          {pinned.length > 0 && (
            <div className="notes-section">
              <h4 className="section-title">Pinned</h4>
              {pinnedGroups.map((g) => (
                <div key={g.key}>
                  {g.title && g.key !== 'all' && <h5 className="section-title" style={{ marginTop: 10, marginBottom: 6, color: 'var(--muted)' }}>{g.title}</h5>}
                  <div className={`notes-grid notes-grid--swap${gridViewClass}`} ref={pinnedGridRef}>
                    {g.notes.map((n, idx) => {
                      const span = spanForNote(n);
                      const setItemRef = (el: HTMLElement | null, noteId: number) => {
                        if (el) itemRefs.current.set(noteId, el);
                        else itemRefs.current.delete(noteId);
                      };
                      return (
                        <SwapNoteItem
                          key={`swap-pinned-${String(g.key)}-${Number(n.id)}-${idx}`}
                          note={n}
                          setItemRef={setItemRef}
                          style={{ gridColumn: `span ${span}` } as any}
                          isDragSource={swapActiveId != null && Number(swapActiveId) === Number(n.id)}
                          isDragTarget={swapTargetId != null && Number(swapTargetId) === Number(n.id)}
                          disabled={disableNoteDnD}
                          onChange={handleNoteChange}
                          openRequest={getOpenRequestForNote(Number(n.id))}
                          onOpenRequestHandled={handleOpenRequestHandled}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="notes-section">
            {otherGroups.map((g) => (
              <div key={g.key}>
                {g.title && g.key !== 'all' && <h5 className="section-title" style={{ marginTop: 10, marginBottom: 6, color: 'var(--muted)' }}>{g.title}</h5>}
                <div className={`notes-grid notes-grid--swap${gridViewClass}`} ref={othersGridRef}>
                  {g.notes.map((n, idx) => {
                    const span = spanForNote(n);
                    const setItemRef = (el: HTMLElement | null, noteId: number) => {
                      if (el) itemRefs.current.set(noteId, el);
                      else itemRefs.current.delete(noteId);
                    };
                    return (
                      <SwapNoteItem
                        key={`swap-others-${String(g.key)}-${Number(n.id)}-${idx}`}
                        note={n}
                        setItemRef={setItemRef}
                        style={{ gridColumn: `span ${span}` } as any}
                        isDragSource={swapActiveId != null && Number(swapActiveId) === Number(n.id)}
                        isDragTarget={swapTargetId != null && Number(swapTargetId) === Number(n.id)}
                        disabled={disableNoteDnD}
                        onChange={handleNoteChange}
                        openRequest={getOpenRequestForNote(Number(n.id))}
                        onOpenRequestHandled={handleOpenRequestHandled}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <DragOverlay>
            {activeSwapNote ? (
              <div
                className={`note-drag-ghost${isListView ? ' note-drag-ghost--list' : ''}`}
                style={{
                  width: swapOverlayRect ? `${swapOverlayRect.width}px` : (() => {
                    const s = spanForNote(activeSwapNote);
                    return `calc(${s} * var(--note-card-width) + ${Math.max(0, s - 1)} * var(--gap))`;
                  })(),
                  height: swapOverlayRect ? `${swapOverlayRect.height}px` : undefined,
                }}
              >
                <NoteCard
                  note={activeSwapNote}
                  onChange={handleNoteChange}
                  openRequest={getOpenRequestForNote(Number(activeSwapNote.id))}
                  onOpenRequestHandled={handleOpenRequestHandled}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <>
          {pinned.length > 0 && (
            <div className="notes-section">
              <h4 className="section-title">Pinned</h4>
              {pinnedGroups.map((g) => (
                <div key={g.key}>
                  {g.title && g.key !== 'all' && (
                    <h5 className="section-title" style={{ marginTop: 10, marginBottom: 6, color: 'var(--muted)' }}>{g.title}</h5>
                  )}
                  <div className={`notes-grid${manualDragActive ? ' notes-grid--manual' : ''}${gridViewClass}`} ref={pinnedGridRef}>
                    {(keepRearrangeEnabled && rearrangeSection === 'pinned' && rearrangeRenderIds.length)
                      ? rearrangeRenderIds.map((key, idx) => {
                          if (key === 'spacer') {
                            return (
                              <div
                                key="spacer"
                                ref={rearrangeSpacerRef as any}
                                className="note-rearrange-spacer"
                                style={{
                                  gridColumn: `span ${rearrangeColSpanRef.current}`,
                                  gridRowEnd: `span ${rearrangeRowSpanRef.current}`,
                                  height: `${rearrangeBaseRectRef.current?.height || 0}px`,
                                } as any}
                              />
                            );
                          }
                          const id = Number(key);
                          const n = noteById.get(id);
                          if (!n) return null;
                          const span = Math.max(1, Math.min(3, Number((n as any).cardSpan || 1)));
                          const place = pinnedPlacements?.get(Number(n.id)) || null;
                          return (
                            <div
                              key={`rearrange-pinned-${Number(n.id)}-${idx}`}
                              data-note-id={n.id}
                              style={place
                                ? ({ gridColumnStart: place.colStart, gridColumnEnd: `span ${place.colSpan}`, gridRowStart: place.rowStart, gridRowEnd: `span ${place.rowSpan}` } as any)
                                : ({ gridColumn: `span ${span}` } as any)
                              }
                              ref={(el) => { if (el) itemRefs.current.set(n.id, el); else itemRefs.current.delete(n.id); }}
                            >
                              <NoteCard
                                note={n}
                                onChange={handleNoteChange}
                                openRequest={getOpenRequestForNote(Number(n.id))}
                                onOpenRequestHandled={handleOpenRequestHandled}
                              />
                            </div>
                          );
                        })
                      : g.notes.map((n, idx) => {
                          const globalIdx = idToIndex.get(Number(n.id)) ?? -1;
                          const span = Math.max(1, Math.min(3, Number((n as any).cardSpan || 1)));
                          const place = pinnedPlacements?.get(Number(n.id)) || null;
                          const sectionIds = g.notes.map((x: any) => Number(x.id)).filter((id: any) => Number.isFinite(id));
                          const wrapperProps: any = keepRearrangeEnabled
                            ? {
                                draggable: false,
                                onPointerDown: (e: any) => onRearrangePointerDown(e, Number(n.id), 'pinned', sectionIds, span),
                              }
                            : {
                                draggable: canManualReorder && !disableNoteDnD,
                                onDragStart: (e: any) => {
                                  if (!canManualReorder) return;
                                  draggingNoteIdRef.current = Number(n.id);
                                  e.dataTransfer.setData('text/plain', String(globalIdx));
                                  draggingIdxRef.current = globalIdx;
                                },
                                onDragEnd: () => {
                                  if (!canManualReorder) return;
                                  draggingIdxRef.current = null;
                                  draggingNoteIdRef.current = null;
                                },
                                onDragOver: (e: any) => {
                                  if (!canManualReorder) return;
                                  e.preventDefault();
                                  try {
                                    const draggingIndex = draggingIdxRef.current;
                                    if (dragBehavior === 'rearrange' && draggingIndex !== null && draggingIndex !== globalIdx) {
                                      const now = Date.now();
                                      const targetEl = e.currentTarget as HTMLElement;
                                      const rect = targetEl.getBoundingClientRect();
                                      const bufferY = Math.min(28, Math.floor(rect.height * 0.2));
                                      const bufferX = Math.min(20, Math.floor(rect.width * 0.2));
                                      const insideSafeY = e.clientY > rect.top + bufferY && e.clientY < rect.bottom - bufferY;
                                      const insideSafeX = e.clientX > rect.left + bufferX && e.clientX < rect.right - bufferX;
                                      const interval = Math.max(150, Math.floor(getAnimMs('rearrange') * 0.6));
                                      if (insideSafeY && insideSafeX && (now - lastSpliceAt.current > interval)) {
                                        moveNoteSplice(draggingIndex, globalIdx);
                                        lastSpliceAt.current = now;
                                        draggingIdxRef.current = globalIdx;
                                      }
                                    }
                                  } catch {}
                                },
                                onDrop: (e: any) => {
                                  if (!canManualReorder) return;
                                  e.preventDefault();
                                  const raw = Number(e.dataTransfer.getData('text/plain'));
                                  const from = Number.isFinite(raw) ? raw : (draggingIdxRef.current ?? -1);
                                  const to = globalIdx;
                                  try {
                                    if (dragBehavior === 'rearrange') moveNoteSplice(from, to);
                                    else moveNote(from, to);
                                  } catch { moveNote(from, to); }
                                  requestAnimationFrame(() => { try { persistOrder(notesRef.current); } catch {} });
                                  draggingIdxRef.current = null;
                                  draggingNoteIdRef.current = null;
                                },
                              };

                          return (
                            <div
                              key={`pinned-${String(g.key)}-${Number(n.id)}-${idx}`}
                              data-note-id={n.id}
                              style={place
                                ? ({ gridColumnStart: place.colStart, gridColumnEnd: `span ${place.colSpan}`, gridRowStart: place.rowStart, gridRowEnd: `span ${place.rowSpan}` } as any)
                                : ({ gridColumn: `span ${span}` } as any)
                              }
                              ref={(el) => { if (el) itemRefs.current.set(n.id, el); else itemRefs.current.delete(n.id); }}
                              {...wrapperProps}
                            >
                              <NoteCard
                                note={n}
                                onChange={handleNoteChange}
                                openRequest={getOpenRequestForNote(Number(n.id))}
                                onOpenRequestHandled={handleOpenRequestHandled}
                              />
                            </div>
                          );
                        })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="notes-section">
            {otherGroups.map((g) => (
              <div key={g.key}>
                {g.title && g.key !== 'all' && (
                  <h5 className="section-title" style={{ marginTop: 10, marginBottom: 6, color: 'var(--muted)' }}>{g.title}</h5>
                )}
                <div className={`notes-grid${manualDragActive ? ' notes-grid--manual' : ''}${gridViewClass}`} ref={othersGridRef}>
                  {(keepRearrangeEnabled && rearrangeSection === 'others' && rearrangeRenderIds.length)
                    ? rearrangeRenderIds.map((key, idx) => {
                        if (key === 'spacer') {
                          return (
                            <div
                              key="spacer"
                              ref={rearrangeSpacerRef as any}
                              className="note-rearrange-spacer"
                              style={{
                                gridColumn: `span ${rearrangeColSpanRef.current}`,
                                gridRowEnd: `span ${rearrangeRowSpanRef.current}`,
                                height: `${rearrangeBaseRectRef.current?.height || 0}px`,
                              } as any}
                            />
                          );
                        }
                        const id = Number(key);
                        const n = noteById.get(id);
                        if (!n) return null;
                        const span = Math.max(1, Math.min(3, Number((n as any).cardSpan || 1)));
                        const place = othersPlacements?.get(Number(n.id)) || null;
                        return (
                          <div
                            key={`rearrange-others-${Number(n.id)}-${idx}`}
                            data-note-id={n.id}
                            style={place
                              ? ({ gridColumnStart: place.colStart, gridColumnEnd: `span ${place.colSpan}`, gridRowStart: place.rowStart, gridRowEnd: `span ${place.rowSpan}` } as any)
                              : ({ gridColumn: `span ${span}` } as any)
                            }
                            ref={(el) => { if (el) itemRefs.current.set(n.id, el); else itemRefs.current.delete(n.id); }}
                          >
                            <NoteCard
                              note={n}
                              onChange={handleNoteChange}
                              openRequest={getOpenRequestForNote(Number(n.id))}
                              onOpenRequestHandled={handleOpenRequestHandled}
                            />
                          </div>
                        );
                      })
                    : g.notes.map((n, idx) => {
                        const globalIdx = idToIndex.get(Number(n.id)) ?? -1;
                        const span = Math.max(1, Math.min(3, Number((n as any).cardSpan || 1)));
                        const place = othersPlacements?.get(Number(n.id)) || null;
                        const sectionIds = g.notes.map((x: any) => Number(x.id)).filter((id: any) => Number.isFinite(id));

                        const wrapperProps: any = keepRearrangeEnabled
                          ? {
                              draggable: false,
                              onPointerDown: (e: any) => onRearrangePointerDown(e, Number(n.id), 'others', sectionIds, span),
                            }
                          : {
                              draggable: canManualReorder && !disableNoteDnD,
                              onDragStart: (e: any) => {
                                if (!canManualReorder) return;
                                draggingNoteIdRef.current = Number(n.id);
                                e.dataTransfer.setData('text/plain', String(globalIdx));
                                draggingIdxRef.current = globalIdx;
                              },
                              onDragEnd: () => {
                                if (!canManualReorder) return;
                                draggingIdxRef.current = null;
                                draggingNoteIdRef.current = null;
                              },
                              onDragOver: (e: any) => {
                                if (!canManualReorder) return;
                                e.preventDefault();
                                try {
                                  const draggingIndex = draggingIdxRef.current;
                                  if (dragBehavior === 'rearrange' && draggingIndex !== null && draggingIndex !== globalIdx) {
                                    const now = Date.now();
                                    const targetEl = e.currentTarget as HTMLElement;
                                    const rect = targetEl.getBoundingClientRect();
                                    const bufferY = Math.min(28, Math.floor(rect.height * 0.2));
                                    const bufferX = Math.min(20, Math.floor(rect.width * 0.2));
                                    const insideSafeY = e.clientY > rect.top + bufferY && e.clientY < rect.bottom - bufferY;
                                    const insideSafeX = e.clientX > rect.left + bufferX && e.clientX < rect.right - bufferX;
                                    const interval = Math.max(150, Math.floor(getAnimMs('rearrange') * 0.6));
                                    if (insideSafeY && insideSafeX && (now - lastSpliceAt.current > interval)) {
                                      moveNoteSplice(draggingIndex, globalIdx);
                                      lastSpliceAt.current = now;
                                      draggingIdxRef.current = globalIdx;
                                    }
                                  }
                                } catch {}
                              },
                              onDrop: (e: any) => {
                                if (!canManualReorder) return;
                                e.preventDefault();
                                const raw = Number(e.dataTransfer.getData('text/plain'));
                                const from = Number.isFinite(raw) ? raw : (draggingIdxRef.current ?? -1);
                                const to = globalIdx;
                                try {
                                  if (dragBehavior === 'rearrange') moveNoteSplice(from, to);
                                  else moveNote(from, to);
                                } catch { moveNote(from, to); }
                                requestAnimationFrame(() => { try { persistOrder(notesRef.current); } catch {} });
                                draggingIdxRef.current = null;
                                draggingNoteIdRef.current = null;
                              },
                            };

                        return (
                          <div
                            key={`others-${String(g.key)}-${Number(n.id)}-${idx}`}
                            data-note-id={n.id}
                            style={place
                              ? ({ gridColumnStart: place.colStart, gridColumnEnd: `span ${place.colSpan}`, gridRowStart: place.rowStart, gridRowEnd: `span ${place.rowSpan}` } as any)
                              : ({ gridColumn: `span ${span}` } as any)
                            }
                            ref={(el) => { if (el) itemRefs.current.set(n.id, el); else itemRefs.current.delete(n.id); }}
                            {...wrapperProps}
                          >
                            <NoteCard
                              note={n}
                              onChange={handleNoteChange}
                              openRequest={getOpenRequestForNote(Number(n.id))}
                              onOpenRequestHandled={handleOpenRequestHandled}
                            />
                          </div>
                        );
                      })}
                </div>
              </div>
            ))}
          </div>
        </>
      )
      )}

      <ConfirmDialog
        open={galleryDeleteTarget != null}
        title="Delete image"
        message={galleryDeleteTarget
          ? `Delete this image from "${galleryDeleteTarget.title}"? This will remove it from the associated note.`
          : 'Delete this image? This will remove it from the associated note.'}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onCancel={() => setGalleryDeleteTarget(null)}
        onConfirm={() => {
          const target = galleryDeleteTarget;
          setGalleryDeleteTarget(null);
          if (target) void deleteImageFromGallery({ noteId: Number(target.noteId), imageId: Number(target.imageId) });
        }}
      />

      {galleryLightboxUrl && <ImageLightbox url={galleryLightboxUrl} onClose={() => setGalleryLightboxUrl(null)} />}

      {keepRearrangeEnabled && activeRearrangeNote && rearrangeBaseRectRef.current ? createPortal(
        <div
          ref={rearrangeOverlayRef}
          className="note-rearrange-overlay"
          style={{
            position: 'fixed',
            left: `${rearrangeBaseRectRef.current.left}px`,
            top: `${rearrangeBaseRectRef.current.top}px`,
            width: `${rearrangeBaseRectRef.current.width}px`,
            height: `${rearrangeBaseRectRef.current.height}px`,
          } as any}
        >
          <div className={`note-rearrange-overlay-inner${isListView ? ' note-rearrange-overlay-inner--list' : ''}`}>
            <NoteCard
              note={activeRearrangeNote}
              onChange={handleNoteChange}
              openRequest={getOpenRequestForNote(Number(activeRearrangeNote.id))}
              onOpenRequestHandled={handleOpenRequestHandled}
            />
          </div>
        </div>,
        document.body
      ) : null}
    </section>
  );
}

