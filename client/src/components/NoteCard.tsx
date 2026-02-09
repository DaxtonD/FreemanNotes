import React, { useRef, useState } from "react";
import { useTheme } from '../themeContext';
import DOMPurify from 'dompurify';
import { useAuth } from '../authContext';
import ChecklistEditor from "./ChecklistEditor";
import RichTextEditor from "./RichTextEditor";
import CollaboratorModal from "./CollaboratorModal";
import MoreMenu from "./MoreMenu";
import MoveToCollectionModal from "./MoveToCollectionModal";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPalette, faUsers, faTag, faFolder } from '@fortawesome/free-solid-svg-icons';
import LabelsDialog from "./LabelsDialog";
import ColorPalette from "./ColorPalette";
import ImageDialog from "./ImageDialog";
import ReminderPicker, { type ReminderDraft } from "./ReminderPicker";
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Collaboration from '@tiptap/extension-collaboration';

type NoteItem = {
  id: number;
  content: string;
  checked?: boolean;
  ord?: number;
  indent?: number;
};

type Note = {
  id: number;
  title?: string;
  body?: string;
  pinned?: boolean;
  items?: NoteItem[];
  type?: string;
  color?: string;
  viewerColor?: string | null;
  viewerCollections?: Array<{ id: number; name: string; parentId: number | null }>;
  noteLabels?: Array<{ id: number; label?: { id: number; name: string } }>;
  images?: Array<{ id: number; url: string }>
  cardSpan?: number;
};

/** choose '#000' or '#fff' based on best WCAG contrast vs provided hex color */
function contrastColorForBackground(hex?: string | null): string | undefined {
  if (!hex) return undefined;
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map(ch => ch + ch).join("") : h;
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

  return contrastWithWhite >= contrastWithBlack ? "#ffffff" : "#000000";
}

export default function NoteCard({
  note,
  onChange,
  openRequest,
  onOpenRequestHandled,
  dragHandleAttributes,
  dragHandleListeners,
}: {
  note: Note;
  onChange?: (ev?: any) => void;
  openRequest?: number;
  onOpenRequestHandled?: (noteId: number) => void;
  dragHandleAttributes?: Record<string, any>;
  dragHandleListeners?: Record<string, any>;
}) {
  const noteRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const imagesWrapRef = useRef<HTMLDivElement | null>(null);
  const snapRafRef = useRef<number | null>(null);
  const lastSnapUnitRef = useRef<number | null>(null);
  const lastSnapBaseRef = useRef<number | null>(null);
  const theme = (() => { try { return useTheme(); } catch { return { effective: 'dark' } as any; } })();

  const [bg, setBg] = useState<string>((note as any).viewerColor || note.color || ""); // empty = theme card color
  // default text color for "Default" palette will use CSS var --muted so it matches original layout
  const [textColor, setTextColor] = useState<string | undefined>(((note as any).viewerColor || note.color) ? contrastColorForBackground(((note as any).viewerColor || note.color) as string) : undefined);
  const [archived, setArchived] = useState(false);
  const [images, setImages] = useState<Array<{ id:number; url:string }>>((note.images as any) || []);
  const [thumbsPerRow, setThumbsPerRow] = useState<number>(3);
  const [noteItems, setNoteItems] = useState<any[]>(note.items || []);
  const [title, setTitle] = useState<string>(note.title || '');

  React.useEffect(() => {
    try {
      const next = (((note as any).images || []).map((i: any) => ({ id: Number(i.id), url: String(i.url) })));
      setImages(next);
    } catch {}
  }, [note.id, (note as any).images]);

  React.useEffect(() => {
    try { setArchived(!!(note as any).archived); } catch {}
  }, [note.id, (note as any).archived]);

  function notifyImages(next: Array<{ id: number; url: string }>) {
    try { (onChange as any)?.({ type: 'images', noteId: note.id, images: next }); } catch {}
  }

  function notifyColor(next: string) {
    try { (onChange as any)?.({ type: 'color', noteId: note.id, color: next || '' }); } catch {}
  }

  function setImagesWithNotify(updater: (prev: Array<{ id: number; url: string }>) => Array<{ id: number; url: string }>) {
    setImages((prev) => {
      const next = updater(prev);
      try { setTimeout(() => notifyImages(next), 0); } catch {}
      return next;
    });
  }

  const [showCollaborator, setShowCollaborator] = useState(false);
  const [collaborators, setCollaborators] = useState<Array<{ collabId?: number; userId: number; email: string; name?: string; userImageUrl?: string }>>([]);
  const [labels, setLabels] = useState<Array<{ id: number; name: string }>>(() => (note.noteLabels || []).map((nl:any) => nl.label).filter((l:any) => l && typeof l.id === 'number' && typeof l.name === 'string'));
  const [viewerCollections, setViewerCollections] = React.useState<Array<{ id: number; name: string; parentId: number | null }>>(() => {
    try {
      const arr = (note as any).viewerCollections;
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((c: any) => c && typeof c.id === 'number' && typeof c.name === 'string')
        .map((c: any) => ({ id: Number(c.id), name: String(c.name), parentId: (c.parentId == null ? null : Number(c.parentId)) }));
    } catch {
      return [];
    }
  });
  const [showMore, setShowMore] = useState(false);
  const [moreAnchorPoint, setMoreAnchorPoint] = useState<{ x:number; y:number } | null>(null);
  const [showMoveToCollection, setShowMoveToCollection] = useState(false);

  const [expandedMeta, setExpandedMeta] = React.useState<null | 'collab' | 'labels' | 'collections'>(null);
  const [collectionPathById, setCollectionPathById] = React.useState<Record<number, string>>({});

  const [showPalette, setShowPalette] = useState(false);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showTextEditor, setShowTextEditor] = useState(false);
  const [showCompleted, setShowCompleted] = useState<boolean>(true);
  const [rtHtmlFromY, setRtHtmlFromY] = React.useState<string | null>(null);
  const [previewClipped, setPreviewClipped] = useState(false);

  React.useEffect(() => {
    try {
      const arr = (note as any).viewerCollections;
      if (!Array.isArray(arr)) { setViewerCollections([]); return; }
      const next = arr
        .filter((c: any) => c && typeof c.id === 'number' && typeof c.name === 'string')
        .map((c: any) => ({ id: Number(c.id), name: String(c.name), parentId: (c.parentId == null ? null : Number(c.parentId)) }));
      setViewerCollections(next);
    } catch {
      setViewerCollections([]);
    }
  }, [note.id, (note as any).viewerCollections]);

  const isCoarsePointer = React.useMemo(() => {
    try {
      const mq = window.matchMedia;
      return !!(mq && (mq('(pointer: coarse)').matches || mq('(any-pointer: coarse)').matches));
    } catch {
      return false;
    }
  }, []);
  const previewRowAlignItems: React.CSSProperties['alignItems'] = isCoarsePointer ? 'center' : 'flex-start';

  const openEditor = React.useCallback(() => {
    if (note.type === 'CHECKLIST' || (note.items && note.items.length)) setShowEditor(true);
    else setShowTextEditor(true);
  }, [note.type, note.items]);

  const lastOpenRequestRef = React.useRef<number>(0);
  React.useEffect(() => {
    const req = Number(openRequest || 0);
    if (!req) return;
    if (req === lastOpenRequestRef.current) return;
    lastOpenRequestRef.current = req;
    openEditor();
    try { onOpenRequestHandled && onOpenRequestHandled(Number(note.id)); } catch {}
  }, [openRequest, openEditor, onOpenRequestHandled, note.id]);

  const isInteractiveTarget = React.useCallback((target: HTMLElement | null): boolean => {
    if (!target) return false;
    try {
      return !!target.closest('button, a, input, textarea, select, [contenteditable="true"], [role="button"], .more-menu, .dropdown, .color-palette');
    } catch {
      return false;
    }
  }, []);

  const scheduleSnapPreview = React.useCallback((forceMeasure = false) => {
    if (snapRafRef.current != null) return;
    snapRafRef.current = requestAnimationFrame(() => {
      snapRafRef.current = null;
      const el = bodyRef.current;
      if (!el) return;
      try {
        // Only snap when something is actually clipped; avoid shrinking previews unnecessarily.
        const clipped = el.scrollHeight > el.clientHeight + 1;
        if (!clipped) {
          // Clear any previous snap.
          if (el.style.maxHeight) el.style.maxHeight = '';
          lastSnapUnitRef.current = null;
          lastSnapBaseRef.current = null;
          return;
        }

        // Measure how much vertical space the preview area *would* have without our snapping.
        // We only clear max-height on explicit recalc/resize to avoid ResizeObserver feedback loops.
        const prevMaxHeight = el.style.maxHeight;
        if (forceMeasure && prevMaxHeight) {
          el.style.maxHeight = '';
          void el.getBoundingClientRect();
        }

        const available = el.clientHeight;
        if (!Number.isFinite(available) || available <= 0) {
          if (forceMeasure && prevMaxHeight) el.style.maxHeight = prevMaxHeight;
          return;
        }

        let unit = 0;
        // Snap to computed line-height so we don't cut text mid-line.
        // For checklists, items can wrap (up to 4 lines), so row height isn't a stable unit.
        const lhSource = (noteItems && noteItems.length > 0)
          ? ((el.querySelector('.note-item-text') as HTMLElement | null) ?? el)
          : el;
        const lh = parseFloat(getComputedStyle(lhSource).lineHeight || '0');
        if (Number.isFinite(lh) && lh > 0) unit = lh;

        // Guardrails.
        if (!Number.isFinite(unit) || unit < 12) {
          if (prevMaxHeight) el.style.maxHeight = prevMaxHeight;
          return;
        }

        // If we're re-measuring, but base space & unit haven't changed, do nothing.
        if (
          forceMeasure &&
          lastSnapUnitRef.current != null &&
          lastSnapBaseRef.current != null &&
          Math.abs(lastSnapUnitRef.current - unit) < 0.5 &&
          Math.abs(lastSnapBaseRef.current - available) < 0.5
        ) {
          return;
        }

        const remainder = available % unit;
        // If we're already very close to a boundary, don't thrash.
        if (remainder < 2 || unit - remainder < 2) {
          // If we cleared max-height to measure, restore it.
          if (forceMeasure && prevMaxHeight) el.style.maxHeight = prevMaxHeight;
          return;
        }

        const snapped = Math.max(unit, Math.floor(available - remainder));
        // Apply the snap (shrink a tiny amount to end on a full row/line).
        el.style.maxHeight = `${snapped}px`;
        lastSnapUnitRef.current = unit;
        lastSnapBaseRef.current = available;
      } catch {
        // no-op
      }
    });
  }, [noteItems]);

  React.useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const check = () => {
      try {
        const bodyClipped = el.scrollHeight > el.clientHeight + 1;
        setPreviewClipped(bodyClipped);
      } catch {}
    };

    // Run after paint so layout has settled.
    const raf = requestAnimationFrame(() => {
      check();
      scheduleSnapPreview(true);
    });
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(() => {
        check();
        scheduleSnapPreview();
      });
      ro.observe(el);
    } catch {}

    const onRecalc = () => scheduleSnapPreview(true);
    window.addEventListener('notes-grid:recalc', onRecalc as any);
    window.addEventListener('resize', onRecalc as any);

    return () => {
      try { cancelAnimationFrame(raf); } catch {}
      try { ro && ro.disconnect(); } catch {}
      try { window.removeEventListener('notes-grid:recalc', onRecalc as any); } catch {}
      try { window.removeEventListener('resize', onRecalc as any); } catch {}
      if (snapRafRef.current != null) {
        try { cancelAnimationFrame(snapRafRef.current); } catch {}
        snapRafRef.current = null;
      }
    };
  }, [note.id, title, noteItems.length, showCompleted, rtHtmlFromY, note.body, images.length, labels.length, scheduleSnapPreview]);

  React.useEffect(() => {
    const el = imagesWrapRef.current;
    if (!el) return;
    const GAP = 6;
    const compute = () => {
      try {
        const css = getComputedStyle(document.documentElement);
        const thumbRaw = css.getPropertyValue('--image-thumb-size') || '';
        const thumbW = Math.max(24, parseInt(String(thumbRaw).trim(), 10) || 96);
        const w = el.clientWidth || 0;
        const perRow = Math.max(1, Math.floor((w + GAP) / (thumbW + GAP)));
        setThumbsPerRow(perRow);
      } catch {}
    };
    compute();
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(() => compute());
      ro.observe(el);
    } catch {}
    window.addEventListener('resize', compute);
    window.addEventListener('notes-grid:recalc', compute as any);
    return () => {
      try { ro && ro.disconnect(); } catch {}
      window.removeEventListener('resize', compute);
      window.removeEventListener('notes-grid:recalc', compute as any);
    };
  }, []);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const { token, user } = useAuth();

  React.useEffect(() => {
    const onCollectionsChanged = (ev: Event) => {
      try {
        const ce = ev as CustomEvent<any>;
        const detail = ce?.detail || {};
        if (detail?.invalidateAll) {
          setCollectionPathById({});
          return;
        }
        const ids = Array.isArray(detail?.ids) ? detail.ids : (Number.isFinite(Number(detail?.id)) ? [Number(detail.id)] : []);
        if (!ids.length) return;
        setCollectionPathById((prev) => {
          const next = { ...prev };
          for (const id of ids) {
            try { delete (next as any)[Number(id)]; } catch {}
          }
          return next;
        });
      } catch {}
    };

    try { window.addEventListener('collections:changed', onCollectionsChanged as any); } catch {}
    return () => {
      try { window.removeEventListener('collections:changed', onCollectionsChanged as any); } catch {}
    };
  }, []);

  const neededCollectionIdsKey = React.useMemo(() => {
    try {
      const ids = viewerCollections
        .map((c) => Number(c.id))
        .filter((id) => Number.isFinite(id));
      if (expandedMeta !== 'collections') return '';
      return ids.join(',');
    } catch {
      return '';
    }
  }, [viewerCollections, expandedMeta]);

  React.useEffect(() => {
    if (!token) return;
    if (!viewerCollections.length) return;

    const neededIds = (neededCollectionIdsKey ? neededCollectionIdsKey.split(',').map((s) => Number(s)).filter((n) => Number.isFinite(n)) : []);
    if (!neededIds.length) return;

    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        const missing = neededIds.filter((id) => !collectionPathById[id]);
        if (!missing.length) return;

        const results = await Promise.all(missing.map(async (id) => {
          try {
            const res = await fetch(`/api/collections/${id}/breadcrumb`, {
              headers: { Authorization: token ? `Bearer ${token}` : '' },
              signal: controller.signal,
            });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            const breadcrumb = Array.isArray(data?.breadcrumb) ? data.breadcrumb : [];
            const names = breadcrumb.map((b: any) => String(b?.name || '')).filter(Boolean);
            const path = names.join(' / ');
            return [id, path || (viewerCollections.find((c) => Number(c.id) === id)?.name || String(id))] as const;
          } catch {
            return [id, viewerCollections.find((c) => Number(c.id) === id)?.name || String(id)] as const;
          }
        }));

        if (cancelled) return;
        const patch: Record<number, string> = {};
        for (const [id, path] of results) patch[Number(id)] = String(path || '');
        setCollectionPathById((prev) => ({ ...prev, ...patch }));
      } catch {}
    })();

    return () => {
      cancelled = true;
      try { controller.abort(); } catch {}
    };
  }, [token, viewerCollections, neededCollectionIdsKey, collectionPathById]);
  // Subscribe to Yjs checklist for live card updates
  const ydoc = React.useMemo(() => new Y.Doc(), [note.id]);
  const providerRef = React.useRef<WebsocketProvider | null>(null);
  const yarrayRef = React.useRef<Y.Array<Y.Map<any>> | null>(null);
  React.useEffect(() => {
    const room = `note-${note.id}`;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const serverUrl = `${proto}://${window.location.host}/collab`;
    const provider = new WebsocketProvider(serverUrl, room, ydoc);
    providerRef.current = provider;
    const yarr = ydoc.getArray<Y.Map<any>>('checklist');
    yarrayRef.current = yarr;
    const updateFromY = () => {
      try {
        if (yarr.length === 0) return; // avoid overwriting DB items until doc has content
        const arr = yarr.toArray().map((m) => ({
          id: (typeof m.get('id') === 'number' ? Number(m.get('id')) : undefined),
          content: String(m.get('content') || ''),
          checked: !!m.get('checked'),
          indent: Number(m.get('indent') || 0),
        }));
        setNoteItems(arr);
      } catch {}
    };
    yarr.observeDeep(updateFromY);
    provider.on('sync', (isSynced: boolean) => { if (isSynced) updateFromY(); });
    return () => { try { yarr.unobserveDeep(updateFromY as any); } catch {}; try { provider.destroy(); } catch {}; };
  }, [note.id, ydoc]);

  // Subscribe to Yjs text doc for real-time HTML preview on cards (TEXT notes)
  React.useEffect(() => {
    if (note.type !== 'TEXT') { setRtHtmlFromY(null); return; }
    let ed: Editor | null = null;
    try {
      ed = new Editor({
        extensions: [
          StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
          Link.configure({ openOnClick: false, autolink: true }),
          TextAlign.configure({ types: ['heading', 'paragraph'] }),
          Collaboration.configure({ document: ydoc })
        ],
        content: ''
      });
      const compute = () => {
        try {
          const html = ed?.getHTML() || '';
          const safe = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
          setRtHtmlFromY(safe);
        } catch {}
      };
      ed.on('update', compute);
      // On initial provider sync, compute once
      const provider = providerRef.current;
      const onSync = (isSynced: boolean) => { if (isSynced) compute(); };
      provider?.on('sync', onSync);
      return () => { try { ed?.destroy(); } catch {}; try { provider?.off('sync', onSync as any); } catch {}; };
    } catch {
      // ignore editor init failures
    }
  }, [note.id, note.type, ydoc]);
  // Render a minimal formatted HTML preview from TipTap JSON stored in note.body
  function bodyHtmlPreview(): string {
    const raw = note.body || '';
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const renderMarks = (text: string, marks?: any[]): string => {
      if (!marks || !marks.length) return esc(text);
      return marks.reduce((acc, m) => {
        switch (m.type) {
          case 'bold': return `<strong>${acc}</strong>`;
          case 'italic': return `<em>${acc}</em>`;
          case 'underline': return `<u>${acc}</u>`;
          case 'link': {
            const href = typeof m.attrs?.href === 'string' ? m.attrs.href : '#';
            return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${acc}</a>`;
          }
          default: return acc;
        }
      }, esc(text));
    };
    const renderNode = (node: any, inListItem = false): string => {
      if (!node) return '';
      if (Array.isArray(node)) return node.map(n => renderNode(n, inListItem)).join('');
      const t = node.type;
      if (t === 'text') return renderMarks(node.text || '', node.marks);
      if (t === 'hardBreak') return '<br/>';
      if ((t === 'paragraph' || t === 'heading') && (!node.content || node.content.length === 0)) return inListItem ? '' : '<p></p>';
      const inner = node.content ? renderNode(node.content, t === 'listItem') : '';
      switch (t) {
        case 'paragraph': return `<p>${inner}</p>`;
        case 'heading': {
          const lvl = Math.min(6, Math.max(1, Number(node.attrs?.level || 1)));
          return `<h${lvl}>${inner}</h${lvl}>`;
        }
        case 'bulletList': return `<ul>${inner}</ul>`;
        case 'orderedList': return `<ol>${inner}</ol>`;
        case 'listItem': {
          // TipTap listItem usually wraps a paragraph; flatten to inline
          return `<li>${inner.replace(/^<p>|<\/p>$/g, '')}</li>`;
        }
        case 'blockquote': return `<blockquote>${inner}</blockquote>`;
        case 'codeBlock': return `<pre><code>${esc((node.textContent || '') as string)}</code></pre>`;
        default: return inner;
      }
    };
    try {
      const json = JSON.parse(raw);
      const html = renderNode(json);
      return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    } catch {
      const fallback = esc(raw).replace(/\n/g, '<br/>');
      return DOMPurify.sanitize(`<p>${fallback}</p>`);
    }
  }

  // keep local bg/textColor in sync when the parent reloads the note (e.g., after page refresh)
  React.useEffect(() => {
    const base = ((note as any).viewerColor || note.color || '') as string;
    setBg(base || '');
    setTextColor(base ? contrastColorForBackground(base) : undefined);
  }, [note.id, (note as any).viewerColor, note.color]);
  React.useEffect(() => {
    setLabels((note.noteLabels || []).map((nl:any) => nl.label).filter((l:any) => l && typeof l.id === 'number' && typeof l.name === 'string'));
  }, [note.noteLabels]);
  React.useEffect(() => { setTitle(note.title || ''); }, [note.title]);
  React.useEffect(() => { setImages(((note as any).images || []).map((i:any)=>({ id:Number(i.id), url:String(i.url) }))); }, [(note as any).images]);
  // Keep collaborators in sync with server-provided data on note reloads
  React.useEffect(() => {
    try {
      const arr = ((note as any).collaborators || []).map((c:any) => {
        const u = (c && (c.user || {}));
        if (u && typeof u.id === 'number' && typeof u.email === 'string') {
          const img = (typeof (u as any).userImageUrl === 'string')
            ? String((u as any).userImageUrl)
            : (typeof (c as any).userImageUrl === 'string' ? String((c as any).userImageUrl) : undefined);
          return { collabId: Number(c.id), userId: Number(u.id), email: String(u.email), name: (typeof u.name === 'string' ? String(u.name) : undefined), userImageUrl: img };
        }
        return null;
      }).filter(Boolean);
      setCollaborators(arr as any);
    } catch {}
  }, [(note as any).collaborators]);

  // track pointer down/up to distinguish clicks from small drags (prevents accidental reflows)
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = React.useRef(false);

  async function onPickColor(color: string) {
    // first palette entry is the "Default" swatch (empty string).
    // Selecting it restores the app's default background and sets text to the original muted color.
    const next = color || '';
    try {
      const res = await fetch(`/api/notes/${note.id}/prefs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ color: next })
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      console.error('Failed to save color preference', err);
      window.alert('Failed to save color preference');
    }
    if (!next) {
      setBg('');
      setTextColor('var(--muted)');
    } else {
      setBg(next);
      setTextColor(contrastColorForBackground(next));
    }
    try { notifyColor(next); } catch {}
    setShowPalette(false);
  }

  function onAddImageUrl(url?: string | null) {
    setShowImageDialog(false);
    if (!url) return;
    // Persist to server and update local images list
    (async () => {
      try {
        const res = await fetch(`/api/notes/${note.id}/images`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' }, body: JSON.stringify({ url }) });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const img = data.image || null;
        if (img && img.id && img.url) {
          setImagesWithNotify((s) => {
            const exists = s.some(x => Number(x.id) === Number(img.id));
            if (exists) return s;
            return [...s, { id: Number(img.id), url: String(img.url) }];
          });
        }
      } catch (err) {
        console.error('Failed to attach image', err);
        // Fallback: show locally even if save fails
        setImagesWithNotify((s) => {
          const exists = s.some(x => String(x.url) === String(url));
          if (exists) return s;
          return [...s, { id: Date.now(), url }];
        });
        window.alert('Failed to attach image to server; showing locally');
      }
    })();
  }

  async function toggleItemChecked(itemId: number, checked: boolean) {
    const yarr = yarrayRef.current;
    if (yarr) {
      const idx = yarr.toArray().findIndex((m) => (typeof m.get('id') === 'number' ? Number(m.get('id')) === itemId : false));
      if (idx >= 0) {
        const m = yarr.get(idx) as Y.Map<any>;
        m.set('checked', checked);
        const indent = Number(m.get('indent') || 0);
        if (indent === 0) {
          for (let i = idx + 1; i < yarr.length; i++) {
            const child = yarr.get(i) as Y.Map<any>;
            const childIndent = Number(child.get('indent') || 0);
            if (childIndent > 0) child.set('checked', checked); else break;
          }
        }
        return;
      }
    }
    // Fallback to REST if Yjs not available
    try {
      const res = await fetch(`/api/notes/${note.id}/items/${itemId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ checked }) });
      if (!res.ok) throw new Error(await res.text());
      setNoteItems(s => s.map(it => it.id === itemId ? { ...it, checked } : it));
    } catch (err) {
      console.error(err);
      window.alert('Failed to update checklist item — please try again.');
    }
  }

  async function onConfirmReminder(draft: ReminderDraft) {
    setShowReminderPicker(false);
    try {
      // Request permission while we still have a user gesture.
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          await Notification.requestPermission();
        }
      } catch {}

      const res = await fetch(`/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ reminderDueAt: draft.dueAtIso, reminderOffsetMinutes: draft.offsetMinutes }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const updated = data?.note || {};
      try {
        (onChange as any)?.({
          type: 'reminder',
          noteId: Number(note.id),
          reminderDueAt: updated.reminderDueAt ?? draft.dueAtIso,
          reminderOffsetMinutes: (typeof updated.reminderOffsetMinutes === 'number') ? updated.reminderOffsetMinutes : draft.offsetMinutes,
          reminderAt: updated.reminderAt ?? null,
        });
      } catch {
        onChange && onChange();
      }
    } catch (err) {
      console.error(err);
      window.alert('Failed to set reminder');
    }
  }

  async function onClearReminder() {
    setShowReminderPicker(false);
    try {
      const res = await fetch(`/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ reminderDueAt: null }),
      });
      if (!res.ok) throw new Error(await res.text());
      try { (onChange as any)?.({ type: 'reminder', noteId: Number(note.id), reminderDueAt: null, reminderAt: null }); }
      catch { onChange && onChange(); }
    } catch (err) {
      console.error(err);
      window.alert('Failed to clear reminder');
    }
  }

  async function toggleArchive() {
    const next = !archived;
    if (next) {
      const ok = window.confirm('Archive this note?');
      if (!ok) return;
    }

    const prev = archived;
    setArchived(next);
    try {
      const res = await fetch(`/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ archived: next }),
      });
      if (!res.ok) throw new Error(await res.text());
      try { (onChange as any)?.({ type: 'archive', noteId: Number(note.id), archived: next }); } catch { onChange && onChange(); }
    } catch (e) {
      console.error(e);
      setArchived(prev);
      window.alert('Failed to archive note');
    }
  }

  const isTrashed = !!((note as any)?.trashedAt);
  const ownerId = (typeof (note as any).owner?.id === 'number' ? Number((note as any).owner.id) : undefined);
  const currentUserId = (user && (user as any).id) ? Number((user as any).id) : undefined;
  const isOwner = !!(ownerId && currentUserId && ownerId === currentUserId);

  async function onRestoreNote() {
    if (!isOwner) {
      window.alert('Only the note owner can restore this note.');
      return;
    }
    try {
      const res = await fetch(`/api/notes/${note.id}/restore`, { method: 'POST', headers: { Authorization: token ? `Bearer ${token}` : '' } });
      if (!res.ok) throw new Error(await res.text());
      onChange && onChange();
    } catch (err) {
      console.error(err);
      window.alert('Failed to restore note');
    }
  }

  async function onDeleteNote() {
    try {
      if (isTrashed) {
        if (!isOwner) {
          window.alert('Only the note owner can permanently delete this note.');
          return;
        }
        const ok = window.confirm('Delete this note permanently? This cannot be undone.');
        if (!ok) return;
        const res = await fetch(`/api/notes/${note.id}/purge`, { method: 'DELETE', headers: { Authorization: token ? `Bearer ${token}` : '' } });
        if (!res.ok) throw new Error(await res.text());
        onChange && onChange();
        return;
      }

      if (ownerId && currentUserId && ownerId !== currentUserId) {
        // Collaborator: remove self from this note
        const self = collaborators.find(c => typeof c.userId === 'number' && c.userId === currentUserId);
        if (self && typeof self.collabId === 'number') {
          const res = await fetch(`/api/notes/${note.id}/collaborators/${self.collabId}`, { method: 'DELETE', headers: { Authorization: token ? `Bearer ${token}` : '' } });
          if (!res.ok) throw new Error(await res.text());
          onChange && onChange();
          return;
        }
        window.alert('You are not the owner and could not find your collaborator entry to remove.');
        return;
      }
      // Owner: move note to trash for everyone
      const res = await fetch(`/api/notes/${note.id}`, { method: 'DELETE', headers: { Authorization: token ? `Bearer ${token}` : '' } });
      if (!res.ok) throw new Error(await res.text());
      onChange && onChange();
    } catch (err) {
      console.error(err);
      window.alert('Failed to move to trash or leave note');
    }
  }
  const [showLabels, setShowLabels] = useState(false);
  function onAddLabel() { setShowLabels(true); }
  async function onUncheckAll() {
    try {
      const updated = (noteItems || []).map((it:any, idx:number) => ({ id: it.id, content: it.content, checked: false, ord: typeof it.ord === 'number' ? it.ord : idx, indent: typeof it.indent === 'number' ? it.indent : 0 }));
      setNoteItems(updated);

      // Also update the Yjs checklist so it persists across refresh and syncs to collaborators.
      try {
        const yarr = yarrayRef.current;
        if (yarr && yarr.length > 0) {
          for (let i = 0; i < yarr.length; i++) {
            const m = yarr.get(i) as any;
            if (!m) continue;
            // Preserve id field if present (helps downstream DB sync assign IDs).
            try { if (typeof m.get('id') === 'number') m.set('id', m.get('id')); } catch {}
            try { m.set('checked', false); } catch {}
          }
        }
      } catch {}

      const res = await fetch(`/api/notes/${note.id}/items`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' }, body: JSON.stringify({ items: updated }) });
      if (!res.ok) throw new Error(await res.text());
      // no full reload needed; local state already reflects changes
    } catch (err) {
      console.error(err);
      window.alert('Failed to uncheck all items');
    }
  }
  async function onCheckAll() {
    try {
      const updated = (noteItems || []).map((it:any, idx:number) => ({ id: it.id, content: it.content, checked: true, ord: typeof it.ord === 'number' ? it.ord : idx, indent: typeof it.indent === 'number' ? it.indent : 0 }));
      setNoteItems(updated);

      // Also update the Yjs checklist so it persists across refresh and syncs to collaborators.
      try {
        const yarr = yarrayRef.current;
        if (yarr && yarr.length > 0) {
          for (let i = 0; i < yarr.length; i++) {
            const m = yarr.get(i) as any;
            if (!m) continue;
            try { if (typeof m.get('id') === 'number') m.set('id', m.get('id')); } catch {}
            try { m.set('checked', true); } catch {}
          }
        }
      } catch {}

      const res = await fetch(`/api/notes/${note.id}/items`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' }, body: JSON.stringify({ items: updated }) });
      if (!res.ok) throw new Error(await res.text());
      // no full reload needed; local state already reflects changes
    } catch (err) {
      console.error(err);
      window.alert('Failed to check all items');
    }
  }

  function onCollaboratorSelect(selected: { id: number; email: string; name?: string; userImageUrl?: string }) {
    setCollaborators((s) => {
      if (s.find(x => x.userId === selected.id)) return s;
      return [...s, { userId: selected.id, email: selected.email, name: selected.name, userImageUrl: selected.userImageUrl }];
    });
    setShowCollaborator(false);
    // Persist collaborator on server
    (async () => {
      try {
        const res = await fetch(`/api/notes/${note.id}/collaborators`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
          body: JSON.stringify({ email: selected.email })
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const collab = (data && (data.collaborator || null));
        if (collab && typeof collab.id === 'number') {
          setCollaborators((s) => s.map(c => (c.userId === selected.id ? { ...c, collabId: Number(collab.id) } : c)));
        }
      } catch (err) {
        console.error('Failed to add collaborator', err);
        window.alert('Failed to add collaborator');
        // Revert optimistic add on failure
        setCollaborators((s) => s.filter(c => c.userId !== selected.id));
      }
    })();
  }

  async function onRemoveCollaborator(collabId: number) {
    try {
      const res = await fetch(`/api/notes/${note.id}/collaborators/${collabId}`, { method: 'DELETE', headers: { Authorization: token ? `Bearer ${token}` : '' } });
      if (!res.ok) throw new Error(await res.text());
      setCollaborators((s) => s.filter(c => c.collabId !== collabId));
      onChange && onChange();
    } catch (err) {
      console.error('Failed to remove collaborator', err);
      window.alert('Failed to remove collaborator');
    }
  }

  async function onSetCardWidth(span: 1 | 2 | 3) {
    try {
      const res = await fetch(`/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ cardSpan: span })
      });
      if (!res.ok) throw new Error(await res.text());
      // Ask grid to recalc columns/width and prompt a soft reload
      try { window.dispatchEvent(new Event('notes-grid:recalc')); } catch {}
      onChange && onChange();
    } catch (err) {
      console.error('Failed to set card width', err);
      window.alert('Failed to set card width');
    }
  }

  // Normalize legacy saved defaults when theme switches: if a note saved the default dark
  // or light background explicitly, treat it as theme-default so it adapts across themes.
  const normalizedBg = (() => {
    const v = (bg || '').toLowerCase().trim();
    // Known dark defaults from prior versions and related UI surfaces
    const darkDefaults = new Set(["#1e1e1e", "#121212", "#181818", "#1c1c1c", "#161616"]);
    const lightDefaults = new Set(["#ffffff", "#fff"]);
    if (theme.effective === 'light' && (darkDefaults.has(v))) return '';
    if (theme.effective === 'dark' && (lightDefaults.has(v))) return '';
    return bg;
  })();

  // Derive the final text color from the effective background; for theme-default bg use inherit
  const finalTextColor: string | undefined = normalizedBg ? contrastColorForBackground(normalizedBg) : undefined;

  // compute chip background so it's visible against selected background/text color
  const chipBg = (finalTextColor === "#ffffff" || finalTextColor === "var(--muted)")
    ? "rgba(0,0,0,0.12)"
    : "rgba(255,255,255,0.06)";

    // Compute participant chips (owner + collaborators), excluding current user
    const chipParticipants: Array<{ key: string | number; userId: number; name: string; email: string; userImageUrl?: string }> = [];
    try {
      const currentUserId = (user && (user as any).id) ? Number((user as any).id) : undefined;
      const owner = (note as any).owner || null;
      if (owner && typeof owner.id === 'number' && owner.id !== currentUserId) {
        const ownerName = (typeof owner.name === 'string' && owner.name) ? owner.name : String(owner.email || '').split("@")[0];
        chipParticipants.push({ key: `owner-${owner.id}`, userId: Number(owner.id), name: ownerName, email: String(owner.email || ''), userImageUrl: (typeof (owner as any).userImageUrl === 'string' ? String((owner as any).userImageUrl) : undefined) });
      }
      for (const c of collaborators) {
        if (typeof c.userId === 'number' && c.userId !== currentUserId) {
          const nm = (c.name && c.name.length) ? c.name : String(c.email).split('@')[0];
          chipParticipants.push({ key: c.collabId || `u-${c.userId}`, userId: Number(c.userId), name: nm, email: c.email, userImageUrl: c.userImageUrl });
        }
      }
    } catch {}

    const styleVars: React.CSSProperties = {
      background: normalizedBg || undefined,
      color: finalTextColor || undefined,
      opacity: archived ? 0.6 : 1,
      position: 'relative',
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      ['--chip-bg' as any]: chipBg,
    } as React.CSSProperties;
    // Only override checkbox vars when the note has an explicit background color.
    if (normalizedBg) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      styleVars['--checkbox-bg'] = normalizedBg;
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      styleVars['--checkbox-border'] = contrastColorForBackground(normalizedBg);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      styleVars['--checkbox-stroke'] = contrastColorForBackground(normalizedBg);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      styleVars['--checkbox-checked-bg'] = normalizedBg;
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      styleVars['--checkbox-checked-mark'] = contrastColorForBackground(normalizedBg);
    }

    return (
    <article
      ref={(el) => { noteRef.current = el as HTMLElement | null; }}
      className={`note-card${labels.length > 0 ? ' has-labels' : ''}${viewerCollections.length > 0 ? ' has-collections' : ''}${(noteItems && noteItems.length > 0) ? ' has-checklist' : ''}`}
      style={styleVars}
      {...(!title ? (dragHandleAttributes || {}) : {})}
      {...(!title ? (() => {
        const ls: any = dragHandleListeners || {};
        const { onKeyDown: _dragKeyDown, ...rest } = ls;
        return rest;
      })() : {})}
      data-clipped={previewClipped ? '1' : undefined}
      onClick={(e) => {
        const t = e.target as HTMLElement | null;
        if (isInteractiveTarget(t)) return;
        openEditor();
      }}
    >
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} />

      {(() => {
        const due = (note as any)?.reminderDueAt;
        if (!due) return null;
        const ms = Date.parse(String(due));
        const d = Number.isFinite(ms) ? new Date(ms) : null;
        const title = d ? `Reminder: ${d.toLocaleString()}` : 'Reminder set';
        return (
          <div className="note-reminder-bell" aria-hidden title={title}>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2z"/>
              <path d="M18 8V7a6 6 0 1 0-12 0v1c0 3.5-2 5-2 5h16s-2-1.5-2-5z"/>
            </svg>
          </div>
        );
      })()}

      {title && (
        <div
          className="note-title"
          {...(dragHandleAttributes || {})}
          {...(() => {
            const ls: any = dragHandleListeners || {};
            const { onKeyDown: _dragKeyDown, ...rest } = ls;
            return rest;
          })()}
          style={{ cursor: 'pointer' }}
          onClick={() => { openEditor(); }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            try {
              const dragKeyDown = (dragHandleListeners as any)?.onKeyDown;
              if (typeof dragKeyDown === 'function') dragKeyDown(e);
            } catch {}
            if ((e as any).defaultPrevented) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openEditor();
            }
          }}
        >
          {title}
        </div>
      )}

      {(() => {
        const hasAnyMeta = (chipParticipants.length > 0) || (labels.length > 0) || (viewerCollections.length > 0);
        if (!hasAnyMeta) return null;

        const panelId = `note-meta-panel-${Number(note.id)}`;
        const withPath = viewerCollections
          .map((c) => ({ ...c, path: collectionPathById[Number(c.id)] || String(c.name || '') }))
          .sort((a, b) => String(a.path).localeCompare(String(b.path)));

        const closeOnMouseLeave = () => {
          if (isCoarsePointer) return;
          setExpandedMeta(null);
        };

        return (
          <div
            className={`note-meta${expandedMeta ? ' is-expanded' : ''}`}
            onPointerDown={(e) => { e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); }}
            onMouseLeave={closeOnMouseLeave}
            onBlurCapture={(e) => {
              const next = (e.relatedTarget as HTMLElement | null);
              if (next && (e.currentTarget as HTMLElement).contains(next)) return;
              setExpandedMeta(null);
            }}
          >
            <div className="note-meta-bar">
              {chipParticipants.length > 0 && (
                <button
                  type="button"
                  className={`chip chip--meta${expandedMeta === 'collab' ? ' is-active' : ''}`}
                  aria-expanded={expandedMeta === 'collab'}
                  aria-controls={panelId}
                  title="Collaborators"
                  onMouseEnter={() => { if (!isCoarsePointer) setExpandedMeta('collab'); }}
                  onFocus={(e) => {
                    // On mobile, taps often trigger focus before click. If we open on focus,
                    // the subsequent click toggles it closed, which feels like a double-tap.
                    // Only auto-open on keyboard focus.
                    try {
                      const isFocusVisible = (e.currentTarget as any)?.matches?.(':focus-visible');
                      if (!isFocusVisible) return;
                    } catch {}
                    setExpandedMeta('collab');
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedMeta((s) => s === 'collab' ? null : 'collab');
                  }}
                >
                  <FontAwesomeIcon icon={faUsers} className="meta-fa-icon" />
                  <span>{chipParticipants.length}</span>
                </button>
              )}

              {labels.length > 0 && (
                <button
                  type="button"
                  className={`chip chip--meta${expandedMeta === 'labels' ? ' is-active' : ''}`}
                  aria-expanded={expandedMeta === 'labels'}
                  aria-controls={panelId}
                  title="Labels"
                  onMouseEnter={() => { if (!isCoarsePointer) setExpandedMeta('labels'); }}
                  onFocus={(e) => {
                    try {
                      const isFocusVisible = (e.currentTarget as any)?.matches?.(':focus-visible');
                      if (!isFocusVisible) return;
                    } catch {}
                    setExpandedMeta('labels');
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedMeta((s) => s === 'labels' ? null : 'labels');
                  }}
                >
                  <FontAwesomeIcon icon={faTag} className="meta-fa-icon" />
                  <span>{labels.length}</span>
                </button>
              )}

              {viewerCollections.length > 0 && (
                <button
                  type="button"
                  className={`chip chip--meta chip--meta-collections${expandedMeta === 'collections' ? ' is-active' : ''}`}
                  aria-expanded={expandedMeta === 'collections'}
                  aria-controls={panelId}
                  title={`${viewerCollections.length} collections`}
                  onMouseEnter={() => { if (!isCoarsePointer) setExpandedMeta('collections'); }}
                  onFocus={(e) => {
                    try {
                      const isFocusVisible = (e.currentTarget as any)?.matches?.(':focus-visible');
                      if (!isFocusVisible) return;
                    } catch {}
                    setExpandedMeta('collections');
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedMeta((s) => s === 'collections' ? null : 'collections');
                  }}
                >
                  <FontAwesomeIcon icon={faFolder} className="meta-fa-icon" />
                  <span>{viewerCollections.length}</span>
                </button>
              )}
            </div>

            <div
              id={panelId}
              className={`note-meta-panel${expandedMeta ? ' is-open' : ''}`}
              role="region"
              aria-label="Note metadata"
            >
              {expandedMeta === 'collab' && (
                <div className="collab-chips" aria-label="Collaborators">
                  {chipParticipants.map((p) => {
                    const mode = ((user as any)?.chipDisplayMode) || 'image+text';
                    const showImg = (mode === 'image' || mode === 'image+text') && !!p.userImageUrl;
                    const showText = (mode === 'text' || mode === 'image+text');
                    return (
                      <button
                        key={p.key}
                        type="button"
                        className="chip"
                        title={p.email}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          try { (onChange as any)?.({ type: 'filter:collaborator', noteId: Number(note.id), userId: Number(p.userId), name: String(p.name || '') }); } catch {}
                        }}
                      >
                        {showImg ? (
                          <img src={p.userImageUrl!} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover' }} />
                        ) : null}
                        {showText ? (<span>{p.name}</span>) : null}
                      </button>
                    );
                  })}
                </div>
              )}

              {expandedMeta === 'labels' && (
                <div className="label-chips" aria-label="Labels">
                  {labels.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className="chip"
                      onClick={(e) => {
                        e.stopPropagation();
                        try { (onChange as any)?.({ type: 'filter:labels', noteId: Number(note.id), labelId: Number(l.id), labelName: String(l.name || '') }); } catch {}
                      }}
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
              )}

              {expandedMeta === 'collections' && (
                <div className="note-collections" aria-label="Collections">
                  <div className="note-collections-list" role="list">
                    {withPath.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="chip note-collection-chip"
                        title={c.path}
                        onClick={(e) => {
                          e.stopPropagation();
                          try { (onChange as any)?.({ type: 'filter:collection', noteId: Number(note.id), collectionId: Number(c.id), collectionName: String(c.name || '') }); } catch {}
                        }}
                      >
                        {c.path}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <div
        className="note-body"
        ref={bodyRef}
        onClick={() => { openEditor(); }}
      >
        {noteItems && noteItems.length > 0 ? (
          <div>
            {/** Show incomplete first, then optionally completed items. Preserve indent in preview. */}
            <div className="note-items-list">
              {(noteItems.filter((it:any) => !it.checked)).map((it, idx) => (
                <div key={typeof it.id === 'number' ? it.id : `i-${idx}`} className="note-item" style={{ display: 'flex', gap: 8, alignItems: previewRowAlignItems, marginLeft: ((it.indent || 0) * 16) }}>
                  <button
                    className={`note-checkbox ${it.checked ? 'checked' : ''}`}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleItemChecked(it.id, !it.checked); }}
                    aria-pressed={!!it.checked}
                    style={{ background: 'var(--checkbox-bg)', border: '2px solid var(--checkbox-border)', color: 'var(--checkbox-stroke)' }}
                  >
                    {it.checked && (
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
                        <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                  <div className="note-item-text">
                    <div className="rt-html" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(String(it.content || ''), { USE_PROFILES: { html: true } }) }} />
                  </div>
                </div>
              ))}
            </div>

            {/** Completed items block */}
            {noteItems.some((it:any) => it.checked) && (
              <div style={{ marginTop: 6 }}>
                <button className="btn completed-toggle" onClick={(e) => { e.stopPropagation(); setShowCompleted(s => !s); }} aria-expanded={showCompleted} aria-controls={`completed-${note.id}`}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ transform: showCompleted ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>{'▸'}</span>
                    <span>{noteItems.filter((it:any)=>it.checked).length} completed items</span>
                  </span>
                </button>
              </div>
            )}

            {showCompleted && noteItems.some((it:any) => it.checked) && (
              <div className="note-items-list" style={{ marginTop: 6 }}>
                {noteItems.filter((it:any) => it.checked).map((it, idx) => (
                  <div key={`c-${typeof it.id === 'number' ? it.id : idx}`} className="note-item completed" style={{ display: 'flex', gap: 8, alignItems: previewRowAlignItems, marginLeft: ((it.indent || 0) * 16), opacity: 0.7 }}>
                    <button
                      className={`note-checkbox ${it.checked ? 'checked' : ''}`}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleItemChecked(it.id, !it.checked); }}
                      aria-pressed={!!it.checked}
                      style={{ background: 'var(--checkbox-bg)', border: '2px solid var(--checkbox-border)', color: 'var(--checkbox-stroke)' }}
                    >
                      {it.checked && (
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
                          <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                    <div className="note-item-text" style={{ textDecoration: 'line-through' }}>
                      <div className="rt-html" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(String(it.content || ''), { USE_PROFILES: { html: true } }) }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          (rtHtmlFromY || note.body) ? (
            <div className="note-html" dangerouslySetInnerHTML={{ __html: (rtHtmlFromY || bodyHtmlPreview()) }} />
          ) : null
        )}
      </div>

      {images && images.length > 0 && (
        <div className="note-images" ref={imagesWrapRef}>
          {(() => {
            const maxSlots = Math.max(1, thumbsPerRow) * 3;
            const visible = images.slice(0, Math.min(images.length, maxSlots));
            const hiddenCount = Math.max(0, images.length - maxSlots);
            return visible.map((img, idx) => (
            <button
              key={img.id}
              className="note-image"
              style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
              onClick={() => { openEditor(); }}
            >
              <img src={img.url} alt="note image" />
              {hiddenCount > 0 && idx === visible.length - 1 && (
                <span className="note-image-moreOverlay" aria-label={`${hiddenCount} more images`}>+{hiddenCount} more</span>
              )}
            </button>
            ));
          })()}
        </div>
      )}



      {/* Hover zone to reveal footer only near the bottom */}
      <div className="footer-hover-zone" aria-hidden />
      {/* Protected footer region for actions (not affected by note bg/text color) */}
      <div className="note-footer" aria-hidden={false}>
        <div className="note-actions">
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

          <button
            className="tiny"
            onClick={toggleArchive}
            aria-label={archived ? 'Unarchive' : 'Archive'}
            title={archived ? 'Unarchive' : 'Archive'}
          >
            {archived ? (
              // Unarchive icon (box with upward arrow)
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M20.54 5.23L19.4 4H4.6L3.46 5.23 3 6v2h18V6l-.46-.77zM6 10v9h12v-9H6z"/>
                <path d="M12 17l-4-4h3V9h2v4h3l-4 4z"/>
              </svg>
            ) : (
              // Archive icon
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M20.54 5.23L19.4 4H4.6L3.46 5.23 3 6v2h18V6l-.46-.77zM6 10v9h12V10H6zm3 2h6v2H9v-2z"/>
              </svg>
            )}
          </button>

          <button
            className="tiny"
            onClick={(e) => { e.stopPropagation(); setMoreAnchorPoint({ x: e.clientX, y: e.clientY }); setShowMore(s => !s); }}
            aria-label="More"
            title="More"
          >
            ⋮
          </button>
        </div>
      </div>

      {showMore && (
        <MoreMenu
          anchorRef={noteRef}
          anchorPoint={moreAnchorPoint}
          itemsCount={isTrashed && isOwner ? 6 : 5}
          onClose={() => setShowMore(false)}
          onDelete={onDeleteNote}
          deleteLabel={isTrashed ? 'Delete permanently' : (isOwner ? 'Move to trash' : 'Leave note')}
          onRestore={isTrashed && isOwner ? onRestoreNote : undefined}
          restoreLabel="Restore"
          onMoveToCollection={() => setShowMoveToCollection(true)}
          onAddLabel={onAddLabel}
          onUncheckAll={(note.type === 'CHECKLIST' || (noteItems && noteItems.length > 0)) ? onUncheckAll : undefined}
          onCheckAll={(note.type === 'CHECKLIST' || (noteItems && noteItems.length > 0)) ? onCheckAll : undefined}
          onSetWidth={onSetCardWidth}
        />
      )}

      {showMoveToCollection && (
        <MoveToCollectionModal
          noteId={Number(note.id)}
          onClose={() => setShowMoveToCollection(false)}
          onChanged={(collections) => {
            try {
              const next = Array.isArray(collections)
                ? collections
                    .map((c: any) => ({ id: Number(c.id), name: String(c.name || ''), parentId: (c.parentId == null ? null : Number(c.parentId)) }))
                    .filter((c: any) => Number.isFinite(c.id) && c.name.length)
                : [];
              setViewerCollections(next);
            } catch {}
            try { (onChange as any)?.({ type: 'collections', noteId: Number(note.id), collections }); } catch {}
          }}
        />
      )}
      {showLabels && (
        <LabelsDialog
          noteId={note.id}
          onClose={() => setShowLabels(false)}
          onUpdated={(ls) => {
            setLabels(ls);
            try { (onChange as any)?.({ type: 'labels', noteId: note.id, labels: ls }); } catch {}
          }}
        />
      )}

      {showCollaborator && (
        <CollaboratorModal
          onClose={() => setShowCollaborator(false)}
          onSelect={onCollaboratorSelect}
          current={(() => {
            const arr: Array<{ collabId?: number; userId: number; email: string; name?: string; userImageUrl?: string }> = [];
            const currentUserId = (user && (user as any).id) ? Number((user as any).id) : undefined;
            const owner = (note as any).owner || null;
            if (owner && typeof owner.id === 'number' && owner.id !== currentUserId) {
              arr.push({
                userId: Number(owner.id),
                email: String(owner.email || ''),
                name: (typeof owner.name === 'string' ? owner.name : undefined),
                userImageUrl: (typeof (owner as any).userImageUrl === 'string' ? String((owner as any).userImageUrl) : undefined),
              });
            }
            for (const c of collaborators) {
              if (typeof c.userId === 'number') {
                arr.push({ collabId: c.collabId, userId: c.userId, email: c.email, name: c.name, userImageUrl: c.userImageUrl });
              }
            }
            return arr;
          })()}
          ownerId={(typeof (note as any).owner?.id === 'number' ? Number((note as any).owner.id) : ((user as any)?.id))}
          onRemove={onRemoveCollaborator}
        />
      )}

      {showPalette && <ColorPalette anchorRef={noteRef} onPick={onPickColor} onClose={() => setShowPalette(false)} />}

      {showImageDialog && <ImageDialog onClose={() => setShowImageDialog(false)} onAdd={onAddImageUrl} />}

      {showReminderPicker && (
        <ReminderPicker
          onClose={() => setShowReminderPicker(false)}
          onConfirm={onConfirmReminder}
          onClear={((note as any)?.reminderDueAt ? onClearReminder : undefined)}
          initialDueAtIso={(note as any)?.reminderDueAt || null}
          initialOffsetMinutes={typeof (note as any)?.reminderOffsetMinutes === 'number' ? Number((note as any).reminderOffsetMinutes) : 30}
        />
      )}
      {showEditor && (
        <ChecklistEditor
          note={{ ...note, items: noteItems, images }}
          noteBg={bg}
          onColorChanged={(next: string) => {
            try {
              const v = String(next || '');
              setBg(v);
              setTextColor(v ? contrastColorForBackground(v) : 'var(--muted)');
              notifyColor(v);
            } catch {}
          }}
          onClose={() => setShowEditor(false)}
          onSaved={({ items, title }) => { setNoteItems(items); setTitle(title); }}
          onImagesUpdated={(imgs) => { setImagesWithNotify(() => imgs); }}
          moreMenu={{
            onDelete: onDeleteNote,
            onAddLabel,
            onMoveToCollection: () => setShowMoveToCollection(true),
            onUncheckAll,
            onCheckAll,
            onSetWidth: onSetCardWidth,
          }}
        />
      )}
      {showTextEditor && (
        <RichTextEditor
          note={{ ...note, images }}
          noteBg={bg}
          onColorChanged={(next: string) => {
            try {
              const v = String(next || '');
              setBg(v);
              setTextColor(v ? contrastColorForBackground(v) : 'var(--muted)');
              notifyColor(v);
            } catch {}
          }}
          onClose={() => setShowTextEditor(false)}
          onSaved={({ title, body }) => { setTitle(title); note.body = body; }}
          onImagesUpdated={(imgs) => { setImagesWithNotify(() => imgs); }}
          moreMenu={{
            onDelete: onDeleteNote,
            onAddLabel,
            onMoveToCollection: () => setShowMoveToCollection(true),
            onSetWidth: onSetCardWidth,
          }}
        />
      )}
    </article>
  );
}
