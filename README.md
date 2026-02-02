<!-- OCR feature removed -->

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

## Versioning

- Uses Semantic Versioning (MAJOR.MINOR.PATCH).
- When you say a milestone is done, we will bump and tag:
  - Patch: `npm run release:patch`
  - Minor: `npm run release:minor`
  - Major: `npm run release:major`
- Each release updates `package.json` version, creates a Git tag `vX.Y.Z`, and pushes to GitHub.
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

## OCR (PaddleOCR)

- Engine: PaddleOCR with `lang="en"` and `use_angle_cls=True`.
- Deterministic preprocessing only: convert to RGB, remove alpha, resize so max dimension ≈ 1800px; no thresholding or tuning.
- Output: `{ text, lines: [{ text, confidence }], avgConfidence }`; returns `{ status: "low_confidence" }` if average confidence falls below the threshold.
- One pass per image — no retries.

Setup:
- Requires Python 3 and pip.
- Install Python deps:
  - `pip install -r scripts/requirements.txt`
- Optional: set `PYTHON_BIN` env var to the Python executable if not `python` on your system.
- Swappable design: `server/src/ocr.ts` exposes a factory `createOcrEngine()`; currently uses PaddleOCR.

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


