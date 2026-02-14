import React from 'react';
import { createPortal } from 'react-dom';

export default function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = React.useState<'fit' | 'zoom'>('fit');
  const [scale, setScale] = React.useState<number>(1);
  const [offset, setOffset] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = React.useState<boolean>(false);
  const draggingRef = React.useRef<boolean>(false);
  const dragPointerIdRef = React.useRef<number | null>(null);
  const lastPosRef = React.useRef<{ x: number; y: number } | null>(null);
  const pointersRef = React.useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = React.useRef<{ startDistance: number; startScale: number } | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);
  const clampOffset = (nx: number, ny: number, nextScale?: number) => {
    const s = typeof nextScale === 'number' ? nextScale : scale;
    const el = contentRef.current;
    if (!el) return { x: nx, y: ny };
    const w = el.clientWidth;
    const h = el.clientHeight;
    const maxX = (w * (s - 1)) / 2;
    const maxY = (h * (s - 1)) / 2;
    return { x: clamp(nx, -maxX, maxX), y: clamp(ny, -maxY, maxY) };
  };

  const toggleZoom = () => {
    if (mode === 'fit') {
      const nextScale = 1.6;
      setMode('zoom');
      setScale(nextScale);
      setOffset(clampOffset(offset.x, offset.y, nextScale));
    } else {
      setMode('fit');
      setScale(1);
      setOffset({ x: 0, y: 0 });
      draggingRef.current = false;
      lastPosRef.current = null;
    }
  };

  const onWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    if (mode !== 'zoom') return;
    e.preventDefault();
    const delta = e.deltaY;
    const factor = delta > 0 ? 0.92 : 1.08; // smooth zoom steps
    const next = clamp(scale * factor, 1, 6);
    setScale(next);
    setOffset((prev) => clampOffset(prev.x, prev.y, next));
  };

  const onPointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (mode !== 'zoom') return;
    const t = e.target as HTMLElement | null;
    if (t && t.closest('button')) return;
    if (e.pointerType === 'touch') {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
      if (pointersRef.current.size >= 2) {
        const pts = Array.from(pointersRef.current.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const d = Math.hypot(dx, dy);
        pinchRef.current = { startDistance: Math.max(1, d), startScale: scale };
        draggingRef.current = false;
        setDragging(false);
        dragPointerIdRef.current = null;
        lastPosRef.current = null;
        return;
      }
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragPointerIdRef.current = e.pointerId;
    draggingRef.current = true;
    setDragging(true);
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  };

  const onPointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (mode !== 'zoom') return;
    if (e.pointerType === 'touch') {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size >= 2) {
        e.preventDefault();
        const pts = Array.from(pointersRef.current.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const start = pinchRef.current || { startDistance: d, startScale: scale };
        if (!pinchRef.current) pinchRef.current = start;
        const next = clamp(start.startScale * (d / Math.max(1, start.startDistance)), 1, 6);
        setScale(next);
        setOffset((prev) => clampOffset(prev.x, prev.y, next));
        return;
      }
      // pinch ended; refresh baseline for one-finger drag
      pinchRef.current = null;
    }
    if (!draggingRef.current) return;
    if (dragPointerIdRef.current != null && e.pointerId !== dragPointerIdRef.current) return;
    if (e.pointerType === 'mouse' && (e.buttons & 1) !== 1) {
      draggingRef.current = false;
      setDragging(false);
      dragPointerIdRef.current = null;
      lastPosRef.current = null;
      return;
    }
    const last = lastPosRef.current;
    if (!last) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    setOffset((prev) => clampOffset(prev.x + dx, prev.y + dy));
  };

  const endDrag = React.useCallback(() => {
    draggingRef.current = false;
    setDragging(false);
    dragPointerIdRef.current = null;
    lastPosRef.current = null;
    pinchRef.current = null;
  }, []);

  const onPointerUpOrCancel: React.PointerEventHandler<HTMLDivElement> = (e) => {
    try { pointersRef.current.delete(e.pointerId); } catch {}
    if (pointersRef.current.size < 2) pinchRef.current = null;
    endDrag();
  };

  const content = (
    <div
      className="lightbox-backdrop"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}
    >
      <div
        className="lightbox-content"
        ref={contentRef}
        onClick={(e) => {
          e.stopPropagation();
          if (mode === 'fit') toggleZoom();
        }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUpOrCancel}
        onPointerCancel={onPointerUpOrCancel}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') endDrag();
        }}
        style={{ width: '96vw', height: '92vh', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: mode === 'fit' ? 'zoom-in' : (dragging ? 'grabbing' : 'grab') }}
      >
        <img
          src={url}
          alt="full view"
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 8, display: 'block', transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transition: dragging ? 'none' : 'transform 120ms ease', userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none' }}
        />
        {/* Controls: show in zoom mode */}
        {mode === 'zoom' && (
          <div className="lightbox-controls lightbox-controls-left" onClick={(e) => e.stopPropagation()}>
            <button className="btn lightbox-control-btn" aria-label="Zoom in" onClick={() => { const next = clamp(scale * 1.12, 1, 6); setScale(next); setOffset((prev) => clampOffset(prev.x, prev.y, next)); }}>＋</button>
            <button className="btn lightbox-control-btn" aria-label="Zoom out" onClick={() => { const next = clamp(scale / 1.12, 1, 6); setScale(next); setOffset((prev) => clampOffset(prev.x, prev.y, next)); }}>－</button>
            <button className="btn lightbox-control-btn" aria-label="Reset" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); setMode('fit'); }}>Reset</button>
          </div>
        )}
        <div className="lightbox-controls lightbox-controls-right" onClick={(e) => e.stopPropagation()}>
          <button
            className="btn lightbox-control-btn lightbox-close-btn"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            aria-label="Close"
          >
            ✕ Close
          </button>
        </div>
      </div>
    </div>
  );
  if (typeof document !== 'undefined') return createPortal(content, document.body);
  return content;
}
