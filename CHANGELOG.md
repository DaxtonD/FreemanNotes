# Changelog

All notable changes to this project will be documented in this file.

Adheres to Semantic Versioning (MAJOR.MINOR.PATCH).

## [0.2.0] - 2026-01-31

### Collaboration & Live Updates
- Adopt Yjs as the canonical collaborative state for notes.
- Server-authoritative Y.Doc lifecycle: initialize from DB, persist snapshots on every update.
- WebSocket collaboration endpoint (`/collab`) for real-time sync across clients.
- Integrity diagnostics endpoint: `GET /api/notes/:id/integrity` compares DB vs Y.Doc; supports `?token` in dev.

### Text Notes
- Stop storing HTML for text notes; keep TipTap JSON and derive sanitized previews.
- Headless TipTap Editor bound to Y.Doc computes live HTML previews on NoteCard.

### Checklist Collaboration
- CRDT model: `Y.Array<Y.Map>` for checklist items with `content`, `checked`, `indent`, and stable `uid` keys.
- Operations for add/edit/toggle/move/indent with server-persisted order.
- Live NoteCard updates reflect Yjs changes immediately.

### Drag & UX Improvements
- Restore smooth vertical drag animation: neighbors shift up/down with eased transforms.
- Fix nested drag mis-selection when dragging across unchecked/checked groups.
- Increase drag handle hit area for easier grabbing.

### Stability & Dev Experience
- Debounced preview sync for text notes; Windows `start` uses `cross-env`.
- Minor UI polish: checklist alignment, paragraph margin resets, Underline restored.

-
## [0.2.1] - 2026-01-31

### Changed
- CI: Docker workflow now publishes semver tags without the leading `v` (e.g., `0.2.1`, `0.2`) in addition to `v0.2.1`.
- No code changes.

## [0.1.0] - 2026-01-28
- Initial public commit of FreemanNotes
- Core features: responsive notes grid, drag-to-reorder, user preferences, invites, and updated README

## Template for future releases

### Added
- 

### Changed
- 

### Fixed
- 

### Removed
- 

### Security
- 
