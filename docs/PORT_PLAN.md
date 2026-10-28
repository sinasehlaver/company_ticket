# company_ticket → Node + React port: plan (for the Opus 5.5 session)

Status 2026-10-28: planning only, no code written. Read first: `docs/USER_FLOWS.md` (flows F1-F12, quirks, decisions, gaps), `.claude/rules/company_ticket.md`, `.claude/rules/_webapp-defaults.md`, `.claude/rules/_turkish-ui.md`, `_ui.md`. Django stays untouched as reference (`ticketsystem/`).

Run the build on **Opus 5.5** (main = plan/judgement) and phase subagents on Opus 5.5 too (user's choice; overrides the Sonnet-for-mechanical default). Put a labelled cost estimate (prices from the `claude-api` skill) in the ExitPlanMode summary.

## Stack and layout

New dir `company_ticket/web/` (Django files stay in place): `server/` Express + `@libsql/client` (`file:` URL in dev, Turso in prod, same code), `client/` Vite + React from `_starter/` (`_look` linked). Port pair: take next free from `.claude/ports.md`, bind 127.0.0.1, add row in the same change. Real session auth (argon2/scrypt, HttpOnly SameSite cookie, server-side sessions table), CSRF token on every POST, no state change on GET. Tests: `node:test` for server (parity tests first: hold/sell/cancel), one browser pass at the end via `.claude/scripts/browser.mjs`. Entry point `npm run verify`.

## Schema (same shape as Django models)

halls, events, days, tickets (`UNIQUE(day_id,row,num)`), logs (action `satış` | `satış iptal`), users (username, hash, role `sales|baskan|superuser`, disabled, `updated_at`), sessions, meta(`schema_version`). All rows get `updated_at` (ISO UTC ms) and a stable `uid` (uuid) so merge import can match rows across DBs. Soft-delete not used; deletes write a `tombstones(uid, table, deleted_at)` row so merge doesn't resurrect deleted halls/events/days.

## Atomic hold / sell (quirks 1-3)

- Hold: `UPDATE tickets SET status=1, owner=?, updated_at=? WHERE id=? AND day_id=? AND status=0` ; 0 rows changed => 409 "başkası tuttu" toast. Unhold: `... WHERE status=1 AND owner=me`. Count hall: pick first free ticket inside the same single UPDATE (`WHERE id=(SELECT id ... status=0 LIMIT 1)`).
- Sell: one transaction; `UPDATE ... SET status=2 WHERE day_id=? AND status=1 AND owner=me`, insert one log per `RETURNING` row. Client sends the list of seat ids it confirmed; server sells only if the held set still equals it, else 409 + refreshed state. Concurrency test: N parallel holds on one seat => exactly 1 winner.
- Cancel (başkan/superuser only): strict parser (`a-32, b-25`, case-insensitive rows, empty items rejected with message listing bad tokens), count hall N validated 1..sold; all-or-nothing; resets owner; log each. Toasts for every outcome.
- Seat map: render exactly as Django (row bands, tier hues 150..360, aisle `-`, gap `-1`, price at left, letters both sides). Poll or SSE every few seconds so other users' holds appear without reload.

## Roles

sales: browse, hold, sell own. başkan: + cancel, sold count + revenue, create/edit hall/event/day, edit prices, release seats, accounts, report + CSV. superuser: + delete hall/event/day (typed confirmation; day with sold tickets needs extra confirm), import. Authz middleware on every route, role table tested per route.

## Backup: download and import (decided 2026-10-28 with Sina)

**Download `.db`** — allowed: all 5 sales accounts + başkan + superuser (every active account). Produces a consistent SQLite file via `VACUUM INTO` (fallback: serialized copy in a transaction when Turso doesn't support it) into a temp dir with random name, streamed then deleted. Includes users (password hashes), so the file is sensitive: warn in the UI, `Cache-Control: no-store`, log every download (who, when) in an `audit` table. Filename `company-ticket-YYYYMMDD-HHMM.db`. Rate-limit.

**Import `.db`** — allowed: başkan + superuser only. Flow:
1. Upload (size cap, e.g. 50 MB; multipart to temp dir, never an attacker path) and open the file **read-only in a separate connection**.
2. **Validate before touching live data**: SQLite magic header, `PRAGMA integrity_check`, expected tables/columns, `meta.schema_version` <= server's (older => run migrations on a copy; newer => reject), row-count sanity.
3. **Block while any seat is held** (status=1): show who holds what; the user releases (başkan tool) or waits, then retries. Re-check inside the merge transaction.
4. **Diff summary + typed confirmation**: counts file vs live (halls, events, days, tickets sold/held/free, logs, users) and per-table "will add / update / keep / conflict"; user must type `İÇE AKTAR`.
5. **Auto-snapshot** of the live DB (same `VACUUM INTO`) saved to a `snapshots/` store before the merge, kept (last 5), offered as a download in the result toast = one-click undo (restore = import of that snapshot with "replace" semantic, superuser only).
6. **Merge, newer wins**, in one transaction (all or nothing):
   - Row matching by `uid`. Row only in file => insert. Row only in live => keep (unless a file tombstone is newer than the live row's `updated_at` => delete; a live tombstone newer than the file row => stay deleted).
   - Row in both: compare `updated_at`; newer wins whole row (no field-level merge). Tie => live wins.
   - **Tickets** are the sensitive case: same newer-wins rule per ticket, but a `sold` ticket in live never reverts to free/held by an older file row; a sale-cancel only wins if its `updated_at` is genuinely newer. A ticket from the file that points to a day/event missing on both sides is skipped and reported.
   - **Logs** are append-only: union by `uid`, never updated or removed.
   - **Users**: matched by username; newer wins, except the importer's own account row is always kept as live (no lockout), and role/disabled of the importer can't be downgraded by import. Sessions are never imported.
   - Foreign keys re-mapped through `uid` (integer ids may differ between DBs); insert order halls → events → days → tickets → logs.
7. Result report: counts added/updated/kept/skipped with reasons, shown in a dialog and written to `audit`.
Tests: fixtures with two DB files covering each rule above (newer/older/tie/tombstone/sold-never-reverts/own-account/held-blocks/corrupt file/newer-schema/path traversal in filename/oversize/non-başkan 403/CSRF).

## Phases (each verified by tests; keep each well under half the context)

1. Server core: schema, auth/sessions/CSRF, roles middleware, pricing (port `pricing.py` + its tests), create hall/event/day (F3-F6), seed from `kkm_seats.json`. Parity tests vs `ticketsystem/tests.py`.
2. Reservation core: hold/unhold/sell/cancel/count hall + concurrency tests + log + lookup (F8-F12).
3. React UI from `_starter/`: login, browse, seat map, day tabs, sell/cancel dialogs, toasts, theme, Turkish UI, size-responsive for phones at the sales desk.
4. Başkan tools: edit/delete, release seats, accounts, report + CSV.
5. Backup download/import (section above) + UI (Settings → Yedek) .
6. Deploy config (Render + Turso), README, rules file, ports row, `start.sh`, DEPLOY.md update.

Docs move with code: README + `.claude/rules/company_ticket.md` once at the end of each phase group, not per edit.

## Walkthrough for the user at the end (required, unasked)

Exact commands (`! ./web/start.sh`), URL, per-feature "what good looks like" (two browsers hold the same seat => one gets a toast; sell lists held seats; backup download then import into a second throwaway DB showing the diff dialog), and what is unverified (real Turso, GitHub workflows). Then wait for the user to test.
