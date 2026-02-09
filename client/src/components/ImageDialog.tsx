import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function ImageDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (url?: string | null) => void }) {
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
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      onAdd(String(reader.result));
    };
    reader.readAsDataURL(f);
    onClose();
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
            <button type="button" className="btn" onClick={onChooseFile}>Choose file</button>
          </div>
        </form>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFile} />
      </div>
    </div>
  );
  if (typeof document !== 'undefined') return createPortal(content, document.body);
  return content;
}
