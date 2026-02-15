import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function MenuIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="more-item__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        {children}
      </svg>
    </span>
  );
}

function MenuItem({
  label,
  icon,
  onClick,
  danger,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`more-item${danger ? " more-item--danger" : ""}`}
      role="menuitem"
      onClick={onClick}
    >
      {icon}
      <span className="more-item__label">{label}</span>
    </button>
  );
}

export default function MoreMenu({
  anchorRef,
  anchorPoint, // optional click coordinate { x, y }
  itemsCount = 4,
  pinned,
  onAddCollaborator,
  onAddImage,
  onAddReminder,
  onTogglePin,
  onClose,
  onDelete,
  deleteLabel,
  onRestore,
  restoreLabel,
  onMoveToCollection,
  onAddLabel,
  onUncheckAll,
  onCheckAll,
  onSetWidth
}: {
  anchorRef?: React.RefObject<HTMLElement | null>;
  anchorPoint?: { x: number; y: number } | null;
  itemsCount?: number;
  pinned?: boolean;
  onAddCollaborator?: () => void;
  onAddImage?: () => void;
  onAddReminder?: () => void;
  onTogglePin?: () => void;
  onClose: () => void;
  onDelete: () => void;
  deleteLabel?: string;
  onRestore?: () => void;
  restoreLabel?: string;
  onMoveToCollection?: () => void;
  onAddLabel?: () => void;
  onUncheckAll?: () => void;
  onCheckAll?: () => void;
  onSetWidth?: (span: 1 | 2 | 3) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ position: "fixed", visibility: "hidden", left: 0, top: 0, zIndex: 10001 });
  const [isSheet, setIsSheet] = useState(false);
  const [interactionLocked, setInteractionLocked] = useState(true);
  const openedAtRef = useRef<number>(Date.now());
  const backIdRef = useRef<string>((() => {
    try { return `more-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; } catch { return `more-${Math.random()}`; }
  })());
  const mountAtRef = useRef<number>(Date.now());

  useEffect(() => {
    openedAtRef.current = Date.now();
    setInteractionLocked(true);
    const ms = isSheet ? 700 : 260;
    const t = window.setTimeout(() => {
      try { setInteractionLocked(false); } catch {}
    }, ms);
    try {
      const id = backIdRef.current;
      const onBack = () => { try { onClose(); } catch {} };
      window.dispatchEvent(new CustomEvent('freemannotes:back/register', { detail: { id, onBack } }));
      return () => {
        try { window.clearTimeout(t); } catch {}
        try { window.dispatchEvent(new CustomEvent('freemannotes:back/unregister', { detail: { id } })); } catch {}
      };
    } catch {
      try { window.clearTimeout(t); } catch {}
      return;
    }
  }, [onClose, isSheet]);

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
      // Bottom sheet: ignore anchor/click point and stick to bottom.
      setStyle({
        position: 'fixed',
        left: 8,
        right: 8,
        bottom: 8,
        top: 'auto',
        visibility: 'visible',
        zIndex: 10001,
      });
      return;
    }

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
      setStyle({ position: 'fixed', left, top, visibility: 'visible', zIndex: 10001, width: `${w}px`, height: `${h}px` });
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
      setStyle({ position: 'fixed', left, top, visibility: 'visible', zIndex: 10001, width: `${w}px`, height: `${h}px` });
    });
  }, [anchorRef, anchorPoint, itemsCount, isSheet]);

  // Note: click-away is handled by the backdrop so underlying UI isn't clickable.

  const swallowIfOpeningGesture = (e: React.SyntheticEvent) => {
    try {
      // Guard against the same long-press gesture that opened the menu from
      // activating/highlighting an item under the finger on first release.
      if (interactionLocked || (Date.now() - openedAtRef.current) < 420) {
        (e as any).preventDefault?.();
        (e as any).stopPropagation?.();
      }
    } catch {}
  };

  const node = (
    <>
      <div
        className="more-menu-backdrop"
        role="presentation"
        onPointerDown={(e) => { try { e.preventDefault(); e.stopPropagation(); } catch {} }}
        onMouseDown={(e) => { try { e.preventDefault(); e.stopPropagation(); } catch {} }}
        onClick={(e) => {
          try { e.preventDefault(); e.stopPropagation(); } catch {}
          // Ignore immediate click events that occur within a short window after
          // the menu mounted (e.g., the finger release from the long-press that
          // opened the menu). This avoids the backdrop immediately closing the
          // menu the moment it appears.
          try {
            if (Date.now() - (mountAtRef.current || 0) < 350) return;
          } catch {}
          onClose();
        }}
        onContextMenu={(e) => { try { e.preventDefault(); e.stopPropagation(); } catch {} }}
      />
      <div
        ref={rootRef}
        className={`more-menu${isSheet ? ' more-menu--sheet' : ''}${interactionLocked ? ' more-menu--locked' : ''}`}
        style={style}
        role="menu"
        aria-label="More options"
        onPointerDownCapture={swallowIfOpeningGesture}
        onMouseDownCapture={swallowIfOpeningGesture}
        onTouchStartCapture={swallowIfOpeningGesture}
        onClickCapture={swallowIfOpeningGesture}
      >
      <div className="more-group">
        {onRestore && (
          <MenuItem
            label={restoreLabel || 'Restore'}
            icon={
              <MenuIcon>
                <path d="M12 5a7 7 0 1 1-6.65 9.2.9.9 0 1 1 1.7-.6A5.2 5.2 0 1 0 12 6.8h-.02l.9.9a.9.9 0 0 1-1.27 1.27L9.2 6.54a.9.9 0 0 1 0-1.27l2.43-2.43a.9.9 0 1 1 1.27 1.27l-.93.93H12Z" />
              </MenuIcon>
            }
            onClick={() => {
              onRestore();
              onClose();
            }}
          />
        )}

        {onTogglePin && (
          <MenuItem
            label={pinned ? 'Unpin note' : 'Pin note'}
            icon={
              <MenuIcon>
                <path d="M14 2H10v2H8v2h.17l1.12 9.05L7 17.4V20h10v-2.6l-2.29-2.35L15.83 6H16V4h-2V2Zm-1.95 4 1.15 9.3L15 17.1V18H9v-.9l1.8-1.8L11.05 6h1Z" />
              </MenuIcon>
            }
            onClick={() => {
              onTogglePin();
              onClose();
            }}
          />
        )}

        {onAddCollaborator && (
          <MenuItem
            label={'Add collaborator'}
            icon={
              <MenuIcon>
                <path d="M16 11c1.93 0 3.5-1.57 3.5-3.5S17.93 4 16 4s-3.5 1.57-3.5 3.5S14.07 11 16 11Zm-8 1c1.93 0 3.5-1.57 3.5-3.5S9.93 5 8 5 4.5 6.57 4.5 8.5 6.07 12 8 12Zm8 2c-2.22 0-4.1 1.2-5.1 3H21v-1c0-1.66-2.24-3-5-3Zm-8 1c-2.76 0-5 1.34-5 3v1h8.6c.23-1.08.7-2.07 1.37-2.9C11.9 15.7 10.08 15 8 15Z" />
                <path d="M21 11v2h-2v2h-2v-2h-2v-2h2V9h2v2h2Z" />
              </MenuIcon>
            }
            onClick={() => {
              onAddCollaborator();
              onClose();
            }}
          />
        )}

        {onAddImage && (
          <MenuItem
            label={'Add image'}
            icon={
              <MenuIcon>
                <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12H6a2 2 0 0 1-2-2V6Zm2 0v10h14V6H6Zm3 3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm-2 7 3.2-4.2 2.4 3 1.8-2.2L19 16H7Z" />
              </MenuIcon>
            }
            onClick={() => {
              onAddImage();
              onClose();
            }}
          />
        )}

        {onAddReminder && (
          <MenuItem
            label={'Add reminder'}
            icon={
              <MenuIcon>
                <path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2Z" />
                <path d="M18 8V7a6 6 0 1 0-12 0v1c0 3.5-2 5-2 5h16s-2-1.5-2-5Z" />
              </MenuIcon>
            }
            onClick={() => {
              onAddReminder();
              onClose();
            }}
          />
        )}

        <MenuItem
          label={deleteLabel || 'Delete'}
          danger
          icon={
            <MenuIcon>
              <path d="M9 3h6l1 2h4a1 1 0 1 1 0 2h-1l-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7H4a1 1 0 1 1 0-2h4l1-2Zm1.2 2h3.6l-.5-1h-2.6l-.5 1ZM7 7l1 13h8l1-13H7Zm3 3a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1Zm5 1v7a1 1 0 1 1-2 0v-7a1 1 0 1 1 2 0Z" />
            </MenuIcon>
          }
          onClick={() => {
            onDelete();
            onClose();
          }}
        />
        {onMoveToCollection && (
          <MenuItem
            label={'Add to collection…'}
            icon={
              <MenuIcon>
                <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v1H3V6Zm0 5h20v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7Zm10-1a1 1 0 0 1 1 1v1h1a1 1 0 1 1 0 2h-1v1a1 1 0 1 1-2 0v-1h-1a1 1 0 1 1 0-2h1v-1a1 1 0 0 1 1-1Z" />
              </MenuIcon>
            }
            onClick={() => {
              onMoveToCollection();
              onClose();
            }}
          />
        )}
        {onAddLabel && (
          <MenuItem
            label={'Add label'}
            icon={
              <MenuIcon>
                <path d="M3 12.2V6a3 3 0 0 1 3-3h6.2a3 3 0 0 1 2.12.88l6.8 6.8a3 3 0 0 1 0 4.24l-5.3 5.3a3 3 0 0 1-4.24 0l-6.8-6.8A3 3 0 0 1 3 12.2ZM6 5a1 1 0 0 0-1 1v6.2c0 .27.1.52.29.71l6.8 6.8a1 1 0 0 0 1.42 0l5.3-5.3a1 1 0 0 0 0-1.42l-6.8-6.8A1 1 0 0 0 12.2 5H6Zm1.5 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z" />
              </MenuIcon>
            }
            onClick={() => {
              onAddLabel();
              onClose();
            }}
          />
        )}
        {onUncheckAll && (
          <MenuItem
            label={'Uncheck all'}
            icon={
              <MenuIcon>
                <path d="M5 5h14a2 2 0 0 1 2 2v14H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v12h14V7H5Zm4 2a1 1 0 0 1 1 1v3.5l.25-.25a1 1 0 1 1 1.42 1.42l-2 2a1 1 0 0 1-1.42 0l-2-2a1 1 0 1 1 1.42-1.42l.25.25V10a1 1 0 0 1 1-1Z" />
              </MenuIcon>
            }
            onClick={() => {
              onUncheckAll();
              onClose();
            }}
          />
        )}
        {onCheckAll && (
          <MenuItem
            label={'Check all'}
            icon={
              <MenuIcon>
                <path d="M5 5h14a2 2 0 0 1 2 2v14H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v12h14V7H5Zm11.2 4.1a1 1 0 0 1 0 1.4l-4.5 4.5a1 1 0 0 1-1.4 0L8 14.7a1 1 0 1 1 1.4-1.4l1.6 1.6 3.8-3.8a1 1 0 0 1 1.4 0Z" />
              </MenuIcon>
            }
            onClick={() => {
              onCheckAll();
              onClose();
            }}
          />
        )}
      </div>

      {onSetWidth && (
        <>
          <hr className="more-sep" />

          <div className="more-group">
            <MenuItem
              label={'Card width: Regular'}
              icon={
                <MenuIcon>
                  <path d="M6 5h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v10h12V7H6Z" />
                </MenuIcon>
              }
              onClick={() => {
                onSetWidth(1);
                onClose();
              }}
            />
            <MenuItem
              label={'Card width: Double'}
              icon={
                <MenuIcon>
                  <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Zm2 0v10h5V7H6Zm7 0v10h5V7h-5Z" />
                </MenuIcon>
              }
              onClick={() => {
                onSetWidth(2);
                onClose();
              }}
            />
            <MenuItem
              label={'Card width: Triple'}
              icon={
                <MenuIcon>
                  <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Zm2 0v10h3V7H6Zm5 0v10h3V7h-3Zm5 0v10h3V7h-3Z" />
                </MenuIcon>
              }
              onClick={() => {
                onSetWidth(3);
                onClose();
              }}
            />
          </div>
        </>
      )}
      </div>
    </>
  );

  return createPortal(node, document.body);
}
