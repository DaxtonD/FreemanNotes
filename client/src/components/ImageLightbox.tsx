import React from 'react';
import { createPortal } from 'react-dom';

export default function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = React.useState<'fit' | 'zoom'>('fit');
  const [scale, setScale] = React.useState<number>(1);
  const [offset, setOffset] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const draggingRef = React.useRef<boolean>(false);
  const lastPosRef = React.useRef<{ x: number; y: number } | null>(null);

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

  const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (mode !== 'zoom') { return; }
    if (e.button !== 0) return; // left button only
    draggingRef.current = true;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
  };
  const onMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!draggingRef.current || mode !== 'zoom') return;
    const last = lastPosRef.current; if (!last) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    setOffset((prev) => clampOffset(prev.x + dx, prev.y + dy));
  };
  const endDrag = () => { draggingRef.current = false; lastPosRef.current = null; };

  const content = (
    <div
      className="lightbox-backdrop"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}
    >
      <div
        className="lightbox-content"
        ref={contentRef}
        onClick={(e) => { e.stopPropagation(); toggleZoom(); }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        style={{ width: '96vw', height: '92vh', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: mode === 'fit' ? 'zoom-in' : (draggingRef.current ? 'grabbing' : 'grab') }}
      >
        <img
          src={url}
          alt="full view"
          style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 8, display: 'block', transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transition: draggingRef.current ? 'none' : 'transform 120ms ease' }}
        />
        {/* Controls: show in zoom mode */}
        {mode === 'zoom' && (
          <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
            <button className="btn" aria-label="Zoom in" onClick={() => { const next = clamp(scale * 1.12, 1, 6); setScale(next); setOffset((prev) => clampOffset(prev.x, prev.y, next)); }}>＋</button>
            <button className="btn" aria-label="Zoom out" onClick={() => { const next = clamp(scale / 1.12, 1, 6); setScale(next); setOffset((prev) => clampOffset(prev.x, prev.y, next)); }}>－</button>
            <button className="btn" aria-label="Reset" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); setMode('fit'); }}>Reset</button>
          </div>
        )}
        <button
          className="btn"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{ position: 'absolute', top: 10, right: 10 }}
          aria-label="Close"
        >
          Close
        </button>
      </div>
    </div>
  );
  if (typeof document !== 'undefined') return createPortal(content, document.body);
  return content;
}
