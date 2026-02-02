# Changelog

All notable changes to this project will be documented in this file.

Adheres to Semantic Versioning (MAJOR.MINOR.PATCH).

## [0.3.0] - 2026-02-01

### Added
- Preferences hub with submenus: Appearance, Colors, Drag & Animation, Collaborators.
- User profile photos: client upload (data URL) → server resize/compress via Sharp → stored under `/uploads/users/{id}.jpg` and served statically.
- Real-time photo propagation: broadcast `user-photo-updated` to note participants; clients update owner/collab images inline.
- Collaborator chips display preference (`chipDisplayMode`): persisted per-user; rendering honors Image + Text | Image only | Text only.
- Per-user note color via `NotePref` and `viewerColor`; GET `/api/notes` includes viewer-specific color.
- Events channel updates: `note-shared`, `note-unshared`, `collab-removed`, `user-photo-updated`; `NotesGrid` subscribes for immediate UI refresh.

### Changed
- Preferences consolidated into submenus; Save applies changes immediately (chip display mode via `authContext.updateMe`).
- Header simplified: avatar opens Preferences; Sign out moved into Preferences.
- Header avatar and Preferences preview standardized to 55×55.
- Collaborators section label updated from "Collaborator Chips" to "Collaborators".

### Fixed
- Collaborator chips persist across refresh; rollback on failure.
- First opener of checklist sees live changes (Yjs gating fixed).
- Immediate photo refresh via cache-busting query `?v=timestamp` appended to `userImageUrl` post-upload.

### Removed
- Legacy OCR implementation: tesseract code, env vars, and references removed.

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
