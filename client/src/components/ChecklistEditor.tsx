import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../authContext';
import ChecklistItemRT from './ChecklistItemRT';
import ColorPalette from './ColorPalette';
import ReminderPicker from './ReminderPicker';
import CollaboratorModal from './CollaboratorModal';
import ImageDialog from './ImageDialog';
import ImageLightbox from './ImageLightbox';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPalette } from '@fortawesome/free-solid-svg-icons';
import DOMPurify from 'dompurify';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

export default function ChecklistEditor({ note, onClose, onSaved, noteBg, onImagesUpdated }:
  { note: any; onClose: () => void; onSaved?: (payload: { items: Array<{ id: number; content: string; checked: boolean; ord: number; indent: number }>; title: string }) => void; noteBg?: string; onImagesUpdated?: (images: Array<{ id:number; url:string }>) => void }) {
  const { token, user } = useAuth();
  // Track the currently-focused per-item rich-text editor to drive toolbar actions/state
  const activeChecklistEditor = useRef<any>(null);
  const [, setToolbarTick] = useState<number>(0);
  // Prevent immediate pointer interactions for a short time after mount
  const pointerSafeRef = useRef(false);
  React.useEffect(() => {
    pointerSafeRef.current = false;
    const id = window.setTimeout(() => { pointerSafeRef.current = true; }, 160);
    return () => window.clearTimeout(id);
  }, []);
  const [items, setItems] = useState<Array<any>>(() => (note.items || []).map((it: any) => ({ indent: 0, ...it })));
  const [saving, setSaving] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(true);
  const [dragging, setDragging] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const itemRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const [autoFocusIndex, setAutoFocusIndex] = useState<number | null>(null);
  const [title, setTitle] = useState<string>(note.title || '');
  // prefer explicit `noteBg` passed from the parent (NoteCard); fallback to viewer-specific color
  const [bg, setBg] = useState<string>(noteBg ?? ((note as any).viewerColor || note.color || ''));
  const [showPalette, setShowPalette] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [showCollaborator, setShowCollaborator] = useState(false);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [images, setImages] = useState<Array<{ id:number; url:string }>>(((note as any).images || []).map((i:any)=>({ id:Number(i.id), url:String(i.url) })));
  React.useEffect(() => { try { const next = (((note as any).images || []).map((i:any)=>({ id:Number(i.id), url:String(i.url) }))); setImages(next); onImagesUpdated && onImagesUpdated(next); } catch {} }, [ (note as any).images ]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<{ id:number; email:string }[]>([]);

  // Yjs collaboration state for checklist items
  const ydoc = React.useMemo(() => new Y.Doc(), [note.id]);
  const providerRef = React.useRef<WebsocketProvider | null>(null);
  const yarrayRef = React.useRef<Y.Array<Y.Map<any>> | null>(null);
  const ymetaRef = React.useRef<Y.Map<any> | null>(null);
  const debouncedSyncTimer = React.useRef<number | null>(null);
  const syncedRef = React.useRef<boolean>(false);

  const rafRef = useRef<number | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const docDragOverRef = useRef<((e: DragEvent) => void) | undefined>(undefined);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const clearHoverTimeoutRef = useRef<number | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragDirectionRef = useRef<'vertical' | 'horizontal' | null>(null);
  const sourceLeftRef = useRef<number>(0);
  const nestedPendingRef = useRef<{ parentId: number | null; makeNested: boolean }>({ parentId: null, makeNested: false });
  const pointerTrackRef = useRef<{ active: boolean; startX: number; startY: number; idx: number | null; draggedId?: number | null; pointerId?: number } | null>(null);
  const [previewItems, setPreviewItems] = useState<Array<any> | null>(null);
  // Hardwired drag/hover thresholds
  const DRAG = {
    hoverDownPct: 0.7,
    hoverUpPct: 0.7,
    indentPx: 16,
    ghostOverlapPct: 0.7,
    ghostOverlapUpPct: 0.7,
    ghostOverlapDownPct: 0.7,
    hoverClearMs: 80,
    directionLockPx: 6,
  } as const;
  const lastPointerYRef = useRef<number>(0);
  const lastDragYRef = useRef<number>(0);
  const genUid = React.useCallback(() => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`, []);
  const getKey = React.useCallback((it: any) => (typeof it.id === 'number' ? it.id : (it.uid || `tmp-${Math.random().toString(36).slice(2,6)}`)), []);

  // Setup Yjs provider and bind checklist CRDT
  useEffect(() => {
    const room = `note-${note.id}`;
    const serverUrl = `ws://${window.location.host}/collab`;
    const provider = new WebsocketProvider(serverUrl, room, ydoc);
    providerRef.current = provider;
    const yarr = ydoc.getArray<Y.Map<any>>('checklist');
    yarrayRef.current = yarr;
    const ymeta = ydoc.getMap<any>('meta');
    ymetaRef.current = ymeta;

    const seededRef = { current: false } as { current: boolean };
    const onSync = (isSynced: boolean) => {
      if (!isSynced) return;
      syncedRef.current = true;
      // Seed Yjs array from existing items if empty on first sync
      try {
        const yarr2 = yarrayRef.current;
        if (yarr2 && yarr2.length === 0 && !seededRef.current) {
          const initial = (note.items || []).map((it: any) => {
            const m = new Y.Map<any>();
            if (typeof it.id === 'number') m.set('id', it.id);
            m.set('uid', (it.uid || `u${Math.random().toString(36).slice(2,8)}`));
            m.set('content', String(it.content || ''));
            m.set('checked', !!it.checked);
            m.set('indent', Number(it.indent || 0));
            return m;
          });
          if (initial.length) yarr2.insert(0, initial as any);
          seededRef.current = true;
        }
      } catch {}
    };
    provider.on('sync', onSync);

    const updateFromY = () => {
      try {
        const arr = yarr.toArray().map((m, idx) => ({
          id: (typeof m.get('id') === 'number' ? Number(m.get('id')) : undefined),
          uid: (m.get('uid') ? String(m.get('uid')) : undefined),
          content: String(m.get('content') || ''),
          checked: !!m.get('checked'),
          indent: Number(m.get('indent') || 0),
          // Prefer uid for React key stability; fallback to id, then index
          key: (m.get('uid') ? String(m.get('uid')) : (typeof m.get('id') === 'number' ? Number(m.get('id')) : `i${idx}`)),
        }));
        const isFocused = !!(activeChecklistEditor.current && activeChecklistEditor.current.isFocused);
        const structuralChanged = (() => {
          try {
            if (arr.length !== items.length) return true;
            for (let i = 0; i < arr.length; i++) {
              const a = arr[i];
              const b = items[i];
              if (!b) return true;
              const aKey = (typeof a.uid === 'string' && a.uid) ? `u:${a.uid}` : (typeof a.id === 'number' ? `i:${a.id}` : `p:${i}`);
              const bKey = (typeof (b as any).uid === 'string' && (b as any).uid) ? `u:${(b as any).uid}` : (typeof b.id === 'number' ? `i:${b.id}` : `p:${i}`);
              if (aKey !== bKey) return true;
            }
            return false;
          } catch { return true; }
        })();
        // Always apply structural changes (insert/delete) even if focused; defer content-only updates while editing
        if (structuralChanged || !isFocused) setItems(arr);
        if (syncedRef.current) {
          if (debouncedSyncTimer.current) window.clearTimeout(debouncedSyncTimer.current);
          debouncedSyncTimer.current = window.setTimeout(async () => {
            try {
              const ordered = arr.map((it, i) => {
                const payload: any = { content: it.content, checked: !!it.checked, ord: i, indent: it.indent || 0 };
                if (typeof it.id === 'number') payload.id = it.id;
                return payload;
              });
              const res = await fetch(`/api/notes/${note.id}/items`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ items: ordered })
              });
              if (res.ok) {
                const data = await res.json();
                const serverItems: Array<any> = Array.isArray(data.items) ? data.items : [];
                const yarr2 = yarrayRef.current;
                if (yarr2 && serverItems.length === yarr2.length) {
                  for (let i = 0; i < yarr2.length; i++) {
                    const m = yarr2.get(i) as Y.Map<any>;
                    const idVal = m.get('id');
                    const srvId = serverItems[i]?.id;
                    if (typeof srvId === 'number' && typeof idVal !== 'number') {
                      try { m.set('id', srvId); } catch {}
                    }
                  }
                }
              }
            } catch {}
          }, 800);
        }
      } catch {}
    };
    yarr.observeDeep(updateFromY);

    return () => {
      try { yarr.unobserveDeep(updateFromY as any); } catch {}
      try { provider.off('sync', onSync as any); } catch {}
      try { provider.destroy(); } catch {}
    };
  }, [note.id, token, ydoc]);

  useEffect(() => {
    try {
      setImages((((note as any).images || []).map((i:any)=>({ id:Number(i.id), url:String(i.url) }))));
    } catch {}
  }, [ (note as any).images ]);

  function getBlockRange(list: any[], idx: number) {
    const start = idx;
    const baseIndent = list[idx]?.indent || 0;
    let end = idx + 1;
    while (end < list.length && (list[end].indent || 0) > baseIndent) end++;
    return [start, end]; // end is exclusive
  }

  function moveBlock(srcStart: number, srcEnd: number, dstIndex: number) {
    setItems(s => {
      const copy = [...s];
      const block = copy.slice(srcStart, srcEnd);
      copy.splice(srcStart, srcEnd - srcStart);
      let insertAt = dstIndex;
      if (insertAt > srcStart) insertAt = insertAt - (srcEnd - srcStart);
      if (insertAt < 0) insertAt = 0;
      if (insertAt > copy.length) insertAt = copy.length;
      copy.splice(insertAt, 0, ...block);
      return copy;
    });
  }

  useEffect(() => { itemRefs.current = itemRefs.current.slice(0, items.length); }, [items.length]);
  // Autosize textareas whenever items or preview changes
  useEffect(() => {
    requestAnimationFrame(() => {
      itemRefs.current.forEach(el => {
        try {
          el.style.height = 'auto';
          el.style.height = Math.max(22, el.scrollHeight) + 'px';
        } catch {}
      });
    });
  }, [items, previewItems]);

  function shiftClassForIndex(realIdx: number, list: any[]) {
    if (dragDirectionRef.current !== 'vertical') return '';
    if (dragging === null) return '';
    const [sStart, sEnd] = getBlockRange(list, dragging);
    if (hoverIndex === null) return '';
    // Do not apply shift to items inside the dragged block
    if (realIdx >= sStart && realIdx < sEnd) return '';
    // Dragging down: neighbors between the block end and hover index shift up
    if (dragging < hoverIndex) {
      if (realIdx > (sEnd - 1) && realIdx <= hoverIndex) return 'shift-up';
      return '';
    }
    // Dragging up: neighbors between hover index and block start shift down
    if (dragging > hoverIndex) {
      if (realIdx >= hoverIndex && realIdx < sStart) return 'shift-down';
      return '';
    }
    return '';
  }

  // Map between real list indices and DOM indices when the list is visually split
  // into two groups (unchecked first, then checked). This avoids mismatches when
  // computing hover/drag positions for pointer-driven vertical drag.
  function getDisplayOrderIndices(list: any[]): number[] {
    const order: number[] = [];
    for (let i = 0; i < list.length; i++) { if (!list[i]?.checked) order.push(i); }
    for (let i = 0; i < list.length; i++) { if (list[i]?.checked) order.push(i); }
    return order;
  }
  function realToDomIndex(realIdx: number, list: any[]): number {
    const order = getDisplayOrderIndices(list);
    return order.indexOf(realIdx);
  }
  function domToRealIndex(domIdx: number, list: any[]): number {
    const order = getDisplayOrderIndices(list);
    return (domIdx >= 0 && domIdx < order.length) ? order[domIdx] : -1;
  }

  // Unchecked-only mapping helpers (exclude checked items from vertical drag)
  function getUncheckedOrderIndices(list: any[]): number[] {
    const order: number[] = [];
    for (let i = 0; i < list.length; i++) { if (!list[i]?.checked) order.push(i); }
    return order;
  }
  function realToDomIndexUnchecked(realIdx: number, list: any[]): number {
    const order = getUncheckedOrderIndices(list);
    return order.indexOf(realIdx);
  }
  function domToRealIndexUnchecked(domIdx: number, list: any[]): number {
    const order = getUncheckedOrderIndices(list);
    return (domIdx >= 0 && domIdx < order.length) ? order[domIdx] : -1;
  }

  function updateItem(idx: number, content: string) {
    const yarr = yarrayRef.current;
    if (yarr) {
      const m = yarr.get(idx) as Y.Map<any> | undefined; if (!m) return;
      m.set('content', content); if (typeof m.get('id') === 'number') m.set('id', m.get('id'));
    } else {
      setItems(s => s.map((it, i) => i === idx ? { ...it, content } : it));
    }
    // Autosize the edited textarea on next frame
    requestAnimationFrame(() => {
      const el = itemRefs.current[idx];
      if (el) {
        try { el.style.height = 'auto'; el.style.height = Math.max(22, el.scrollHeight) + 'px'; } catch {}
      }
    });
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>, realIdx: number) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addItemAt(realIdx + 1); if (typeof items[realIdx].id === 'number') items[realIdx].id = items[realIdx].id;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = realIdx - 1;
      if (prev >= 0) {
        const el = itemRefs.current[prev];
        if (el) el.focus();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = realIdx + 1;
      const el = itemRefs.current[next];
      if (el) el.focus();
    }
    else if (e.key === 'Backspace') {
      // If the current item is blank and Backspace is pressed, delete it and focus the previous item
      const cur = items[realIdx];
      if (cur && ((cur.content || '').length === 0)) {
        e.preventDefault();
        if (realIdx > 0) {
          deleteItemAt(realIdx);
          requestAnimationFrame(() => {
            const prev = itemRefs.current[realIdx - 1];
            if (prev) {
              prev.focus();
              try { const len = (items[realIdx - 1]?.content || '').length; prev.setSelectionRange(len, len); } catch {}
            }
          });
        }
      }
    }
  }

  function addItemAt(idx?: number) {
    const yarr = yarrayRef.current;
    if (yarr) {
      const pos = typeof idx === 'number' ? Math.max(0, Math.min(idx, yarr.length)) : yarr.length;
      const m = new Y.Map<any>(); m.set('content', ''); m.set('checked', false); m.set('indent', 0);
      m.set('uid', genUid());
      yarr.insert(pos, [m]);
      setAutoFocusIndex(pos);
    } else {
      // Fallback when collaboration doc isn't ready yet: update local state
      setItems(s => {
        const pos = typeof idx === 'number' ? Math.max(0, Math.min(idx, s.length)) : s.length;
        const uid = genUid();
        const next = [...s];
        next.splice(pos, 0, { uid, content: '', checked: false, indent: 0 });
        return next;
      });
      setAutoFocusIndex(typeof idx === 'number' ? idx : (items.length + 1));
    }
  }

  function toggleChecked(idx: number) {
    const yarr = yarrayRef.current;
    if (yarr) {
      const m = yarr.get(idx) as Y.Map<any> | undefined; if (!m) return;
      const newChecked = !m.get('checked'); if (typeof m.get('id') === 'number') m.set('id', m.get('id'));
      m.set('checked', newChecked);
      const indent = Number(m.get('indent') || 0);
      if (indent === 0) {
        for (let i = idx + 1; i < yarr.length; i++) {
          const child = yarr.get(i) as Y.Map<any>;
          const childIndent = Number(child.get('indent') || 0);
          if (childIndent > 0) child.set('checked', newChecked); else break;
        }
      }
    } else {
      // Local fallback if collaboration doc is not ready
      setItems(s => s.map((it, i) => {
        if (i === idx) {
          const newChecked = !it.checked;
          const baseIndent = Number(it.indent || 0);
          const next = { ...it, checked: newChecked };
          if (baseIndent === 0) {
            // cascade to children until indent decreases back to 0
            const out = [...s];
            out[i] = next;
            for (let j = i + 1; j < out.length; j++) {
              const childIndent = Number(out[j].indent || 0);
              if (childIndent > 0) out[j] = { ...out[j], checked: newChecked }; else break;
            }
            return out[i];
          }
          return next;
        }
        return it;
      }));
    }
  }

  function moveItem(src: number, dst: number) {
    const yarr = yarrayRef.current; if (!yarr) return;
    if (src === dst || src < 0 || dst < 0 || src >= yarr.length || dst > yarr.length) return;
    const elem = yarr.get(src) as Y.Map<any>;
    yarr.delete(src, 1);
    yarr.insert(dst, [elem]);
  }

  function moveBlockY(srcStart: number, srcEnd: number, dstIndex: number) {
    const yarr = yarrayRef.current; if (!yarr) return;
    // Clamp ranges to current Y.Array length to avoid out-of-bounds when preview/state diverge
    const start = Math.max(0, Math.min(srcStart, yarr.length));
    const end = Math.max(start, Math.min(srcEnd, yarr.length));
    const len = end - start; if (len <= 0) return;
    let insertAt = Math.max(0, Math.min(dstIndex, yarr.length));
    if (insertAt > start) insertAt = insertAt - len;
    if (insertAt < 0) insertAt = 0;
    if (insertAt > yarr.length) insertAt = yarr.length;
    // snapshot plain values to avoid reinserting integrated Y.Map instances
    const vals: Array<{ id?: number; uid?: string; content: string; checked: boolean; indent: number }> = [];
    for (let i = 0; i < len; i++) {
      const m = yarr.get(start + i) as Y.Map<any>;
      vals.push({
        id: (typeof m.get('id') === 'number' ? Number(m.get('id')) : undefined),
        uid: (m.get('uid') ? String(m.get('uid')) : undefined),
        content: String(m.get('content') || ''),
        checked: !!m.get('checked'),
        indent: Number(m.get('indent') || 0),
      });
    }
    yarr.delete(start, len);
    const clones = vals.map(v => { const m = new Y.Map<any>(); if (typeof v.id === 'number') m.set('id', v.id); if (v.uid) m.set('uid', v.uid); m.set('content', v.content); m.set('checked', v.checked); m.set('indent', v.indent); return m; });
    yarr.insert(insertAt, clones as any);
  }

  function startDrag(e: React.DragEvent<HTMLElement>, realIdx: number) {
    if (!pointerSafeRef.current) return;
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const offsetX = (e.clientX || 0) - rect.left;
    const offsetY = (e.clientY || 0) - rect.top;
    dragOffsetRef.current = { x: offsetX, y: offsetY };
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    dragDirectionRef.current = null;
    sourceLeftRef.current = rect.left;

    const ghost = target.cloneNode(true) as HTMLElement;
    ghost.style.position = 'fixed';
    ghost.style.left = (e.clientX - offsetX) + 'px';
    ghost.style.top = (e.clientY - offsetY) + 'px';
    ghost.style.width = rect.width + 'px';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '9999';
    ghost.style.opacity = '0.95';
    ghost.classList.add('checklist-ghost');
    document.body.appendChild(ghost);
    ghostRef.current = ghost as HTMLDivElement;
    try { if (e.dataTransfer) e.dataTransfer.setDragImage(ghost, Math.round(offsetX), Math.round(offsetY)); } catch (err) { }
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(realIdx)); }
    setDragging(realIdx); setHoverIndex(realIdx);
    setTimeout(() => { try { target.classList.add('drag-source'); } catch (err) { } }, 0);

    const onDrag = (ev: DragEvent) => {
      ev.preventDefault();
      if (!ghostRef.current) return;
      const off = dragOffsetRef.current;
      const gxRaw = (ev.clientX || 0) - off.x;
      const gyRaw = (ev.clientY || 0) - off.y;
      if (dragDirectionRef.current === null && dragStartRef.current) {
        const dx = Math.abs((ev.clientX || 0) - dragStartRef.current.x);
        const dy = Math.abs((ev.clientY || 0) - dragStartRef.current.y);
        const THRESH = DRAG.directionLockPx;
        if (dx > THRESH || dy > THRESH) dragDirectionRef.current = dx > dy ? 'horizontal' : 'vertical';
      }
      if (dragDirectionRef.current === 'vertical') {
        ghostRef.current.style.left = sourceLeftRef.current + 'px';
        ghostRef.current.style.top = gyRaw + 'px';
      } else if (dragDirectionRef.current === 'horizontal') {
        ghostRef.current.style.left = gxRaw + 'px';
        ghostRef.current.style.top = (dragStartRef.current ? dragStartRef.current.y - off.y : gyRaw) + 'px';
      } else {
        ghostRef.current.style.left = gxRaw + 'px';
        ghostRef.current.style.top = gyRaw + 'px';
      }
    };
    docDragOverRef.current = onDrag;
    document.addEventListener('dragover', onDrag);
  }

  function endDragCleanup() {
    if (ghostRef.current) { ghostRef.current.remove(); ghostRef.current = null; }
    if (docDragOverRef.current) { document.removeEventListener('dragover', docDragOverRef.current); docDragOverRef.current = undefined; }
    document.querySelectorAll('.checklist-item.drag-source').forEach(el => el.classList.remove('drag-source'));
    setDragging(null); setHoverIndex(null);
    setPreviewItems(null);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (clearHoverTimeoutRef.current) { clearTimeout(clearHoverTimeoutRef.current); clearHoverTimeoutRef.current = null; }
    dragStartRef.current = null; dragDirectionRef.current = null; nestedPendingRef.current = { parentId: null, makeNested: false };
    // reset any dynamic shift applied during vertical drag
    try {
      const dialog = document.querySelector('.image-dialog') as HTMLElement | null;
      if (dialog) dialog.style.removeProperty('--checklist-item-shift');
    } catch (err) { }
  }

  async function save() {
    setSaving(true);
    try {
      if ((note.title || '') !== title) {
        const r1 = await fetch(`/api/notes/${note.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ title }) });
        if (!r1.ok) throw new Error(await r1.text());
      }
      // derive payload from Yjs state
      const yarr = yarrayRef.current;
      const arr = yarr ? yarr.toArray().map((m) => ({ id: (typeof m.get('id') === 'number' ? Number(m.get('id')) : undefined), content: String(m.get('content') || ''), checked: !!m.get('checked'), indent: Number(m.get('indent') || 0) })) : items;
      const payloadItems = arr.map((it, i) => { const payload: any = { content: it.content, checked: !!it.checked, ord: i, indent: it.indent || 0 }; if (typeof it.id === 'number') payload.id = it.id; return payload; });
      const res = await fetch(`/api/notes/${note.id}/items`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ items: payloadItems }) });
      if (!res.ok) throw new Error(await res.text());
      onSaved && onSaved({ items: payloadItems, title });
      onClose();
    } catch (err) { console.error('Failed to save checklist', err); window.alert('Failed to save checklist'); } finally { setSaving(false); }
  }
  // compute inline styles for the dialog to reflect note color (so editor shows same background)
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

  const dialogStyle: React.CSSProperties = {} as any;
  const text = bg ? (contrastColor(bg) || 'var(--muted)') : undefined;
  // Expose checkbox CSS variables on the dialog only when the note provides a color.
  // If no note color is present, leave the app-level vars intact so user prefs apply.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (bg) dialogStyle['--checkbox-bg'] = bg;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (text) dialogStyle['--checkbox-border'] = text;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (bg) dialogStyle['--checkbox-checked-bg'] = bg;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (text) dialogStyle['--checkbox-checked-mark'] = text;
  if (bg) {
    dialogStyle.background = bg;
    if (text) dialogStyle.color = text;
  }

  async function onPickColor(color: string) {
    const next = color || '';
    try {
      const res = await fetch(`/api/notes/${note.id}/prefs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ color: next })
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      console.error('Failed to save color preference', err);
      window.alert('Failed to save color preference');
    }
    setBg(next);
  }

  function onAddImageUrl(url?: string | null) {
    setShowImageDialog(false);
    if (!url) return;
    (async () => {
      try {
        const res = await fetch(`/api/notes/${note.id}/images`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ url }) });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const img = data.image || null;
        if (img && img.id && img.url) setImages(s => { const exists = s.some(x => Number(x.id) === Number(img.id)); const next = exists ? s : [...s, { id: Number(img.id), url: String(img.url) }]; onImagesUpdated && onImagesUpdated(next); return next; });
      } catch (err) {
        console.error('Failed to attach image', err);
        window.alert('Failed to attach image');
        setImages(s => { const exists = s.some(x => String(x.url) === String(url)); const next = exists ? s : [...s, { id: Date.now(), url }]; onImagesUpdated && onImagesUpdated(next); return next; });
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
    try {
      const res = await fetch(`/api/notes/${note.id}/images/${imageId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(await res.text());
      setImages(s => { const next = s.filter(i => i.id !== imageId); onImagesUpdated && onImagesUpdated(next); return next; });
    } catch (err) {
      console.error('Failed to delete image', err);
      window.alert('Failed to delete image');
    }
  }
  function deleteItemAt(idx: number) {
    const yarr = yarrayRef.current;
    if (yarr) {
      if (idx >= 0 && idx < yarr.length) yarr.delete(idx, 1);
    } else {
      setItems(s => s.filter((_, i) => i !== idx));
    }
  }

  const dialog = (
    <div className="image-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { save(); } }}>
      <div className="image-dialog" role="dialog" aria-modal style={{ width: 'min(1000px, 86vw)', ...dialogStyle }}>
        <div className="dialog-header">
          <strong>Edit checklist</strong>
          <button className="icon-close" onClick={onClose}>✕</button>
        </div>
        <div className="dialog-body">
          <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
            <input placeholder="Checklist title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, background: 'transparent', border: 'none', color: 'inherit', fontWeight: 600, fontSize: 18 }} />
          </div>
          {images && images.length > 0 && (
            <div className="note-images" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 8 }}>
              {images.map(img => (
                <div
                  key={img.id}
                  className="note-image"
                  role="button"
                  tabIndex={0}
                  style={{ cursor: 'zoom-in', position: 'relative' }}
                  onClick={() => setLightboxUrl(img.url)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightboxUrl(img.url); } }}
                >
                  <img src={img.url} alt="note image" style={{ width: '100%', height: 'auto', borderRadius: 6, display: 'block' }} />
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
          <div className="rt-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <button className="tiny" onClick={() => activeChecklistEditor.current?.chain().focus().toggleBold().run()} aria-pressed={activeChecklistEditor.current?.isActive?.('bold')}>B</button>
            <button className="tiny" onClick={() => activeChecklistEditor.current?.chain().focus().toggleItalic().run()} aria-pressed={activeChecklistEditor.current?.isActive?.('italic')}>I</button>
            <button className="tiny" onClick={() => activeChecklistEditor.current?.chain().focus().toggleUnderline().run()} aria-pressed={activeChecklistEditor.current?.isActive?.('underline')}>U</button>
          </div>

          {((previewItems ?? items).length === 0) && (
            <div style={{ marginBottom: 8 }}>
              <button className="btn" onClick={() => addItemAt(0)}>Add an item</button>
            </div>
          )}


                  {(previewItems ?? items).filter(it => !it.checked).map((it, idx) => {
                    const currentList = previewItems ?? items;
                    const realIdx = currentList.indexOf(it);
                    const shiftClass = shiftClassForIndex(realIdx, currentList);
                    return (
                      <div key={it.key ?? realIdx} className={`checklist-item ${shiftClass}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginLeft: (it.indent || 0) * 18 }} draggable={false}
                        onPointerCancel={() => { pointerTrackRef.current = null; }}
                        
                        onDragOver={(e) => {
                          e.preventDefault(); const target = e.currentTarget as HTMLElement; const rect = target.getBoundingClientRect();
                          if (rafRef.current) cancelAnimationFrame(rafRef.current);
                          rafRef.current = requestAnimationFrame(() => {
                            if (dragging === null) return;
                            if (dragDirectionRef.current === 'horizontal' && dragStartRef.current) {
                              const dx = ((e as unknown as React.DragEvent<HTMLElement>).clientX || 0) - dragStartRef.current.x;
                              if (dx > DRAG.indentPx && realIdx > 0) {
                                let pId: number | null = null;
                                for (let j = realIdx - 1; j >= 0; j--) {
                                  if ((items[j].indent || 0) === 0) { pId = items[j].id ?? null; break; }
                                }
                                nestedPendingRef.current = { parentId: pId, makeNested: true };
                              }
                              else if (dx < -DRAG.indentPx) nestedPendingRef.current = { parentId: null, makeNested: false };
                              else nestedPendingRef.current = { parentId: null, makeNested: false };
                              return;
                            }
                            // Use ghost overlap with directional thresholds
                            let shouldHover = false;
                            const ghost = ghostRef.current ? ghostRef.current.getBoundingClientRect() : null;
                            if (ghost) {
                              const overlap = Math.max(0, Math.min(ghost.bottom, rect.bottom) - Math.max(ghost.top, rect.top));
                              const frac = overlap / (rect.height || 1);
                              const movingDown = ((e as unknown as React.DragEvent<HTMLElement>).clientY || 0) > (lastDragYRef.current || ((e as unknown as React.DragEvent<HTMLElement>).clientY || 0));
                              lastDragYRef.current = (e as unknown as React.DragEvent<HTMLElement>).clientY || 0;
                              const thresh = movingDown ? DRAG.ghostOverlapDownPct : DRAG.ghostOverlapUpPct;
                              shouldHover = frac >= thresh;
                            }
                            if (shouldHover) { if (clearHoverTimeoutRef.current) { clearTimeout(clearHoverTimeoutRef.current); clearHoverTimeoutRef.current = null; } setHoverIndex(prev => (prev === realIdx ? prev : realIdx)); }
                            else { if (hoverIndex === realIdx && clearHoverTimeoutRef.current === null) { clearHoverTimeoutRef.current = window.setTimeout(() => { setHoverIndex(prev => (prev === realIdx ? null : prev)); clearHoverTimeoutRef.current = null; }, Math.max(0, DRAG.hoverClearMs)); } }
                          });
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const src = dragging !== null ? dragging : parseInt(e.dataTransfer.getData('text/plain') || '-1', 10);
                          const dst = realIdx;
                          if (src >= 0) {
                            const dx = dragStartRef.current ? ((e.clientX || 0) - dragStartRef.current.x) : 0;
                            const treatHorizontal = dragDirectionRef.current === 'horizontal' || Math.abs(dx) > DRAG.indentPx;
                            if (treatHorizontal) {
                              const yarr = yarrayRef.current;
                              if (yarr) {
                                if (dx > DRAG.indentPx) {
                                  const [bStart, bEnd] = getBlockRange(items, src);
                                  let parentIdx: number | null = null;
                                  for (let j = src - 1; j >= 0; j--) {
                                    if ((items[j].indent || 0) === 0) { parentIdx = j; break; }
                                  }
                                  if (bStart >= 0) {
                                    if (parentIdx != null) {
                                      if (bStart === dst) {
                                        for (let i = bStart; i < bEnd; i++) {
                                          const m = yarr.get(i) as Y.Map<any>; m.set('indent', 1);
                                        }
                                      } else {
                                        // snapshot values and reinsert as fresh maps to avoid reusing integrated types
                                        const vals: Array<{ id?: number; uid?: string; content: string; checked: boolean; indent: number }> = [];
                                        for (let i = bStart; i < bEnd; i++) {
                                          const mm = yarr.get(i) as Y.Map<any>;
                                          vals.push({ id: (typeof mm.get('id') === 'number' ? Number(mm.get('id')) : undefined), uid: (mm.get('uid') ? String(mm.get('uid')) : undefined), content: String(mm.get('content') || ''), checked: !!mm.get('checked'), indent: Number(mm.get('indent') || 0) });
                                        }
                                        yarr.delete(bStart, bEnd - bStart);
                                        let insertAt = parentIdx + 1;
                                        // adjust insertAt if parent was before removed range
                                        if (parentIdx > bStart) insertAt = parentIdx - (bEnd - bStart) + 1;
                                        while (insertAt < yarr.length) {
                                          const ind = Number((yarr.get(insertAt) as Y.Map<any>).get('indent') || 0);
                                          if (ind > 0) insertAt++; else break;
                                        }
                                        const clones = vals.map(v => { const nm = new Y.Map<any>(); if (typeof v.id === 'number') nm.set('id', v.id); if (v.uid) nm.set('uid', v.uid); nm.set('content', v.content); nm.set('checked', v.checked); nm.set('indent', 1); return nm; });
                                        yarr.insert(insertAt, clones as any);
                                      }
                                    } else {
                                      for (let i = bStart; i < bEnd; i++) {
                                        const m = yarr.get(i) as Y.Map<any>; m.set('indent', 1);
                                      }
                                    }
                                  }
                                } else if (dx < -DRAG.indentPx) {
                                  const [bStart, bEnd] = getBlockRange(items, src);
                                  if (bStart >= 0) {
                                    for (let i = bStart; i < bEnd && i < yarr.length; i++) {
                                      const m = yarr.get(i) as Y.Map<any>;
                                      const cur = Number(m.get('indent') || 0);
                                      m.set('indent', Math.max(0, cur - 1));
                                    }
                                  }
                                }
                              }
                            } else {
                              if (src !== dst) {
                                const [bStart, bEnd] = getBlockRange(items, src);
                                moveBlockY(bStart, bEnd, dst);
                              }
                            }
                          }
                          endDragCleanup();
                        }}
                        onDragLeave={() => { if (hoverIndex === realIdx) setHoverIndex(null); if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } }}
                      >
                        <div className="drag-handle" style={{ width: 32, cursor: 'grab', userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none', msUserSelect: 'none' }} onMouseDown={(e) => { e.preventDefault(); }}
                          onPointerDown={(e) => {
                            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                            const currentList = previewItems ?? items;
                            const draggedId = (typeof currentList[realIdx]?.id === 'number' ? currentList[realIdx].id : (currentList[realIdx]?.uid ?? null));
                            pointerTrackRef.current = { active: true, startX: e.clientX, startY: e.clientY, idx: realIdx, draggedId, pointerId: e.pointerId };
                            dragDirectionRef.current = null;
                            setPreviewItems(null);
                          }}
                          onPointerMove={(e) => {
                            const p = pointerTrackRef.current;
                            if (!p || !p.active) return;
                            const dx = e.clientX - p.startX;
                            const dy = e.clientY - p.startY;
                            const TH = DRAG.directionLockPx;
                            if (dragDirectionRef.current === null && (Math.abs(dx) > TH || Math.abs(dy) > TH)) {
                              dragDirectionRef.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
                            }
                            // handle pointer-driven vertical dragging (lift + reorder)
                            if (dragDirectionRef.current === 'vertical') {
                              // create ghost once
                              if (!ghostRef.current) {
                                const nodes = Array.from(document.querySelectorAll('.image-dialog .checklist-item:not(.completed)')) as HTMLElement[];
                                const srcRealIdx = p.idx ?? -1;
                                const currentList = previewItems ?? items;
                                const srcDomIdx = realToDomIndexUnchecked(srcRealIdx, currentList);
                                const srcEl = nodes[srcDomIdx];
                                if (srcEl) {
                                  const rect = srcEl.getBoundingClientRect();
                                  const ghost = srcEl.cloneNode(true) as HTMLElement;
                                  ghost.style.position = 'fixed';
                                  ghost.style.left = rect.left + 'px';
                                  ghost.style.top = rect.top + 'px';
                                  ghost.style.width = rect.width + 'px';
                                  ghost.style.pointerEvents = 'none';
                                  ghost.style.zIndex = '9999';
                                  ghost.style.opacity = '0.98';
                                  ghost.classList.add('checklist-ghost');
                                  document.body.appendChild(ghost);
                                  ghostRef.current = ghost as HTMLDivElement;
                                  // mark source hidden
                                  try { srcEl.classList.add('drag-source'); } catch (err) {}
                                  setDragging(srcRealIdx);
                                  setHoverIndex(srcRealIdx);
                                  // record source left for horizontal locking
                                  sourceLeftRef.current = rect.left;
                                  // set shift distance so neighbors occupy the dragged item's full height
                                  try {
                                    const dialog = document.querySelector('.image-dialog') as HTMLElement | null;
                                    if (dialog) dialog.style.setProperty('--checklist-item-shift', `${Math.round(rect.height)}px`);
                                  } catch (err) { }
                                }
                              }
                              // update ghost position
                              if (ghostRef.current) {
                                ghostRef.current.style.left = sourceLeftRef.current + 'px';
                                ghostRef.current.style.top = (e.clientY - (dragOffsetRef.current.y || 0)) + 'px';
                              }
                              // compute hover index using ghost overlap to avoid jitter
                              const nodes = Array.from(document.querySelectorAll('.image-dialog .checklist-item:not(.completed)')) as HTMLElement[];
                              if (nodes.length) {
                                let chosenDomIdx: number | null = null;
                                const ghostRect = ghostRef.current ? ghostRef.current.getBoundingClientRect() : { top: e.clientY - 10, bottom: e.clientY + 10 };
                                const movingDown = e.clientY > (lastPointerYRef.current || e.clientY);
                                lastPointerYRef.current = e.clientY;
                                const overlapThreshold = (typeof DRAG.ghostOverlapUpPct === 'number' && typeof DRAG.ghostOverlapDownPct === 'number')
                                  ? (movingDown ? DRAG.ghostOverlapDownPct : DRAG.ghostOverlapUpPct)
                                  : DRAG.ghostOverlapPct;
                                for (let i = 0; i < nodes.length; i++) {
                                  const r = nodes[i].getBoundingClientRect();
                                  const overlap = Math.max(0, Math.min(ghostRect.bottom, r.bottom) - Math.max(ghostRect.top, r.top));
                                  const frac = overlap / (r.height || 1);
                                  if (frac >= overlapThreshold) { chosenDomIdx = i; break; }
                                }
                                const currentList = previewItems ?? items;
                                if (chosenDomIdx != null) {
                                  const chosenRealIdx = domToRealIndexUnchecked(chosenDomIdx, currentList);
                                  if (chosenRealIdx !== hoverIndex) setHoverIndex(chosenRealIdx);
                                }
                              }
                              return;
                            }
                            const INDENT_TH = DRAG.indentPx;
                            if (dragDirectionRef.current === 'horizontal') {
                              const draggedId = p.draggedId ?? null;
                              if (draggedId == null) return;
                              const current = items;
                              const src = current.findIndex(x => (typeof draggedId === 'number' ? x.id === draggedId : x.uid === draggedId));
                              if (src < 0) return;
                              // don't preview if dragging the first item and no valid parent
                              if (src === 0 && dx > 0) { setPreviewItems(null); return; }
                              if (dx > INDENT_TH) {
                                const [bStart, bEnd] = getBlockRange(current, src);
                                const copy = [...current];
                                const block = copy.splice(bStart, bEnd - bStart);
                                // find parent top-level before original src
                                let parentIdx: number | null = null;
                                for (let j = src - 1; j >= 0; j--) {
                                  if ((current[j].indent || 0) === 0) { parentIdx = j; break; }
                                }
                                if (parentIdx != null) {
                                  const parentKey = (typeof current[parentIdx].id === 'number' ? current[parentIdx].id : current[parentIdx].uid);
                                  const foundParentIdx = copy.findIndex(x => (typeof parentKey === 'number' ? x.id === parentKey : x.uid === parentKey));
                                  let insertAt = foundParentIdx >= 0 ? foundParentIdx + 1 : Math.min(bStart, copy.length);
                                  while (insertAt < copy.length && (copy[insertAt].indent || 0) > 0) insertAt++;
                                        const inc = block.map(it => ({ ...it, indent: 1 }));
                                  copy.splice(insertAt, 0, ...inc);
                                } else {
                                  let insertAt = Math.min(bStart, copy.length);
                                  while (insertAt < copy.length && (copy[insertAt].indent || 0) > 0) insertAt++;
                                  const inc = block.map(it => ({ ...it, indent: 1 }));
                                  copy.splice(insertAt, 0, ...inc);
                                }
                                setPreviewItems(copy);
                              } else if (dx < -INDENT_TH) {
                                const [bStart, bEnd] = getBlockRange(current, src);
                                const copy = [...current];
                                for (let i = bStart; i < bEnd && i < copy.length; i++) copy[i] = { ...copy[i], indent: Math.max(0, (copy[i].indent || 0) - 1) };
                                setPreviewItems(copy);
                              } else {
                                setPreviewItems(null);
                              }
                            }
                          }}
                          onPointerUp={(e) => {
                            try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
                            const p = pointerTrackRef.current;
                            pointerTrackRef.current = null;
                            if (previewItems) {
                              const yarr = yarrayRef.current;
                              if (yarr) {
                                try {
                                  // Commit only indent changes to existing items, keeping order intact
                                  for (let i = 0; i < previewItems.length; i++) {
                                    const it = previewItems[i];
                                    // Find matching Y item by id or uid
                                    const idx = yarr.toArray().findIndex(m => {
                                      const idVal = m.get('id');
                                      const uidVal = m.get('uid');
                                      if (typeof it.id === 'number' && typeof idVal === 'number') return Number(it.id) === Number(idVal);
                                      if (it.uid && uidVal) return String(it.uid) === String(uidVal);
                                      return false;
                                    });
                                    if (idx >= 0) {
                                      const m = yarr.get(idx) as Y.Map<any>;
                                      try { m.set('indent', Number(it.indent || 0)); } catch {}
                                      // also sync checked/content if preview has changes
                                      try { m.set('checked', !!it.checked); } catch {}
                                      try { m.set('content', String(it.content || '')); } catch {}
                                    }
                                  }
                                } catch {}
                              }
                              setPreviewItems(null);
                              // If horizontal preview was applied, skip vertical commit to avoid index mismatch
                              dragDirectionRef.current = null;
                              endDragCleanup();
                              return;
                            }
                            // if pointer-driven vertical drag was active, commit block move
                            if (dragDirectionRef.current === 'vertical' && dragging !== null) {
                              const srcRealIdx = dragging;
                              const current = items;
                              const [sStart, sEnd] = getBlockRange(current, srcRealIdx);
                              if (hoverIndex !== null) {
                                // when moving down, insert after the hovered item; when moving up, insert before
                                const dstRealIdx = srcRealIdx < hoverIndex ? hoverIndex + 1 : hoverIndex;
                                if (!(dstRealIdx >= sStart && dstRealIdx < sEnd)) moveBlockY(sStart, sEnd, dstRealIdx);
                              } else {
                                // no hover; no-op
                              }
                            }
                            dragDirectionRef.current = null;
                            // cleanup ghost and classes
                            endDragCleanup();
                          }}
                        >≡</div>
                        <div className={`checkbox-visual ${it.checked ? 'checked' : ''}`} onClick={() => toggleChecked(realIdx)}>{it.checked && (<svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>)}</div>
                        <div style={{ flex: 1 }}>
                          <ChecklistItemRT
                            value={it.content || ''}
                            onChange={(html) => updateItem(realIdx, html)}
                            onEnter={() => addItemAt(realIdx + 1)}
                            autoFocus={autoFocusIndex === realIdx}
                            onFocus={(ed) => { activeChecklistEditor.current = ed; setToolbarTick(t => t + 1); if (autoFocusIndex === realIdx) setAutoFocusIndex(null); }}
                          />
                        </div>
                        {/* up/down controls removed in favor of drag reorder */}
                        <button className="delete-item" onClick={(e) => { e.stopPropagation(); deleteItemAt(realIdx); }} aria-label="Delete item">✕</button>
                      </div>
                    );
                  })}

                  <div style={{ marginTop: 12 }}>
                    <button className="btn completed-toggle" onClick={() => setCompletedOpen(o => !o)} aria-expanded={completedOpen} aria-controls={`editor-completed-${note.id}`}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ transform: completedOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>{'▸'}</span>
                        <span>{items.filter(it=>it.checked).length} completed items</span>
                      </span>
                    </button>
                    {completedOpen && (previewItems ?? items).filter(it => it.checked).map((it, idx) => {
                      const currentList = previewItems ?? items;
                      const realIdx = currentList.indexOf(it);
                      const shiftClass = '';
                      return (
                        <div key={it.key ?? realIdx} className={`checklist-item completed ${shiftClass}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginLeft: (it.indent || 0) * 18 }} draggable={false}>
                          <div style={{ width: 20 }} />
                          <div className={`checkbox-visual ${it.checked ? 'checked' : ''}`} onClick={() => toggleChecked(realIdx)}>{it.checked && (<svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>)}</div>
                          <div style={{ flex: 1, textDecoration: 'line-through', display: 'flex', alignItems: 'center' }}>
                            <div className="rt-html" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(String(it.content || ''), { USE_PROFILES: { html: true } }) }} />
                          </div>
                          {/* up/down controls removed in favor of drag reorder */}
                          <button className="delete-item" onClick={(e) => { e.stopPropagation(); deleteItemAt(realIdx); }} aria-label="Delete item">✕</button>
                        </div>
                      );
                    })}
                  </div>
                </div>


              <div className="dialog-footer">
                <div className="note-actions" style={{ marginRight: 'auto', display: 'inline-flex', gap: 8, justifyContent: 'flex-start' }}>
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
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={onClose}>Cancel</button>
                  <button className="btn" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                </div>
              </div>
            </div>
          </div>
          );

          if (typeof document !== 'undefined') {
            const portal = createPortal(dialog, document.body);
            return (<>{portal}
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

