# Deploy: Render (free) + Turso

Cost $0. Render's free web service sleeps after ~15 min idle (first load ~1 min); open the site a few minutes before a sale starts. Its disk is ephemeral, so the data lives in Turso. The server refuses to boot with `NODE_ENV=production` unless `DATABASE_URL` is `libsql://` or `https://`.

## 1. Turso

```sh
turso db create company-ticket --location fra
turso db show company-ticket --url          # libsql://company-ticket-<you>.turso.io
turso db tokens create company-ticket       # full access -> DATABASE_AUTH_TOKEN
```

## 2. Render

The app repo is on GitHub (it is public: no secrets live in it; only the backups repo in step 3 must be private), then Render → New → Blueprint → pick it (reads `render.yaml`: Node 24, `rootDir: web`, build `npm ci && npm run build`, start `node server/index.js`, health check `/healthz`). Fill the prompted vars:

| Var | Value |
|---|---|
| `DATABASE_URL`, `DATABASE_AUTH_TOKEN` | from step 1 |
| `ADMIN_PASSWORD` | superuser `sina` (`ADMIN_USERNAME`) |
| `BASKAN_PASSWORD` | başkan `baskan` (`BASKAN_USERNAME`) |
| `TICKET_USER_PASSWORD` | shared password for `mimarlik kutuphane carsi hazirlik disari` (unset = random per user, never logged in production: set them in the app under Hesaplar) |

Set by the blueprint: `NODE_VERSION=24`, `NODE_ENV=production`, `HOST=0.0.0.0` (Render sets `PORT`). No session secret is needed (sessions are random ids stored hashed in the DB).

**First boot** (every boot, idempotent): migrations, then the users above are created only if missing, and the KKM + Mimarlık halls are seeded only if there are no halls. Existing users are never touched, so change passwords in the app (Hesaplar), not by editing the env vars. Then in the site: Etkinlikler → add the event, add days (set the hall prices on the first day).

The build uses `web/vendor/look` (the shared UI kit, committed) because Render clones only this repo. After changing the workspace `_look`, run `npm run vendor-look` in `web/` and commit the result. With `rootDir: web`, pushes that change nothing under `web/` don't redeploy.

## 3. Backups

**In the app** (Settings → Yedek, başkan and superuser only, since the file holds password hashes): download a `.db`; import one (merge); each import keeps a snapshot (last 5). A snapshot restore replaces the data only (halls, events, days, tickets, logs); accounts, passwords and logins stay as they are. See README.

**Nightly GitHub Action** (`.github/workflows/backup.yml`, 02:17 UTC, keeps 30) runs `node web/server/cli/backup.mjs`: the same `.db` as the in-app download, encrypted with AES-256-GCM (`CTB1` + 12-byte IV + ciphertext + 16-byte tag), uploaded as a release asset to a **private** backups repo. It contains password hashes, hence the encryption. Turso also keeps 1-day point-in-time restore.

One-time setup:
1. Create a private repo, e.g. `<you>/company-ticket-backups` (add a README).
2. `openssl rand -base64 32` (or 64 hex chars from `openssl rand -hex 32`) → password manager (**lose it = backups unreadable**) and secret `BACKUP_KEY`.
3. `turso db tokens create company-ticket --read-only` → secret `BACKUP_DATABASE_AUTH_TOKEN`.
4. Fine-grained PAT, only the backups repo, Contents read/write → secret `BACKUP_REPO_TOKEN`.
5. Secrets in the app repo: `DATABASE_URL`, `BACKUP_DATABASE_AUTH_TOKEN`, `BACKUP_KEY`, `BACKUP_REPO_TOKEN`, `BACKUP_REPO` (`owner/company-ticket-backups`), and for restore `DATABASE_AUTH_TOKEN` (full access).
6. Actions → backup → Run workflow; check the release appears. GitHub pauses scheduled workflows after 60 days without repo activity: re-enable it in the Actions tab before the season.

**Restore = merge**, the same rules as the in-app import: newer row wins, rows only in the backup are added, a sale is never un-sold, deletes from the backup apply (the CLI counts as superuser), nothing runs while any seat is held. Actions → restore → Run workflow, `backup` = `latest` or a tag, **apply unticked** → read the dry-run report in the log → run again with **apply ticked** (a `cli` snapshot is saved first). Whole DB gone: create a new Turso DB, point the GitHub secrets at it, restore (the CLI migrates an empty DB first), then point Render at it.

Terminal (in `web/`, with `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `BACKUP_KEY` set):

```sh
node server/cli/backup.mjs out.bak.enc
node server/cli/restore.mjs out.bak.enc            # dry run
node server/cli/restore.mjs out.bak.enc --apply    # also accepts a plain .db from the app
```

Old Django-era `.bak.enc` releases are a different format and cannot be restored by the Node CLI.

## Cutover from the Django deploy

The Node app uses its own schema; Django data is **not** migrated (only the two halls are re-seeded).

1. Take a last Django backup first: run the old backup workflow (or `BACKUP_KEY=… python manage.py backup last-django.bak.enc` against Turso) and keep the file with its key.
2. Use a **new, empty** Turso DB for the Node app (or empty the old one only after step 1).
3. Replace the Render service with the blueprint in `render.yaml` (same name `company-ticket`); fill the new env vars (`BASKAN_PASSWORD`; drop `SECRET_KEY`, `PYTHON_VERSION`).
4. Deploy, check `/healthz`, log in as `sina`, `baskan` and one sales user.
   Check the client IP once: the login rate limit keys on `req.ip` and assumes Render adds exactly one proxy hop (`trust proxy 1`). The app records no IPs, so test it by behaviour: from a laptop, enter a wrong password for a sales user 10 times (the 11th try answers "15 dakika"), then log in as that same user from a phone on mobile data. It must work there. If the phone also gets the 15-minute message, `req.ip` is Render's proxy, not the client, so every seller shares one rate-limit bucket: fix the `trust proxy` hop count in `server/app.js`.
5. Set the hall prices on the first day, recreate the season's events/days, do a test hold + sell + cancel.
6. Point the GitHub secrets (`DATABASE_URL`, tokens) at the new DB and run the backup workflow once by hand; then a restore dry run.

The Django blueprint is kept in `scripts/render-django.yaml`.

## Not verified yet

Only local runs exist: unit tests on a SQLite file and against a local `sqld`, and a headless browser check. Never run for real: a Turso database, the Render build and deploy, and both GitHub workflows.
