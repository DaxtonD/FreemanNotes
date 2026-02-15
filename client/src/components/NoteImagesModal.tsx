import React from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../authContext';
import ConfirmDialog from './ConfirmDialog';
import ImageLightbox from './ImageLightbox';

export default function NoteImagesModal({
  noteId,
  initialImages,
  onClose,
  onImagesChanged,
}: {
  noteId: number;
  initialImages: Array<{ id: number; url: string }>;
  onClose: () => void;
  onImagesChanged?: (next: Array<{ id: number; url: string }>) => void;
}) {
  const { token } = useAuth();
  const [images, setImages] = React.useState<Array<{ id: number; url: string }>>(Array.isArray(initialImages) ? initialImages : []);
  const [loading, setLoading] = React.useState(false);
  const [confirmImageDeleteId, setConfirmImageDeleteId] = React.useState<number | null>(null);
  const [lightboxUrl, setLightboxUrl] = React.useState<string | null>(null);
  const onCloseRef = React.useRef(onClose);
  const onImagesChangedRef = React.useRef<typeof onImagesChanged>(onImagesChanged);

  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    onImagesChangedRef.current = onImagesChanged;
  }, [onImagesChanged]);

  const isCoarsePointer = React.useMemo(() => {
    try {
      return !!(window.matchMedia && (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: coarse)').matches));
    } catch {
      return false;
    }
  }, []);

  const imageLongPressTimerRef = React.useRef<number | null>(null);
  const imageLongPressStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const suppressNextImageClickRef = React.useRef(false);
  const backIdRef = React.useRef<string>((() => {
    try { return `nim-${noteId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; } catch { return `nim-${Math.random()}`; }
  })());

  const clearImageLongPress = React.useCallback(() => {
    if (imageLongPressTimerRef.current != null) {
      window.clearTimeout(imageLongPressTimerRef.current);
      imageLongPressTimerRef.current = null;
    }
    imageLongPressStartRef.current = null;
  }, []);

  const refreshImages = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/notes/${noteId}/images`, {
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
      if (!res.ok) return;
      const data = await res.json();
      const next = (Array.isArray(data?.images) ? data.images : [])
        .filter((img: any) => img && typeof img.url === 'string')
        .map((img: any) => ({ id: Number(img.id), url: String(img.url) }));
      setImages(next);
      try { onImagesChangedRef.current && onImagesChangedRef.current(next); } catch {}
    } catch {
      // ignore fetch errors in modal
    } finally {
      setLoading(false);
    }
  }, [noteId, token]);

  const performDeleteImage = React.useCallback(async (imageId: number) => {
    try {
      const res = await fetch(`/api/notes/${noteId}/images/${imageId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
      });
      if (!res.ok) throw new Error(await res.text());
      setImages((prev) => {
        const next = prev.filter((img) => Number(img.id) !== Number(imageId));
        try { onImagesChangedRef.current && onImagesChangedRef.current(next); } catch {}
        return next;
      });
    } catch (err) {
      console.error('Failed to delete image', err);
      window.alert('Failed to delete image');
    }
  }, [noteId, token]);

  React.useEffect(() => {
    setImages(Array.isArray(initialImages) ? initialImages : []);
  }, [initialImages]);

  React.useEffect(() => {
    window.dispatchEvent(new Event('freemannotes:editor-modal-open'));
    try {
      const id = backIdRef.current;
      const onBack = () => { try { onCloseRef.current?.(); } catch {} };
      window.dispatchEvent(new CustomEvent('freemannotes:back/register', { detail: { id, onBack } }));
    } catch {}
    void refreshImages();
    return () => {
      try { window.dispatchEvent(new CustomEvent('freemannotes:back/unregister', { detail: { id: backIdRef.current } })); } catch {}
      window.dispatchEvent(new Event('freemannotes:editor-modal-close'));
      clearImageLongPress();
    };
  }, [refreshImages, clearImageLongPress]);

  const content = (
    <>
      <div
        className="note-images-modal-backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="note-images-modal" role="dialog" aria-modal="true" aria-label="Note images" onMouseDown={(e) => e.stopPropagation()}>
          <div className="note-images-modal__header">
            <strong>Images ({images.length})</strong>
            <button className="icon-close" onClick={onClose} aria-label="Close images">✕</button>
          </div>

          <div className="note-images-modal__body">
            {loading && images.length === 0 ? (
              <div className="note-images-modal__empty">Loading images…</div>
            ) : images.length === 0 ? (
              <div className="note-images-modal__empty">No images</div>
            ) : (
              <div className="note-images-modal__grid">
                {images.map((img) => (
                  <div
                    key={img.id}
                    className="note-images-modal__tile"
                    role="button"
                    tabIndex={0}
                    onContextMenu={(e) => {
                      if (!isCoarsePointer) return;
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={() => {
                      if (suppressNextImageClickRef.current) {
                        suppressNextImageClickRef.current = false;
                        return;
                      }
                      setLightboxUrl(img.url);
                    }}
                    onPointerDown={(e) => {
                      if (!isCoarsePointer) return;
                      if (e.pointerType && e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
                      e.preventDefault();
                      clearImageLongPress();
                      imageLongPressStartRef.current = { x: e.clientX, y: e.clientY };
                      imageLongPressTimerRef.current = window.setTimeout(() => {
                        suppressNextImageClickRef.current = true;
                        clearImageLongPress();
                        setConfirmImageDeleteId(Number(img.id));
                      }, 520);
                    }}
                    onPointerMove={(e) => {
                      if (!isCoarsePointer) return;
                      const start = imageLongPressStartRef.current;
                      if (!start) return;
                      if (Math.abs(e.clientX - start.x) > 10 || Math.abs(e.clientY - start.y) > 10) {
                        clearImageLongPress();
                      }
                    }}
                    onPointerUp={() => clearImageLongPress()}
                    onPointerCancel={() => clearImageLongPress()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setLightboxUrl(img.url);
                      }
                    }}
                  >
                    <img src={img.url} alt="note image" loading="lazy" draggable={false} />
                    <button
                      className="image-delete"
                      aria-label="Delete image"
                      title="Delete image"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmImageDeleteId(Number(img.id));
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmImageDeleteId != null}
        title={'Delete image'}
        message={'Are you sure you want to delete this image?'}
        confirmLabel={'Delete'}
        cancelLabel={'Cancel'}
        danger
        onCancel={() => setConfirmImageDeleteId(null)}
        onConfirm={() => {
          const id = confirmImageDeleteId;
          setConfirmImageDeleteId(null);
          if (typeof id === 'number') void performDeleteImage(id);
        }}
      />

      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </>
  );

  if (typeof document !== 'undefined') return createPortal(content, document.body);
  return content;
}
