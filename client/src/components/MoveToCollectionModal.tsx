import React from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../authContext';

type CollectionLite = { id: number; name: string; parentId: number | null; hasChildren?: boolean; noteCount?: number };
type NoteCollectionLite = { id: number; name: string; parentId: number | null };

type StackEntry = { id: number; name: string };

export default function MoveToCollectionModal({
	noteId,
	onClose,
	onChanged,
}: {
	noteId: number;
	onClose: () => void;
	onChanged: (collections: NoteCollectionLite[]) => void;
}) {
	const { token } = useAuth();
	const [stack, setStack] = React.useState<StackEntry[]>([]);
	const [collections, setCollections] = React.useState<CollectionLite[]>([]);
	const [noteCollections, setNoteCollections] = React.useState<NoteCollectionLite[]>([]);
	const [loading, setLoading] = React.useState(false);
	const [creatingName, setCreatingName] = React.useState('');
	const [busy, setBusy] = React.useState(false);

	// Participate in the shared modal lock (NotesGrid owns the global class).
	React.useEffect(() => {
		try {
			window.dispatchEvent(new Event('freemannotes:editor-modal-open'));
			return () => {
				setTimeout(() => {
					try { window.dispatchEvent(new Event('freemannotes:editor-modal-close')); } catch {}
				}, 0);
			};
		} catch {
			return;
		}
	}, []);

	const parentId = stack.length ? Number(stack[stack.length - 1].id) : null;

	const refresh = React.useCallback(async () => {
		if (!token) { setCollections([]); return; }
		setLoading(true);
		try {
			const qs = (parentId == null) ? '' : `?parentId=${encodeURIComponent(String(parentId))}`;
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
			setLoading(false);
		}
	}, [token, parentId]);

	React.useEffect(() => {
		refresh();
	}, [refresh]);

	const refreshNoteCollections = React.useCallback(async () => {
		if (!token) { setNoteCollections([]); return; }
		try {
			const res = await fetch(`/api/notes/${encodeURIComponent(String(noteId))}/collections`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!res.ok) return;
			const data = await res.json();
			const list = Array.isArray((data as any)?.collections) ? (data as any).collections : [];
			setNoteCollections(list.map((c: any) => ({
				id: Number(c.id),
				name: String(c.name || ''),
				parentId: (c.parentId == null ? null : Number(c.parentId)),
			})).filter((c: any) => Number.isFinite(c.id) && c.name.length));
		} catch {
			// ignore
		}
	}, [token, noteId]);

	React.useEffect(() => {
		refreshNoteCollections();
	}, [refreshNoteCollections]);

	React.useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [onClose]);

	const idSet = React.useMemo(() => {
		return new Set<number>(noteCollections.map((c) => Number(c.id)).filter((id) => Number.isFinite(id)));
	}, [noteCollections]);

	const bumpVisibleCollectionCount = React.useCallback((collectionId: number, delta: number) => {
		const id = Number(collectionId);
		const d = Number(delta);
		if (!Number.isFinite(id) || !Number.isFinite(d) || d === 0) return;
		setCollections((prev) => prev.map((c) => {
			if (Number(c.id) !== id) return c;
			if (typeof c.noteCount !== 'number') return c;
			return { ...c, noteCount: Math.max(0, Number(c.noteCount) + d) };
		}));
	}, []);

	const addTo = async (collectionId: number) => {
		if (!token) return;
		if (busy) return;
		if (!Number.isFinite(collectionId)) return;
		const wasMember = idSet.has(Number(collectionId));
		setBusy(true);
		try {
			const res = await fetch(`/api/notes/${encodeURIComponent(String(noteId))}/collections`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ collectionId: Number(collectionId) }),
			});
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			const list = Array.isArray((data as any)?.collections) ? (data as any).collections : [];
			setNoteCollections(list.map((c: any) => ({ id: Number(c.id), name: String(c.name || ''), parentId: (c.parentId == null ? null : Number(c.parentId)) }))
				.filter((c: any) => Number.isFinite(c.id) && c.name.length));
			if (!wasMember) bumpVisibleCollectionCount(collectionId, +1);
			try { onChanged(list); } catch {}
		} catch (err) {
			window.alert('Failed to add note to collection: ' + String(err));
		} finally {
			setBusy(false);
		}
	};

	const removeFrom = async (collectionId: number) => {
		if (!token) return;
		if (busy) return;
		if (!Number.isFinite(collectionId)) return;
		const wasMember = idSet.has(Number(collectionId));
		setBusy(true);
		try {
			const res = await fetch(`/api/notes/${encodeURIComponent(String(noteId))}/collections/${encodeURIComponent(String(collectionId))}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			const list = Array.isArray((data as any)?.collections) ? (data as any).collections : [];
			setNoteCollections(list.map((c: any) => ({ id: Number(c.id), name: String(c.name || ''), parentId: (c.parentId == null ? null : Number(c.parentId)) }))
				.filter((c: any) => Number.isFinite(c.id) && c.name.length));
			if (wasMember) bumpVisibleCollectionCount(collectionId, -1);
			try { onChanged(list); } catch {}
		} catch (err) {
			window.alert('Failed to remove from collection: ' + String(err));
		} finally {
			setBusy(false);
		}
	};

	const clearAll = async () => {
		if (!token) return;
		if (busy) return;
		const idsToDecrement = Array.from(new Set(noteCollections.map((c) => Number(c.id)).filter((id) => Number.isFinite(id))));
		setBusy(true);
		try {
			const res = await fetch(`/api/notes/${encodeURIComponent(String(noteId))}/collections`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!res.ok) throw new Error(await res.text());
			setNoteCollections([]);
			idsToDecrement.forEach((id) => bumpVisibleCollectionCount(id, -1));
			try { onChanged([]); } catch {}
		} catch (err) {
			window.alert('Failed to clear collections: ' + String(err));
		} finally {
			setBusy(false);
		}
	};

	const createAndAdd = async () => {
		if (!token) return;
		const name = String(creatingName || '').trim();
		if (!name) return;
		if (busy) return;
		setBusy(true);
		try {
			const res = await fetch('/api/collections', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ name, parentId }),
			});
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			const createdId = Number((data as any)?.collection?.id);
			if (Number.isFinite(createdId)) {
				try {
					window.dispatchEvent(new CustomEvent('collections:changed', { detail: { invalidateAll: true, reason: 'create', id: createdId } }));
				} catch {}
				try { setCreatingName(''); } catch {}
				setBusy(false);
				await addTo(createdId);
				return;
			}
			await refresh();
		} catch (err) {
			window.alert('Failed to create collection: ' + String(err));
		} finally {
			setBusy(false);
		}
	};

	const breadcrumb = stack.map((s) => s.name).join(' / ');

	return createPortal(
		<div
			style={{
				position: 'fixed',
				inset: 0,
				background: 'var(--modal-backdrop, rgba(0,0,0,0.66))',
				zIndex: 10050,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				padding: 16,
			}}
			onPointerDown={(e) => {
				// Close on pointer-down to avoid click-through.
				if (e.target !== e.currentTarget) return;
				e.preventDefault();
				e.stopPropagation();
				setTimeout(() => onClose(), 0);
			}}
			onClick={(e) => {
				// Ignore synthetic click after pointerdown close.
				if (e.target === e.currentTarget) {
					e.preventDefault();
					e.stopPropagation();
				}
			}}
		>
			<div
				role="dialog"
				aria-label="Add to collection"
				aria-modal="true"
				style={{
					width: 'min(520px, 100%)',
					maxHeight: 'min(680px, 100%)',
					overflow: 'auto',
					background: 'var(--modal-surface, var(--panel, var(--card)))',
					color: 'var(--text, var(--fg))',
					border: '1px solid var(--modal-border, var(--border, rgba(255,255,255,0.10)))',
					borderRadius: 12,
					boxShadow: '0 18px 48px rgba(0,0,0,0.42)',
					padding: 14,
				}}
				onPointerDown={(e) => e.stopPropagation()}
				onMouseDown={(e) => e.stopPropagation()}
				onClick={(e) => e.stopPropagation()}
			>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
					<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
						{stack.length > 0 && (
							<>
								<button className="btn" onClick={() => setStack((s) => s.slice(0, -1))} disabled={busy} title="Back">Back</button>
								<button className="btn" onClick={() => setStack([])} disabled={busy} title="Root">All</button>
							</>
						)}
					</div>
					<button className="btn" onClick={onClose} disabled={busy}>Done</button>
				</div>

				<div style={{ marginTop: 10, marginBottom: 10 }}>
					<div style={{ fontWeight: 700 }}>Add to…</div>
					<div style={{ color: 'var(--muted)', fontSize: 12 }}>
						{breadcrumb || 'All notes'}
					</div>
				</div>

				<div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
					{parentId != null && (
						<button className="btn" onClick={() => { addTo(Number(parentId)); }} disabled={busy} title="Add to current collection">
							Add here
						</button>
					)}
					<button className="btn" onClick={clearAll} disabled={busy} title="Remove from all collections">
						Remove all
					</button>
				</div>

				<div style={{ display: 'grid', gap: 6 }}>
					{loading && <div style={{ color: 'var(--muted)' }}>Loading…</div>}
					{!loading && collections.length === 0 && <div style={{ color: 'var(--muted)' }}>No sub-collections</div>}
					{collections.map((c) => (
						<div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-2, transparent)' }}>
							<div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
								<button
									className="btn"
									onClick={() => setStack((s) => [...s, { id: c.id, name: c.name }])}
									disabled={busy}
									title="Open"
								>
									Open
								</button>
								<div style={{ overflow: 'hidden' }}>
									<div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
									{typeof c.noteCount === 'number' && <div style={{ color: 'var(--muted)', fontSize: 12 }}>{c.noteCount} notes</div>}
								</div>
							</div>
							{(() => {
								const isMember = idSet.has(Number(c.id));
								return (
									<button
										className="btn"
										onClick={() => { isMember ? removeFrom(c.id) : addTo(c.id); }}
										disabled={busy}
										title={isMember ? 'Remove note from this collection' : 'Add note to this collection'}
									>
										{isMember ? 'Remove' : 'Add'}
									</button>
								);
							})()}
						</div>
					))}
				</div>

				<div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
					<div style={{ fontWeight: 700, marginBottom: 6 }}>New collection</div>
					<div style={{ display: 'flex', gap: 8 }}>
						<input
							value={creatingName}
							onChange={(e) => setCreatingName(e.target.value)}
							placeholder="Name"
							style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)' }}
							onKeyDown={(e) => { if (e.key === 'Enter') createAndAdd(); }}
							disabled={busy}
						/>
						<button className="btn" onClick={createAndAdd} disabled={busy || !creatingName.trim()}>Create & add</button>
					</div>
				</div>
			</div>
		</div>,
		document.body
	);
}
