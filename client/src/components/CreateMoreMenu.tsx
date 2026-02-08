import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function CreateMoreMenu({
  anchorRef,
  onClose,
  onDiscard,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onDiscard: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', visibility: 'hidden', left: 0, top: 0, zIndex: 10000 });

  useLayoutEffect(() => {
    const anchor = anchorRef?.current;
    const node = rootRef.current;
    if (!node) return;

    const viewportPadding = 8;
    const measure = () => {
      node.style.width = 'auto';
      node.style.height = 'auto';
      const w = Math.ceil(node.offsetWidth);
      const h = Math.ceil(node.offsetHeight);
      return { w, h };
    };

    if (!anchor) {
      const { w, h } = measure();
      let left = Math.round(window.innerWidth - w - viewportPadding);
      let top = Math.round(window.innerHeight - h - viewportPadding);
      if (left < viewportPadding) left = viewportPadding;
      if (left + w > window.innerWidth - viewportPadding) left = Math.max(viewportPadding, window.innerWidth - w - viewportPadding);
      if (top < viewportPadding) top = viewportPadding;
      if (top + h > window.innerHeight - viewportPadding) top = Math.max(viewportPadding, window.innerHeight - h - viewportPadding);
      setStyle({ position: 'fixed', left, top, visibility: 'visible', zIndex: 10000, width: `${w}px`, height: `${h}px` });
      return;
    }

    const rect = anchor.getBoundingClientRect();
    requestAnimationFrame(() => {
      const { w, h } = measure();
      let left = Math.round(rect.right - w);
      let top = Math.round(rect.bottom - h);
      if (left < viewportPadding) left = viewportPadding;
      if (left + w > window.innerWidth - viewportPadding) left = Math.max(viewportPadding, window.innerWidth - w - viewportPadding);
      if (top < viewportPadding) top = viewportPadding;
      if (top + h > window.innerHeight - viewportPadding) top = Math.max(viewportPadding, window.innerHeight - h - viewportPadding);
      setStyle({ position: 'fixed', left, top, visibility: 'visible', zIndex: 10000, width: `${w}px`, height: `${h}px` });
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    function onDoc(e: Event) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('mousedown', onDoc);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [onClose]);

  const node = (
    <div ref={rootRef} className="more-menu" style={style} role="dialog" aria-label="More options">
      <button className="more-item" onClick={() => { onDiscard(); onClose(); }}>Discard</button>
    </div>
  );

  return createPortal(node, document.body);
}
