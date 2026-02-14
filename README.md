## Image Upload Limits

- **MAX_IMAGE_UPLOAD_MB**: Controls Express JSON body limit for image data URLs. Increase if you see `PayloadTooLargeError`.
# FreemanNotes

Modern, fast notes app with a minimalist UI, responsive grid, and collaboration-ready backend. Built with React + Vite on the client and Express + Prisma (MySQL) on the server.

## Overview

- Single dev process: server runs Vite middleware to serve the client during development.
- Database: Prisma ORM with MySQL; schema auto-pushed from code.
- Auth: JWT-based; first user is automatically an admin; admin-only invites.
- Preferences: per-user UI settings persisted and applied on login.

## Features

- **Notes Grid**: Responsive columns with stable width; FLIP animations on resize and reorder.
- **Drag-to-Reorder**: Swap or rearrange behavior (user preference); order persisted server-side.
- **Interactive Checklists**: Optimistic toggling; incomplete items shown first; completed items collapsible.
- **Preferences**: Note width, font, spacing, checkbox size, text size, drag behavior, animation speed, colors.
- **Popovers & Menus**: Widths match note card; footer actions fit without scrollbars.
- **More Menu**: Delete, Add Label, Uncheck All, Check All — anchored at card bottom-right.
- **Invites**: Admins can invite by email; each invite carries a desired role; first account is auto-admin.

## OCR (Image Text → Search)

FreemanNotes can extract readable text from note images **server-side** using **PaddleOCR**, then include that text in the existing global search bar.

### How it works

- When an image is added to a note, the server returns immediately (no UI blocking).
- A background OCR job runs automatically:
  - Decodes the image bytes (supports data URLs, `/uploads/...`, and http/https URLs).
  - Preprocesses for accuracy (auto-orient, flatten alpha → white, contrast normalize, downscale large images).
  - Runs PaddleOCR with angle classification (handles rotated text; best-effort deskew).
  - Stores:
    - `ocrText` (raw extracted text)
    - `ocrSearchText` (normalized text optimized for indexing)
    - `ocrDataJson` (structured result: blocks/lines/boxes/confidence)
    - `ocrHash` (sha256 of image bytes to avoid re-OCR)
- When OCR completes, clients are notified via `note-images-changed`, so search results update automatically.

### Installation (minimal)

- Docker (recommended): OCR works out of the box because the container image includes Python + PaddleOCR.
- Local development: OCR requires Python 3 and PaddleOCR deps. If Python (or deps) are missing, OCR fails safely and the app continues running.

### Extending language support

- OCR defaults to English (`lang="en"`).
- The OCR service is designed to accept a `lang` parameter later (PaddleOCR supports many languages).

## Planned

- **Labels UI**: Inline chips and a small labels editor popover.
- **Invite UX**: Auto-fill invite token from `/?invite=`; invite list page for admins.
- **Email Verification**: Optional verify-on-register.
- **Invite Expiry**: Expiring tokens; admin-configurable.
- **More Animations**: Subtle transitions for popovers and editor state.

## Quick Start

1) Copy `.env.example` to `.env` and set values:

```
PORT=4000
APP_URL=http://localhost:4000
NODE_ENV=development

# MySQL connection (example)
DATABASE_URL="mysql://user:pass@host:3306/freeman"

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

### Compose: optional persistent MySQL

The included `docker-compose.yml` has an optional MySQL service behind a profile that uses a named volume.

1) Set `DATABASE_URL` in your `.env` to:

`DATABASE_URL="mysql://freeman:freemanpass@db:3306/freemannotes"`

2) Start compose with the DB profile:

`docker compose --profile with-db up --build`

3) When updating, do **not** run `docker compose down -v` (that deletes volumes).

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


