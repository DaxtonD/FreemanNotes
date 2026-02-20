import React from 'react';
import { createPortal } from 'react-dom';

export type MediaView = 'images' | 'urlPreviews';

export default function MediaSheet({
  open,
  onClose,
  activeView,
  onChangeView,
  imageCount,
  urlPreviewCount,
  children,
}: {
  open: boolean;
  onClose: () => void;
  activeView: MediaView;
  onChangeView: (next: MediaView) => void;
  imageCount: number;
  urlPreviewCount: number;
  children: {
    images: React.ReactNode;
    urlPreviews: React.ReactNode;
  };
}) {
  const [isMobileLayout, setIsMobileLayout] = React.useState<boolean>(() => {
    try {
      if (typeof window === 'undefined') return false;
      return window.matchMedia('(max-width: 900px), (pointer: coarse), (any-pointer: coarse)').matches;
    } catch {
      return false;
    }
  });
  const [dragX, setDragX] = React.useState(0);
  const [isSwiping, setIsSwiping] = React.useState(false);
  const [sheetDragY, setSheetDragY] = React.useState(0);
  const [animDirection, setAnimDirection] = React.useState<1 | -1>(activeView === 'images' ? -1 : 1);
  const swipeStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const sheetStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const lastViewRef = React.useRef<MediaView>(activeView);

  React.useEffect(() => {
    if (!open) return;
    const onResize = () => {
      try {
        setIsMobileLayout(window.matchMedia('(max-width: 900px), (pointer: coarse), (any-pointer: coarse)').matches);
      } catch {}
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const previous = lastViewRef.current;
    if (previous !== activeView) {
      setAnimDirection(previous === 'images' ? 1 : -1);
      lastViewRef.current = activeView;
    }
  }, [activeView, open]);

  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onEsc);
    };
  }, [open, onClose]);

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileLayout) return;
    const t = e.touches?.[0];
    if (!t) return;
    swipeStartRef.current = { x: t.clientX, y: t.clientY };
    setIsSwiping(true);
  };

  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileLayout || !isSwiping || !swipeStartRef.current) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dx = t.clientX - swipeStartRef.current.x;
    const dy = t.clientY - swipeStartRef.current.y;
    if (Math.abs(dy) > Math.abs(dx) * 1.15) {
      setIsSwiping(false);
      setDragX(0);
      swipeStartRef.current = null;
      return;
    }
    setDragX(Math.max(-120, Math.min(120, dx)));
  };

  const onTouchEnd = () => {
    if (!isMobileLayout) return;
    const threshold = 54;
    if (dragX <= -threshold && activeView === 'images' && urlPreviewCount > 0) {
      setAnimDirection(1);
      onChangeView('urlPreviews');
    } else if (dragX >= threshold && activeView === 'urlPreviews' && imageCount > 0) {
      setAnimDirection(-1);
      onChangeView('images');
    }
    setDragX(0);
    setIsSwiping(false);
    swipeStartRef.current = null;
  };

  const onSheetHandleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileLayout) return;
    const t = e.touches?.[0];
    if (!t) return;
    sheetStartRef.current = { x: t.clientX, y: t.clientY };
    setSheetDragY(0);
  };

  const onSheetHandleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileLayout) return;
    const st = sheetStartRef.current;
    if (!st) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dx = t.clientX - st.x;
    const dy = t.clientY - st.y;
    if (Math.abs(dx) > Math.abs(dy) * 1.2) return;
    if (dy > 0) {
      try { e.preventDefault(); } catch {}
      setSheetDragY(Math.min(160, dy));
    } else {
      setSheetDragY(0);
    }
  };

  const onSheetHandleTouchEnd = () => {
    if (!isMobileLayout) return;
    if (sheetDragY >= 56) onClose();
    setSheetDragY(0);
    sheetStartRef.current = null;
  };

  if (!open || typeof document === 'undefined') return null;

  const hasImages = imageCount > 0;
  const hasUrls = urlPreviewCount > 0;

  return createPortal(
    <div className="media-sheet-layer" role="presentation">
      <div className="media-sheet-backdrop" onMouseDown={onClose} />
      <div
        className={`media-sheet${isMobileLayout ? ' media-sheet--mobile' : ' media-sheet--desktop'} media-sheet--${activeView}`}
        role="dialog"
        aria-modal="true"
        aria-label="Media"
        onMouseDown={(e) => e.stopPropagation()}
        style={isMobileLayout && sheetDragY > 0 ? { transform: `translateY(${Math.round(sheetDragY)}px)` } : undefined}
      >
        {isMobileLayout && (
          <div
            className="media-sheet__grab"
            role="button"
            aria-label="Drag down to close media"
            onTouchStart={onSheetHandleTouchStart}
            onTouchMove={onSheetHandleTouchMove}
            onTouchEnd={onSheetHandleTouchEnd}
            onTouchCancel={onSheetHandleTouchEnd}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span className="media-sheet__grabBar" aria-hidden="true" />
            <span className="media-sheet__grabLabel">Media</span>
          </div>
        )}
        <div className="media-sheet__header">
          <div className="media-sheet__tabs" role="tablist" aria-label="Media sections">
            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'images'}
              className={`media-sheet__tab${activeView === 'images' ? ' is-active' : ''}`}
              onClick={() => { if (hasImages) { setAnimDirection(activeView === 'urlPreviews' ? -1 : 1); onChangeView('images'); } }}
              disabled={!hasImages}
            >
              Images ({imageCount})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'urlPreviews'}
              className={`media-sheet__tab${activeView === 'urlPreviews' ? ' is-active' : ''}`}
              onClick={() => { if (hasUrls) { setAnimDirection(activeView === 'images' ? 1 : -1); onChangeView('urlPreviews'); } }}
              disabled={!hasUrls}
            >
              URL previews ({urlPreviewCount})
            </button>
          </div>
          <button type="button" className="icon-close" onClick={onClose} aria-label="Close media">✕</button>
        </div>

        <div
          className="media-sheet__viewport"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        >
          <div
            className={`media-sheet__track media-sheet__track--${animDirection > 0 ? 'forward' : 'backward'}${isSwiping ? ' is-swiping' : ''}`}
            style={{ transform: `translateX(calc(${activeView === 'images' ? '0%' : '-50%'} + ${dragX}px))` }}
          >
            <section className="media-sheet__panel" aria-hidden={activeView !== 'images'}>
              {children.images}
            </section>
            <section className="media-sheet__panel" aria-hidden={activeView !== 'urlPreviews'}>
              {children.urlPreviews}
            </section>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
