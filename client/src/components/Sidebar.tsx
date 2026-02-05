import React, { useEffect, useState } from "react";
import { useAuth } from "../authContext";
import { DEFAULT_SORT_CONFIG, type SortConfig, type SortDir, type SortKey, type GroupByKey, type SmartFilterKey } from '../sortTypes';

export default function Sidebar({
  selectedLabelIds = [],
  onToggleLabel,
  onClearLabels,
  collapsed = false,
  sortConfig = DEFAULT_SORT_CONFIG,
  onSortConfigChange,
}: {
  selectedLabelIds?: number[];
  onToggleLabel?: (id: number) => void;
  onClearLabels?: () => void;
  collapsed?: boolean;
  sortConfig?: SortConfig;
  onSortConfigChange?: (next: SortConfig) => void;
}) {
  const { token } = useAuth();
  const [labels, setLabels] = useState<Array<{ id: number; name: string }>>([]);
  const [open, setOpen] = useState(true);
  const [sortingOpen, setSortingOpen] = useState(true);
  const [filtersListOpen, setFiltersListOpen] = useState(true);
  const [groupingListOpen, setGroupingListOpen] = useState(true);
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
  };

  return (
    <aside className={"sidebar" + (collapsed ? " collapsed" : "")}>
      <div className="sidebar-section">
        <div className="sidebar-item active" title="Notes" style={{ cursor: 'pointer' }} onClick={resetToDefault}>
          <span className="icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M6 3h9l3 3v15H6zM14 3v4h4"/>
            </svg>
          </span>
          {!collapsed && <span className="text">Notes</span>}
        </div>
        <div className="sidebar-item" title="Reminders">
          <span className="icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2z"/>
              <path d="M18 8V7a6 6 0 1 0-12 0v1c0 3.5-2 5-2 5h16s-2-1.5-2-5z"/>
            </svg>
          </span>
          {!collapsed && <span className="text">Reminders</span>}
        </div>
        <div className="sidebar-item" onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer' }} title="Labels">
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

        <div className="sidebar-item" onClick={() => setSortingOpen(o => !o)} style={{ cursor: 'pointer' }} title="Sorting">
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

            <div className="sidebar-item" onClick={() => setFiltersListOpen(o => !o)} style={{ cursor: 'pointer', marginTop: 4 }} title="Filters">
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

            <div className="sidebar-item" onClick={() => setGroupingListOpen(o => !o)} style={{ cursor: 'pointer', marginTop: 4 }} title="Grouping">
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
          {!collapsed && <span className="text">Collections</span>}
        </div>
        <div className="sidebar-item" title="Archive">
          <span className="icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M20.54 5.23L19.4 4H4.6L3.46 5.23 3 6v2h18V6l-.46-.77zM6 10v9h12V10H6zm3 2h6v2H9v-2z"/>
            </svg>
          </span>
          {!collapsed && <span className="text">Archive</span>}
        </div>
        <div className="sidebar-item" title="Bin">
          <span className="icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M4 7h16"/>
              <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/>
              <path d="M9 7V5h6v2"/>
            </svg>
          </span>
          {!collapsed && <span className="text">Bin</span>}
        </div>
      </div>
    </aside>
  );
}
