# web/ dev notes (Node port of ticketsystem/)

Phase 1 = server core, phase 2 = reservation core. Plan: `~/.claude/plans/snazzy-sleeping-alpaca.md`, `../docs/PORT_PLAN.md`, `../docs/USER_FLOWS.md`.

```
npm install
npm test                 # node --test "server/**/*.test.js"  (a bare dir arg would run index.js too)
npm run test:sqld        # same suite against a throwaway sqld on a free port (scripts/test-sqld.sh, needs /usr/local/bin/sqld)
npm start                # node server/index.js -> 127.0.0.1:5140 (HOST/PORT env override)
```

Env: `DATABASE_URL` (default `file:<web>/data/company.db`, cwd-independent), `DATABASE_AUTH_TOKEN`,
`NODE_ENV=production` (Secure cookie, trust proxy 1, refuses non-`libsql://`/`https://` URL unless
`ALLOW_FILE_DB=1`), `ADMIN_USERNAME`(sina)/`ADMIN_PASSWORD`, `BASKAN_USERNAME`(baskan)/`BASKAN_PASSWORD`,
`TICKET_USER_PASSWORD`.

## Module map (`server/`)

| File | Exports |
|---|---|
| `db.js` | `openDb(url, authToken?)` (file: URLs get the write lock, see gotchas), `migrate(db)`, `schemaVersion(db)`, `tx(db, async t => …)`, `audit(db, username, action, detail)`, `now()`, `newUid()`, `splitSql(sql)`, `MIGRATIONS`, `SCHEMA_VERSION` |
| `schema.sql` | migration 1 (all tables). New schema = append `{version: 2, sql}` to `MIGRATIONS`; never edit v1 once shipped |
| `pricing.js` | `parseSchema(text)`, `formatSchema(rowPrices)`, `hallRows(hall)`, `rowPricesFromBody(prices, rows)`, `readPrices(hall, body) -> {prices, schema}`, `tiers(rowPrices) -> Map price -> [category, hue]`, `PriceError`, `MAX_PRICE` |
| `seats.js` | `validateSeats(seats)`, `istanbulToUtc('YYYY-MM-DDTHH:MM') -> ISO \| null`, `createDay(db, eventRow, hallRow, body) -> dayId`, `MAX_COUNT`, `IST_OFFSET_MIN` |
| `reserve.js` | `loadDay(db,id)`, `siblingDays(db,eventId)`, `dayVersion(db,dayId)`, `dayState(db,dayId,user)`, `toggleSeat(db,day,user,ticketId) -> 'held'\|'released'`, `countHold`, `countRelease`, `sell(db,day,user,ids) -> {sold,total}`, `cancel(db,day,user,body) -> {cancelled}`, `dayLogs(db,day,seat?)`, `parseSeat`, `parseSeatList`, `Conflict` (→ 409 + state), `FREE/HELD/SOLD` |
| `auth.js` | `hashPassword`, `verifyPassword`, `createUser(db, {username, password, role, disabled})`, `setUserDisabled(db, userId, bool)` (kills sessions), `sessionLoader(db)`, `requireRole(minRole)`, `csrfCheck`, `originCheck`, `login(req,res,db,limiter)`, `logout(req,res,db)`, `makeLimiter({max, windowMs, clock})`, `httpError(status, msg)`, `RANK`, `ROLES`, `COOKIE`, `SESSION_MS` |
| `bootstrap.js` | `bootstrap(db, env, log) -> created[]`, `STAFF`, `SEED_HALLS` |
| `app.js` | `createApp({dbUrl, authToken, env}) -> Promise<{app, db, ctx}>` (runs `migrate`, not `bootstrap`), `dbUrlProblem(env)`, `DEFAULT_DB_URL` |
| `index.js` | boot: env check → createApp → bootstrap → listen |
| `routes/index.js` | `ROUTES`, `route(method, path, minRole, handler)`, `mountRoutes(app, ctx)` |
| `routes/days.js` | day page, state poll, toggle/count/sell/cancel, logs (phase 2) |
| `routes/{auth,halls,events}.js` | route registrations; `halls.js` also exports `hallOut(row)`, `getHall(db, id)` |
| `routes/util.js` | `nameFrom(body, label)`, `one(db, sql, args, notFoundMsg)`, `json(text, fallback)` |
| `test-helpers.js` | `makeApp({env})`, `makeClient(base)`, `PASSWORD`; `TEST_DB_URL` set → every `makeApp` drops all tables of that DB instead of a temp file (run with `--test-concurrency=1`) |
| `backup/export.js` | `exportTo(db, path) -> {path,size,counts}` (fresh migrated SQLite file, read tx, column intersection), `withExport`, `exportBuffer`, `exportFilename(date, prefix)` (Istanbul), `EXPORT_TABLES` |
| `backup/validate.js` | `receiveUpload(req,res)` (express.raw 50 MB → 0600 temp file, random name), `validateFile(path) -> {schemaVersion, migratedFrom}`, `tempPath`, `removeTemp`, `MAGIC`, `MAX_UPLOAD`, `REQUIRED` |
| `backup/merge.js` | `planMerge(live, file, importer)` (pure), `previewMerge`, `applyMerge`, `replaceAll` (snapshot restore), `liveHolds`, `HoldsConflict`, `readFileData`, `readLiveData` |
| `backup/snapshots.js` | `takeSnapshot(db, by, reason)` (prunes to `KEEP_SNAPSHOTS`=5), `listSnapshots`, `getSnapshot`, `withSnapshotFile` |
| `backup/crypto.js` | `parseKey`, `encrypt`, `decrypt`, `isEncrypted`, `CTB_MAGIC` (AES-256-GCM, CLI only) |
| `routes/backup.js` | export, import preview/commit, snapshots list/download/restore; `CONFIRM_IMPORT`, `CONFIRM_RESTORE` |
| `cli/backup.mjs`, `cli/restore.mjs` | encrypted backup / merge-restore for the GitHub workflows (see "Backup") |
| `seed/` | copies of `../kkm_seats.json`, `../kkm_seatplan.json` (web/ is self-contained for Render) |

## DB conventions

- `@libsql/client` only, parameterized SQL everywhere (`{sql, args}`). Placeholder lists built from
  counts (bulk ticket insert) are fine; never interpolate values.
- Syncable tables (halls, events, days, tickets, users, logs, snapshots) carry `uid` (`newUid()`) and
  `updated_at` (`now()` = ISO UTC ms). Every UPDATE must also set `updated_at = now()` — merge import
  (phase 5) is newer-wins on it. Logs use `at` (append-only, never updated).
- Deletes (phase 4) must write `tombstones(uid, tbl, deleted_at)` (`tbl` = table name, PK (tbl, uid)).
  Bootstrap won't re-seed a seed hall whose uid is tombstoned. Seed halls have fixed uids
  (`SEED_HALLS[].uid`) so independently seeded DBs agree.
- No FK cascades relied on (PRAGMA foreign_keys is per connection and libsql transactions may open new
  ones): delete children explicitly.
- Multi-statement writes: `tx(db, async t => { await t.execute(...) })` (interactive "write"
  transaction, rollback on throw) or `db.batch([...], 'write')` when no reads are needed in between.
- Dates: `days.date` is UTC ISO. Input is Istanbul local `YYYY-MM-DDTHH:MM` (fixed UTC+3) via
  `istanbulToUtc`. UI must display in `Europe/Istanbul`.
- Tickets: `status` 0 free / 1 held / 2 sold; `owner` = holder user id (NULL when free);
  `last_modified_by` = username text. Count hall: row `m`, num `'0'..'N-1'`, category 0.
  `days.tickets_dict` = `{row: {"-1": [price, hue]}}` (seated only, `{}` for count halls).
- `day_versions(day_id PK, version)` (migration 2, not syncable): every hold/unhold/sell/cancel bumps it in the
  same batch/tx (`INSERT … SELECT ?, 1 WHERE changes() > 0 ON CONFLICT DO UPDATE` right after the UPDATE).
  Version string = `<counter>.<max ticket updated_at ms>.<ticket count>`, so imports also change it. Phase 4/5:
  deleting a day deletes its row; anything else that writes tickets must bump it too.
- Holds/sells don't write `audit` (the `logs` table is their record); cancel writes `sale.cancel` too.
- `users.role` ∈ `sales|baskan|superuser`, `disabled` 0/1. `sessions.id_hash` = sha256(cookie id).

## HTTP conventions

- Route table: add routes only through `route(method, path, minRole, handler)` inside a
  `routes/<area>.js` registered in `routes/index.js`. `minRole` null = public (only `/healthz`,
  `POST /api/login` — a test enforces this). Chain per route: `requireRole` (401 no session, 403 below
  rank) → `csrfCheck` (non-GET) → handler. `originCheck` runs on every non-GET `/api` (login too).
- `handler(req, res, ctx)` with `ctx = {db, env, limiter}`; return a value → JSON 200 (set
  `res.status(201)` first for creates); throw `httpError(status, '<Türkçe mesaj>')` for errors →
  `{error}`. Anything else thrown → 500 `{error:'Sunucu hatası'}` (logged).
- Any `:id` param must be `^[1-9]\d{0,15}$` else 404 (router.param). Unknown `/api/*` → 404 JSON.
  JSON body limit 100kb → 413; bad JSON → 400 `Geçersiz JSON`.
- `req.user = {id, username, role}`, `req.session = {idHash, csrf}`. Role order sales < baskan < superuser.
- Client contract: `POST /api/login {username,password}` → `{user, csrf}` + cookie `ct_sid`;
  `GET /api/me` → `{user, csrf}`; send `X-CSRF-Token: <csrf>` on every non-GET. Login: 10
  failures/15 min per ip+username → 429 (in-memory, per process). Session 12h sliding.
- Every mutation writes an `audit` row (`hall.create`, `hall.rename`, `hall.prices`,
  `event.create`, `event.rename`, `day.create`, `day.date`, `sale.cancel`).

## Phase-1 API

| Route | Role | Body → response |
|---|---|---|
| `GET /api/halls` | baskan | `{halls:[{id,name,kind,seatCount,priceSchema}]}` |
| `GET /api/halls/:id` | sales | `{hall:{id,uid,name,seats,seatPlan,priceSchema,kind:'seated'\|'count',seatCount,rows,prices:{row:price},price}}` (prices/price = prefill from saved schema) |
| `POST /api/halls` | baskan | `{name, seats, seatPlan?}` → 201 `{hall}` (empty price schema) |
| `PUT /api/halls/:id` | baskan | `{name}` → `{hall}` |
| `PUT /api/halls/:id/prices` | baskan | seated `{prices:{row:price}}` (every row) / count `{price}` → `{hall}` |
| `GET /api/events` | sales | `{events:[{id,uid,name,hallId,hallName,dayCount,firstDate}]}` |
| `GET /api/events/:id` | sales | `{event:{…, days:[{id,uid,eventId,date,ticketsDict,updatedAt}]}}` days by date |
| `POST /api/events` | baskan | `{name, hallId}` → 201 `{event}` |
| `PUT /api/events/:id` | baskan | `{name}` → `{event}` |
| `POST /api/events/:id/days` | baskan | `{date, prices\|price, remember?}` → 201 `{day}` |
| `PUT /api/days/:id` | baskan | `{date}` → `{day}` |

## Phase-2 API

All 404 `Gün bulunamadı` for an unknown day. Conflicts → **409 `{error, state}`** (fresh state included).
`state` = `{version, seats:[[id,row,num,price,category,status,mine,holder]], mine:{count,total,list:[{id,row,num,price}]}, free, sold}`;
`holder` (holder/seller username) and `sold:{count,revenue}` only for baskan+ (else `null`); `mine` = held by me.

| Route | Role | Body → response |
|---|---|---|
| `GET /api/days/:id` | sales | `{day:{id,uid,date,kind:'seated'\|'count',ticketsDict,event:{id,name,hallId,hallName},seats:<hall seats.all>\|null,seatCount\|null}, days:[{id,date}], state}` |
| `GET /api/days/:id/state?since=v` | sales | 204 if `v` = current version, else `state` |
| `POST /api/days/:id/toggle` | sales | `{ticketId}` → `{action:'held'\|'released', state}`; 409 `Bu koltuğu başkası tuttu` / `Bu koltuk satıldı`; ticket of another day 404; count day 400 |
| `POST /api/days/:id/count/hold` | sales | → `{action:'held', state}`; 409 `Boş bilet kalmadı`; seated day 400 |
| `POST /api/days/:id/count/release` | sales | → `{action:'released', state}` (frees my highest-id hold); 409 `Tuttuğunuz bilet yok` |
| `POST /api/days/:id/sell` | sales | `{ticketIds}` must equal my held set exactly → `{sold:[{row,num,price}], total, state}`; mismatch 409 `Tuttuğunuz koltuklar değişti…`; empty 400 `Satılacak koltuk yok` |
| `POST /api/days/:id/cancel` | baskan | seated `{tickets:'a-32, B-25'}` / count `{count:N}` (1..sold, newest sold first) → `{cancelled, state}`; all-or-nothing 400 `Anlaşılmayan: … · Tekrarlanan: … · Bu günde yok: … · Satılmamış: …` |
| `GET /api/logs/days` | baskan | `{days:[{id,date,eventId,eventName,hallName}]}` newest first |
| `GET /api/days/:id/logs?seat=a-12` | baskan | `{day, days, seat:'a-12'\|null, logs:[{at,action,username,row,num,price}]}` newest first; bad seat 400, unknown 404 `Bu günde böyle bir koltuk yok` |

## Phase-4 API

Deletes need `{confirm:<exact name>}` (hall/event name; a day's Istanbul `DD.MM.YYYY HH:MM` = `istanbulLabel`, client `confirmStamp`);
with sold tickets they 409 `{error, sold}` until `force:true`. One `tx()`: children deleted explicitly (tickets, logs, day_versions),
a tombstone per deleted syncable row. Audit actions: `hold.release`, `{hall,event,day}.delete`, `day.reprice` (`{schema, changed, counts, held, sold}`), `user.{create,disable,enable,role,password}`, `day.date`, `{hall,event}.rename`.
Migration 3 = `user_logins(user_id, at)` (upserted on login; "son giriş").

| Route | Role | Body → response |
|---|---|---|
| `DELETE /api/halls/:id` · `/api/events/:id` · `/api/days/:id` | superuser | `{confirm, force?}` → `{deleted:{halls,events,days,tickets,logs}, sold}`; wrong confirm 400 |
| `POST /api/days/:id/prices/preview` | baskan | same body → `{free, held, sold, soldOld, soldNew}` = tickets per status whose price/tier would change + old/new revenue of those sold; no writes |
| `PUT /api/days/:id/prices` | baskan | `{prices \| price, held?:'keep'\|'apply', sold?:'keep'\|'apply'}` (default keep; else 400) → free always repriced, held/sold per choice, one tx; `{day, changed, preview, held, sold}`; bumps updated_at + day_versions |
| `POST /api/days/:id/release` | baskan | `{ticketId}` (one seat) or `{userId}` (all of a user's holds, also count days) → releaseHold result + `state`; bumps day_versions |
| `GET /api/users` | baskan | `{users:[{id,username,role,disabled,lastLogin}]}` |
| `POST /api/users` | baskan | `{username, role:'sales'\|'baskan', password(≥8) \| generate:true}` → `{user, password?}` (generated shown once); baskan role superuser-only |
| `PUT /api/users/:id` | baskan | `{disabled?, role?}` (role: superuser only); disable kills sessions; never self, never the last superuser; baskan only manages sales |
| `POST /api/users/:id/password` | baskan | `{password \| generate:true}` → `{password?}`; kills sessions |
| `GET /api/report?event=` | baskan | per event → days `{sold, capacity, revenue, byUser, byPrice}` + totals |
| `GET /api/report.csv?event=` | baskan | `text/csv; charset=utf-8`, BOM, `;`-separated, CRLF, ASCII attachment filename, `=+-@\t\r` cells prefixed `'` |

## Backup (phase 5)

**Format.** A backup is a plain SQLite file built by `exportTo`: a fresh DB migrated to our `SCHEMA_VERSION`, then the rows of
`halls events days users tickets logs tombstones audit` copied in one read transaction (only columns both sides have).
Not exported: `sessions`, `snapshots`, `day_versions`, `user_logins`. `meta.exported_at` is set. Password hashes are in it,
so treat a backup like the DB. The CLI file is `CTB1` + 12-byte IV + AES-256-GCM ciphertext + 16-byte tag (AAD = `CTB1`),
key `BACKUP_KEY` = 32 bytes as 64 hex or base64. Old Django-era `.bak.enc` releases are a different format and are not readable here.
Migration 4 = `snapshots.reason` (`import` | `restore` | `cli`).

**Validation** (upload and CLI): SQLite magic, `PRAGMA integrity_check`, required tables/columns, `schema_version` ≤ ours
(newer → 400 "…daha yeni bir sürümüyle alınmış…"; older → migrated on the temp copy, warning `olderSchema`). The upload is the raw body
(`application/octet-stream`, 50 MB → 413); no path, name or query param from the client is used for any file path.

**Merge rules** (`planMerge`, newer `updated_at` wins per row, matched by `uid` / username for users):
- Row only in the file → inserted, FKs remapped through parent uids (orphans skipped `orphan`). Row only live → kept.
- Both: file newer → updated (parent FK never changes on update); else kept. Rows failing validation → skipped `invalid`.
- File tombstone newer than the live row **and** every live descendant → the subtree is deleted (warning `soldDeleted` if sales go);
  otherwise skipped `live-newer`. **Deletes apply only for a superuser importer (and the CLI, which counts as superuser)**: a
  başkan import skips them (`needs-superuser`, warning `deletesNeedSuperuser` = number of skipped deletes). Live tombstone → the file row stays deleted (`deleted`).
- Tickets: a live sale (status 2) is never reverted, even by a newer cancel in the file (`sold-kept`); those are flagged in
  warning `soldCancelledInFile` `{count, days:[{dayUid, date, event, count, seats:['A-12',…] | null}]}` (`null` = count hall,
  count only), shown in the preview and result dialogs and the CLI output for a manual cancel. File holds (status 1) come in free (`holdsDropped`).
- Users: never your own account (`own-account`); a başkan importer only adds/changes sales accounts (`needs-superuser`).
- Logs are a union by uid; audit is never merged. Timestamps in the future → warning `futureDates`. Touched days bump `day_versions`.
- Any live hold blocks preview, commit, restore and the CLI (409 `{error, holds:[{dayId,date,event,count}]}`).

**API**

| Route | Role | Body → response |
|---|---|---|
| `GET /api/backup/export` | baskan | (holds every password hash, so not sales) `.db` attachment `company-ticket-YYYYMMDD-HHMM.db` (Istanbul), `no-store`; 1 per 30 s per user → 429 + `Retry-After`; audit `backup.export` |
| `POST /api/backup/import/preview` | baskan | raw file → `{token, expiresAt, report, counts:{live,file}, warnings}`; no writes; token bound to the user, 10 min, one pending upload per user |
| `POST /api/backup/import/commit` | baskan | `{token, confirm:'İÇE AKTAR'}` → snapshot (`import`) → merge → `{report, warnings, snapshotId}`; audit `backup.import`. The token is claimed (`busy`) for the commit: a parallel commit of it → 409 |
| `GET /api/backup/snapshots` | baskan | `{snapshots:[{id, createdAt, createdBy, size, reason}]}` (last 5) |
| `GET /api/backup/snapshots/:id/download` | baskan | `.db` attachment; audit `backup.snapshot.download` |
| `POST /api/backup/snapshots/:id/restore` | superuser | `{confirm:'GERİ YÜKLE'}` → snapshot (`restore`) → full replace of halls/events/days/tickets/logs/tombstones; accounts untouched (users, sessions, user_logins, audit stay live: later password resets/disables survive, nobody is logged out); every day_version bumps; audit `backup.restore` |

`report[tbl] = {added, updated, deleted, kept, skipped:{reason:n}}`, `report.tombstones = {added}`; warnings `[{code, count}]`.

**Client** (`views/Backup.jsx`, Settings → Yedek, başkan+ only; sales don't see the section): download; import (preview table + warnings → typed
`İÇE AKTAR` → the current state is downloaded first; if that hits the 30 s limit the toast/result dialog offers the import snapshot
instead → commit → result dialog). Snapshot list; restore button superuser only. `api.js` `upload(path, file)` / `download(path)`.

**CLI** (`DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `BACKUP_KEY`; never prints secrets):
```
node server/cli/backup.mjs out.bak.enc              # read-only on the source
node server/cli/restore.mjs in.bak.enc [--apply]    # dry run prints the report; --apply: snapshot 'cli' + merge, audit user 'cli'
```
restore also accepts a plain `.db` (an in-app download).

**Workflows** (`../.github/workflows/backup.yml` nightly 02:17 UTC → encrypted release asset, keep 30; `restore.yml` manual,
dry run unless `apply`): Node 24, `npm ci --omit=dev` in `web/`, then the CLI. **Never run yet.**

## libsql gotchas

- **file: mode + concurrent writes**: the client pools connections opened with busy timeout 0, so two write
  transactions in flight → `SQLITE_BUSY` (probed); a busy timeout would block the event loop the tx holder
  needs. `openDb` wraps file: clients with an in-process FIFO lock over every write (non-SELECT `execute`,
  non-read `batch`, write `transaction` until commit/rollback/close). Remote clients are unwrapped: sqld
  serialized parallel interactive write txs fine (20-way hold/sell races green on `test:sqld`).
- Single statements (`UPDATE … WHERE status = 0`, count hold's `WHERE id = (SELECT … LIMIT 1) AND status = 0`)
  are the atomicity unit; `changes()` and `RETURNING` behave the same over HTTP batches/txs as on a file.
- `?1` numbered params with a positional args array work on both.

## Tests

```js
import { makeApp } from './test-helpers.js';
const t = await makeApp({ env });           // fresh temp file: DB, app.listen(0, '127.0.0.1')
const b = await t.login('baskan');          // creates user 'baskan' (pw PASSWORD) + logged-in client
const r = await b.post('/api/halls', {...}); // {status, body, headers}; cookie + X-CSRF-Token sent
t.client();  t.user(role, name);  t.seedHall({name, seats, priceSchema});  t.seedEvent(hallId);
await t.seedDay({seats: {count: 4}, price: 55}) / ({seats, prices: {a: 75}}) / ({hallId, eventId, prices, date}) // -> {hallId, eventId, dayId}
await t.count('SELECT COUNT(*) AS n FROM tickets WHERE day_id = ?', [id]);
await t.close();
```

`client.request(method, path, body, {headers, raw})` — `raw` sends a literal body string. New routes are
picked up by `authz.test.js` automatically; give it an id mapping in `concrete()` for a new `:param`
prefix and a body in `BODIES` if an allowed call would otherwise 500.

## Client (`client/`, phase 3)

- **Structure**: Vite + React from `_starter` (`src/config.js` appId `company-ticket`, `users:false`; own `Login`,
  `AppBar` with user menu + "Çıkış", `SettingsDrawer` with a phase-5 "Yedek" slot). Views in `src/views/`
  (`Events`/`Event`/`NewDay`, `Halls`/`Hall`/`NewHall`, `Day`, `Logs`/`DayLog`, `SeatMap`, `PriceEditor`);
  pure logic in `src/*.js` (`format`, `seatmap`, `cancel`, `prices`, `router`, `strings`) with `*.test.js` beside them (run by `npm test`).
  Phase-4 tabs (Rapor/Hesaplar) go in `TABS` + the view switch in `App.jsx`.
- **look alias**: `vite.config.js` resolves `look` → `../../_look` (workspace) else `web/vendor/look`; `LOOK_DIR=vendor`
  forces the copy (Render has no `_look`). `npm run vendor-look` refreshes it; `vendor-look.test.js` warns when stale. React is deduped.
- **Serving**: `npm run build` → `client/dist`; `server/app.js` serves it (`/assets` immutable) with an SPA fallback for every
  non-`/api`, non-`/healthz` GET. The index HTML gets its own CSP with `sha256-` hashes of its inline scripts (no-flash), never `'unsafe-inline'`.
  `npm run dev` = `scripts/dev.mjs` (server :5140 `--watch` + vite :5141 proxying `/api` + `/healthz`).
- **Routing**: hash routes (`router.js`): `events`, `events/new`, `events/:id`, `events/:id/new-day`, `day/:id`, `halls[/:id|/new]`,
  `logs[/:id]`. Every non-root view has ← and Esc to its parent (`parentOf`; a view can set its real parent via `setBack`).
- **api.js** is the only fetch: JSON in/out, `X-CSRF-Token` on non-GET (token from `/api/me`/login), throws `{status, message, body}`,
  any 401 calls the `onUnauthorized` handler → Login.
- **Day polling**: `GET /state?since=<version>` every 3 s (204 = no change), paused while hidden, re-polled on focus/visibility.
  A `mutSeq` counter drops a poll answer if a click/sell/cancel state landed after the poll was sent. 409 → toast + `e.body.state`.
- **Verify**: `npm run verify` (`scripts/verify.sh`: build, free port, `mktemp` file DB, fixed passwords, waits `/healthz`,
  runs `verify-ui.mjs` or the script given). Screenshots → `/private/tmp/claude-501/-Users-sina-Projects/company-ticket-shots/`.
  Gotcha: a 787-seat map is slow in headless Chrome on a busy machine (one click up to several seconds, unrelated to JS time),
  so waits are 10 s and the context default timeout 30 s.

## Client, phase 4

- **Tabs** Halls, Loglar, Rapor (`views/Report.jsx`) and Hesaplar (`views/Accounts.jsx`) are baskan+ (`TABS` minRole); `ctx.sudo` = superuser. Sales sees only Etkinlikler. Day page hides Loglar button and hall crumb for sales; event page shows hall name as a plain chip.
- **Settings drawer**: sales gets theme (light/dark/system) + language only; başkan+ get the full Appearance section.
- **Deletes**: `ui/TypedConfirm.jsx` (`typedDelete`, `TypedDeleteHost`, `DeleteButton`): type the name, red "Sil"; a 409 with `sold`
  shows a checkbox and the next submit sends `force:true`. Superuser only, on Hall / Event / Day pages.
- **Day page (baskan)**: clicking another user's seat opens a Popover menu "Bırak"; `Holders` card ("Tutulanlar", "Hepsini bırak"
  per user); `DayAdmin` card (date/time, prices, delete). Saving prices calls `/prices/preview`; if held or sold seats would change, `ui/RepriceDialog.jsx` asks keep/apply per group (default "Eski fiyatı koru"), else it saves directly. Map opens at real size; "Sığdır" fits.
- **Seat map layout**: row = `.sm-row` grid `[.sm-price-l | .sm-band | .sm-price-r]`; prices sit outside the tinted band. Held-by-others seats = orange stripes, sold = crimson (light + dark). The old `.sm-stage` translateX offset is gone; SAHNE centres on the band.
- **Day page header**: long date h1 is `sr-only` for multi-day events (short tab label at 1.25× `--fs`). "Günü düzenle" is collapsed by default. Sell confirm: `.sell-rows` scrolls, total and buttons stay visible.
- **SeatMap perf**: memoized `Seat` with primitive props + one delegated click on `.seatmap` (`data-id` → `byId` Map, latest
  `onSeat` via ref), so a state poll re-renders only seats whose status/label changed. verify-ui logs click→DOM medians (no assert).
- Accounts: generated / reset passwords show once in a dialog (Kopyala). Superuser gets a per-row role Select (not on its own row) → `confirmDialog` → `PUT {role}`; başkan sees role chips.
