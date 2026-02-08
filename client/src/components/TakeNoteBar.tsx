import React, { useState, useRef, useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { makeWebSocketUrl } from '../lib/ws';
import { useAuth } from '../authContext';
import ChecklistItemRT from './ChecklistItemRT';
import ColorPalette from './ColorPalette';
import ReminderPicker from './ReminderPicker';
import CollaboratorModal from './CollaboratorModal';
import ImageDialog from './ImageDialog';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPalette } from '@fortawesome/free-solid-svg-icons';
import Underline from '@tiptap/extension-underline';

export default function TakeNoteBar({
  onCreated,
  openRequest,
  activeCollection,
}: {
  onCreated?: () => void;
  openRequest?: { nonce: number; mode: 'text' | 'checklist' };
  activeCollection?: { id: number; path: string } | null;
}): JSX.Element {
  const { token, user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<'text' | 'checklist'>('text');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [maximized, setMaximized] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Underline,
      Extension.create({
        name: 'paragraphEnterFix',
        priority: 1000,
        addKeyboardShortcuts() {
          return {
            'Shift-Enter': () => { const e = this.editor; e.commands.splitBlock(); e.commands.setParagraph(); return true; },
            'Mod-Enter': () => { const e = this.editor; e.commands.splitBlock(); e.commands.setParagraph(); return true; },
          };
        },
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'rt-editor',
      },
    },
  });

  function shouldFullscreenOnMobile(): boolean {
    try {
      const mq = window.matchMedia;
      if (!mq) return false;
      const touchLike = mq('(pointer: coarse)').matches || mq('(any-pointer: coarse)').matches;
      const small = mq('(max-width: 720px)').matches;
      return !!(touchLike && small);
    } catch {
      return false;
    }
  }

  const backIdRef = useRef<string>('');
  if (!backIdRef.current) {
    try {
      backIdRef.current = `take-note-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    } catch {
      backIdRef.current = `take-note-${Math.random()}`;
    }
  }

    function toggleMarkAcrossLine(mark: 'bold' | 'italic' | 'underline') {
      if (!editor) return;
      const sel: any = editor.state.selection;
      if (!sel || !sel.empty) {
        editor.chain().focus()[`toggle${mark.charAt(0).toUpperCase() + mark.slice(1)}` as 'toggleBold' | 'toggleItalic' | 'toggleUnderline']().run();
        return;
      }
      const $from = sel.$from; let depth = $from.depth; while (depth > 0 && !$from.node(depth).isBlock) depth--;
      const from = $from.start(depth); const to = $from.end(depth);
      const chain = editor.chain().focus().setTextSelection({ from, to });
      if (mark === 'bold') chain.toggleBold().run(); else if (mark === 'italic') chain.toggleItalic().run(); else chain.toggleUnderline().run();
      try { editor.chain().setTextSelection(sel.from).run(); } catch {}
    }

    const [, setToolbarTick] = useState(0);
    useEffect(() => {
      if (!editor) return;
      const handler = () => setToolbarTick(t => t + 1);
      editor.on('selectionUpdate', handler);
      editor.on('transaction', handler);
      return () => {
        editor.off('selectionUpdate', handler);
        editor.off('transaction', handler);
      };
    }, [editor]);

    // Link insertion is only available in the full editor.

  const ignoreNextDocClickRef = useRef(false);
  const lastExternalOpenRef = useRef(0);

  const activeCollectionId = (activeCollection && Number.isFinite(Number(activeCollection.id))) ? Number(activeCollection.id) : null;
  const activeCollectionPath = (activeCollection && typeof activeCollection.path === 'string') ? String(activeCollection.path) : '';
  const [addToCurrentCollection, setAddToCurrentCollection] = useState(false);

  useEffect(() => {
    const nonce = Number(openRequest?.nonce || 0);
    if (!nonce) return;
    if (nonce === lastExternalOpenRef.current) return;
    lastExternalOpenRef.current = nonce;

    const nextMode = openRequest?.mode || 'text';
    setMode(nextMode);
    try { ignoreNextDocClickRef.current = true; } catch {}
    try { setAddToCurrentCollection(activeCollectionId != null); } catch {}
    setExpanded(true);
    setMaximized(shouldFullscreenOnMobile());

    if (nextMode === 'checklist') {
      setItems((cur) => (cur && cur.length ? cur : [{ content: '' }]));
      setTimeout(() => focusItem(0), 30);
    } else {
      requestAnimationFrame(() => {
        try { editor?.commands.focus('end'); } catch {}
      });
    }
  }, [openRequest?.nonce, openRequest?.mode, editor]);

  // Treat the expanded create editor like a modal: disable background interactions
  // and hook the mobile Back button to close it instead of exiting.
  const modalDepthRef = useRef(false);
  useEffect(() => {
    try {
      if (expanded && !modalDepthRef.current) {
        modalDepthRef.current = true;
        window.dispatchEvent(new Event('freemannotes:editor-modal-open'));
      }
      if (!expanded && modalDepthRef.current) {
        modalDepthRef.current = false;
        window.dispatchEvent(new Event('freemannotes:editor-modal-close'));
      }
    } catch {}
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const id = backIdRef.current;
    const onBack = () => {
      try {
        const st = overlayStateRef.current;
        if (st.showImageDialog) { setShowImageDialog(false); return; }
        if (st.showCollaborator) { setShowCollaborator(false); return; }
        if (st.showReminderPicker) { setShowReminderPicker(false); return; }
        if (st.showPalette) { setShowPalette(false); return; }
      } catch {}
      try {
        // Discard on Back (do not create notes unless user explicitly clicks Save)
        discardAndClose();
      } catch {
        try { discardAndClose(); } catch {}
      }
    };

    try {
      window.dispatchEvent(new CustomEvent('freemannotes:back/register', { detail: { id, onBack } }));
    } catch {}
    return () => {
      try { window.dispatchEvent(new CustomEvent('freemannotes:back/unregister', { detail: { id } })); } catch {}
    };
  }, [expanded]);

  const [items, setItems] = useState<{ content: string; checked?: boolean }[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const draggingIdx = useRef<number | null>(null);
  const activeChecklistEditor = useRef<any | null>(null);
  const itemEditorRefs = useRef<Array<any | null>>([]);
  const [, setChecklistToolbarTick] = useState(0);
  const skipNextChecklistToolbarClickRef = useRef(false);
  const [bg, setBg] = useState<string>('');
  const [textColor, setTextColor] = useState<string | undefined>(undefined);
  const [showPalette, setShowPalette] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [showCollaborator, setShowCollaborator] = useState(false);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [selectedCollaborators, setSelectedCollaborators] = useState<Array<{id:number;email:string}>>([]);

  const overlayStateRef = useRef({
    showPalette: false,
    showReminderPicker: false,
    showCollaborator: false,
    showImageDialog: false,
  });
  useEffect(() => {
    overlayStateRef.current = {
      showPalette,
      showReminderPicker,
      showCollaborator,
      showImageDialog,
    };
  }, [showPalette, showReminderPicker, showCollaborator, showImageDialog]);

  function getCurrentChecklistEditor(): any | null {
    let ed = activeChecklistEditor.current as any;
    if (ed && (ed as any).isFocused) return ed;
    const selNode = typeof document !== 'undefined' ? (document.getSelection()?.anchorNode || null) : null;
    if (selNode) {
      const bySel = itemEditorRefs.current.find((x) => {
        try { return !!(x && (x as any).view?.dom && (x as any).view.dom.contains(selNode as Node)); } catch { return false; }
      });
      if (bySel) ed = bySel;
    } else {
      const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
      if (activeEl) {
        const byDom = itemEditorRefs.current.find((x) => {
          try { return !!(x && (x as any).view && (x as any).view.dom && ((x as any).view.dom === activeEl || (x as any).view.dom.contains(activeEl))); } catch { return false; }
        });
        if (byDom) ed = byDom;
      }
    }
    if (!ed || !(ed as any)?.isFocused) {
      const focused = itemEditorRefs.current.find((x) => !!(x && (x as any).isFocused));
      if (focused) ed = focused;
    }
    return ed || null;
  }

  function applyChecklistMarkAcrossLine(mark: 'bold' | 'italic' | 'underline') {
    const ed = getCurrentChecklistEditor() as any;
    if (!ed) return;
    const sel: any = ed.state?.selection;
    if (!sel || !sel.empty) {
      const chain = ed.chain().focus();
      if (mark === 'bold') chain.toggleBold().run();
      else if (mark === 'italic') chain.toggleItalic().run();
      else chain.toggleUnderline().run();
      try {
        const restorePos = sel?.from;
        requestAnimationFrame(() => {
          try {
            const ch = ed.chain().focus();
            if (typeof restorePos === 'number') ch.setTextSelection(restorePos);
            ch.run();
          } catch {}
        });
      } catch {}
      return;
    }
    const $from = sel.$from; let depth = $from.depth; while (depth > 0 && !$from.node(depth).isBlock) depth--;
    const from = $from.start(depth); const to = $from.end(depth);
    const chain = ed.chain().focus().setTextSelection({ from, to });
    if (mark === 'bold') chain.toggleBold().run();
    else if (mark === 'italic') chain.toggleItalic().run();
    else chain.toggleUnderline().run();
    try { ed.chain().focus().setTextSelection(sel.from).run(); } catch {}
    try {
      const restorePos = sel.from;
      requestAnimationFrame(() => {
        try {
          try { (ed as any).view?.focus?.(); } catch {}
          ed.chain().focus().setTextSelection(restorePos).run();
        } catch {}
      });
    } catch {}
    try { setChecklistToolbarTick(t => t + 1); } catch {}
  }

  function isCurrentLineMarked(mark: 'bold' | 'italic' | 'underline'): boolean {
    const ed = getCurrentChecklistEditor() as any;
    if (!ed) return false;
    const sel: any = ed.state?.selection;
    if (!sel) return false;
    const markType = (ed.schema?.marks || {})[mark];
    if (!markType) return false;
    const $from = sel.$from; let depth = $from.depth; while (depth > 0 && !$from.node(depth).isBlock) depth--; const from = $from.start(depth); const to = $from.end(depth);
    let hasText = false; let allMarked = true;
    try {
      ed.state.doc.nodesBetween(from, to, (node: any) => {
        if (node && node.isText) {
          hasText = true;
          const hasMark = !!markType.isInSet(node.marks);
          if (!hasMark) allMarked = false;
        }
      });
    } catch {}
    return hasText && allMarked;
  }

  function hasContentToSave(): boolean {
    try {
      const hasTitle = !!title.trim();
      const hasBg = !!bg;
      const hasExtras = !!(imageUrl || (selectedCollaborators && selectedCollaborators.length));
      if (mode === 'checklist') {
        const anyItem = (items || []).some((it) => !!String(it.content || '').trim() || !!it.checked);
        return hasTitle || hasBg || hasExtras || anyItem;
      }
      const hasText = !!((editor?.getText() || '').trim());
      return hasTitle || hasBg || hasExtras || hasText;
    } catch {
      return false;
    }
  }

  function discardAndClose() {
    try { setExpanded(false); } catch {}
    try { setMaximized(false); } catch {}
    try { setShowPalette(false); } catch {}
    try { setShowReminderPicker(false); } catch {}
    try { setShowCollaborator(false); } catch {}
    try { setShowImageDialog(false); } catch {}
    try { setTitle(''); setBody(''); setItems([]); setBg(''); setImageUrl(null); setSelectedCollaborators([]); } catch {}
    try { editor?.commands.clearContent(); } catch {}
  }

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!expanded) return;
      // When opening, the click target can be removed during the same click event,
      // causing composedPath/contains checks to fail and immediately closing.
      if (ignoreNextDocClickRef.current) {
        ignoreNextDocClickRef.current = false;
        return;
      }
      // If an inner control intentionally prevented default (e.g. formatting buttons,
      // empty-state actions), don't treat it as a click-away.
      if (e.defaultPrevented) return;
      const el = rootRef.current;
      if (!el) return;
      // Ignore clicks inside any overlay/popover elements so the creation dialog stays open
      const t = e.target as Node;
      const inPalette = document.querySelector('.palette-popover')?.contains(t);
      const inReminder = document.querySelector('.reminder-popover')?.contains(t);
      const inCollab = document.querySelector('.collab-modal')?.contains(t);
      const inImageDlg = document.querySelector('.image-dialog')?.contains(t);
      if (inPalette || inReminder || inCollab || inImageDlg) return;

      // Prefer composedPath: it's resilient even if the click target is removed
      // during the same event (e.g. state updates that replace the button).
      try {
        const path = (e.composedPath?.() || []) as unknown[];
        if (path.includes(el)) return;
      } catch {}

      if (e.target instanceof Node && el.contains(e.target)) return;

      // Discard on click-away (do not create notes unless user explicitly clicks Save)
      discardAndClose();
    }

    function onKey(e: KeyboardEvent) {
      if (!expanded) return;
      if (e.key === 'Escape') {
        discardAndClose();
      }
    }

    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  /** choose '#000' or '#fff' based on best WCAG contrast vs provided hex color */
  function contrastColorForBackground(hex?: string | null): string | undefined {
    if (!hex) return undefined;
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h;
    if (full.length !== 6) return undefined;
    const r = parseInt(full.slice(0, 2), 16) / 255;
    const g = parseInt(full.slice(2, 4), 16) / 255;
    const b = parseInt(full.slice(4, 6), 16) / 255;
    const srgbToLin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const R = srgbToLin(r), G = srgbToLin(g), B = srgbToLin(b);
    const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const contrastRatio = (L1: number, L2: number) => (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const contrastWithWhite = contrastRatio(1, L);
    const contrastWithBlack = contrastRatio(0, L);
    return contrastWithWhite >= contrastWithBlack ? '#ffffff' : '#000000';
  }

  // Update textColor whenever bg changes
  useEffect(() => {
    if (!bg) {
      setTextColor('var(--muted)');
    } else {
      setTextColor(contrastColorForBackground(bg));
    }
  }, [bg]);

  function addItem() {
    setItems(s => {
      const next = [...s, { content: '' }];
      return next;
    });
  }

  function updateItem(idx: number, content: string) {
    setItems(s => s.map((it, i) => i === idx ? { ...it, content } : it));
  }

  function toggleLocalItemChecked(idx: number) {
    setItems(s => s.map((it, i) => i === idx ? { ...it, checked: !it.checked } : it));
  }

  function focusItem(idx: number) {
    // Slight delay to allow newly inserted item to mount and register its editor ref
    setTimeout(() => {
      const ed = itemEditorRefs.current[idx];
      try { ed && ed.chain().focus().run(); } catch {}
    }, 30);
  }

  async function save() {
    setLoading(true);
    try {
      if (!token) throw new Error('Not authenticated');
      // For text notes, capture content JSON to seed Yjs after creation.
      const bodyJson = mode === 'text' ? (editor?.getJSON() || {}) : {};
      // Do not store body for text notes; rely on Yjs collaboration persistence.
      const payload: any = { title, body: null, type: mode === 'checklist' ? 'CHECKLIST' : 'TEXT', color: bg || null };
      if (mode === 'checklist') payload.items = items.map((it, i) => ({ content: it.content, ord: i }));
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const noteId = data?.note?.id;

      if (noteId && addToCurrentCollection && activeCollectionId != null) {
        try {
          const cres = await fetch(`/api/notes/${noteId}/collections`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ collectionId: activeCollectionId }),
          });
          if (!cres.ok) throw new Error(await cres.text());
        } catch (e) {
          console.warn('Created note but failed to add to collection', e);
          try { window.alert('Note created, but failed to add it to the current collection.'); } catch {}
        }
      }
      // For text notes, push initial content into the Yjs doc so it persists canonically.
      if (noteId && mode === 'text') {
        try {
          const ydoc = new Y.Doc();
          const room = `note-${noteId}`;
          const provider = new WebsocketProvider(makeWebSocketUrl('/collab'), room, ydoc);
          // Create a headless temporary editor bound to the Yjs doc and set content
          const tempEditor = new Editor({
            extensions: [
              StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
              TextAlign.configure({ types: ['heading', 'paragraph'] }),
              Collaboration.configure({ document: ydoc })
            ],
            content: '',
          });
          // Wait until synced before seeding to avoid overwriting any state
          await new Promise<void>((resolve) => {
            provider.on('sync', (isSynced: boolean) => { if (isSynced) resolve(); });
          });
          try { tempEditor?.commands.setContent(bodyJson); } catch {}
          // Give a brief moment for updates to flush
          await new Promise(r => setTimeout(r, 100));
          try { tempEditor?.destroy(); } catch {}
          try { provider.destroy(); } catch {}
          try { ydoc.destroy(); } catch {}
          // Also store derived snapshot for preview/search
          try {
            await fetch(`/api/notes/${noteId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ body: JSON.stringify(bodyJson), type: 'TEXT' }) });
          } catch {}
        } catch (e) {
          console.warn('Failed to seed Yjs content for new note', e);
        }
      }
      // post-create additions: collaborators and image
      if (noteId && selectedCollaborators.length) {
        for (const u of selectedCollaborators) {
          try { await fetch(`/api/notes/${noteId}/collaborators`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ email: u.email }) }); } catch {}
        }
      }
      if (noteId && imageUrl) {
        try { await fetch(`/api/notes/${noteId}/images`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ url: imageUrl }) }); } catch {}
      }
      setTitle(''); setBody(''); setItems([]); setExpanded(false); setBg(''); setImageUrl(null); setSelectedCollaborators([]);
      try { setAddToCurrentCollection(activeCollectionId != null); } catch {}
      editor?.commands.clearContent();
      onCreated && onCreated();
    } catch (err) {
      console.error('Failed to create note', err);
      window.alert('Failed to create note');
    } finally { setLoading(false); }
  }

  if (!expanded) {
    return (
      <div ref={rootRef}>
        <div
          className="take-note-bar"
          role="button"
          tabIndex={0}
          onMouseDown={(e) => { try { e.preventDefault(); } catch {} try { e.stopPropagation(); } catch {} ignoreNextDocClickRef.current = true; try { setAddToCurrentCollection(activeCollectionId != null); } catch {} setMode('text'); setExpanded(true); }}
          onClick={(e) => { try { e.preventDefault(); } catch {} try { e.stopPropagation(); } catch {} ignoreNextDocClickRef.current = true; try { setAddToCurrentCollection(activeCollectionId != null); } catch {} setMode('text'); setExpanded(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              ignoreNextDocClickRef.current = true;
              try { setAddToCurrentCollection(activeCollectionId != null); } catch {}
              setMode('text');
              setExpanded(true);
            }
          }}
        >
          <div style={{ flex: 1, padding: '10px 12px' }}>Create a new note</div>
          <div
            className="checkbox-visual"
            onMouseDown={(e) => { e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); ignoreNextDocClickRef.current = true; try { setAddToCurrentCollection(activeCollectionId != null); } catch {} setMode('checklist'); setItems([{ content: '' }]); setExpanded(true); focusItem(0); }}
            aria-label="Start checklist"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
              <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </div>
    );
  }

  const dialogStyle: React.CSSProperties = {} as any;
  if (bg) {
    dialogStyle.background = bg;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    dialogStyle['--checkbox-bg'] = bg;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    dialogStyle['--checkbox-border'] = '#ffffff';
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    dialogStyle['--checkbox-checked-bg'] = bg;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    dialogStyle['--checkbox-checked-mark'] = '#ffffff';

    // Used by sticky title/toolbar backgrounds.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    dialogStyle['--editor-surface'] = bg;
  }

  return (
    <div className={`take-note-expanded${maximized ? ' maximized' : ''}`} ref={rootRef} style={{ padding: 12, ...dialogStyle }}>
      {mode === 'text' ? (
        <div>
          <div className="rt-sticky-header">
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} style={{ fontSize: 18, fontWeight: 600, border: 'none', background: 'transparent', color: 'inherit' }} />
            </div>

            <div className="rt-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8, marginBottom: 0, overflowX: 'auto' }}>
            <button className="tiny" onClick={() => toggleMarkAcrossLine('bold')} aria-pressed={editor?.isActive('bold')}>B</button>
            <button className="tiny" onClick={() => toggleMarkAcrossLine('italic')} aria-pressed={editor?.isActive('italic')}>I</button>
            <button className="tiny" onClick={() => toggleMarkAcrossLine('underline')} aria-pressed={editor?.isActive('underline')}>U</button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} aria-pressed={editor?.isActive('heading', { level: 1 })}>H1</button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} aria-pressed={editor?.isActive('heading', { level: 2 })}>H2</button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} aria-pressed={editor?.isActive('heading', { level: 3 })}>H3</button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleBulletList().run()} aria-pressed={editor?.isActive('bulletList')} aria-label="Bulleted list" title="Bulleted list">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <circle cx="5" cy="6" r="1.5" />
                <rect x="9" y="5" width="10" height="2" rx="1" />
                <circle cx="5" cy="12" r="1.5" />
                <rect x="9" y="11" width="10" height="2" rx="1" />
                <circle cx="5" cy="18" r="1.5" />
                <rect x="9" y="17" width="10" height="2" rx="1" />
              </svg>
            </button>
            <button className="tiny" onClick={() => editor?.chain().focus().toggleOrderedList().run()} aria-pressed={editor?.isActive('orderedList')} aria-label="Numbered list" title="Numbered list">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <text x="3.5" y="7" fontSize="6" fontFamily="system-ui, Arial" fill="currentColor">1.</text>
                <rect x="9" y="5" width="10" height="2" rx="1" />
                <text x="3.5" y="13" fontSize="6" fontFamily="system-ui, Arial" fill="currentColor">2.</text>
                <rect x="9" y="11" width="10" height="2" rx="1" />
                <text x="3.5" y="19" fontSize="6" fontFamily="system-ui, Arial" fill="currentColor">3.</text>
                <rect x="9" y="17" width="10" height="2" rx="1" />
              </svg>
            </button>
            <button className="tiny" onClick={() => editor?.chain().focus().setTextAlign('left').run()} aria-pressed={editor?.isActive({ textAlign: 'left' })} aria-label="Align left" title="Align left">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <rect x="4" y="5" width="14" height="2" rx="1" />
                <rect x="4" y="9" width="10" height="2" rx="1" />
                <rect x="4" y="13" width="14" height="2" rx="1" />
                <rect x="4" y="17" width="8" height="2" rx="1" />
              </svg>
            </button>
            <button className="tiny" onClick={() => editor?.chain().focus().setTextAlign('center').run()} aria-pressed={editor?.isActive({ textAlign: 'center' })} aria-label="Align center" title="Align center">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <rect x="5" y="5" width="14" height="2" rx="1" />
                <rect x="7" y="9" width="10" height="2" rx="1" />
                <rect x="5" y="13" width="14" height="2" rx="1" />
                <rect x="8" y="17" width="8" height="2" rx="1" />
              </svg>
            </button>
            <button className="tiny" onClick={() => editor?.chain().focus().setTextAlign('right').run()} aria-pressed={editor?.isActive({ textAlign: 'right' })} aria-label="Align right" title="Align right">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <rect x="6" y="5" width="14" height="2" rx="1" />
                <rect x="10" y="9" width="10" height="2" rx="1" />
                <rect x="6" y="13" width="14" height="2" rx="1" />
                <rect x="12" y="17" width="8" height="2" rx="1" />
              </svg>
            </button>
            <button className="tiny" onClick={() => editor?.chain().focus().setTextAlign('justify').run()} aria-pressed={editor?.isActive({ textAlign: 'justify' })} aria-label="Justify" title="Justify">
              <svg viewBox="0 0 24 24" aria-hidden focusable="false">
                <rect x="5" y="5" width="14" height="2" rx="1" />
                <rect x="5" y="9" width="14" height="2" rx="1" />
                <rect x="5" y="13" width="14" height="2" rx="1" />
                <rect x="5" y="17" width="14" height="2" rx="1" />
              </svg>
            </button>
            {/* Link insertion is available in the full editor only */}
            <button className="tiny" onClick={() => setMaximized(m => !m)} aria-label="Toggle maximize" title="Toggle maximize">⤢</button>
            </div>
          </div>
          <div
            onKeyDown={(e) => {
              if (!editor) return;
              const ctrl = e.ctrlKey || e.metaKey;
              if (!ctrl) return;
              // scope shortcuts when editor is focused
              if (!editor.isFocused) return;
              switch (e.key.toLowerCase()) {
                case 'b': e.preventDefault(); toggleMarkAcrossLine('bold'); break;
                case 'i': e.preventDefault(); toggleMarkAcrossLine('italic'); break;
                case 'u': e.preventDefault(); toggleMarkAcrossLine('underline'); break;
                // 'k' (insert link) is available in the full editor only
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
      ) : (
        <div>
          <div className="rt-sticky-header">
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} style={{ fontSize: 18, fontWeight: 600, border: 'none', background: 'transparent', color: 'inherit' }} />
            </div>

            <div
              className="rt-toolbar"
              style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8, marginBottom: 0 }}
              onPointerDown={(e) => e.preventDefault()}
              onPointerUp={(e) => e.preventDefault()}
            >
            <button
              className="tiny"
              type="button"
              tabIndex={-1}
              onPointerDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); skipNextChecklistToolbarClickRef.current = true; applyChecklistMarkAcrossLine('bold'); }}
              onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onMouseDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onMouseUp={(e) => e.preventDefault()}
              onClick={() => { if (skipNextChecklistToolbarClickRef.current) { skipNextChecklistToolbarClickRef.current = false; return; } applyChecklistMarkAcrossLine('bold'); }}
              aria-pressed={isCurrentLineMarked('bold')}
            >B</button>
            <button
              className="tiny"
              type="button"
              tabIndex={-1}
              onPointerDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); skipNextChecklistToolbarClickRef.current = true; applyChecklistMarkAcrossLine('italic'); }}
              onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onMouseDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onMouseUp={(e) => e.preventDefault()}
              onClick={() => { if (skipNextChecklistToolbarClickRef.current) { skipNextChecklistToolbarClickRef.current = false; return; } applyChecklistMarkAcrossLine('italic'); }}
              aria-pressed={isCurrentLineMarked('italic')}
            >I</button>
            <button
              className="tiny"
              type="button"
              tabIndex={-1}
              onPointerDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); skipNextChecklistToolbarClickRef.current = true; applyChecklistMarkAcrossLine('underline'); }}
              onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onMouseDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onMouseUp={(e) => e.preventDefault()}
              onClick={() => { if (skipNextChecklistToolbarClickRef.current) { skipNextChecklistToolbarClickRef.current = false; return; } applyChecklistMarkAcrossLine('underline'); }}
              aria-pressed={isCurrentLineMarked('underline')}
            >U</button>
            </div>
          </div>

          <div style={{ marginTop: 8 }}>
          {items.length === 0 && (
            <div style={{ marginBottom: 8 }}>
              <button
                className="btn"
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setItems([{ content: '' }]);
                  // wait for ChecklistItemRT to mount + register
                  setTimeout(() => focusItem(0), 30);
                }}
              >Add an item</button>
            </div>
          )}
          {items.map((it, idx) => (
            <div
              key={idx}
              className="checklist-item"
              draggable
              onDragStart={(e) => { draggingIdx.current = idx; e.dataTransfer?.setData('text/plain', String(idx)); }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const src = draggingIdx.current ?? parseInt(e.dataTransfer.getData('text/plain') || '-1', 10);
                const dst = idx;
                if (src >= 0 && src !== dst) {
                  setItems(s => {
                    const copy = [...s];
                    const [moved] = copy.splice(src, 1);
                    copy.splice(dst, 0, moved);
                    return copy;
                  });
                }
                draggingIdx.current = null;
              }}
              style={{ display: 'flex', gap: 8, alignItems: 'center' }}
            >
              <div className="drag-handle" style={{ width: 20, cursor: 'grab', userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none', msUserSelect: 'none' }} aria-hidden>≡</div>
              <div className="checkbox-visual" onClick={() => toggleLocalItemChecked(idx)} aria-hidden>
                {it.checked && (
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <ChecklistItemRT
                  value={it.content}
                  onChange={(html) => updateItem(idx, html)}
                  onEnter={() => {
                    setItems(s => { const copy = [...s]; copy.splice(idx + 1, 0, { content: '' }); return copy; });
                    focusItem(idx + 1);
                  }}
                  onArrowUp={() => focusItem(Math.max(0, idx - 1))}
                  onArrowDown={() => focusItem(Math.min(items.length - 1, idx + 1))}
                  onBackspaceEmpty={() => {
                    if (idx > 0) {
                      setItems(s => { const copy = [...s]; copy.splice(idx, 1); return copy; });
                      focusItem(idx - 1);
                    }
                  }}
                  onFocus={(ed: any) => {
                    activeChecklistEditor.current = ed;
                    itemEditorRefs.current[idx] = ed;
                    setChecklistToolbarTick(t => t + 1);
                  }}
                  placeholder={''}
                  autoFocus={idx === 0}
                />
              </div>
              <button
                className="delete-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setItems(s => {
                    const next = s.filter((_, i) => i !== idx);
                    // if we deleted the last item, clear active editor refs
                    if (next.length === 0) {
                      activeChecklistEditor.current = null;
                      itemEditorRefs.current = [];
                      return next;
                    }
                    // focus previous (or first) after the list updates
                    const focusIdx = Math.max(0, Math.min(idx - 1, next.length - 1));
                    setTimeout(() => focusItem(focusIdx), 30);
                    return next;
                  });
                }}
                aria-label="Delete item"
                title="Delete item"
              >✕</button>
            </div>
          ))}
          </div>
        </div>
      )}

      {imageUrl && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="note-image" style={{ width: 96, height: 72, flex: '0 0 auto' }}>
            <img src={imageUrl} alt="selected" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, display: 'block' }} />
          </div>
          <div style={{ flex: 1, fontSize: 13, opacity: 0.9 }}>1 image selected</div>
          <button className="btn" type="button" onClick={() => setImageUrl(null)} style={{ padding: '6px 10px' }}>Remove</button>
        </div>
      )}

      <div className="note-footer" aria-hidden={false} style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <div style={{ marginRight: 'auto', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, color: (bg ? textColor : undefined) }}>
          {!!activeCollectionId && !!activeCollectionPath && (
            <label className="create-collection-toggle" title={activeCollectionPath}>
              <input
                type="checkbox"
                checked={!!addToCurrentCollection}
                onChange={(e) => setAddToCurrentCollection(!!e.target.checked)}
              />
              <span className="create-collection-toggle__text">Add to current collection:</span>
              <span className="create-collection-toggle__path">{activeCollectionPath}</span>
            </label>
          )}

          <div className="note-actions" style={{ display: 'inline-flex', gap: 8 }}>
            <button className="tiny palette" onClick={() => setShowPalette(true)} aria-label="Change color" title="Change color">
              <FontAwesomeIcon icon={faPalette} className="palette-svg" />
            </button>
            <button className="tiny" onClick={() => setShowReminderPicker(true)} aria-label="Reminder" title="Reminder">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2z"/>
              <path d="M18 8V7a6 6 0 1 0-12 0v1c0 3.5-2 5-2 5h16s-2-1.5-2-5z"/>
            </svg>
            </button>
            <button className="tiny" onClick={() => setShowCollaborator(true)} aria-label="Collaborators" title="Collaborators">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/>
              <path d="M6 14c-1.66 0-3 1.34-3 3v1h9.5c-.2-.63-.5-1.23-.9-1.76C11.7 15.6 9.9 14 6 14z"/>
              <path d="M20 16v2h-2v2h-2v-2h-2v-2h2v-2h2v2z" />
            </svg>
            </button>
            <button className="tiny" onClick={() => setShowImageDialog(true)} aria-label="Add image" title="Add image">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M21 19V5c0-1.1-.9-2-2-2H5C3.9 3 3 3.9 3 5v14h18zM8.5 13.5l2.5 3L14.5 12l4.5 7H5l3.5-5.5z"/>
            </svg>
            </button>
          </div>
        </div>
        <button className="btn" onClick={async () => {
          discardAndClose();
        }}>Cancel</button>
        <button className="btn" onClick={save} disabled={loading || !hasContentToSave()}>{loading ? 'Saving...' : 'Save'}</button>
      </div>

      {showPalette && <ColorPalette anchorRef={rootRef} onPick={(c) => { setBg(c); /* keep palette open */ }} onClose={() => setShowPalette(false)} />}
      {showReminderPicker && <ReminderPicker onClose={() => setShowReminderPicker(false)} onSet={(iso) => { setShowReminderPicker(false); /* TODO: persist reminder when supported */ }} />}
      {showCollaborator && (
        <CollaboratorModal
          onClose={() => setShowCollaborator(false)}
          onSelect={(u) => { setSelectedCollaborators(s => (s.find(x=>x.id===u.id)?s:[...s,u])); setShowCollaborator(false); }}
          current={(() => {
            const currentUserId = (user && (user as any).id) ? Number((user as any).id) : undefined;
            return selectedCollaborators
              .filter(u => (typeof u.id === 'number' ? u.id !== currentUserId : true))
              .map(u => ({ userId: u.id, email: u.email }));
          })()}
          ownerId={(user as any)?.id}
          onRemove={() => { /* no-op: creation dialog selections have no collabId yet */ }}
        />
      )}
      {showImageDialog && <ImageDialog onClose={() => setShowImageDialog(false)} onAdd={(url) => setImageUrl(url || null)} />}
    </div>
  );
}

