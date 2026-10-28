# Company Ticket System

Seat-map ticket sales for the ODTÜ "Company" Musicals Community, used about two months a year.

- Halls with seat maps (seated, or a plain ticket count), events, show days with per-row prices
- Live seat map: hold seats, sell them in one step, see other sellers' holds every 3 s; works on a phone
- Cancel sales, per-seat log, per-event report with revenue and CSV export
- Roles: sales, başkan, superuser; account management in the app
- Backup: download the database, merge-import a backup, automatic snapshots before every import
- Turkish first, English available; light/dark theme

## Quick start

Needs Node 22.13+ (Render runs 24).

```sh
./start.sh
```

Installs dependencies when needed, starts the API on `127.0.0.1:5140` and the dev UI on `127.0.0.1:5141`, and opens Chrome (macOS `open`; on Linux/Windows open http://127.0.0.1:5141/ yourself, or run `cd web && npm run dev`). The local database is `web/data/company.db`; the first run creates the users with the dev passwords it prints and seeds the KKM and Mimarlık halls.

## Commands

Run in `web/`:

| Command | What it does |
|---|---|
| `npm run dev` | API (watch) on :5140 + vite on :5141 |
| `npm test` | Server and client unit tests on a temporary SQLite file |
| `npm run test:sqld` | The same suite against a throwaway local `sqld` (Turso protocol; needs `sqld` installed) |
| `npm run build` | Builds the client to `client/dist` (served by the server) |
| `npm run verify` | Builds, starts the server on a free port with a scratch DB, runs the headless browser check |
| `npm start` | Production server (`node server/index.js`) |

## Roles

| Role | Can |
|---|---|
| Sales (`mimarlik`, `kutuphane`, `carsi`, `hazirlik`, `disari`) | Browse events, hold and sell seats; theme and language in Settings |
| Başkan | Everything sales can, plus halls, logs, events, days and prices; cancel sales; release others' holds; report; manage sales accounts; import a backup |
| Superuser | Everything, plus deletes (typed confirmation), başkan accounts and roles, restore a snapshot |

## Configuration

| Env var | Meaning |
|---|---|
| `DATABASE_URL` | Default `file:web/data/company.db`. Production needs `libsql://` or `https://` (Turso) |
| `DATABASE_AUTH_TOKEN` | Turso token |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Superuser (default `sina`), created on first boot only |
| `BASKAN_USERNAME` / `BASKAN_PASSWORD` | Başkan (default `baskan`), created on first boot only |
| `TICKET_USER_PASSWORD` | Shared password for the 5 sales users on first boot (unset = random; printed once in dev, never in production: set them in Hesaplar) |
| `HOST` / `PORT` | Listen address, default `127.0.0.1:5140` |
| `NODE_ENV=production` | Secure cookies, proxy trust, Turso-only DB (`ALLOW_FILE_DB=1` overrides for local tests) |
| `BACKUP_KEY` | 32-byte key (64 hex or base64) for the encrypted CLI backups |

Users are never overwritten from env after they exist; change passwords in the app (Hesaplar).

## How it works

Express 5 + `@libsql/client` (SQLite file locally, Turso in production) and a React + Vite client in `web/`. Holds and sales are single conditional updates, so two sellers can never get the same seat.

**Backups.** Settings → Yedek (başkan and superuser; the file holds password hashes): download the whole database as a `.db` file, or import one as a merge (newer row wins, a sale is never undone, deletes only for a superuser, blocked while anyone holds seats) after a preview and a typed `İÇE AKTAR`. Each import first saves a snapshot (last 5 kept, restorable by a superuser; a restore replaces the data only, never accounts or passwords). From a terminal, `node server/cli/backup.mjs out.bak.enc` and `node server/cli/restore.mjs in.bak.enc [--apply]` do the same with AES-256-GCM files; GitHub Actions run them nightly and on demand (see DEPLOY.md).

Internals: [web/docs/DEV_NOTES.md](web/docs/DEV_NOTES.md).

## Deploy

Render (free) + Turso: [DEPLOY.md](DEPLOY.md).

## The Django app

The original Django 5.2 app (`ticketsystem/`, `company/`) stays as a reference. Run it with `scripts/start-django.sh` (venv, migrate, dev users, `127.0.0.1:5130`), tests with `DEBUG=1 python manage.py test`. Its Render blueprint is `scripts/render-django.yaml`.
