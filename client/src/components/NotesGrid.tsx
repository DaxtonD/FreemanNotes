import React, { useEffect, useState, useRef } from "react";
import NoteCard from "./NoteCard";
import { useAuth } from "../authContext";
import TakeNoteBar from "./TakeNoteBar";

export default function NotesGrid({ selectedLabelIds = [], searchQuery = '' }: { selectedLabelIds?: number[], searchQuery?: string }) {
  const { token } = useAuth();
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const notesRef = useRef<any[]>([]);
  const itemRefs = useRef(new Map<number, HTMLElement>());
  const lastSpliceAt = useRef<number>(0);

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
      setNotes(data.notes || []);
      // After notes render, ask grid to recalc so width/columns lock immediately
      try { setTimeout(() => window.dispatchEvent(new Event('notes-grid:recalc')), 0); } catch {}
      // apply any locally saved order (for unauthenticated or offline sessions)
      try {
        const raw = localStorage.getItem('notesOrder');
        if (raw) {
          const ids: number[] = JSON.parse(raw || '[]');
          if (Array.isArray(ids) && ids.length) {
            const map = new Map((data.notes || []).map((n:any) => [n.id, n]));
            const ordered: any[] = [];
            const seen = new Set<number>();
            for (const id of ids) {
              if (map.has(id) && !seen.has(id)) { ordered.push(map.get(id)); seen.add(id); }
            }
            // append any notes not in saved order
            for (const n of (data.notes || [])) if (!seen.has(n.id)) ordered.push(n);
            setNotes(ordered);
          }
        }
      } catch (e) { /* ignore malformed localStorage */ }
    } catch (err) {
      console.error('Failed to load notes', err);
      setNotes([]);
    } finally { setLoading(false); }
  }

  useEffect(() => { if (token) load(); else setNotes([]); }, [token]);
  useEffect(() => { notesRef.current = notes; }, [notes]);

  // Subscribe to lightweight server events to refresh list on share/unshare and update chips
  useEffect(() => {
    if (!token) return;
    let ws: WebSocket | null = null;
    try {
      const url = `ws://${window.location.host}/events?token=${encodeURIComponent(token)}`;
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data || '{}'));
          if (!msg || !msg.type) return;
          switch (msg.type) {
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
    function updateCols() {
      // capture pre-layout positions for FLIP if columns change
      const beforeRects = new Map<number, DOMRect>();
      try { itemRefs.current.forEach((el, id) => { if (el) beforeRects.set(id, el.getBoundingClientRect()); }); } catch {}
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
      const sidebarWidth = parseInt(docStyle.getPropertyValue('--sidebar-width')) || 220;
      const mainHorizontalPadding = 64; // matches `.main-area{padding:24px 32px}`
      const availFallback = window.innerWidth - sidebarWidth - mainHorizontalPadding;
      const avail = Math.max(availMain, availArea, availFallback, 0);

      // Auto-fit removed: card width remains as set by preferences
      // compute columns per-grid using available width relative to its left edge
      const grids = Array.from(document.querySelectorAll('.notes-area .notes-grid')) as HTMLElement[];
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
          // Set both standard and WebKit-prefixed column-count
          g.style.setProperty('column-count', String(gridCols));
          g.style.setProperty('-webkit-column-count', String(gridCols));
          // Shorthand also, to ensure engines apply both values consistently
          g.style.setProperty('columns', `${gridCols} ${cardWidth}px`);
          g.style.setProperty('-webkit-columns', `${gridCols} ${cardWidth}px`);
          anyColsChanged = true;
        }
        // Explicitly set column-width to card width to ensure consistent column sizing
        g.style.setProperty('column-width', `${cardWidth}px`);
        g.style.setProperty('-webkit-column-width', `${cardWidth}px`);
        g.style.width = `${gridTotal}px`;
      }
      // FLIP: animate items from old positions to new after column changes
      if (anyColsChanged && beforeRects.size) {
        requestAnimationFrame(() => {
          const afterRects = new Map<number, DOMRect>();
          itemRefs.current.forEach((el, id) => { if (el) afterRects.set(id, el.getBoundingClientRect()); });
          afterRects.forEach((rect, id) => {
            const prev = beforeRects.get(id);
            const el = itemRefs.current.get(id);
            if (!prev || !el) return;
            const dx = prev.left - rect.left;
            const dy = prev.top - rect.top;
            if (dx === 0 && dy === 0) return;
            // FLIP: set delta with no transition, force reflow, then animate to identity
            el.style.transition = 'none';
            el.style.transform = `translate(${dx}px, ${dy}px)`;
            void el.getBoundingClientRect();
            el.style.transition = `transform ${getAnimMs('resize')}ms ease-in-out`;
            el.style.transform = '';
            const cleanup = () => { try { el.style.transition = ''; el.removeEventListener('transitionend', cleanup); } catch {} };
            el.addEventListener('transitionend', cleanup);
          });
        });
      }
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
                g.style.backgroundImage = `repeating-linear-gradient(to right, rgba(255,255,255,0.08) 0, rgba(255,255,255,0.08) 1px, transparent 1px, transparent ${spacing}px)`;
                g.style.backgroundSize = `${spacing}px 100%`;
                g.style.backgroundPosition = 'left top';
              } else {
                g.style.backgroundImage = '';
                g.style.backgroundSize = '';
              }
            }
          }
        };
      } catch {}
      // (masonry emulation removed) keep grid width locked and let CSS Grid
      // handle vertical flow to avoid overlapping issues.
    }

    updateCols();
    const observerTarget = document.querySelector('.main-area') || document.body;
    const ro = new ResizeObserver(() => updateCols());
    ro.observe(observerTarget as Element);
    window.addEventListener('resize', updateCols);
    window.addEventListener('notes-grid:recalc', updateCols as EventListener);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateCols);
      window.removeEventListener('notes-grid:recalc', updateCols as EventListener);
    };
  }, []);

  function matchesLabels(n: any): boolean {
    if (!selectedLabelIds.length) return true;
    const labels = (n.noteLabels || []).map((nl: any) => nl.label?.id).filter((id: any) => typeof id === 'number');
    return selectedLabelIds.some(id => labels.includes(id));
  }
  function matchesSearch(n: any): boolean {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return true;
    if (String(n.title || '').toLowerCase().includes(q)) return true;
    if (String(n.body || '').toLowerCase().includes(q)) return true;
    const items = Array.isArray(n.items) ? n.items : [];
    if (items.some((it: any) => String(it.content || '').toLowerCase().includes(q))) return true;
    const labels = Array.isArray(n.noteLabels) ? n.noteLabels : [];
    if (labels.some((nl: any) => String(nl.label?.name || '').toLowerCase().includes(q))) return true;
    const images = Array.isArray(n.images) ? n.images : [];
    // OCR text search removed
    return false;
  }
  const pinned = notes.filter(n => n.pinned).filter(matchesLabels).filter(matchesSearch);
  const others = notes.filter(n => !n.pinned).filter(matchesLabels).filter(matchesSearch);
  function moveNote(from: number, to: number) {
    // FLIP for reordering only: capture before positions, update state, then animate transforms
    const before = new Map<number, DOMRect>();
    itemRefs.current.forEach((el, id) => { if (el) before.set(id, el.getBoundingClientRect()); });

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

  if (loading) return <div>Loading notes…</div>;

  return (
    <section className="notes-area">
      <TakeNoteBar onCreated={load} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 className="section-title">Notes</h3>
      </div>

      {pinned.length > 0 && (
        <div className="notes-section">
          <h4 className="section-title">Pinned</h4>
          <div className="notes-grid" ref={gridRef}>
            {pinned.map((n) => {
              const globalIdx = notes.findIndex(x => x.id === n.id);
              return (
                <div key={n.id}
                  ref={(el) => { if (el) itemRefs.current.set(n.id, el); else itemRefs.current.delete(n.id); }}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', String(globalIdx));
                    setDraggingIndex(globalIdx);
                    // align drag image to cursor using `.note-card` if available; do not hide original
                    const wrapper = itemRefs.current.get(n.id);
                    const cardEl = wrapper ? (wrapper.querySelector('.note-card') as HTMLElement | null) : null;
                    if (cardEl) {
                      const r = cardEl.getBoundingClientRect();
                      const dpr = (window as any).devicePixelRatio || 1;
                      const offsetX = (e.clientX - r.left) * dpr;
                      const offsetY = (e.clientY - r.top) * dpr;
                      try { e.dataTransfer.setDragImage(cardEl, offsetX, offsetY); } catch {}
                    }
                  }}
                  onDragEnd={() => {
                    setDraggingIndex(null);
                    setHoverIndex(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setHoverIndex(globalIdx);
                    try {
                      const behavior = localStorage.getItem('prefs.dragBehavior') || 'swap';
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
                          setDraggingIndex(globalIdx);
                        }
                      }
                    } catch {}
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = Number(e.dataTransfer.getData('text/plain'));
                    const to = globalIdx;
                    try {
                      const behavior = localStorage.getItem('prefs.dragBehavior') || 'swap';
                      if (behavior === 'rearrange') {
                        moveNoteSplice(from, to);
                      } else {
                        moveNote(from, to);
                      }
                    } catch { moveNote(from, to); }
                    // persist after state update — read latest notes from ref inside RAF
                    requestAnimationFrame(() => { try { persistOrder(notesRef.current); } catch (err) {} });
                    setDraggingIndex(null);
                    setHoverIndex(null);
                  }}
                >
                    <NoteCard note={n} onChange={load} />
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="notes-section">
        <h4 className="section-title">Others</h4>
        <div className="notes-grid">
          {others.map((n) => {
            const globalIdx = notes.findIndex(x => x.id === n.id);
              return (
              <div key={n.id}
                ref={(el) => { if (el) itemRefs.current.set(n.id, el); else itemRefs.current.delete(n.id); }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', String(globalIdx));
                  setDraggingIndex(globalIdx);
                  // align drag image to cursor using `.note-card` if available; do not hide original
                  const wrapper = itemRefs.current.get(n.id);
                  const cardEl = wrapper ? (wrapper.querySelector('.note-card') as HTMLElement | null) : null;
                  if (cardEl) {
                    const r = cardEl.getBoundingClientRect();
                    const dpr = (window as any).devicePixelRatio || 1;
                    const offsetX = (e.clientX - r.left) * dpr;
                    const offsetY = (e.clientY - r.top) * dpr;
                    try { e.dataTransfer.setDragImage(cardEl, offsetX, offsetY); } catch {}
                  }
                }}
                onDragEnd={() => {
                  setDraggingIndex(null);
                  setHoverIndex(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setHoverIndex(globalIdx);
                  try {
                    const behavior = localStorage.getItem('prefs.dragBehavior') || 'swap';
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
                        setDraggingIndex(globalIdx);
                      }
                    }
                  } catch {}
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = Number(e.dataTransfer.getData('text/plain'));
                  const to = globalIdx;
                  try {
                    const behavior = localStorage.getItem('prefs.dragBehavior') || 'swap';
                    if (behavior === 'rearrange') {
                      moveNoteSplice(from, to);
                    } else {
                      moveNote(from, to);
                    }
                  } catch { moveNote(from, to); }
                  // persist after state update — read latest notes from ref inside RAF
                  requestAnimationFrame(() => { try { persistOrder(notesRef.current); } catch (err) {} });
                  setDraggingIndex(null);
                  setHoverIndex(null);
                }}
              >
                <NoteCard note={n} onChange={load} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

