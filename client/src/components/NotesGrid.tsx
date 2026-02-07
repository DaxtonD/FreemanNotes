import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import NoteCard from "./NoteCard";
import { useAuth } from "../authContext";
import TakeNoteBar from "./TakeNoteBar";
import { DEFAULT_SORT_CONFIG, type SortConfig } from '../sortTypes';

type NoteLabelLite = { id: number; name: string };
type NoteImageLite = { id: number; url: string };

const SwapNoteItem = React.memo(function SwapNoteItem({
  note,
  setItemRef,
  isDragSource,
  isDragTarget,
  disabled,
  onChange,
  style,
}: {
  note: any;
  setItemRef: (el: HTMLElement | null, noteId: number) => void;
  isDragSource: boolean;
  isDragTarget: boolean;
  disabled: boolean;
  onChange: (evt?: any) => void;
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
      // Let dnd-kit handle dragging; avoid accidental drags on taps via sensors.
      {...(disabled ? {} : attributes)}
      {...(disabled ? {} : listeners)}
    >
      <NoteCard note={note} onChange={onChange} />
    </div>
  );
});

export default function NotesGrid({ selectedLabelIds = [], searchQuery = '', sortConfig = DEFAULT_SORT_CONFIG }: { selectedLabelIds?: number[], searchQuery?: string, sortConfig?: SortConfig }) {
  const { token } = useAuth();
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const notesRef = useRef<any[]>([]);

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
    const root = document.documentElement;
    if (disableNoteDnD) root.classList.add('is-editor-modal-open');
    else root.classList.remove('is-editor-modal-open');
    return () => { try { root.classList.remove('is-editor-modal-open'); } catch {} };
  }, [disableNoteDnD]);
  const itemRefs = useRef(new Map<number, HTMLElement>());
  const lastSpliceAt = useRef<number>(0);
  const draggingIdxRef = useRef<number | null>(null);
  const draggingNoteIdRef = useRef<number | null>(null);
  const suppressNextRecalcRef = useRef(false);
  const pinnedGridRef = useRef<HTMLDivElement | null>(null);
  const othersGridRef = useRef<HTMLDivElement | null>(null);
  const [pinnedLayout, setPinnedLayout] = useState<number[][] | null>(null);
  const [othersLayout, setOthersLayout] = useState<number[][] | null>(null);
  const pinnedLayoutRef = useRef<number[][] | null>(null);
  const othersLayoutRef = useRef<number[][] | null>(null);

  // Swap drag autoscroll (mobile): keep drag stable while scrolling to far targets.
  const swapDraggingRef = useRef(false);
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
    window.addEventListener('pointermove', onPointerMove, { capture: true });
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

  async function load() {
    setLoading(true);
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

      setNotes(nextNotes);
      // After notes render, ask grid to recalc so width/columns lock immediately
      try { setTimeout(() => window.dispatchEvent(new Event('notes-grid:recalc')), 0); } catch {}
    } catch (err) {
      console.error('Failed to load notes', err);
      setNotes([]);
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
      const nextImages = (Array.isArray(images) ? images : [])
        .filter((img) => img && (typeof (img as any).url === 'string'))
        .map((img: any) => ({ id: Number(img.id || Date.now()), url: String(img.url) }));
      return { ...n, images: nextImages };
    }));
  }

  useEffect(() => { if (token) load(); else setNotes([]); }, [token]);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { pinnedLayoutRef.current = pinnedLayout; }, [pinnedLayout]);
  useEffect(() => { othersLayoutRef.current = othersLayout; }, [othersLayout]);

  const canManualReorder = !!(sortConfig && sortConfig.sortKey === 'default' && sortConfig.groupBy === 'none' && sortConfig.smartFilter === 'none');
  const dragBehavior = (() => {
    try { return (localStorage.getItem('prefs.dragBehavior') || 'swap'); } catch { return 'swap'; }
  })();
  const manualSwapEnabled = canManualReorder && dragBehavior === 'swap';
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
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 12 } })
  );

  function onSwapDragStart(evt: DragStartEvent) {
    if (!manualSwapEnabled) return;
    const id = Number(evt.active.id);
    if (!Number.isFinite(id)) return;
    swapDraggingRef.current = true;
    startSwapPointerTracking((evt as any).activatorEvent);
    startSwapAutoScroll();
    setSwapActiveId(id);
    setSwapTargetId(null);
    swapCandidateIdRef.current = null;
    clearSwapDwellTimer();
    setManualDragActive(true);
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
  }

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
  }, [selectedLabelIds, searchQuery, notes]);

  // Subscribe to lightweight server events to refresh list on share/unshare and update chips
  useEffect(() => {
    // Observe child size changes and trigger span recalculation to prevent overlaps
    const observedChildren = new WeakSet<Element>();
    let childRO: ResizeObserver | null = null;
    if (!token) return;
    let ws: WebSocket | null = null;
    try {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${window.location.host}/events?token=${encodeURIComponent(token)}`;
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data || '{}'));
          if (!msg || !msg.type) return;
          switch (msg.type) {
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
              try {
                // Mirror server-saved prefs into the DOM + localStorage for other sessions.
                if (typeof payload.noteWidth === 'number') {
                  document.documentElement.style.setProperty('--note-card-width', `${Number(payload.noteWidth)}px`);
                  try { localStorage.setItem('prefs.noteWidth', String(Number(payload.noteWidth))); } catch {}
                }
                if (typeof payload.checklistTextSize === 'number') {
                  document.documentElement.style.setProperty('--checklist-text-size', `${Number(payload.checklistTextSize)}px`);
                  try { localStorage.setItem('prefs.checklistTextSize', String(Number(payload.checklistTextSize))); } catch {}
                }
                if (typeof payload.noteLineSpacing === 'number') {
                  document.documentElement.style.setProperty('--note-line-height', String(Number(payload.noteLineSpacing)));
                  try { localStorage.setItem('prefs.noteLineSpacing', String(Number(payload.noteLineSpacing))); } catch {}
                }
                if (typeof payload.fontFamily === 'string' && payload.fontFamily) {
                  document.documentElement.style.setProperty('--app-font-family', String(payload.fontFamily));
                  try { localStorage.setItem('prefs.fontFamily', String(payload.fontFamily)); } catch {}
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
    } catch {}
    return () => { try { ws && ws.close(); } catch {}; };
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
      const docStyle = getComputedStyle(document.documentElement);
      let cardWidth = parseInt(docStyle.getPropertyValue('--note-card-width')) || 300;
      const gap = parseInt(docStyle.getPropertyValue('--gap')) || 16;
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
        const left = Math.floor(g.getBoundingClientRect().left);
        // Prefer the container's right edge (notes-area/main-area) to avoid overflowing off-screen
        const rightEdge = containerRight - containerPaddingRight;
        const availableToRight = Math.max(0, rightEdge - left);
        // Cap by the smaller of global avail and the per-grid right availability
        const gridAvail = Math.max(0, Math.min(avail, availableToRight));
        const gridCols = Math.max(1, Math.floor((gridAvail + gap) / (cardWidth + gap)));
        const gridTotalUncapped = gridCols * cardWidth + Math.max(0, gridCols - 1) * gap;
        const gridTotal = Math.min(gridTotalUncapped, availableToRight);
        const prev = Number(g.dataset.__cols || '0');
        if (prev !== gridCols) {
          g.style.setProperty('--cols', String(gridCols));
          g.dataset.__cols = String(gridCols);
          anyColsChanged = true;
        }
        // Grid uses fixed track width via CSS var; no column-width needed
        g.style.width = `${gridTotal}px`;

        // If this grid is one of the swap-mode masonry containers, mirror the
        // computed column count into React state.
        try {
          if (g === pinnedGridRef.current) {
            if (pinnedDomColsRef.current !== gridCols) {
              pinnedDomColsRef.current = gridCols;
              setPinnedDomCols(gridCols);
            }
          } else if (g === othersGridRef.current) {
            if (othersDomColsRef.current !== gridCols) {
              othersDomColsRef.current = gridCols;
              setOthersDomCols(gridCols);
            }
          }
        } catch {}
      }

      // Animations should run ONLY for user drag-to-reorder actions.
      // Column/resize/layout recalculations must not trigger FLIP animations.
      // expose quick diagnostics
      try {
        (window as any).__notesGridDebug = {
          cardWidth, gap, availMain, availArea, availFallback, avail,
          grids: grids.map(g => {
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
        const row = parseInt(docStyle.getPropertyValue('--row')) || 8;
        const gapPx = parseInt(docStyle.getPropertyValue('--gap')) || 16;
        for (const g of grids) {
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
          const docStyle = getComputedStyle(document.documentElement);
          const row = parseInt(docStyle.getPropertyValue('--row')) || 8;
          const gapPx = parseInt(docStyle.getPropertyValue('--gap')) || 16;
          for (const entry of entries) {
            const target = entry.target as HTMLElement;
            const wrap = cardToWrap.get(target) || target;
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
    const q = (searchQuery || '').trim().toLowerCase();

    const matchesLabels = (n: any): boolean => {
      if (!labelIds.length) return true;
      const labels = (n.noteLabels || []).map((nl: any) => nl.label?.id).filter((id: any) => typeof id === 'number');
      return labelIds.some(id => labels.includes(id));
    };

    const matchesSearch = (n: any): boolean => {
      if (!q) return true;
      if (String(n.title || '').toLowerCase().includes(q)) return true;
      if (String(n.body || '').toLowerCase().includes(q)) return true;
      const items = Array.isArray(n.items) ? n.items : [];
      if (items.some((it: any) => String(it.content || '').toLowerCase().includes(q))) return true;
      const labels = Array.isArray(n.noteLabels) ? n.noteLabels : [];
      if (labels.some((nl: any) => String(nl.label?.name || '').toLowerCase().includes(q))) return true;
      return false;
    };

    const pinnedRaw = notes.filter(n => n.pinned).filter(matchesLabels).filter(matchesSearch);
    const othersRaw = notes.filter(n => !n.pinned).filter(matchesLabels).filter(matchesSearch);
    const pinnedSorted = applySort(pinnedRaw);
    const othersSorted = applySort(othersRaw);
    return {
      pinned: pinnedSorted,
      others: othersSorted,
      pinnedGroups: groupNotes(pinnedSorted),
      otherGroups: groupNotes(othersSorted),
    };
  }, [notes, selectedLabelIds, searchQuery, sortConfig]);

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
    try { localStorage.setItem('notesOrder', JSON.stringify(currentNotes.map(n => n.id))); } catch (e) {}
    // attempt server persistence if authenticated
    if (!token) return;
    try {
      const ids = currentNotes.map(n => n.id);
      const res = await fetch('/api/notes/order', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ ids }) });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      console.error('Failed to persist note order to server', err);
    }
  }

  const handleNoteChange = useCallback((evt?: any) => {
    if (evt && evt.type === 'labels' && typeof evt.noteId === 'number' && Array.isArray(evt.labels)) {
      applyLabelsToNote(evt.noteId, evt.labels);
      return;
    }
    if (evt && evt.type === 'images' && typeof evt.noteId === 'number' && Array.isArray(evt.images)) {
      applyImagesToNote(evt.noteId, evt.images);
      return;
    }
    load();
  }, [token, sortConfig, searchQuery, selectedLabelIds]);

  useEffect(() => {
    if (!loading && token) setHasLoadedOnce(true);
  }, [loading, token]);

  if (loading && !hasLoadedOnce) return <div>Loading notes…</div>;

  const spanForNote = (note: any): number => {
    try {
      const raw = Number((note as any)?.cardSpan || 1);
      return Math.max(1, Math.min(3, Number.isFinite(raw) ? raw : 1));
    } catch { return 1; }
  };

  const activeSwapNote = (manualSwapEnabled && swapActiveId != null) ? (noteById.get(Number(swapActiveId)) || null) : null;

  return (
    <section className="notes-area">
      <TakeNoteBar onCreated={load} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 className="section-title">Notes</h3>
      </div>

      {manualSwapEnabled ? (
        <DndContext
          sensors={swapSensors}
          collisionDetection={pointerWithin}
          onDragStart={onSwapDragStart}
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
                  <div className="notes-grid notes-grid--swap" ref={pinnedGridRef}>
                    {g.notes.map((n) => {
                      const span = spanForNote(n);
                      const setItemRef = (el: HTMLElement | null, noteId: number) => {
                        if (el) itemRefs.current.set(noteId, el);
                        else itemRefs.current.delete(noteId);
                      };
                      return (
                        <SwapNoteItem
                          key={n.id}
                          note={n}
                          setItemRef={setItemRef}
                          style={{ gridColumn: `span ${span}` } as any}
                          isDragSource={swapActiveId != null && Number(swapActiveId) === Number(n.id)}
                          isDragTarget={swapTargetId != null && Number(swapTargetId) === Number(n.id)}
                          disabled={disableNoteDnD}
                          onChange={handleNoteChange}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="notes-section">
            <h4 className="section-title">Others</h4>
            {otherGroups.map((g) => (
              <div key={g.key}>
                {g.title && g.key !== 'all' && <h5 className="section-title" style={{ marginTop: 10, marginBottom: 6, color: 'var(--muted)' }}>{g.title}</h5>}
                <div className="notes-grid notes-grid--swap" ref={othersGridRef}>
                  {g.notes.map((n) => {
                    const span = spanForNote(n);
                    const setItemRef = (el: HTMLElement | null, noteId: number) => {
                      if (el) itemRefs.current.set(noteId, el);
                      else itemRefs.current.delete(noteId);
                    };
                    return (
                      <SwapNoteItem
                        key={n.id}
                        note={n}
                        setItemRef={setItemRef}
                        style={{ gridColumn: `span ${span}` } as any}
                        isDragSource={swapActiveId != null && Number(swapActiveId) === Number(n.id)}
                        isDragTarget={swapTargetId != null && Number(swapTargetId) === Number(n.id)}
                        disabled={disableNoteDnD}
                        onChange={handleNoteChange}
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
                className="note-drag-ghost"
                style={{
                  width: (() => {
                    const s = spanForNote(activeSwapNote);
                    return `calc(${s} * var(--note-card-width) + ${Math.max(0, s - 1)} * var(--gap))`;
                  })(),
                }}
              >
                <NoteCard note={activeSwapNote} onChange={handleNoteChange} />
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
                  <div className={"notes-grid" + (manualDragActive ? " notes-grid--manual" : "")} ref={pinnedGridRef}>
                    {g.notes.map((n) => {
                    const globalIdx = idToIndex.get(Number(n.id)) ?? -1;
                    const span = Math.max(1, Math.min(3, Number((n as any).cardSpan || 1)));
                    const place = pinnedPlacements?.get(Number(n.id)) || null;
                    return (
                      <div key={n.id}
                        data-note-id={n.id}
                        style={place
                          ? ({ gridColumnStart: place.colStart, gridColumnEnd: `span ${place.colSpan}`, gridRowStart: place.rowStart, gridRowEnd: `span ${place.rowSpan}` } as any)
                          : ({ gridColumn: `span ${span}` } as any)
                        }
                        ref={(el) => { if (el) itemRefs.current.set(n.id, el); else itemRefs.current.delete(n.id); }}
                        draggable={canManualReorder && !disableNoteDnD}
                        onDragStart={(e) => {
                          if (!canManualReorder) return;
                          draggingNoteIdRef.current = Number(n.id);
                          e.dataTransfer.setData('text/plain', String(globalIdx));
                          draggingIdxRef.current = globalIdx;
                        }}
                        onDragEnd={() => {
                          if (!canManualReorder) return;
                          draggingIdxRef.current = null;
                          draggingNoteIdRef.current = null;
                        }}
                        onDragOver={(e) => {
                          if (!canManualReorder) return;
                          e.preventDefault();
                          try {
                            const behavior = localStorage.getItem('prefs.dragBehavior') || 'swap';
                            const draggingIndex = draggingIdxRef.current;
                            if (behavior === 'rearrange' && draggingIndex !== null && draggingIndex !== globalIdx) {
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
                        }}
                        onDrop={(e) => {
                          if (!canManualReorder) return;
                          e.preventDefault();
                          const raw = Number(e.dataTransfer.getData('text/plain'));
                          const from = Number.isFinite(raw) ? raw : (draggingIdxRef.current ?? -1);
                          const to = globalIdx;
                          try {
                            const behavior = localStorage.getItem('prefs.dragBehavior') || 'swap';
                            if (behavior === 'rearrange') moveNoteSplice(from, to);
                            else moveNote(from, to);
                          } catch { moveNote(from, to); }
                          requestAnimationFrame(() => { try { persistOrder(notesRef.current); } catch {} });
                          draggingIdxRef.current = null;
                          draggingNoteIdRef.current = null;
                        }}
                      >
                        <NoteCard note={n} onChange={handleNoteChange} />
                      </div>
                    );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="notes-section">
            <h4 className="section-title">Others</h4>
            {otherGroups.map((g) => (
              <div key={g.key}>
                {g.title && g.key !== 'all' && (
                  <h5 className="section-title" style={{ marginTop: 10, marginBottom: 6, color: 'var(--muted)' }}>{g.title}</h5>
                )}
                <div className={"notes-grid" + (manualDragActive ? " notes-grid--manual" : "")} ref={othersGridRef}>
                  {g.notes.map((n) => {
                  const globalIdx = idToIndex.get(Number(n.id)) ?? -1;
                  const span = Math.max(1, Math.min(3, Number((n as any).cardSpan || 1)));
                  const place = othersPlacements?.get(Number(n.id)) || null;
                  return (
                    <div key={n.id}
                      data-note-id={n.id}
                      style={place
                        ? ({ gridColumnStart: place.colStart, gridColumnEnd: `span ${place.colSpan}`, gridRowStart: place.rowStart, gridRowEnd: `span ${place.rowSpan}` } as any)
                        : ({ gridColumn: `span ${span}` } as any)
                      }
                      ref={(el) => { if (el) itemRefs.current.set(n.id, el); else itemRefs.current.delete(n.id); }}
                      draggable={canManualReorder && !disableNoteDnD}
                      onDragStart={(e) => {
                        if (!canManualReorder) return;
                        draggingNoteIdRef.current = Number(n.id);
                        e.dataTransfer.setData('text/plain', String(globalIdx));
                        draggingIdxRef.current = globalIdx;
                      }}
                      onDragEnd={() => {
                        if (!canManualReorder) return;
                        draggingIdxRef.current = null;
                        draggingNoteIdRef.current = null;
                      }}
                      onDragOver={(e) => {
                        if (!canManualReorder) return;
                        e.preventDefault();
                        try {
                          const behavior = localStorage.getItem('prefs.dragBehavior') || 'swap';
                          const draggingIndex = draggingIdxRef.current;
                          if (behavior === 'rearrange' && draggingIndex !== null && draggingIndex !== globalIdx) {
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
                      }}
                      onDrop={(e) => {
                        if (!canManualReorder) return;
                        e.preventDefault();
                        const raw = Number(e.dataTransfer.getData('text/plain'));
                        const from = Number.isFinite(raw) ? raw : (draggingIdxRef.current ?? -1);
                        const to = globalIdx;
                        try {
                          const behavior = localStorage.getItem('prefs.dragBehavior') || 'swap';
                          if (behavior === 'rearrange') moveNoteSplice(from, to);
                          else moveNote(from, to);
                        } catch { moveNote(from, to); }
                        requestAnimationFrame(() => { try { persistOrder(notesRef.current); } catch {} });
                        draggingIdxRef.current = null;
                        draggingNoteIdRef.current = null;
                      }}
                    >
                      <NoteCard note={n} onChange={handleNoteChange} />
                    </div>
                  );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

