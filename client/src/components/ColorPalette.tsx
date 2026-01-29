import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const PALETTE = [
  "", // default
  // light accents
  "#ffffff", "#fff9c4", "#fffde7", "#fff8e1", "#fff3e0", "#fff1f0", "#fff0f6",
  "#f5f5f5", "#f0f0f0", "#f3e5f5", "#fce4ec", "#e3f2fd", "#e8f5e9", "#f9fbe7",
  // mid tones
  "#fff3b0", "#ffd7a6", "#ffccbc", "#f8bbd0", "#e1bee7", "#b3e5fc",
  // darker tones
  "#ffe082", "#ffb74d", "#ff8a65", "#f06292", "#ba68c8", "#4fc3f7",
  "#c8e6c9", "#a5d6a7",
  // dark backgrounds
  "#2b2b2b", "#1f2933", "#121212", "#263238", "#37474f", "#212121"
];

export default function ColorPalette({
  anchorRef,
  onPick,
  onClose
}: {
  anchorRef?: React.RefObject<HTMLElement | null>;
  onPick: (c: string) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden", position: "fixed", top: 0, left: 0 });

  useLayoutEffect(() => {
    const anchor = anchorRef && anchorRef.current;
    const pop = rootRef.current;
    if (!anchor || !pop) {
      // center fallback
      const left = Math.max(8, (window.innerWidth - pop!.offsetWidth) / 2);
      const top = Math.max(8, (window.innerHeight - pop!.offsetHeight) / 2);
      setStyle(prev => ({ ...prev, left, top, visibility: "visible" }));
      return;
    }

    // measure
    const rect = anchor.getBoundingClientRect();

    // set hidden first so offsetWidth/Height available
    setStyle(prev => ({ ...prev, visibility: "hidden" }));

    requestAnimationFrame(() => {
      const pw = pop.offsetWidth;
      const ph = pop.offsetHeight;
      const gap = 8;
      let left = rect.left;
      // prefer aligning right edge of pop to anchor right if it would overflow
      if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
      // prefer slightly inset
      left = Math.max(8, left);

      // try below
      let top = rect.bottom + gap;
      if (top + ph > window.innerHeight - 8) {
        // not enough space below, place above
        top = rect.top - ph - gap;
        if (top < 8) {
          // clamp to viewport
          top = Math.max(8, window.innerHeight - ph - 8);
        }
      }
      setStyle({ position: "fixed", top, left, visibility: "visible", zIndex: 200 });
    });
  }, [anchorRef]);

  // close when clicking outside
  useLayoutEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  const node = (
    <div ref={rootRef} className="palette-popover" style={style}>
      <div className="palette-grid">
        {PALETTE.map((c, i) => (
          <button
            key={i}
            className="palette-swatch"
            onClick={() => { onPick(c); }}
            style={{ background: c || "var(--card)" }}
            title={c || "Default"}
            aria-label={c || "Default color"}
          />
        ))}
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
