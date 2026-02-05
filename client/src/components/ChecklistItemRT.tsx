import React from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';

export type ChecklistItemRTProps = {
  value: string;
  onChange: (text: string) => void;
  onEnter?: () => void;
  onArrowUp?: () => void;
  onArrowDown?: () => void;
  onFocus?: (editor: any) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onBackspaceEmpty?: () => void;
};

export default function ChecklistItemRT({ value, onChange, onEnter, onArrowUp, onArrowDown, onFocus, placeholder, autoFocus, onBackspaceEmpty }: ChecklistItemRTProps) {
  const initialText = (value || '').replace(/<[^>]+>/g, '');
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Underline,
    ],
    content: value || '',
    editorProps: {
      attributes: { class: 'rt-item' },
      handleKeyDown(view, event) {
        const ctrl = event.ctrlKey || event.metaKey;
        if (ctrl) {
          switch ((event.key || '').toLowerCase()) {
            case 'b': {
              event.preventDefault();
              if (!editor) return true;
              const sel: any = editor.state.selection;
              if (sel && sel.empty) {
                const $from = sel.$from; let depth = $from.depth; while (depth > 0 && !$from.node(depth).isBlock) depth--;
                const from = $from.start(depth); const to = $from.end(depth);
                editor.chain().focus().setTextSelection({ from, to }).toggleBold().run();
                try { editor.chain().setTextSelection(sel.from).run(); } catch {}
              } else {
                editor.chain().focus().toggleBold().run();
              }
              return true;
            }
            case 'i': {
              event.preventDefault(); if (!editor) return true;
              const sel: any = editor.state.selection;
              if (sel && sel.empty) {
                const $from = sel.$from; let depth = $from.depth; while (depth > 0 && !$from.node(depth).isBlock) depth--;
                const from = $from.start(depth); const to = $from.end(depth);
                editor.chain().focus().setTextSelection({ from, to }).toggleItalic().run();
                try { editor.chain().setTextSelection(sel.from).run(); } catch {}
              } else { editor.chain().focus().toggleItalic().run(); }
              return true;
            }
            case 'u': {
              event.preventDefault(); if (!editor) return true;
              const sel: any = editor.state.selection;
              if (sel && sel.empty) {
                const $from = sel.$from; let depth = $from.depth; while (depth > 0 && !$from.node(depth).isBlock) depth--;
                const from = $from.start(depth); const to = $from.end(depth);
                editor.chain().focus().setTextSelection({ from, to }).toggleUnderline().run();
                try { editor.chain().setTextSelection(sel.from).run(); } catch {}
              } else { editor.chain().focus().toggleUnderline().run(); }
              return true;
            }
          }
        }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onEnter && onEnter(); return true; }
        if (event.key === 'ArrowUp') { event.preventDefault(); onArrowUp && onArrowUp(); return true; }
        if (event.key === 'ArrowDown') { event.preventDefault(); onArrowDown && onArrowDown(); return true; }
        if (event.key === 'Backspace') {
          try {
            const plain = (editor?.getText() || '').trim();
            const empty = plain.length === 0;
            if (empty) { event.preventDefault(); onBackspaceEmpty && onBackspaceEmpty(); return true; }
          } catch {}
        }
        return false;
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
    onFocus({ editor }) {
      // Focusing an editor does not always produce a selection transaction.
      // We still need to notify the parent so toolbar state can update.
      onFocus && onFocus(editor);
    },
    onSelectionUpdate({ editor }) {
      // notify parent to update toolbar active states
      onFocus && onFocus(editor);
    },
  });

  React.useEffect(() => {
    if (!editor) return;
    onFocus && onFocus(editor);
    if (autoFocus) {
      try { editor.chain().focus().run(); } catch {}
    }
    return () => { /* no-op cleanup */ };
  }, [editor]);

  // Keep editor content in sync when `value` prop updates (e.g., from remote Yjs changes)
  React.useEffect(() => {
    if (!editor) return;
    try {
      if ((editor as any).isFocused) return;
      const current = editor.getHTML();
      const next = value || '';
      if (current !== next) {
        editor.commands.setContent(next, { emitUpdate: false });
      }
    } catch {}
  }, [value, editor]);

  return (
    <div>
      <EditorContent editor={editor} />
    </div>
  );
}
