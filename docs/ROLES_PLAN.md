# Role permissions — confirmed spec (2026-11-02)

Ask (baskan, via pm): ticket sellers should be able to cancel tickets; admins decide what each role does.
Built 2026-11-02 (server caps, Roller screen, backup merge of `roles`); see web/docs/DEV_NOTES.md. Confirmed with the user via AskUserQuestion.

## Today (web/)
Fixed rank `sales < baskan < superuser` (`server/auth.js` `ROLES`/`RANK`, `requireRole(minRole)`);
every route declares a `minRole` in `server/routes/*.js`; client `TABS` mirror it (`client/src/App.jsx`).
Cancel sold ticket (`POST /api/days/:id/cancel`) and release another's hold (`POST /api/days/:id/release`) are baskan-only.

## Decisions
1. **Roles are data, custom roles allowed.** `superuser` and `baskan` are built-in; `sales` is the default
   built-in non-admin role; admins may add named roles (e.g. "kapı görevlisi").
2. **Superuser** always has every capability; never editable, never shown as toggles.
3. **Who edits what**
   - Superuser: edits baskan, sales, and custom roles; creates/deletes custom roles.
   - Baskan: creates/edits/deletes any role except baskan and superuser; can only grant capabilities baskan itself has.
     Baskan cannot change the baskan role.
4. **Capabilities (grouped, ~10)** on top of the always-allowed login / view events / hold / sell / release own holds:
   cancel sold ticket (**off / own / any**, 3-way) · release others' holds · edit events/days · reprice ·
   halls · logs · report · accounts · backup export/import · manage roles.
   Deletes (event/day/hall) and snapshot restore stay superuser-only (not toggles).
5. **Defaults (migration keeps today's behaviour, plus the ask):** sales = cancel `own`, nothing else;
   baskan = everything above with cancel `any`.
6. **Cancel `own`** = only tickets whose sale row's seller is the caller (server-checked in `reserve.js cancel`).
7. **Deleting a role with users** is blocked ("N hesap bu rolde"); reassign first.

## Build notes (for the implementer)
- Server: replace `requireRole(minRole)` with `requireCap(cap)` per route; `authz.test.js` walks every route ×
  role (add a custom-role fixture and an "own vs any cancel" test). Untrusted input: role name length/charset, cap
  keys whitelisted, baskan privilege-escalation checks (granting a cap it lacks, editing baskan) → tests.
- `/api/me` returns the caller's caps; client gates tabs/buttons on caps, not role names.
- Backup merge (`server/backup/merge.js` imports `ROLES`) must carry the roles table.
- Accounts role picker lists roles from the server.
