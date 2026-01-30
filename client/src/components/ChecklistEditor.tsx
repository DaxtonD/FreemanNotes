import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../authContext';

export default function ChecklistEditor({ note, onClose, onSaved, noteBg }:
  { note: any; onClose: () => void; onSaved?: (payload: { items: Array<{ id: number; content: string; checked: boolean; ord: number; indent: number }>; title: string }) => void; noteBg?: string }) {
  const { token } = useAuth();
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
  const [title, setTitle] = useState<string>(note.title || '');
  // prefer explicit `noteBg` passed from the parent (NoteCard) which may have local unsaved color state
  const [bg, setBg] = useState<string>(noteBg ?? note.color ?? '');

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
  const INDENT_THRESHOLD = 16; // px required to trigger indent/un-indent (was 30)

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
        if (!el) return;
        try {
          el.style.height = 'auto';
          el.style.height = Math.max(22, el.scrollHeight) + 'px';
        } catch {}
      });
    });
  }, [items, previewItems]);

  function shiftClassForIndex(realIdx: number, list: any[]) {
    if (dragging === null || hoverIndex === null) return '';
    const [sStart, sEnd] = getBlockRange(list, dragging);
    if (sStart < 0) return '';
    // insertion index is hoverIndex; if dragging < hoverIndex => moving down
    if (dragging < hoverIndex) {
      // items after the dragged block up to hoverIndex should shift up
      if (realIdx >= sEnd && realIdx <= hoverIndex) return 'shift-up';
    } else if (dragging > hoverIndex) {
      // items from hoverIndex up to before dragged block should shift down
      if (realIdx >= hoverIndex && realIdx < sStart) return 'shift-down';
    }
    return '';
  }

  function updateItem(idx: number, content: string) {
    setItems(s => s.map((it, i) => i === idx ? { ...it, content } : it));
    // Autosize the edited textarea on next frame
    requestAnimationFrame(() => {
      const el = itemRefs.current[idx];
      if (el) {
        try {
          el.style.height = 'auto';
          el.style.height = Math.max(22, el.scrollHeight) + 'px';
        } catch {}
      }
    });
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>, realIdx: number) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addItemAt(realIdx + 1);
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
    // Compute insertion index from the live previous state inside the updater
    let insertedAt = 0;
    setItems(prev => {
      const c = [...prev];
      const pos = typeof idx === 'number' ? idx : prev.length;
      insertedAt = pos;
      c.splice(pos, 0, { content: '', checked: false, indent: 0 });
      return c;
    });
    // Focus the newly inserted input on next frame (allow DOM to update)
    requestAnimationFrame(() => {
      const el = itemRefs.current[insertedAt];
      if (el) el.focus();
    });
  }

  function toggleChecked(idx: number) {
    setItems(s => {
      const copy = [...s];
      const newChecked = !copy[idx].checked;
      copy[idx] = { ...copy[idx], checked: newChecked };
      // Cascade for parents (indent === 0)
      if ((copy[idx].indent || 0) === 0) {
        for (let i = idx + 1; i < copy.length; i++) {
          if ((copy[i].indent || 0) > 0) copy[i] = { ...copy[i], checked: newChecked };
          else break;
        }
      }
      // Keep incomplete first, completed after
      const completed = copy.filter(x => x.checked);
      const incomplete = copy.filter(x => !x.checked);
      return [...incomplete, ...completed];
    });
  }

  function moveItem(src: number, dst: number) {
    setItems(s => {
      const copy = [...s];
      const [m] = copy.splice(src, 1);
      copy.splice(dst, 0, m);
      return copy;
    });
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
        const THRESH = 6;
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
      // remove empty items before saving
      const filtered = items.filter(it => ((it.content || '').trim().length > 0));
      // reflect cleaned list in the UI
      setItems(filtered);
      const ordered = [...filtered].sort((a, b) => (a.checked === b.checked) ? 0 : (a.checked ? 1 : -1));
      const payloadItems = ordered.map((it, i) => ({ id: it.id, content: it.content, checked: !!it.checked, ord: i, indent: it.indent || 0 }));
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
  function deleteItemAt(idx: number) {
    setItems(s => {
      const copy = [...s];
      if (idx >= 0 && idx < copy.length) copy.splice(idx, 1);
      return copy;
    });
  }

  const dialog = (
    <div className="image-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { save(); } }}>
      <div className="image-dialog" role="dialog" aria-modal style={{ width: 'min(1000px, 86vw)', ...dialogStyle }}
        onPointerDownCapture={(e) => { if (!pointerSafeRef.current) { e.preventDefault(); e.stopPropagation(); } }}
      >
        <div className="dialog-header">
          <strong>Edit checklist</strong>
          <button className="icon-close" onClick={onClose}>✕</button>
        </div>
        <div className="dialog-body">
          <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
            <input placeholder="Checklist title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, background: 'transparent', border: 'none', color: 'inherit', fontWeight: 600 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => addItemAt()} disabled={saving}>+ Item</button>
            </div>
          </div>


                  {(previewItems ?? items).filter(it => !it.checked).map((it, idx) => {
                    const currentList = previewItems ?? items;
                    const realIdx = currentList.indexOf(it);
                    const shiftClass = shiftClassForIndex(realIdx, currentList);
                    return (
                      <div key={realIdx} className={`checklist-item ${shiftClass}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginLeft: (it.indent || 0) * 18 }} draggable={false}
                        onPointerCancel={() => { pointerTrackRef.current = null; }}
                        
                        onDragOver={(e) => {
                          e.preventDefault(); const target = e.currentTarget as HTMLElement; const rect = target.getBoundingClientRect(); const y = (e as unknown as React.DragEvent<HTMLElement>).clientY; const height = rect.height || 40;
                          if (rafRef.current) cancelAnimationFrame(rafRef.current);
                          rafRef.current = requestAnimationFrame(() => {
                            if (dragging === null) return;
                            if (dragDirectionRef.current === 'horizontal' && dragStartRef.current) {
                              const dx = ((e as unknown as React.DragEvent<HTMLElement>).clientX || 0) - dragStartRef.current.x;
                              if (dx > INDENT_THRESHOLD && realIdx > 0) {
                                // find nearest previous top-level (indent === 0) to be the parent
                                let pId: number | null = null;
                                for (let j = realIdx - 1; j >= 0; j--) {
                                  if ((items[j].indent || 0) === 0) { pId = items[j].id ?? null; break; }
                                }
                                nestedPendingRef.current = { parentId: pId, makeNested: true };
                              }
                              else if (dx < -INDENT_THRESHOLD) nestedPendingRef.current = { parentId: null, makeNested: false };
                              else nestedPendingRef.current = { parentId: null, makeNested: false };
                              return;
                            }
                            let shouldHover = false; if (dragging < realIdx) shouldHover = (y - rect.top < height * 0.28); else if (dragging > realIdx) shouldHover = (rect.bottom - y < height * 0.28);
                            if (shouldHover) { if (clearHoverTimeoutRef.current) { clearTimeout(clearHoverTimeoutRef.current); clearHoverTimeoutRef.current = null; } setHoverIndex(prev => (prev === realIdx ? prev : realIdx)); }
                            else { if (hoverIndex === realIdx && clearHoverTimeoutRef.current === null) { clearHoverTimeoutRef.current = window.setTimeout(() => { setHoverIndex(prev => (prev === realIdx ? null : prev)); clearHoverTimeoutRef.current = null; }, 80); } }
                          });
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const src = dragging !== null ? dragging : parseInt(e.dataTransfer.getData('text/plain') || '-1', 10);
                          const dst = realIdx;
                          if (src >= 0) {
                            const dx = dragStartRef.current ? ((e.clientX || 0) - dragStartRef.current.x) : 0;
                            const treatHorizontal = dragDirectionRef.current === 'horizontal' || Math.abs(dx) > INDENT_THRESHOLD;
                            if (treatHorizontal) {
                              const draggedId = items[src]?.id;
                              if (dx > INDENT_THRESHOLD) {
                                // indent block: compute block for src and increase indent for whole block
                                const [bStart, bEnd] = getBlockRange(items, src);
                                // find previous top-level before original src
                                let parentId: number | null = null;
                                for (let j = src - 1; j >= 0; j--) {
                                  if ((items[j].indent || 0) === 0) { parentId = items[j].id ?? null; break; }
                                }
                                  if (bStart >= 0) {
                                    if (parentId != null) {
                                      if (bStart === dst) {
                                        // set indent to 1 for the block in place
                                        setItems(s => s.map((it, i) => (i >= bStart && i < bEnd) ? { ...it, indent: 1 } : it));
                                      } else {
                                        // remove block and insert after parent, setting indent to 1
                                        setItems(s => {
                                          const copy = [...s];
                                          const block = copy.splice(bStart, bEnd - bStart);
                                          const parentIdx = copy.findIndex(x => x.id === parentId);
                                          let insertAt = parentIdx >= 0 ? parentIdx + 1 : Math.min(dst, copy.length);
                                          while (insertAt < copy.length && (copy[insertAt].indent || 0) > 0) insertAt++;
                                          const inc = block.map(it => ({ ...it, indent: 1 }));
                                          copy.splice(insertAt, 0, ...inc);
                                          return copy;
                                        });
                                      }
                                    } else if (bStart >= 0) {
                                      // no previous top-level found: just set indent=1 for the block in place
                                      setItems(s => s.map((it, i) => (i >= bStart && i < bEnd) ? { ...it, indent: 1 } : it));
                                    }
                                }
                              } else if (dx < -INDENT_THRESHOLD) {
                                // un-indent block: reduce indent by 1 for the block
                                const [bStart, bEnd] = getBlockRange(items, src);
                                if (bStart >= 0) {
                                  setItems(s => s.map((it, i) => (i >= bStart && i < bEnd) ? { ...it, indent: Math.max(0, (it.indent || 0) - 1) } : it));
                                }
                              }
                            } else {
                              if (src !== dst) moveItem(src, dst);
                            }
                          }
                          endDragCleanup();
                        }}
                        onDragLeave={() => { if (hoverIndex === realIdx) setHoverIndex(null); if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } }}
                      >
                        <div className="drag-handle" style={{ width: 20, cursor: 'grab', userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none', msUserSelect: 'none' }} onMouseDown={(e) => { e.preventDefault(); }}
                          onPointerDown={(e) => {
                            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                            const currentList = previewItems ?? items;
                            const draggedId = currentList[realIdx]?.id ?? null;
                            pointerTrackRef.current = { active: true, startX: e.clientX, startY: e.clientY, idx: realIdx, draggedId, pointerId: e.pointerId };
                            dragDirectionRef.current = null;
                            setPreviewItems(null);
                          }}
                          onPointerMove={(e) => {
                            const p = pointerTrackRef.current;
                            if (!p || !p.active) return;
                            const dx = e.clientX - p.startX;
                            const dy = e.clientY - p.startY;
                            const TH = 6;
                            if (dragDirectionRef.current === null && (Math.abs(dx) > TH || Math.abs(dy) > TH)) {
                              dragDirectionRef.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
                            }
                            // handle pointer-driven vertical dragging (lift + reorder)
                            if (dragDirectionRef.current === 'vertical') {
                              // create ghost once
                              if (!ghostRef.current) {
                                const nodes = Array.from(document.querySelectorAll('.image-dialog .checklist-item')) as HTMLElement[];
                                const srcIdx = p.idx ?? -1;
                                const srcEl = nodes[srcIdx];
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
                                  setDragging(srcIdx);
                                  setHoverIndex(srcIdx);
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
                              // compute hover index using ghost overlap (>=50% of target height) to avoid jitter
                              const nodes = Array.from(document.querySelectorAll('.image-dialog .checklist-item')) as HTMLElement[];
                              if (nodes.length) {
                                let chosen: number | null = null;
                                const ghostRect = ghostRef.current ? ghostRef.current.getBoundingClientRect() : { top: e.clientY - 10, bottom: e.clientY + 10 };
                                for (let i = 0; i < nodes.length; i++) {
                                  const r = nodes[i].getBoundingClientRect();
                                  const overlap = Math.max(0, Math.min(ghostRect.bottom, r.bottom) - Math.max(ghostRect.top, r.top));
                                  const frac = overlap / (r.height || 1);
                                  if (frac >= 0.5) { chosen = i; break; }
                                }
                                // if no strong overlap, fall back to nearest center without hysteresis
                                if (chosen === null) {
                                  let closest = 0; let minDist = Infinity;
                                  for (let i = 0; i < nodes.length; i++) {
                                    const r = nodes[i].getBoundingClientRect();
                                    const center = r.top + r.height / 2;
                                    const d = Math.abs((e.clientY || 0) - center);
                                    if (d < minDist) { minDist = d; closest = i; }
                                  }
                                  chosen = closest;
                                }
                                if (chosen !== hoverIndex) setHoverIndex(chosen);
                              }
                              return;
                            }
                            const INDENT_TH = INDENT_THRESHOLD;
                            if (dragDirectionRef.current === 'horizontal') {
                              const draggedId = p.draggedId ?? null;
                              if (draggedId == null) return;
                              const current = items;
                              const src = current.findIndex(x => x.id === draggedId);
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
                                  const parentId = current[parentIdx].id;
                                  const foundParentIdx = copy.findIndex(x => x.id === parentId);
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
                              setItems(prev => {
                                // commit using ids to avoid stale index issues
                                return previewItems;
                              });
                              setPreviewItems(null);
                            }
                            // if pointer-driven vertical drag was active, commit block move
                            if (dragDirectionRef.current === 'vertical' && dragging !== null) {
                              const srcIdx = dragging;
                              const current = items;
                              const [sStart, sEnd] = getBlockRange(current, srcIdx);
                              if (hoverIndex !== null) {
                                // when moving down, insert after the hovered item; when moving up, insert before
                                const dstIdx = srcIdx < hoverIndex ? hoverIndex + 1 : hoverIndex;
                                if (!(dstIdx >= sStart && dstIdx < sEnd)) moveBlock(sStart, sEnd, dstIdx);
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
                        <textarea ref={el => itemRefs.current[realIdx] = el} value={it.content} onChange={e => updateItem(realIdx, (e.target as HTMLTextAreaElement).value)} onKeyDown={(e) => handleInputKeyDown(e as React.KeyboardEvent<HTMLTextAreaElement>, realIdx)} placeholder="List item" className="take-note-input" style={{ flex: 1, height: 'auto' }} rows={1} />
                        <div className="move-controls"><button className="move-btn" onClick={() => moveItem(realIdx, Math.max(0, realIdx-1))} aria-label="Move up">↑</button><button className="move-btn" onClick={() => moveItem(realIdx, Math.min(items.length-1, realIdx+1))} aria-label="Move down">↓</button></div>
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
                      const shiftClass = shiftClassForIndex(realIdx, previewItems ?? items);
                      return (
                        <div key={realIdx} className={`checklist-item ${shiftClass}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginLeft: (it.indent || 0) * 18 }} draggable={false}
                          onDragOver={(e) => { e.preventDefault(); const target = e.currentTarget as HTMLElement; const rect = target.getBoundingClientRect(); const y = (e as unknown as React.DragEvent<HTMLElement>).clientY; const height = rect.height || 40; if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(() => { if (dragging === null) return; let shouldHover = false; if (dragging < realIdx) { shouldHover = (y - rect.top < height * 0.28); } else if (dragging > realIdx) { shouldHover = (rect.bottom - y < height * 0.28); } setHoverIndex(prev => shouldHover ? (prev === realIdx ? prev : realIdx) : (prev === realIdx ? null : prev)); }); }}
                          onDrop={(e) => { e.preventDefault(); const src = dragging !== null ? dragging : parseInt(e.dataTransfer.getData('text/plain') || '-1', 10); const dst = realIdx; if (src >= 0 && src !== dst) moveItem(src, dst); endDragCleanup(); }}
                          onDragLeave={() => { if (hoverIndex === realIdx) setHoverIndex(null); if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } }}
                        >
                          <div style={{ width: 20 }} />
                          <div className={`checkbox-visual ${it.checked ? 'checked' : ''}`} onClick={() => toggleChecked(realIdx)}>{it.checked && (<svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>)}</div>
                          <textarea ref={el => itemRefs.current[realIdx] = el} value={it.content} onChange={e => updateItem(realIdx, (e.target as HTMLTextAreaElement).value)} onKeyDown={(e) => handleInputKeyDown(e as React.KeyboardEvent<HTMLTextAreaElement>, realIdx)} placeholder="List item" className="take-note-input" style={{ flex: 1, height: 'auto' }} rows={1} />
                          <div className="move-controls"><button className="move-btn" onClick={() => moveItem(realIdx, Math.max(0, realIdx-1))} aria-label="Move up">↑</button><button className="move-btn" onClick={() => moveItem(realIdx, Math.min(items.length-1, realIdx+1))} aria-label="Move down">↓</button></div>
                          <button className="delete-item" onClick={(e) => { e.stopPropagation(); deleteItemAt(realIdx); }} aria-label="Delete item">✕</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              <div className="dialog-footer">
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={() => addItemAt()} disabled={saving}>+ Item</button>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={onClose}>Cancel</button>
                  <button className="btn" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                </div>
              </div>
            </div>
          </div>
          );

          if (typeof document !== 'undefined') return createPortal(dialog, document.body);
          return dialog;
        }

