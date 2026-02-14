import React from 'react';

type Point = { x: number; y: number };

export default function AvatarCropModal({
  open,
  imageSrc,
  title = 'Crop image',
  onCancel,
  onApply,
}: {
  open: boolean;
  imageSrc: string | null;
  title?: string;
  onCancel: () => void;
  onApply: (dataUrl: string) => void;
}) {
  const frameRef = React.useRef<HTMLDivElement | null>(null);
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [pos, setPos] = React.useState<Point>({ x: 0, y: 0 });
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);
  const [frameSize, setFrameSize] = React.useState(280);
  const dragRef = React.useRef<{ active: boolean; pointerId?: number; sx: number; sy: number; ox: number; oy: number }>({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 });

  React.useEffect(() => {
    if (!open) return;
    setZoom(1);
    setPos({ x: 0, y: 0 });
    setNatural(null);
  }, [open, imageSrc]);

  React.useEffect(() => {
    if (!open) return;
    const recalc = () => {
      try {
        const r = frameRef.current?.getBoundingClientRect();
        if (r) setFrameSize(Math.max(180, Math.round(Math.min(r.width, r.height))));
      } catch {}
    };
    recalc();
    window.addEventListener('resize', recalc);
    return () => window.removeEventListener('resize', recalc);
  }, [open]);

  const fitted = React.useMemo(() => {
    if (!natural) return { w: frameSize, h: frameSize, scale: 1 };
    const fit = Math.max(frameSize / Math.max(1, natural.w), frameSize / Math.max(1, natural.h));
    return { w: natural.w * fit, h: natural.h * fit, scale: fit };
  }, [natural, frameSize]);

  const zoomed = React.useMemo(() => ({ w: fitted.w * zoom, h: fitted.h * zoom }), [fitted.w, fitted.h, zoom]);

  function clampPoint(p: Point): Point {
    const maxX = Math.max(0, (zoomed.w - frameSize) / 2);
    const maxY = Math.max(0, (zoomed.h - frameSize) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, p.x)),
      y: Math.max(-maxY, Math.min(maxY, p.y)),
    };
  }

  React.useEffect(() => {
    setPos((prev) => clampPoint(prev));
  }, [zoom, frameSize, zoomed.w, zoomed.h]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    try { e.preventDefault(); } catch {}
    dragRef.current = { active: true, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d.active) return;
    try { e.preventDefault(); } catch {}
    const nx = d.ox + (e.clientX - d.sx);
    const ny = d.oy + (e.clientY - d.sy);
    setPos(clampPoint({ x: nx, y: ny }));
  }

  function endDrag(e?: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d.active) return;
    dragRef.current.active = false;
    try {
      if (e && typeof d.pointerId === 'number') {
        (e.currentTarget as HTMLElement).releasePointerCapture(d.pointerId);
      }
    } catch {}
  }

  async function applyCrop() {
    try {
      const img = imgRef.current;
      if (!img || !natural) return;

      const displayW = zoomed.w;
      const displayH = zoomed.h;
      const imgLeft = (frameSize - displayW) / 2 + pos.x;
      const imgTop = (frameSize - displayH) / 2 + pos.y;

      const sx = Math.max(0, (0 - imgLeft) * (natural.w / displayW));
      const sy = Math.max(0, (0 - imgTop) * (natural.h / displayH));
      const sw = Math.min(natural.w - sx, frameSize * (natural.w / displayW));
      const sh = Math.min(natural.h - sy, frameSize * (natural.h / displayH));

      const out = 512;
      const canvas = document.createElement('canvas');
      canvas.width = out;
      canvas.height = out;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, out, out);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      onApply(dataUrl);
    } catch (err) {
      console.error('Avatar crop failed', err);
      window.alert('Failed to crop image');
    }
  }

  if (!open || !imageSrc) return null;

  return (
    <div className="image-dialog-backdrop avatar-crop-backdrop" onClick={onCancel}>
      <div className="image-dialog avatar-crop-dialog" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <strong>{title}</strong>
          <button className="icon-close" onClick={onCancel}>✕</button>
        </div>

        <div className="avatar-crop-body">
          <div
            ref={frameRef}
            className="avatar-crop-frame"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <img
              ref={imgRef}
              src={imageSrc}
              alt="Crop preview"
              draggable={false}
              onLoad={(e) => {
                const el = e.currentTarget;
                setNatural({ w: Math.max(1, el.naturalWidth), h: Math.max(1, el.naturalHeight) });
              }}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: `${Math.round(zoomed.w)}px`,
                height: `${Math.round(zoomed.h)}px`,
                transform: `translate(calc(-50% + ${Math.round(pos.x)}px), calc(-50% + ${Math.round(pos.y)}px))`,
                userSelect: 'none',
                WebkitUserSelect: 'none',
                pointerEvents: 'none',
                touchAction: 'none',
              }}
            />
            <div className="avatar-crop-mask" />
          </div>

          <div className="avatar-crop-zoom-row">
            <span>Zoom</span>
            <input
              aria-label="Avatar zoom"
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            <span>{zoom.toFixed(2)}x</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn" onClick={applyCrop}>Apply</button>
        </div>
      </div>
    </div>
  );
}
