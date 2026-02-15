# Changelog

All notable changes to this project will be documented in this file.

Adheres to Semantic Versioning (MAJOR.MINOR.PATCH).

## [Unreleased]

### Added
- 

### Changed
- 

### Fixed
- 

## [0.7.1] - 2026-02-15

### Changed
- Migrated runtime database setup and container defaults to PostgreSQL (`pg`) with updated bootstrap/setup scripts and Docker wiring.
- Mobile/FAB create flows now use the same editor scroll-shell structure and title/body width behavior as existing-note editors.
- MobileCreateModal rich-text toolbar now matches the existing note editor order and controls (including link placement and justify alignment).
- Tightened more-menu sizing and spacing across desktop and mobile/PWA for denser, easier-to-scan actions.

### Fixed
- Auth session persistence after server restarts: returning users are no longer incorrectly prompted to log in when `/api/auth/me` is valid.
- Mobile note-card gesture conflicts: long-press menu vs drag activation, sidebar swipe interference during drag, and background drag while menu is open.
- Mobile long-press/menu interactions on Android no longer trigger unwanted text-selection/callout behavior.
- Note-card image picker now supports selecting and attaching multiple images in one action (desktop/mobile/PWA).
- Checklist mobile drag intent tuning: improved vertical reorder pickup and reduced accidental horizontal indent actions.
- Mobile create/edit parity fixes for focus rings, title-missing highlighting, and bottom typing runway near sticky/footer controls.

## [0.6.9] - 2026-02-14

### Changed
- Refined header controls and icon styling for better visual consistency (menu button now matches view-toggle theme).
- Mobile/PWA search placement was moved into the sticky strip for improved reachability.
- Desktop quick-create sticky strip was tightened and aligned flush under the header with a solid background.

### Fixed
- Note reordering can now be started from note content areas more reliably across desktop and touch devices.
- Desktop checklist-preview checkboxes are interactive again, while mobile/PWA card toggles remain intentionally disabled.
- Checklist editors now clear active caret/selection/highlight state when toggling item checkboxes.
- Improved checklist row alignment on mobile/PWA editors (drag handle, checkbox, and text baseline).

## [0.6.7] - 2026-02-14

### Changed
- Added a 3-state view cycle in the header: card view, 1x1 list view, and 2x1 list view.
- Refined list layouts to use a title-first header with compact metadata chips and hover-revealed action icons.
- Updated drag previews in list modes to show only the visible title row while reordering.

### Fixed
- List views no longer show note body previews or leave empty white space under titles.
- Image preview expansion now chooses up/down direction based on available viewport space and image count, improving visibility near the top of the screen.
- Expanded image popups now render above neighboring cards via elevated stacking.
- Docker startup no longer fails on Prisma runtime regeneration permissions (`EACCES`) when running with `PUID/PGID`; production startup now safely uses build-time generated Prisma client by default.

## [0.6.6] - 2026-02-13

### Added
- Admin User Management now shows per-user usage stats: note count, image count, database usage, filesystem usage, and total storage.
- Optional Unraid-style container environment support: `PUID`, `PGID`, and `UMASK`.

### Changed
- User Management layout was refined for mobile so usage stats remain readable on narrow screens.
- Docker runtime now supports optional uid/gid privilege drop at startup (via `gosu`) for bind-mounted shares.

### Fixed
- Editor image dock behavior across note/checklist editors: the Images toggle stays fixed at the bottom while expanded images reveal upward and editor body space shrinks/expands accordingly.

## [0.6.3] - 2026-02-10

### Added
- Note cards now show a "+N images" chip by default; click to expand/collapse image thumbnails.
- Per-note image preview expansion preference persists per user across devices and updates in realtime across connected clients.

### Fixed
- NoteCard collaborator/label/collection dropdowns now collapse immediately after selecting an item.
- Take-note checklist: desktop drag handle reliably starts drag, drag visuals are stable, vertical/horizontal direction locking supports indent, and link insertion no longer triggers click-away close.

## [0.6.2] - 2026-02-10

### Added
- Mobile/PWA: long-press on a note card body opens the More menu.

## [0.6.1] - 2026-02-10

### Fixed
- User profile photos/avatars now persist across container updates (uploads directory configurable via `UPLOADS_DIR`; Docker Compose mounts a persistent uploads volume).

## [0.6.0] - 2026-02-10

### Added
- OCR pipeline for note images (PaddleOCR runner + preprocessing) with persisted OCR text/metadata on `NoteImage`.
- Async server-side OCR queue with SHA-256 dedupe across identical images.

### Fixed
- Enforced checklist empty-item pruning across create + edit editors.
- Notes/checklists cleared to an empty state are discarded instead of being saved.
- PWA swipe-right gesture now reliably opens the sidebar.
- Dev startup no longer errors due to missing database-url helper script.

## [0.5.2] - 2026-02-10

### Added
- Per-device preferences for editor and note-card behavior (stored under device profile when device headers are present).

### Changed
- Note creation and editing UX refinements across desktop and mobile (create modal/flows, note-card interactions, and grid behavior).

### Fixed
- Trash menus now match across all devices and editors: trashed notes show Restore + Delete permanently.
- Enforced rule: trashed notes can’t be archived (UI guard + server-side conflict response).
- Checklists automatically prune empty-text items on save/close (client-side Yjs + server-side filtering on create/sync).

## [0.5.1] - 2026-02-09

### Fixed
- Docker/GitHub build: `npm ci` no longer fails when the repository hasn’t copied `prisma/schema.prisma` yet (postinstall now skips Prisma steps until schema exists).

## [0.5.0] - 2026-02-08

### Added
- Web Push notifications for reminders (Android-friendly background delivery).
- Service worker `push` + `notificationclick` handling.
- Notifications settings UI: enable permission/subscription, local test, server push test.
- Link previews stored per-note (multiple previews per note) with realtime updates.

### Changed
- In-app reminder notifications prefer service-worker `showNotification()` with a fallback to `new Notification()`.

### Fixed
- Mobile image and menu UX (bottom-sheet picker, long-press actions, in-app confirm dialog).
- Collapsed desktop sidebar icons now expand and perform their actions.

## [0.4.6] - 2026-02-08

### Added
- Always-visible active view chips (collection path, labels, collaborator, search, sort, grouping, smart filter) with per-chip clear and a global clear-all.
- Create-into-collection flow: when a collection filter path is active, new notes/checklists can be auto-added to the current collection on Save (toggle in the create UI).
- Mobile fullscreen create modals for note + checklist with Save-only persistence.

### Changed
- Mobile Collections navigation no longer auto-closes the drawer when drilling into a collection.

### Fixed
- Desktop TakeNoteBar click-away behavior so it doesn't immediately close on open.
- Mobile checklist drag behavior (handle/spacing/ghosting) to better match the main checklist editor.

## [0.4.2] - 2026-02-05

### Added
- Sidebar sorting + grouping controls (sort mode, group mode, and quick resets).
- Real-time note lifecycle events over `/events`: broadcast `note-created` and `note-deleted` so multiple sessions/collaborators stay in sync.
- Real-time image refresh across clients: broadcast `note-images-changed` and fetch the latest images via `GET /api/notes/:id/images`.

### Changed
- Default ordering behavior: notes remain stable in creation order unless manually reordered.
- Sorting pipeline: layered sort → optional grouping while preserving manual `ord` as the baseline for Default mode.
- `/events` websocket now uses `wss://` automatically when the app is served over HTTPS.

### Fixed
- New labels become immediately filterable without requiring refresh.
- Images added/removed show up immediately in editors and note cards (optimistic UI + reconciliation).
- Note card body clipping when images are present.

### UI
- Note card thumbnails: compact, wrap layout with “+N more” overflow indicator.
- Editor images moved to a bottom, collapsible section with a scroll cap for large sets.

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
