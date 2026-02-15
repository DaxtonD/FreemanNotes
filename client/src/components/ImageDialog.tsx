import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function ImageDialog({ onClose, onAdd, onAddMany }: { onClose: () => void; onAdd: (url?: string | null) => void; onAddMany?: (urls: string[]) => void }) {
  const [url, setUrl] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    window.dispatchEvent(new Event('freemannotes:editor-modal-open'));
    return () => {
      window.dispatchEvent(new Event('freemannotes:editor-modal-close'));
    };
  }, []);

  function onChooseFile() {
    fileRef.current?.click();
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).filter(Boolean);
    if (!files.length) return;
    const readAsDataUrl = (f: File) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
      reader.readAsDataURL(f);
    });
    (async () => {
      try {
        const urls = (await Promise.all(files.map((f) => readAsDataUrl(f))))
          .map((u) => String(u || ''))
          .filter((u) => !!u);
        if (!urls.length) return;
        if (onAddMany) onAddMany(urls);
        else onAdd(urls[0]);
      } catch {
        // keep dialog open only if caller wants to retry; current UX closes after selection
      } finally {
        try { if (fileRef.current) fileRef.current.value = ''; } catch {}
        onClose();
      }
    })();
  }

  function onSubmitUrl(e?: React.FormEvent) {
    e?.preventDefault();
    if (!url) return;
    onAdd(url);
    onClose();
  }

  const content = (
    <div className="image-dialog-backdrop" onClick={onClose}>
      <div className="image-dialog image-dialog--picker" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <strong>Add image</strong>
          <button className="icon-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={onSubmitUrl} className="image-form">
          <input placeholder="Image URL" value={url} onChange={e => setUrl(e.target.value)} className="image-url-input" />
          <div className="image-form-actions">
            <button type="submit" className="btn">Add URL</button>
            <button type="button" className="btn" onClick={onChooseFile}>Choose file(s)</button>
          </div>
        </form>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onFile} />
      </div>
    </div>
  );
  if (typeof document !== 'undefined') return createPortal(content, document.body);
  return content;
}
