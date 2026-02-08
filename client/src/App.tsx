import React from "react";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import AuthGate from "./components/AuthGate";
import { AuthProvider, useAuth } from "./authContext";
import { ThemeProvider } from "./themeContext";
import { DEFAULT_SORT_CONFIG, SortConfig } from './sortTypes';

/**
 * Phase 1 app shell.
 * Now wraps the app in `AuthProvider` so auth UI can be added.
 */
export default function App(): JSX.Element {
	return (
		<ThemeProvider>
			<AuthProvider>
				<AppShell />
			</AuthProvider>
		</ThemeProvider>
	);
}

function AppShell(): JSX.Element {
	const { user, token } = useAuth();
	const [selectedLabelIds, setSelectedLabelIds] = React.useState<number[]>([]);
	const [selectedCollaboratorId, setSelectedCollaboratorId] = React.useState<number | null>(null);
	const [collectionStack, setCollectionStack] = React.useState<Array<{ id: number; name: string }>>([]);
	const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
	const [sidebarDrawerOpen, setSidebarDrawerOpen] = React.useState(false);
	const [isPhone, setIsPhone] = React.useState(false);
	const [searchQuery, setSearchQuery] = React.useState('');
	const [sortConfig, setSortConfig] = React.useState<SortConfig>(DEFAULT_SORT_CONFIG);
	const selectedCollectionId = collectionStack.length ? Number(collectionStack[collectionStack.length - 1].id) : null;

	// Mobile back button handling (Android/PWA): close overlays instead of exiting.
	const backStackRef = React.useRef<Array<{ id: string; onBack: () => void }>>([]);
	const backRootArmedRef = React.useRef(false);
	const lastRootBackAtRef = React.useRef<number>(0);
	const allowExitOnceRef = React.useRef(false);

	const clearAllFilters = React.useCallback(() => {
		setSelectedLabelIds([]);
		setSelectedCollaboratorId(null);
		setCollectionStack([]);
		setSearchQuery('');
		setSortConfig(DEFAULT_SORT_CONFIG);
	}, []);

	const selectCollectionById = React.useCallback(async (collectionId: number, fallbackName?: string) => {
		const id = Number(collectionId);
		if (!Number.isFinite(id)) return;
		if (!token) {
			setCollectionStack([{ id, name: String(fallbackName || id) }]);
			return;
		}
		try {
			const res = await fetch(`/api/collections/${encodeURIComponent(String(id))}/breadcrumb`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			const bc = Array.isArray((data as any)?.breadcrumb) ? (data as any).breadcrumb : [];
			const next = bc.map((c: any) => ({ id: Number(c.id), name: String(c.name || '') }))
				.filter((c: any) => Number.isFinite(c.id) && c.name.length);
			if (next.length) setCollectionStack(next);
			else setCollectionStack([{ id, name: String(fallbackName || id) }]);
		} catch {
			setCollectionStack([{ id, name: String(fallbackName || id) }]);
		}
	}, [token]);
	const toggleLabel = (id: number) => {
		setSelectedLabelIds((s) => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
	};
	const clearLabels = () => setSelectedLabelIds([]);

	React.useEffect(() => {
		function updatePhoneBucket() {
			try {
				const mq = window.matchMedia;
				const isTouchLike = !!(mq && (mq('(pointer: coarse)').matches || mq('(any-pointer: coarse)').matches));
				const vw = (window.visualViewport && typeof window.visualViewport.width === 'number')
					? window.visualViewport.width
					: window.innerWidth;
				const vh = (window.visualViewport && typeof window.visualViewport.height === 'number')
					? window.visualViewport.height
					: window.innerHeight;
				const shortSide = Math.min(vw, vh);
				setIsPhone(isTouchLike && shortSide <= 600);
			} catch {
				setIsPhone(false);
			}
		}
		updatePhoneBucket();
		window.addEventListener('resize', updatePhoneBucket);
		try { window.visualViewport?.addEventListener('resize', updatePhoneBucket); } catch {}
		try { window.visualViewport?.addEventListener('scroll', updatePhoneBucket); } catch {}
		return () => {
			window.removeEventListener('resize', updatePhoneBucket);
			try { window.visualViewport?.removeEventListener('resize', updatePhoneBucket); } catch {}
			try { window.visualViewport?.removeEventListener('scroll', updatePhoneBucket); } catch {}
		};
	}, []);

	React.useEffect(() => {
		if (!isPhone) return;
		if (backRootArmedRef.current) return;
		backRootArmedRef.current = true;
		try {
			// Mark the current entry as our base, then push a sentinel so Back has something to pop to.
			history.replaceState({ ...(history.state || {}), __freemannotes_base: true }, document.title);
			history.pushState({ ...(history.state || {}), __freemannotes_sentinel: true }, document.title);
		} catch {}
	}, [isPhone]);

	React.useEffect(() => {
		if (!isPhone) return;
		const stack = backStackRef.current;

		const onRegister = (e: any) => {
			try {
				const d = e?.detail;
				const id = String(d?.id || '');
				const onBack = d?.onBack;
				if (!id || typeof onBack !== 'function') return;
				// De-dupe by id
				for (let i = stack.length - 1; i >= 0; i--) {
					if (stack[i]?.id === id) stack.splice(i, 1);
				}
				stack.push({ id, onBack });
				try {
					history.pushState({ ...(history.state || {}), __freemannotes_overlay: true, __freemannotes_overlay_id: id }, document.title);
				} catch {}
			} catch {}
		};
		const onUnregister = (e: any) => {
			try {
				const d = e?.detail;
				const id = String(d?.id || '');
				if (!id) return;
				for (let i = stack.length - 1; i >= 0; i--) {
					if (stack[i]?.id === id) stack.splice(i, 1);
				}
			} catch {}
		};

		const onPopState = (ev: PopStateEvent) => {
			try {
				if (!isPhone) return;
				if (stack.length > 0) {
					const top = stack.pop();
					try { top?.onBack?.(); } catch {}
					return;
				}
				// At root with no overlays: don't exit the app; bounce back to the sentinel.
				const st: any = ev?.state;
				const isBase = !st || !!st.__freemannotes_base;
				if (isBase) {
					if (allowExitOnceRef.current) {
						allowExitOnceRef.current = false;
						return;
					}
					const now = Date.now();
					const last = lastRootBackAtRef.current || 0;
					lastRootBackAtRef.current = now;
					const within = (now - last) <= 800;
					if (within) {
						const ok = window.confirm('Exit FreemanNotes?');
						if (ok) {
							allowExitOnceRef.current = true;
							window.setTimeout(() => {
								try { history.back(); } catch {}
								try { (window as any).close?.(); } catch {}
							}, 0);
							return;
						}
					}
					window.setTimeout(() => {
						try { history.go(1); } catch {}
					}, 0);
				}
			} catch {}
		};

		window.addEventListener('freemannotes:back/register', onRegister as any);
		window.addEventListener('freemannotes:back/unregister', onUnregister as any);
		window.addEventListener('popstate', onPopState);
		return () => {
			window.removeEventListener('freemannotes:back/register', onRegister as any);
			window.removeEventListener('freemannotes:back/unregister', onUnregister as any);
			window.removeEventListener('popstate', onPopState);
		};
	}, [isPhone]);

	React.useEffect(() => {
		if (!sidebarDrawerOpen) return;
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') setSidebarDrawerOpen(false);
		}
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [sidebarDrawerOpen]);

	React.useEffect(() => {
		// If we leave phone layout, ensure the drawer closes.
		if (!isPhone) setSidebarDrawerOpen(false);
	}, [isPhone]);

	React.useEffect(() => {
		if (!isPhone) return;
		let active = false;
		let startedOnEdge = false;
		let startedInDrawerRegion = false;
		let startX = 0;
		let startY = 0;
		let lastX = 0;
		let lastY = 0;
		let pointerId: number | null = null;
		let touchId: number | null = null;

		// Open zone: allow edge-swipe anywhere near the left side.
		// (Some browsers reserve the extreme edge for Back; if so, the user can start slightly in.)
		const OPEN_ZONE_MAX_X = 140;
		const NOTE_CARD_OPEN_EDGE_PX = 24; // if gesture starts on a note card, only allow open from extreme-left edge
		const OPEN_DX = 28;
		const CLOSE_DX = 34;
		const MAX_DY = 80;
		const DRAWER_REGION_PX = 360; // must cover max drawer width
		const INTENT_DX = 8;
		const HORIZ_DOMINANCE = 1.2; // dx must be this much stronger than dy

		function isInteractiveTarget(t: EventTarget | null) {
			const el = t as HTMLElement | null;
			if (!el) return false;
			try {
				// If the swipe starts on a note card, we still want to allow opening the drawer.
				// Only treat *actual* controls/links/editor surfaces as interactive.
				if (el.closest('.note-card')) {
					return !!el.closest('input, textarea, select, button, a, [contenteditable="true"]');
				}
				return !!el.closest('input, textarea, select, button, a, [contenteditable="true"], .take-note-expanded, .image-dialog, .prefs-dialog');
			} catch {
				return false;
			}
		}

		function beginAt(x: number, y: number, target: EventTarget | null, pid: number | null, tid: number | null) {
			if (isInteractiveTarget(target)) return false;
			let startedOnNoteCard = false;
			try {
				const el = target as HTMLElement | null;
				startedOnNoteCard = !!(el && el.closest && el.closest('.note-card'));
			} catch {}

			// Only arm the gesture if we started in a relevant region.
			// Also: avoid treating note drags as sidebar opens.
			const canStartOpen = (!sidebarDrawerOpen && x <= OPEN_ZONE_MAX_X && (!startedOnNoteCard || x <= NOTE_CARD_OPEN_EDGE_PX));
			const canStartClose = (sidebarDrawerOpen && x <= DRAWER_REGION_PX);
			if (!canStartOpen && !canStartClose) return false;

			startX = x;
			startY = y;
			lastX = x;
			lastY = y;
			active = true;
			pointerId = pid;
			touchId = tid;
			// Open: start near the left edge.
			startedOnEdge = canStartOpen;
			startedInDrawerRegion = canStartClose;
			return true;
		}

		function updateAt(x: number, y: number, preventScroll: (() => void) | null) {
			lastX = x;
			lastY = y;
			const dx = lastX - startX;
			const dy = lastY - startY;
			// If it's clearly vertical, abandon so we don't fight scroll.
			if (Math.abs(dy) > MAX_DY && Math.abs(dy) > Math.abs(dx) * HORIZ_DOMINANCE) {
				// Treat as scroll; abandon.
				active = false;
				pointerId = null;
				touchId = null;
				startedOnEdge = false;
				startedInDrawerRegion = false;
				return;
			}

			// Prevent scroll only after horizontal intent is clear.
			if (preventScroll && Math.abs(dx) > INTENT_DX && Math.abs(dx) > Math.abs(dy) * HORIZ_DOMINANCE) {
				preventScroll();
			}

			if (startedOnEdge && dx >= OPEN_DX && Math.abs(dy) <= MAX_DY) {
				setSidebarDrawerOpen(true);
				active = false;
				pointerId = null;
				touchId = null;
				startedOnEdge = false;
				startedInDrawerRegion = false;
				return;
			}
			if (startedInDrawerRegion && dx <= -CLOSE_DX && Math.abs(dy) <= MAX_DY) {
				setSidebarDrawerOpen(false);
				active = false;
				pointerId = null;
				touchId = null;
				startedOnEdge = false;
				startedInDrawerRegion = false;
				return;
			}
		}

		function onPointerDown(e: PointerEvent) {
			try {
				if (e.pointerType !== 'touch') return;
				if (pointerId != null) return;
				if (isInteractiveTarget(e.target)) return;

				const ok = beginAt(e.clientX, e.clientY, e.target, e.pointerId, null);
				if (!ok) return;
				try { (e.target as any)?.setPointerCapture?.(e.pointerId); } catch {}
			} catch {}
		}

		function onPointerMove(e: PointerEvent) {
			try {
				if (!active) return;
				if (pointerId == null || e.pointerId !== pointerId) return;
				updateAt(e.clientX, e.clientY, () => e.preventDefault());
			} catch {}
		}

		function endGesture(e: PointerEvent) {
			try {
				if (pointerId == null || e.pointerId !== pointerId) return;
			} catch {}
			active = false;
			pointerId = null;
			touchId = null;
			startedOnEdge = false;
			startedInDrawerRegion = false;
		}

		function onTouchStart(e: TouchEvent) {
			try {
				if (touchId != null || pointerId != null) return;
				if (!e.touches || e.touches.length !== 1) return;
				const t = e.touches[0];
				beginAt(t.clientX, t.clientY, e.target, null, t.identifier);
			} catch {}
		}
		function onTouchMove(e: TouchEvent) {
			try {
				if (!active) return;
				if (touchId == null) return;
				const t = Array.from(e.touches || []).find(x => x.identifier === touchId);
				if (!t) return;
				updateAt(t.clientX, t.clientY, () => e.preventDefault());
			} catch {}
		}
		function onTouchEnd(e: TouchEvent) {
			try {
				if (touchId == null) return;
				const stillActive = Array.from(e.touches || []).some(x => x.identifier === touchId);
				if (stillActive) return;
			} catch {}
			active = false;
			pointerId = null;
			touchId = null;
			startedOnEdge = false;
			startedInDrawerRegion = false;
		}

		document.addEventListener('pointerdown', onPointerDown, { capture: true } as any);
		document.addEventListener('pointermove', onPointerMove, { capture: true, passive: false } as any);
		document.addEventListener('pointerup', endGesture, { capture: true } as any);
		document.addEventListener('pointercancel', endGesture, { capture: true } as any);
		document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true } as any);
		document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false } as any);
		document.addEventListener('touchend', onTouchEnd, { capture: true } as any);
		document.addEventListener('touchcancel', onTouchEnd, { capture: true } as any);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, { capture: true } as any);
			document.removeEventListener('pointermove', onPointerMove, { capture: true } as any);
			document.removeEventListener('pointerup', endGesture, { capture: true } as any);
			document.removeEventListener('pointercancel', endGesture, { capture: true } as any);
			document.removeEventListener('touchstart', onTouchStart, { capture: true } as any);
			document.removeEventListener('touchmove', onTouchMove, { capture: true } as any);
			document.removeEventListener('touchend', onTouchEnd, { capture: true } as any);
			document.removeEventListener('touchcancel', onTouchEnd, { capture: true } as any);
		};
	}, [isPhone, sidebarDrawerOpen]);

	if (!user) {
		return (
			<div className="app-root" style={{ minHeight: '100vh' }}>
				<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
					<AuthGate />
				</div>
			</div>
		);
	}

	return (
		<div className={"app-root" + (isPhone ? " phone" : "") + (sidebarDrawerOpen ? " drawer-open" : "")}>
			<Header
				onToggleSidebar={() => {
					if (isPhone) setSidebarDrawerOpen((o) => !o);
					else setSidebarCollapsed((c) => !c);
				}}
				searchQuery={searchQuery}
				onSearchChange={setSearchQuery}
			/>
			<div className="app-body">
				{!isPhone && (
					<Sidebar
						selectedLabelIds={selectedLabelIds}
						onToggleLabel={toggleLabel}
						onClearLabels={clearLabels}
						collapsed={sidebarCollapsed}
						collectionStack={collectionStack}
						onCollectionStackChange={setCollectionStack}
						sortConfig={sortConfig}
						onSortConfigChange={setSortConfig}
					/>
				)}
				<main className="main-area">
					<AuthGate
						selectedLabelIds={selectedLabelIds}
						selectedCollectionId={selectedCollectionId}
						collectionStack={collectionStack}
						selectedCollaboratorId={selectedCollaboratorId}
						searchQuery={searchQuery}
						sortConfig={sortConfig}
						onClearAllFilters={clearAllFilters}
						onSetSelectedLabelIds={setSelectedLabelIds}
						onSetSelectedCollaboratorId={setSelectedCollaboratorId}
						onSelectCollectionById={selectCollectionById}
						onSetCollectionStack={setCollectionStack}
						onSetSearchQuery={setSearchQuery}
						onSortConfigChange={setSortConfig}
					/>
				</main>
			</div>

			{isPhone && (
				<>
					{sidebarDrawerOpen && (
						<div
							className="mobile-sidebar-backdrop"
							role="button"
							aria-label="Close menu"
							tabIndex={0}
							onClick={() => setSidebarDrawerOpen(false)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') setSidebarDrawerOpen(false);
							}}
						/>
					)}
					<div className={"mobile-sidebar-drawer" + (sidebarDrawerOpen ? " open" : "")}
						aria-hidden={!sidebarDrawerOpen}
					>
						<Sidebar
							selectedLabelIds={selectedLabelIds}
							onToggleLabel={toggleLabel}
							onClearLabels={clearLabels}
							collapsed={false}
							collectionStack={collectionStack}
							onCollectionStackChange={setCollectionStack}
							sortConfig={sortConfig}
							onSortConfigChange={setSortConfig}
							onRequestClose={() => setSidebarDrawerOpen(false)}
						/>
					</div>
				</>
			)}
		</div>
	);
}
