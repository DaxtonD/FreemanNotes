import React from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../authContext';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';

export default function RichTextEditor({ note, onClose, onSaved, noteBg }:
  { note: any; onClose: () => void; onSaved?: (payload: { title: string; body: string }) => void; noteBg?: string }) {
  const { token } = useAuth();
  const [title, setTitle] = React.useState<string>(note.title || '');
  const [maximized, setMaximized] = React.useState<boolean>(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: true, autolink: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: note.body || '',
    editorProps: { attributes: { class: 'rt-editor' } },
  });

  const [, setToolbarTick] = React.useState(0);
  React.useEffect(() => {
    if (!editor) return;
    const handler = () => setToolbarTick(t => t + 1);
    editor.on('selectionUpdate', handler);
    editor.on('transaction', handler);
    return () => {
      editor.off('selectionUpdate', handler);
      editor.off('transaction', handler);
    };
  }, [editor]);

  function applyLink() {
    if (!editor) return;
    const url = window.prompt('Enter URL:');
    if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  async function save() {
    const html = editor?.getHTML() || '';
    try {
      if ((note.title || '') !== title) {
        const r1 = await fetch(`/api/notes/${note.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ title }) });
        if (!r1.ok) throw new Error(await r1.text());
      }
      const r2 = await fetch(`/api/notes/${note.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ body: html, type: 'TEXT' }) });
      if (!r2.ok) throw new Error(await r2.text());
      onSaved && onSaved({ title, body: html });
      onClose();
    } catch (err) {
      console.error('Failed to save note', err);
      window.alert('Failed to save note');
    }
  }

  // Match note color in dialog if provided
  const dialogStyle: React.CSSProperties = {} as any;
  if (noteBg) {
    (dialogStyle as any)['--checkbox-bg'] = noteBg;
    dialogStyle.background = noteBg;
  }

  const dialog = (
    <div className="image-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { save(); } }}>
      <div className={`image-dialog${maximized ? ' maximized' : ''}`} role="dialog" aria-modal style={{ width: maximized ? '96vw' : 'min(1000px, 86vw)', ...dialogStyle }}>
        <div className="dialog-header">
          <strong>Edit note</strong>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="tiny" onClick={() => setMaximized(m => !m)} aria-label="Toggle maximize" title="Toggle maximize">⤢</button>
            <button className="icon-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="dialog-body">
          <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
            <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, background: 'transparent', border: 'none', color: 'inherit', fontWeight: 600 }} />
          </div>
          <div className="rt-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8, marginBottom: 8, overflowX: 'auto' }}>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleBold().run()} aria-pressed={editor?.isActive('bold')} aria-label="Bold" title="Bold">B</button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleItalic().run()} aria-pressed={editor?.isActive('italic')} aria-label="Italic" title="Italic">I</button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleUnderline().run()} aria-pressed={editor?.isActive('underline')} aria-label="Underline" title="Underline">U</button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} aria-pressed={editor?.isActive('heading', { level: 1 })} aria-label="Heading 1" title="Heading 1">H1</button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} aria-pressed={editor?.isActive('heading', { level: 2 })} aria-label="Heading 2" title="Heading 2">H2</button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} aria-pressed={editor?.isActive('heading', { level: 3 })} aria-label="Heading 3" title="Heading 3">H3</button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleBulletList().run()} aria-pressed={editor?.isActive('bulletList')} aria-label="Bulleted list" title="Bulleted list">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false"><circle cx="5" cy="6" r="1.5" /><rect x="9" y="5" width="10" height="2" rx="1" /><circle cx="5" cy="12" r="1.5" /><rect x="9" y="11" width="10" height="2" rx="1" /><circle cx="5" cy="18" r="1.5" /><rect x="9" y="17" width="10" height="2" rx="1" /></svg>
            </button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleOrderedList().run()} aria-pressed={editor?.isActive('orderedList')} aria-label="Numbered list" title="Numbered list">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false"><text x="3.5" y="7" font-size="6" font-family="system-ui, Arial" fill="currentColor">1.</text><rect x="9" y="5" width="10" height="2" rx="1" /><text x="3.5" y="13" font-size="6" font-family="system-ui, Arial" fill="currentColor">2.</text><rect x="9" y="11" width="10" height="2" rx="1" /><text x="3.5" y="19" font-size="6" font-family="system-ui, Arial" fill="currentColor">3.</text><rect x="9" y="17" width="10" height="2" rx="1" /></svg>
            </button>
            <button className="tiny" onClick={() => editor?.chain().focus().setTextAlign('left').run()} aria-pressed={editor?.isActive({ textAlign: 'left' })} aria-label="Align left" title="Align left"><svg viewBox="0 0 24 24" aria-hidden focusable="false"><rect x="4" y="5" width="14" height="2" rx="1" /><rect x="4" y="9" width="10" height="2" rx="1" /><rect x="4" y="13" width="14" height="2" rx="1" /><rect x="4" y="17" width="8" height="2" rx="1" /></svg></button>
            <button className="tiny" onClick={() => editor?.chain().focus().setTextAlign('center').run()} aria-pressed={editor?.isActive({ textAlign: 'center' })} aria-label="Align center" title="Align center"><svg viewBox="0 0 24 24" aria-hidden focusable="false"><rect x="5" y="5" width="14" height="2" rx="1" /><rect x="7" y="9" width="10" height="2" rx="1" /><rect x="5" y="13" width="14" height="2" rx="1" /><rect x="8" y="17" width="8" height="2" rx="1" /></svg></button>
            <button className="tiny" onClick={() => editor?.chain().focus().setTextAlign('right').run()} aria-pressed={editor?.isActive({ textAlign: 'right' })} aria-label="Align right" title="Align right"><svg viewBox="0 0 24 24" aria-hidden focusable="false"><rect x="6" y="5" width="14" height="2" rx="1" /><rect x="10" y="9" width="10" height="2" rx="1" /><rect x="6" y="13" width="14" height="2" rx="1" /><rect x="12" y="17" width="8" height="2" rx="1" /></svg></button>
            <button className="tiny" onClick={() => editor?.chain().focus().setTextAlign('justify').run()} aria-pressed={editor?.isActive({ textAlign: 'justify' })} aria-label="Justify" title="Justify"><svg viewBox="0 0 24 24" aria-hidden focusable="false"><rect x="5" y="5" width="14" height="2" rx="1" /><rect x="5" y="9" width="14" height="2" rx="1" /><rect x="5" y="13" width="14" height="2" rx="1" /><rect x="5" y="17" width="14" height="2" rx="1" /></svg></button>
            <button className="tiny" onClick={applyLink} aria-label="Insert link" title="Insert link"><svg viewBox="0 0 24 24" aria-hidden focusable="false"><path d="M9.17 14.83a3 3 0 0 1 0-4.24l2.83-2.83a3 3 0 1 1 4.24 4.24l-.88.88" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.83 9.17a3 3 0 0 1 0 4.24l-2.83 2.83a3 3 0 1 1-4.24-4.24l.88-.88" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          </div>
          <div
            onKeyDown={(e) => {
              if (!editor) return;
              const ctrl = e.ctrlKey || e.metaKey;
              if (!ctrl) return;
              if (!editor.isFocused) return;
              switch (e.key.toLowerCase()) {
                case 'b': e.preventDefault(); editor.chain().focus().toggleBold().run(); break;
                case 'i': e.preventDefault(); editor.chain().focus().toggleItalic().run(); break;
                case 'u': e.preventDefault(); editor.chain().focus().toggleUnderline().run(); break;
                case 'k': e.preventDefault(); applyLink(); break;
                case 'l': e.preventDefault(); editor.chain().focus().setTextAlign('left').run(); break;
                case 'r': e.preventDefault(); editor.chain().focus().setTextAlign('right').run(); break;
                case 'e': e.preventDefault(); editor.chain().focus().setTextAlign('center').run(); break;
                case 'j': e.preventDefault(); editor.chain().focus().setTextAlign('justify').run(); break;
              }
            }}
          >
            <EditorContent editor={editor} />
          </div>
        </div>
        <div className="dialog-footer">
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn" onClick={save}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') return createPortal(dialog, document.body);
  return dialog;
}
