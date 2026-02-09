import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function MenuIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="more-item__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        {children}
      </svg>
    </span>
  );
}

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
  const [isSheet, setIsSheet] = useState(false);

  useLayoutEffect(() => {
    const decide = () => {
      try {
        const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        const narrow = window.innerWidth <= 760;
        setIsSheet(!!(coarse || narrow));
      } catch {
        setIsSheet(window.innerWidth <= 760);
      }
    };
    decide();
    window.addEventListener('resize', decide);
    return () => window.removeEventListener('resize', decide);
  }, []);

  useLayoutEffect(() => {
    const anchor = anchorRef?.current;
    const node = rootRef.current;
    if (!node) return;

    if (isSheet) {
      setStyle({
        position: 'fixed',
        left: 8,
        right: 8,
        bottom: 8,
        top: 'auto',
        visibility: 'visible',
        zIndex: 10000,
      });
      return;
    }

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
  }, [anchorRef, isSheet]);

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
    <>
      {isSheet && (
        <div
          className="more-menu-backdrop"
          role="presentation"
          onPointerDown={onClose}
          onMouseDown={onClose}
        />
      )}
      <div
        ref={rootRef}
        className={`more-menu${isSheet ? ' more-menu--sheet' : ''}`}
        style={style}
        role="menu"
        aria-label="More options"
      >
      <button
        type="button"
        className="more-item more-item--danger"
        role="menuitem"
        onClick={() => { onDiscard(); onClose(); }}
      >
        <MenuIcon>
          <path d="M9 3h6l1 2h4a1 1 0 1 1 0 2h-1l-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7H4a1 1 0 1 1 0-2h4l1-2Zm1.2 2h3.6l-.5-1h-2.6l-.5 1ZM7 7l1 13h8l1-13H7Z" />
        </MenuIcon>
        <span className="more-item__label">Discard</span>
      </button>
      </div>
    </>
  );

  return createPortal(node, document.body);
}
