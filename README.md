# FreemanNotes

FreemanNotes is a modern, fast, offline-capable notes app with rich text, checklists, reminders, collaboration, OCR search, and polished mobile/PWA behavior.

Built with React + Vite (client) and Express + Prisma (server), with PostgreSQL as the primary supported database and optional MySQL compatibility for existing installs.

## Comprehensive Feature List

### Core notes experience
- Rich text notes and checklist notes.
- Responsive card grid plus `cards`, `list-1`, and `list-2` viewing modes.
- Pinned + unpinned sections with persistent order.
- Drag-to-reorder with swap/rearrange behavior and animated transitions.
- Per-note card width controls (regular/double/triple where applicable).

### Checklists
- Live checklist editing with reorder + indent controls.
- Batch checklist actions from More menu (`Check all`, `Uncheck all`).
- Completed-item handling tuned for fast review workflows.

### Reminders & notifications
- Per-note reminders with due-time picker and lead-time offsets.
- Reminder urgency visualization (red/orange/yellow) across card and list contexts.
- One-tap “mark reminder complete” actions to clear reminders quickly.
- Web Push notifications (with local and server test actions in settings).

### Images & OCR search
- Multi-image attachments per note.
- Image gallery view with quick open-to-associated-note behavior.
- Async OCR pipeline using PaddleOCR + preprocessing.
- OCR text is indexed for global search and updated in realtime.

### Collaboration & realtime
- Collaborator support with share/unshare flows.
- Yjs-powered collaborative editing for supported editor paths.
- Realtime event channel for note/reminder/image/share updates across sessions/devices.

### Collections, labels, and filters
- Nested collections with breadcrumb-aware navigation.
- Labels and collaborator filters.
- Active filter chips with fast clear/reset behavior.
- Sorting and smart filters (including reminder-centric views).

### Offline-first architecture
- Local-first cache and mutation pipeline in `client/src/lib/offline`.
- Durable mutation queue + upload queue with retry.
- Background sync engine for eventual consistency when reconnecting.
- Offline create/edit flows for notes/checklists/images with replay.

### Preferences & defaults
- Built-in registration defaults for user + device preferences.
- Hard-coded initial defaults by device class (`mobile`, `tablet`, `desktop`).
- Extensive appearance/layout controls (font, spacing, title size, checkbox sizing, animation behavior, thumb sizes, etc.).
- Device-aware editor and card behavior preferences.

### Mobile/PWA UX
- Installable PWA with guided install and fallback messaging.
- Mobile FAB-based create flows.
- Long-press contextual menus.
- Gesture handling for sidebar open/close and drag interactions.
- Android gesture conflict handling improvements (edge-swipe/back behavior).

### UI polish
- Contextual More menus across cards and editors (including pin/unpin).
- Drag overlays + drop-target highlighting tuned for touch devices.
- Desktop menu/background focus treatment when popups are open.
- Tightened list-layout spacing, metadata chip behavior, and footer dock presentation.

### Security & account model
- JWT auth.
- First user bootstrap as admin.
- Admin-managed invite flow.
- Role-aware access for owner-only actions (e.g., reminders).

## OCR (Image Text → Search)

FreemanNotes extracts text from note images server-side using PaddleOCR and makes it searchable via the global search bar.

- OCR runs asynchronously after image upload.
- Extracted text, normalized search text, metadata, and hashes are stored.
- Clients receive realtime updates when OCR completes.

## Image Upload Limits

- **MAX_IMAGE_UPLOAD_MB**: Controls Express JSON body limit for image data URLs. Increase if you see `PayloadTooLargeError`.

## Quick Start

1) Copy `.env.example` to `.env` and set values:

```
PORT=4000
APP_URL=http://localhost:4000
NODE_ENV=development

# PostgreSQL connection (recommended)
DATABASE_URL="postgresql://user:pass@host:5432/freemannotes"

# MySQL connection (legacy/optional)
# DATABASE_URL="mysql://user:pass@host:3306/freemannotes"

# JWT secret
JWT_SECRET=generate_a_long_random_string

# Web Push (PWA notifications)
# Generate with: npm run push:gen-vapid
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@example.com

# Registration mode
USER_REGISTRATION_ENABLED=true

# SMTP (optional for invites)
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
INVITE_FROM=...
APP_BASE_URL=http://localhost:4000
```

2) Install dependencies and set up the DB:

```
npm ci
npm run setup-db      # runs prisma db push
npx prisma generate   # if needed
```

3) Start development (single process: server + Vite middleware):

```
npm run dev
# Open http://localhost:4000
```

### Database notes

- PostgreSQL is the recommended target for new deployments.
- If you are upgrading from an older MySQL-based install, keep your existing `DATABASE_URL` until you intentionally migrate data.
- Prisma schema sync is still handled via `npm run setup-db`.

## Build & Run (Production)

```
# Build client and server
npm run build

# Start the compiled server (serves client from client-dist)
npm start
# Open http://localhost:4000
```

## PWA Push Notifications (Android)

This app supports **real background notifications** via Web Push (service worker `push` events). Install-time permission prompts are not allowed by browsers; users must enable notifications via an in-app click.

Setup:

- Ensure your database is up to date after pulling changes: `npm run setup-db`.
- Generate VAPID keys: `npm run push:gen-vapid`.
- Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` in `.env`.
- Push requires HTTPS on real devices (localhost is the usual exception).

Testing (in the app):

- Preferences → Notifications → **Enable notifications**
- **Local test** (verifies service-worker `showNotification`)
- **Push test** (verifies subscription + server send)

## Docker

```
# Build image
docker build -t freemannotes:latest .

# Run with .env
docker run -p 4000:4000 --env-file .env freemannotes:latest
```

Or with Compose:

```
docker compose up --build
```

### Docker Compose database profiles

The project includes two optional DB profiles:

- PostgreSQL (recommended): `with-db-postgres`
- MySQL (legacy/optional): `with-db`

#### PostgreSQL (recommended)

1) Set `.env`:

```
DATABASE_URL="postgresql://freeman:freemanpass@postgres:5432/freemannotes"
```

2) Start:

```
docker compose --profile with-db-postgres up --build
```

#### MySQL (legacy/optional)

1) Set `.env`:

```
DATABASE_URL="mysql://freeman:freemanpass@db:3306/freemannotes"
```

2) Start:

```
docker compose --profile with-db up --build
```

### Persisting uploads (avatars, etc.)

User-uploaded files are served under `/uploads` (e.g. avatars at `/uploads/users/{id}.jpg`). Note images uploaded from the UI are also persisted here (under `/uploads/notes/...`).

In Docker, you should persist this directory using a volume; otherwise files will be lost when the container is replaced.

- **UPLOADS_DIR**: Filesystem path where the server reads/writes uploads.
  - Default: `./uploads` (relative to the server working directory)
  - Compose default: `/app/uploads` (with a named volume mounted)

#### Unraid (recommended): bind-mount uploads to the array

Docker named volumes typically live under Docker's data-root (often on cache in Unraid). To avoid note images filling cache space, use a bind mount to a host path on the array.

With the provided Compose file, set these in your `.env`:

```
# Container path
UPLOADS_DIR=/app/uploads

# Host path (example) -> store on array share
UPLOADS_VOLUME=/mnt/user/freemannotes/uploads

# Optional Unraid-style identity/permissions
PUID=99
PGID=100
UMASK=002
```

Now `docker compose up --build` will mount that host directory into the container and all uploads (avatars + note images) will be stored there.

If `PUID` and `PGID` are provided, the container will run the app process under that uid/gid (via `gosu`) and apply `UMASK` at startup. This is optional, but recommended on Unraid when bind-mounting to array shares.

Compose already includes an `uploads_data` named volume for the app service. When updating, avoid `docker compose down -v` unless you intentionally want to delete uploads.

If you run via `docker run`, mount a volume and set `UPLOADS_DIR`:

```
docker run -p 4000:4000 --env-file .env -e UPLOADS_DIR=/app/uploads -v freemannotes_uploads:/app/uploads freemannotes:latest
```

## Keeping Test/Prod Data When Updating

Pulling a new app image should **not** reset your database as long as your database storage is persistent.

- If you run MySQL as a container, make sure it uses a **named volume** (do not use an ephemeral container filesystem).
- Avoid destructive Prisma commands in production like `prisma migrate reset` or `prisma db push --force-reset`.
- For public/production deployments, prefer **Prisma Migrate** (`prisma migrate deploy`) rather than relying on `prisma db push`.
  - `migrate deploy` applies versioned SQL migrations in order and is the standard upgrade path.
  - `db push` is great for prototyping, but it is not a robust “upgrade mechanism” for apps in the wild.
- This app applies schema changes at startup via `ensureDatabaseReady()` and does **not** intentionally wipe data in production.

### Compose: persistent database volumes

The included `docker-compose.yml` defines persistent named volumes for both optional database profiles.

- PostgreSQL profile: `with-db-postgres` (volume: `postgres_data`)
- MySQL profile: `with-db` (volume: `mysql_data`)

When updating, do **not** run `docker compose down -v` unless you intentionally want to remove database data.

## Versioning

- Uses Semantic Versioning (MAJOR.MINOR.PATCH).
- When you say a milestone is done, we will bump and tag:
  - Patch: `npm run release:patch`
  - Minor: `npm run release:minor`
  - Major: `npm run release:major`
- Each release updates `package.json` version, creates a Git tag (e.g. `0.5.0`), and pushes to GitHub.
- Maintain notes in [CHANGELOG.md](CHANGELOG.md).

## Release Notes

### v0.3.1

- **Fix: Grid packing after filters** — Recalculates masonry row spans when label filters or search change, ensuring notes snap back to the correct layout after clearing filters. Implemented by dispatching `notes-grid:recalc` in `client/src/components/NotesGrid.tsx` whenever `selectedLabelIds`, `searchQuery`, or `notes` change.

## API Summary

- `POST /api/auth/register` — Register (invite required if registration disabled).
- `POST /api/auth/login` — Login; returns JWT.
- `GET /api/auth/me` — Current user (JWT required).
- `PATCH /api/auth/me` — Update user prefs.
- `GET /api/config` — Lightweight config for client (registration enabled flag).
- `POST /api/invite` — Admin-only; create invite and send email.

- `GET /api/notes` — List notes (owner and collaborators).
- `POST /api/notes` — Create note (new notes appear at top-left).
- `PATCH /api/notes/order` — Persist note order.
- `PATCH /api/notes/:id` — Update note.
- `DELETE /api/notes/:id` — Delete note (cascades child rows).
- `PATCH /api/notes/:noteId/items/:itemId` — Update checklist item.
- `PUT /api/notes/:id/items` — Replace/sync checklist items.
- `POST /api/notes/:id/labels` — Add/create label and link to note.
- `POST /api/notes/:id/images` — Add image to note.
- `GET /api/notes/:id/images` — List images for a note.
- `DELETE /api/notes/:id/images/:imageId` — Delete an image from a note.
- `POST /api/notes/:id/images/:imageId/ocr` — Trigger OCR for an image (async).

## Troubleshooting

- **Dev server not reading .env**: Restart after edits; confirm `GET /api/config` reflects `USER_REGISTRATION_ENABLED`.
- **Windows Prisma EPERM (rename)**: Remove temp files then regenerate:
  - `Remove-Item -Force node_modules\.prisma\client\query_engine-windows.dll.node.tmp*`
  - `npx prisma generate`
- **Invite emails**: Ensure SMTP vars are set; server logs show send status.
- **Registration disabled**: Provide `inviteToken` in register body; invite must be unused and match the email.

## Notes

- `node_modules/` is ignored by design; dependencies install from `package.json`.
- `.env` is ignored; keep `.env.example` in the repo for configuration guidance.


