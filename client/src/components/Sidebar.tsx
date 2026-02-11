import React, { useEffect, useState } from "react";
import { useAuth } from "../authContext";
import { DEFAULT_SORT_CONFIG, type SortConfig, type SortDir, type SortKey, type GroupByKey, type SmartFilterKey } from '../sortTypes';

export default function Sidebar({
  selectedLabelIds = [],
  onToggleLabel,
  onClearLabels,
  collapsed = false,
  onRequestClose,
  onRequestExpand,
  collectionStack = [],
  onCollectionStackChange,
  sortConfig = DEFAULT_SORT_CONFIG,
  onSortConfigChange,
}: {
  selectedLabelIds?: number[];
  onToggleLabel?: (id: number) => void;
  onClearLabels?: () => void;
  collapsed?: boolean;
  onRequestClose?: () => void;
  onRequestExpand?: () => void;
  collectionStack?: Array<{ id: number; name: string }>;
  onCollectionStackChange?: (next: Array<{ id: number; name: string }>) => void;
  sortConfig?: SortConfig;
  onSortConfigChange?: (next: SortConfig) => void;
}) {
  const { token } = useAuth();
  const [labels, setLabels] = useState<Array<{ id: number; name: string }>>([]);
  const [open, setOpen] = useState(false);
  const [sortingOpen, setSortingOpen] = useState(false);
  const [filtersListOpen, setFiltersListOpen] = useState(false);
  const [groupingListOpen, setGroupingListOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);

  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [collections, setCollections] = useState<Array<{ id: number; name: string; parentId: number | null; hasChildren?: boolean; noteCount?: number }>>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  useEffect(() => {
    if (!token) { setLabels([]); return; }
    fetch('/api/labels', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setLabels(Array.isArray(d.labels) ? d.labels : []))
      .catch(() => setLabels([]));
    const handler = () => {
      fetch('/api/labels', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => setLabels(Array.isArray(d.labels) ? d.labels : []))
        .catch(() => {});
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('labels:refresh', handler);
    }
    return () => { if (typeof window !== 'undefined') window.removeEventListener('labels:refresh', handler); };
  }, [token]);

  const setSort = (patch: Partial<SortConfig>) => {
    try {
      const next: SortConfig = { ...sortConfig, ...patch } as any;
      onSortConfigChange && onSortConfigChange(next);
    } catch {}
  };

  const toggleSortKey = (key: SortKey, defaultDir: SortDir) => {
    if (sortConfig.sortKey !== key) {
      setSort({ sortKey: key, sortDir: defaultDir });
      return;
    }
    setSort({ sortDir: (sortConfig.sortDir === 'asc' ? 'desc' : 'asc') });
  };

  const toggleGroupBy = (key: GroupByKey) => {
    setSort({ groupBy: (sortConfig.groupBy === key ? 'none' : key) });
  };

  const setSmartFilter = (key: SmartFilterKey) => {
    setSort({ smartFilter: key });
  };

  const arrowFor = (key: SortKey) => {
    if (sortConfig.sortKey !== key) return '';
    return sortConfig.sortDir === 'asc' ? '↑' : '↓';
  };

  const isSortKeyActive = (key: SortKey) => sortConfig.sortKey === key;

  const disabledStyle: React.CSSProperties = { color: 'var(--muted)', opacity: 0.7, cursor: 'not-allowed' };

  const resetToDefault = () => {
    try {
      onSortConfigChange && onSortConfigChange(DEFAULT_SORT_CONFIG);
    } catch {}
    // collapse the Sorting drop-down when returning to default view
    try { setSortingOpen(false); } catch {}
    try { setFiltersListOpen(false); } catch {}
    try { setGroupingListOpen(false); } catch {}
    try { setRemindersOpen(false); } catch {}
    // Clear label filters when returning to default view.
    try { onClearLabels && onClearLabels(); } catch {}
    // Return to root collections view.
    try { onCollectionStackChange && onCollectionStackChange([]); } catch {}
    try { setOpen(false); } catch {}
    try { setCollectionsOpen(false); } catch {}
  };

  const goHome = () => {
    resetToDefault();
    try { onRequestClose && onRequestClose(); } catch {}
  };

  const requestExpandIfCollapsed = () => {
    if (!collapsed) return;
    try { onRequestExpand && onRequestExpand(); } catch {}
  };

  const toggleLabelsOpen = () => {
    setOpen((wasOpen) => !wasOpen);
  };

  const toggleSortingOpen = () => {
    setSortingOpen((wasOpen) => !wasOpen);
  };

  const toggleRemindersOpen = () => {
    setRemindersOpen((wasOpen) => !wasOpen);
  };

  const setReminderFilter = (key: SmartFilterKey) => {
    // Reminder views always sort by due date ascending.
    try {
      onSortConfigChange && onSortConfigChange({
        ...sortConfig,
        smartFilter: key,
        sortKey: 'reminderDueAt' as any,
        sortDir: 'asc',
        groupBy: 'none',
      });
    } catch {
      try { setSmartFilter(key); } catch {}
    }
  };

  const toggleFiltersOpen = () => {
    setFiltersListOpen((wasOpen) => !wasOpen);
  };

  const toggleGroupingOpen = () => {
    setGroupingListOpen((wasOpen) => !wasOpen);
  };

  const currentParentId = (Array.isArray(collectionStack) && collectionStack.length)
    ? Number(collectionStack[collectionStack.length - 1].id)
    : null;

  const refreshCollections = React.useCallback(async () => {
    if (!token) { setCollections([]); return; }
    if (collapsed) return;
    if (!collectionsOpen) return;
    setCollectionsLoading(true);
    try {
      const qs = (currentParentId == null) ? '' : `?parentId=${encodeURIComponent(String(currentParentId))}`;
      const res = await fetch(`/api/collections${qs}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      const list = Array.isArray((data as any)?.collections) ? (data as any).collections : [];
      setCollections(list.map((c: any) => ({
        id: Number(c.id),
        name: String(c.name || ''),
        parentId: (c.parentId == null ? null : Number(c.parentId)),
        hasChildren: !!c.hasChildren,
        noteCount: (typeof c.noteCount === 'number' ? Number(c.noteCount) : undefined),
      })).filter((c: any) => Number.isFinite(c.id) && c.name.length));
    } catch {
      setCollections([]);
    } finally {
      setCollectionsLoading(false);
    }
  }, [token, collapsed, collectionsOpen, currentParentId]);

  useEffect(() => {
    refreshCollections();
  }, [refreshCollections]);

  // Real-time cross-session updates: other clients can create/rename/delete collections.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!token) return;

    const onCollectionsChanged = (ev: Event) => {
      try {
        const ce = ev as CustomEvent<any>;
        const detail = ce?.detail || {};
        const reason = (typeof detail?.reason === 'string') ? String(detail.reason) : '';
        const id = (Number.isFinite(Number(detail?.id)) ? Number(detail.id) : null);
        const name = (typeof detail?.name === 'string') ? String(detail.name) : null;

        // Keep breadcrumb stack names in sync across sessions.
        if (reason === 'rename' && id != null && name != null) {
          try {
            const stack = Array.isArray(collectionStack) ? collectionStack : [];
            const idx = stack.findIndex((c) => Number(c.id) === Number(id));
            if (idx >= 0) {
              const updated = stack.slice();
              updated[idx] = { ...updated[idx], name };
              onCollectionStackChange && onCollectionStackChange(updated);
            }
          } catch {}
        }

        // If current path was deleted elsewhere, pop back to the nearest surviving ancestor.
        if (reason === 'delete' && id != null) {
          try {
            const stack = Array.isArray(collectionStack) ? collectionStack : [];
            const idx = stack.findIndex((c) => Number(c.id) === Number(id));
            if (idx >= 0) {
              onCollectionStackChange && onCollectionStackChange(stack.slice(0, idx));
            }
          } catch {}
        }

        // Only refetch if the list is visible.
        try { refreshCollections(); } catch {}
      } catch {}
    };

    try { window.addEventListener('collections:changed', onCollectionsChanged as any); } catch {}
    return () => {
      try { window.removeEventListener('collections:changed', onCollectionsChanged as any); } catch {}
    };
  }, [token, refreshCollections, collectionStack, onCollectionStackChange]);

  const toggleCollectionsOpen = () => {
    setCollectionsOpen((wasOpen) => {
      const next = !wasOpen;
      if (!next) {
        try { setNewCollectionName(''); } catch {}
      }
      return next;
    });
  };

  const drillInto = (id: number, name: string) => {
    const next = [...(Array.isArray(collectionStack) ? collectionStack : []), { id: Number(id), name: String(name || '') }];
    try { onCollectionStackChange && onCollectionStackChange(next); } catch {}
  };

  const goBackCollection = () => {
    const stack = Array.isArray(collectionStack) ? collectionStack : [];
    if (!stack.length) return;
    try { onCollectionStackChange && onCollectionStackChange(stack.slice(0, -1)); } catch {}
  };

  const goRootCollections = () => {
    try { onCollectionStackChange && onCollectionStackChange([]); } catch {}
  };

  const createCollection = async () => {
    const name = String(newCollectionName || '').trim();
    if (!name || !token) return;
    try {
      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, parentId: currentParentId }),
      });
      if (!res.ok) throw new Error(await res.text());
      try { setNewCollectionName(''); } catch {}
      // New collections can affect breadcrumb paths and descendant display.
      try {
        window.dispatchEvent(new CustomEvent('collections:changed', { detail: { invalidateAll: true, reason: 'create' } }));
      } catch {}
      await refreshCollections();
    } catch (err) {
      window.alert('Failed to create collection: ' + String(err));
    }
  };

  const renameCollection = async (id: number, currentName: string) => {
    if (!token) return;
    const name = window.prompt('Rename collection:', currentName);
    if (name == null) return;
    const next = String(name).trim();
    if (!next) return;
    try {
      const res = await fetch(`/api/collections/${encodeURIComponent(String(id))}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) throw new Error(await res.text());
      // Notify other UI surfaces (e.g., note collection chips) to invalidate any cached paths.
      try {
        window.dispatchEvent(new CustomEvent('collections:changed', { detail: { invalidateAll: true, reason: 'rename', id: Number(id) } }));
      } catch {}
      // Update stack display names if needed.
      try {
        const stack = Array.isArray(collectionStack) ? collectionStack : [];
        const idx = stack.findIndex((c) => Number(c.id) === Number(id));
        if (idx >= 0) {
          const updated = stack.slice();
          updated[idx] = { ...updated[idx], name: next };
          onCollectionStackChange && onCollectionStackChange(updated);
        }
      } catch {}
      await refreshCollections();
    } catch (err) {
      window.alert('Failed to rename collection: ' + String(err));
    }
  };

  const deleteCollection = async (id: number, name: string) => {
    if (!token) return;
    const ok = window.confirm(`Delete collection "${name}"? This will delete all nested collections.`);
    if (!ok) return;
    try {
      const res = await fetch(`/api/collections/${encodeURIComponent(String(id))}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(await res.text());
      // Deleting can invalidate any cached breadcrumb paths for this subtree.
      try {
        window.dispatchEvent(new CustomEvent('collections:changed', { detail: { invalidateAll: true, reason: 'delete', id: Number(id) } }));
      } catch {}
      // If we deleted the current path (or an ancestor), pop back to root.
      try {
        const stack = Array.isArray(collectionStack) ? collectionStack : [];
        const idx = stack.findIndex((c) => Number(c.id) === Number(id));
        if (idx >= 0) {
          onCollectionStackChange && onCollectionStackChange(stack.slice(0, idx));
        }
      } catch {}
      await refreshCollections();
    } catch (err) {
      window.alert('Failed to delete collection: ' + String(err));
    }
  };

  return (
    <aside className={"sidebar" + (collapsed ? " collapsed" : "")}>
      <div className="sidebar-section">
        <div className="sidebar-item active" title="Notes" style={{ cursor: 'pointer' }} onClick={goHome}>
          <span className="icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M6 3h9l3 3v15H6zM14 3v4h4"/>
            </svg>
          </span>
          {!collapsed && <span className="text">Notes</span>}
        </div>
        <div
          className="sidebar-item"
          title="Reminders"
          style={{ cursor: 'pointer' }}
          onClick={() => {
            if (collapsed) {
              requestExpandIfCollapsed();
              try { onClearLabels && onClearLabels(); } catch {}
              try { onCollectionStackChange && onCollectionStackChange([]); } catch {}
              try { setOpen(false); } catch {}
              try { setSortingOpen(false); } catch {}
              try { setFiltersListOpen(false); } catch {}
              try { setGroupingListOpen(false); } catch {}
              try { setCollectionsOpen(false); } catch {}
              try { setRemindersOpen(true); } catch {}
              try { setReminderFilter('remindersAll'); } catch {}
              return;
            }
            toggleRemindersOpen();
          }}
        >
          <span className="icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2z"/>
              <path d="M18 8V7a6 6 0 1 0-12 0v1c0 3.5-2 5-2 5h16s-2-1.5-2-5z"/>
            </svg>
          </span>
          {!collapsed && (
            <span className="text">
              <span className="sidebar-indicator leading"><span className={"chev" + (remindersOpen ? " open" : "")}>▶</span></span>
              Reminders
            </span>
          )}
        </div>
        {remindersOpen && !collapsed && (
          <div style={{ paddingLeft: 10 }}>
            <div
              className="sidebar-item"
              style={{ cursor: 'pointer', fontWeight: sortConfig.smartFilter === 'remindersAll' ? 700 : undefined }}
              onClick={() => setReminderFilter('remindersAll')}
              title="All notes with reminders"
            >
              <span className="text">All</span>
            </div>
            <div
              className="sidebar-item"
              style={{ cursor: 'pointer', fontWeight: sortConfig.smartFilter === 'remindersToday' ? 700 : undefined }}
              onClick={() => setReminderFilter('remindersToday')}
              title="Reminders due today"
            >
              <span className="text">Today</span>
            </div>
            <div
              className="sidebar-item"
              style={{ cursor: 'pointer', fontWeight: sortConfig.smartFilter === 'remindersThisWeek' ? 700 : undefined }}
              onClick={() => setReminderFilter('remindersThisWeek')}
              title="Reminders due this week"
            >
              <span className="text">This week</span>
            </div>
            <div
              className="sidebar-item"
              style={{ cursor: 'pointer', fontWeight: sortConfig.smartFilter === 'remindersNextWeek' ? 700 : undefined }}
              onClick={() => setReminderFilter('remindersNextWeek')}
              title="Reminders due next week"
            >
              <span className="text">Next week</span>
            </div>
            <div
              className="sidebar-item"
              style={{ cursor: 'pointer', fontWeight: sortConfig.smartFilter === 'remindersNextMonth' ? 700 : undefined }}
              onClick={() => setReminderFilter('remindersNextMonth')}
              title="Reminders due next month"
            >
              <span className="text">Next month</span>
            </div>
            <button className="btn" style={{ marginTop: 6, width: '100%' }} onClick={() => { try { setSmartFilter('none'); } catch {}; try { setRemindersOpen(false); } catch {} }}>Clear</button>
          </div>
        )}
        <div
          className="sidebar-item"
          onClick={() => {
            if (collapsed) {
              requestExpandIfCollapsed();
              try { setOpen(true); } catch {}
              try { setRemindersOpen(false); } catch {}
              try { setSortingOpen(false); } catch {}
              try { setFiltersListOpen(false); } catch {}
              try { setGroupingListOpen(false); } catch {}
              try { setCollectionsOpen(false); } catch {}
              return;
            }
            toggleLabelsOpen();
          }}
          style={{ cursor: 'pointer' }}
          title="Labels"
        >
          <span className="icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M6 3h12v18l-6-4-6 4V3z"/>
            </svg>
          </span>
          {!collapsed && (
            <span className="text">
              <span className="sidebar-indicator leading"><span className={"chev" + (open ? " open" : "")}>▶</span></span>
              Labels
            </span>
          )}
        </div>
        {open && !collapsed && (
          <div style={{ paddingLeft: 8 }}>
            {labels.length === 0 && <div className="sidebar-item" style={{ color: 'var(--muted)' }}>No labels</div>}
            {labels.map(l => (
              <label key={l.id} className="sidebar-item" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={selectedLabelIds.includes(l.id)} onChange={() => onToggleLabel && onToggleLabel(l.id)} />
                <span>{l.name}</span>
              </label>
            ))}
            {labels.length > 0 && (
              <button className="btn" onClick={onClearLabels} style={{ marginTop: 6 }}>Clear</button>
            )}
          </div>
        )}

        <div
          className="sidebar-item"
          onClick={() => {
            if (collapsed) {
              requestExpandIfCollapsed();
              try { setSortingOpen(true); } catch {}
              try { setRemindersOpen(false); } catch {}
              try { setOpen(false); } catch {}
              try { setFiltersListOpen(false); } catch {}
              try { setGroupingListOpen(false); } catch {}
              try { setCollectionsOpen(false); } catch {}
              return;
            }
            toggleSortingOpen();
          }}
          style={{ cursor: 'pointer' }}
          title="Sorting"
        >
          <span className="icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M3 18h6v-2H3v2zm0-5h12v-2H3v2zm0-7v2h18V6H3z"/>
            </svg>
          </span>
          {!collapsed && (
            <span className="text">
              <span className="sidebar-indicator leading"><span className={"chev" + (sortingOpen ? " open" : "")}>▶</span></span>
              Sorting
            </span>
          )}
        </div>
        {sortingOpen && !collapsed && (
          <div style={{ paddingLeft: 8 }}>
            <div className="sidebar-item" style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontWeight: sortConfig.sortKey === 'createdAt' ? 700 : undefined }} onClick={() => toggleSortKey('createdAt', 'desc')} title="Sort by date created">
              <span className="text">Date created</span>
              <span className={"sidebar-indicator" + (isSortKeyActive('createdAt') ? "" : " placeholder")}
                aria-hidden
              >
                <span className={"dir" + (sortConfig.sortDir === 'desc' && isSortKeyActive('createdAt') ? " desc" : "")}>▲</span>
              </span>
            </div>
            <div className="sidebar-item" style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontWeight: sortConfig.sortKey === 'updatedAt' ? 700 : undefined }} onClick={() => toggleSortKey('updatedAt', 'desc')} title="Sort by date updated">
              <span className="text">Date updated</span>
              <span className={"sidebar-indicator" + (isSortKeyActive('updatedAt') ? "" : " placeholder")}
                aria-hidden
              >
                <span className={"dir" + (sortConfig.sortDir === 'desc' && isSortKeyActive('updatedAt') ? " desc" : "")}>▲</span>
              </span>
            </div>
            <div className="sidebar-item" style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontWeight: sortConfig.sortKey === 'title' ? 700 : undefined }} onClick={() => toggleSortKey('title', 'asc')} title="Sort alphabetically by title">
              <span className="text">Alphabetical</span>
              <span className={"sidebar-indicator" + (isSortKeyActive('title') ? "" : " placeholder")}
                aria-hidden
              >
                <span className={"dir" + (sortConfig.sortDir === 'desc' && isSortKeyActive('title') ? " desc" : "")}>▲</span>
              </span>
            </div>

            <div className="sidebar-item" onClick={toggleFiltersOpen} style={{ cursor: 'pointer', marginTop: 4 }} title="Filters">
              <span className="text">
                <span className="sidebar-indicator leading"><span className={"chev" + (filtersListOpen ? " open" : "")}>▶</span></span>
                Filters
              </span>
            </div>
            {filtersListOpen && (
              <div style={{ paddingLeft: 10 }}>
                <div className="sidebar-item" style={disabledStyle} title="Coming soon"><span className="text">Due soon</span></div>
                <div className="sidebar-item" style={disabledStyle} title="Coming soon"><span className="text">Least accessed</span></div>
                <div className="sidebar-item" style={disabledStyle} title="Coming soon"><span className="text">Most edited</span></div>
                <div className="sidebar-item" style={disabledStyle} title="Coming soon"><span className="text">“At risk”</span></div>
                {/* preserve state channel for future filter behavior */}
                <div style={{ display: 'none' }}>
                  <button onClick={() => setSmartFilter('none')}>none</button>
                </div>
              </div>
            )}

            <div className="sidebar-item" onClick={toggleGroupingOpen} style={{ cursor: 'pointer', marginTop: 4 }} title="Grouping">
              <span className="text">
                <span className="sidebar-indicator leading"><span className={"chev" + (groupingListOpen ? " open" : "")}>▶</span></span>
                Grouping
              </span>
            </div>
            {groupingListOpen && (
              <div style={{ paddingLeft: 10 }}>
                <div className="sidebar-item" style={{ cursor: 'pointer', fontWeight: sortConfig.groupBy === 'week' ? 700 : undefined }} onClick={() => toggleGroupBy('week')} title="Group by week">
                  <span className="text">By week</span>
                </div>
                <div className="sidebar-item" style={{ cursor: 'pointer', fontWeight: sortConfig.groupBy === 'month' ? 700 : undefined }} onClick={() => toggleGroupBy('month')} title="Group by month">
                  <span className="text">By month</span>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="sidebar-item" title="Collections">
          <span className="icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
            </svg>
          </span>
          {!collapsed && (
            <span className="text" style={{ cursor: 'pointer' }} onClick={toggleCollectionsOpen}>
              <span className="sidebar-indicator leading"><span className={"chev" + (collectionsOpen ? " open" : "")}>▶</span></span>
              Collections
            </span>
          )}
        </div>
        {collectionsOpen && !collapsed && (
          <div style={{ paddingLeft: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {collectionStack.length > 0 && (
                  <>
                    <button className="btn" onClick={goBackCollection} title="Back">Back</button>
                    <button className="btn" onClick={goRootCollections} title="All notes">All</button>
                  </>
                )}
              </div>
              {collectionStack.length > 0 && (
                <button
                  className="btn"
                  title="Delete this collection"
                  onClick={() => {
                    const cur = collectionStack[collectionStack.length - 1];
                    deleteCollection(Number(cur.id), String(cur.name || ''));
                  }}
                >
                  Delete
                </button>
              )}
            </div>
            {collectionStack.length > 0 && (
              <div className="sidebar-item" style={{ color: 'var(--muted)', fontSize: 12, paddingLeft: 0 }} title="Current path">
                {collectionStack.map((c) => String(c.name || '')).join(' / ')}
              </div>
            )}

            <div className={"sidebar-item" + (!collectionStack.length ? " active" : "")} style={{ cursor: 'pointer' }} onClick={() => { goRootCollections(); }} title="Show all notes">
              <span className="text">All notes</span>
            </div>

            {collectionsLoading && <div className="sidebar-item" style={{ color: 'var(--muted)' }}>Loading…</div>}
            {!collectionsLoading && collections.length === 0 && (
              <div className="sidebar-item" style={{ color: 'var(--muted)' }}>No collections</div>
            )}
            {collections.map((c) => (
              <div key={c.id} className="sidebar-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1, minWidth: 0 }}
                  onClick={() => {
                    drillInto(c.id, c.name);
                  }}
                  title={c.name}
                >
                  <span className="text" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  {typeof c.noteCount === 'number' && (
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>({c.noteCount})</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button className="btn" title="Rename" onClick={(e) => { e.stopPropagation(); renameCollection(c.id, c.name); }}>Rename</button>
                  <button className="btn" title="Delete" onClick={(e) => { e.stopPropagation(); deleteCollection(c.id, c.name); }}>✕</button>
                </div>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                placeholder="New collection"
                style={{ flex: 1, minWidth: 0, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)' }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createCollection();
                }}
              />
              <button className="btn" onClick={createCollection} disabled={!newCollectionName.trim()}>Add</button>
            </div>
          </div>
        )}
        <div
          className="sidebar-item"
          title="Archive"
          style={{ cursor: 'pointer', fontWeight: sortConfig.smartFilter === 'archive' ? 700 : undefined }}
          onClick={() => {
            if (collapsed) {
              requestExpandIfCollapsed();
              try { setRemindersOpen(false); } catch {}
              try { setOpen(false); } catch {}
              try { setSortingOpen(false); } catch {}
              try { setFiltersListOpen(false); } catch {}
              try { setGroupingListOpen(false); } catch {}
              try { setCollectionsOpen(false); } catch {}
            }
            try { onClearLabels && onClearLabels(); } catch {}
            try { onCollectionStackChange && onCollectionStackChange([]); } catch {}
            try {
              onSortConfigChange && onSortConfigChange({
                ...sortConfig,
                smartFilter: 'archive',
                sortKey: 'updatedAt' as any,
                sortDir: 'desc',
                groupBy: 'none',
              });
            } catch {
              try { setSmartFilter('archive' as any); } catch {}
            }
            try { onRequestClose && onRequestClose(); } catch {}
          }}
        >
          <span className="icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M20.54 5.23L19.4 4H4.6L3.46 5.23 3 6v2h18V6l-.46-.77zM6 10v9h12V10H6zm3 2h6v2H9v-2z"/>
            </svg>
          </span>
          {!collapsed && <span className="text">Archive</span>}
        </div>
        <div
          className="sidebar-item"
          title="Trash"
          style={{ cursor: 'pointer', fontWeight: sortConfig.smartFilter === 'trash' ? 700 : undefined }}
          onClick={() => {
            if (collapsed) {
              requestExpandIfCollapsed();
              try { setRemindersOpen(false); } catch {}
              try { setOpen(false); } catch {}
              try { setSortingOpen(false); } catch {}
              try { setFiltersListOpen(false); } catch {}
              try { setGroupingListOpen(false); } catch {}
              try { setCollectionsOpen(false); } catch {}
            }
            try { onClearLabels && onClearLabels(); } catch {}
            try { onCollectionStackChange && onCollectionStackChange([]); } catch {}
            try {
              onSortConfigChange && onSortConfigChange({
                ...sortConfig,
                smartFilter: 'trash',
                sortKey: 'updatedAt' as any,
                sortDir: 'desc',
                groupBy: 'none',
              });
            } catch {
              try { setSmartFilter('trash'); } catch {}
            }
            try { onRequestClose && onRequestClose(); } catch {}
          }}
        >
          <span className="icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M4 7h16"/>
              <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/>
              <path d="M9 7V5h6v2"/>
            </svg>
          </span>
          {!collapsed && <span className="text">Trash</span>}
        </div>
      </div>
    </aside>
  );
}
