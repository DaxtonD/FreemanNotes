import React from 'react';
import { createPortal } from 'react-dom';

export default function MobileAuthModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const el = (
    <div className="auth-mobile-backdrop" onClick={onClose}>
      <div className="auth-mobile-sheet" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <div className="auth-mobile-header">
          <strong>{title}</strong>
          <button className="icon-close" onClick={onClose}>✕</button>
        </div>
        <div className="auth-mobile-body">{children}</div>
      </div>
    </div>
  );

  try {
    return createPortal(el, document.body);
  } catch {
    return el;
  }
}
