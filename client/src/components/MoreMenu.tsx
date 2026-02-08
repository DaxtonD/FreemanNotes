import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function MoreMenu({
  anchorRef,
  anchorPoint, // optional click coordinate { x, y }
  itemsCount = 4,
  onClose,
  onDelete,
  onMoveToCollection,
  onAddLabel,
  onUncheckAll,
  onCheckAll,
  onSetWidth
}: {
  anchorRef?: React.RefObject<HTMLElement | null>;
  anchorPoint?: { x: number; y: number } | null;
  itemsCount?: number;
  onClose: () => void;
  onDelete: () => void;
  onMoveToCollection?: () => void;
  onAddLabel: () => void;
  onUncheckAll?: () => void;
  onCheckAll?: () => void;
  onSetWidth: (span: 1 | 2 | 3) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ position: "fixed", visibility: "hidden", left: 0, top: 0, zIndex: 10000 });

  useLayoutEffect(() => {
    const anchor = anchorRef?.current;
    const node = rootRef.current;
    if (!node) return;

    const viewportPadding = 8;
    const measure = () => {
      // Temporarily ensure auto sizing to measure natural content box
      node.style.width = 'auto';
      node.style.height = 'auto';
      const w = Math.ceil(node.offsetWidth);
      const h = Math.ceil(node.offsetHeight);
      return { w, h };
    };

    // If a click point was provided, position bottom-right of popup at the click point.
    // Ignore click point: always anchor at bottom-right of the note card

    // Fallbacks: if no anchor, use click point; if none, use viewport bottom-right
    if (!anchor) {
      const { w, h } = measure();
      let left: number;
      let top: number;
      if (anchorPoint) {
        left = Math.round(anchorPoint.x - w);
        top = Math.round(anchorPoint.y - h);
      } else {
        left = Math.round(window.innerWidth - w - viewportPadding);
        top = Math.round(window.innerHeight - h - viewportPadding);
      }
      // clamp
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
      // Place bottom-right corner at the card's bottom-right
      let left = Math.round(rect.right - w);
      let top = Math.round(rect.bottom - h);
      // Clamp to viewport with small padding
      if (left < viewportPadding) left = viewportPadding;
      if (left + w > window.innerWidth - viewportPadding) left = Math.max(viewportPadding, window.innerWidth - w - viewportPadding);
      if (top < viewportPadding) top = viewportPadding;
      if (top + h > window.innerHeight - viewportPadding) top = Math.max(viewportPadding, window.innerHeight - h - viewportPadding);
      setStyle({ position: 'fixed', left, top, visibility: 'visible', zIndex: 10000, width: `${w}px`, height: `${h}px` });
    });
  }, [anchorRef, anchorPoint, itemsCount]);

  useLayoutEffect(() => {
    function onDoc(e: Event) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [onClose]);

  const node = (
    <div ref={rootRef} className="more-menu" style={style} role="dialog" aria-label="More options">
      <button className="more-item" onClick={() => { onDelete(); onClose(); }}>Delete</button>
      {onMoveToCollection && (
        <button className="more-item" onClick={() => { onMoveToCollection(); onClose(); }}>Add to collection…</button>
      )}
      <button className="more-item" onClick={() => { onAddLabel(); onClose(); }}>Add label</button>
      {onUncheckAll && (
        <button className="more-item" onClick={() => { onUncheckAll(); onClose(); }}>Uncheck all</button>
      )}
      {onCheckAll && (
        <button className="more-item" onClick={() => { onCheckAll(); onClose(); }}>Check all</button>
      )}
      <hr className="more-sep" />
      <div style={{ display: 'grid', gap: 6 }}>
        <button className="more-item" onClick={() => { onSetWidth(1); onClose(); }}>Card width: Regular</button>
        <button className="more-item" onClick={() => { onSetWidth(2); onClose(); }}>Card width: Double</button>
        <button className="more-item" onClick={() => { onSetWidth(3); onClose(); }}>Card width: Triple</button>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
