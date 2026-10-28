# company_ticket — user action flows (as-is, Django)

Source of truth for the port to the Node/app-standard stack. Derived from `ticketsystem/views.py`, `models.py`, `pricing.py`, templates. **Behaviour listed here must survive the port; "Quirks" are candidates to fix only after you confirm.**

## Roles

| Role | Who | Can |
|---|---|---|
| Sales point | 5 shared accounts (mimarlik, kutuphane, carsi, hazirlik, disari), one per sales point | log in, browse, hold + sell own seats |
| Başkan (community president) | **not in the current code** — intended role, to be built in the port | everything a sales point can + cancel sales, sold count + total money, create halls/events/days, edit prices; only the raw `/admin/` and deleting hall/event/day are excluded |
| Superuser | `sina` | everything + create hall/event/day, edit hall prices, `/admin/` |

Today's code has only sales point and superuser (`is_superuser`); cancel is open to every login and revenue is superuser-only.

Everything except `/healthz` and login needs a session.

## Data model

- **Hall**: `seats` JSON, `seatPlan` JSON (unused by any view/template; only stored), `price_schema` text.
  - Seated hall: `seats.all` = ordered list of `{row: [nums]}`; row `"-"` = aisle gap; num `"-1"` = gap in a row. Rows are single lowercase letters (a-z).
  - Count hall (Mimarlık): `seats = {"count": N}`; no seat map.
- **Event** → Hall. **Day** (show date) → Event, `tickets_dict` JSON `{row: {"-1": [price, hue]}}` (row price label + colour only).
- **Ticket** (one per seat per day): row, num, price (frozen at day creation), category (1 = dearest tier, 0 for count hall), `status` 0 free / 1 held / 2 sold, `lastModifiedBy` (**user id** while held, whatever it was last when sold/freed), `lastModified`.
- **Log**: ticket, day, action (`satış` | `satış iptal`), user (username), datetime. Holds are NOT logged.

## Flows

### F1 Login / logout
Login (`/accounts/login`) → home with links Etkinlikler / Sahneler / Loglar (+Admin). Logout → home. Unknown URL (404) → redirect `/`.

### F2 Browse
Etkinlikler → event → list of its days → day page. Sahneler → hall → read-only seat map (+ price link for superuser). Loglar → days newest first → day log.

### F3 Create hall (superuser)
Form: name, seats JSON, seatPlan JSON, price_schema. Redirects to hall.

### F4 Edit hall prices (superuser)
Seated hall: one price per row (every row required, 0..32767), saved as schema `a-f:75,g:60`. Count hall: single price. Bad input → error on page. Does **not** change existing days.

### F5 Create event (superuser) → Event(name, hall).

### F6 Create day (superuser)
Date (`YYYY-MM-DDTHH:MM`, made timezone-aware) + prices prefilled from hall. Optional "remember" saves the schema on the hall. In one transaction: create Day, then
- seated: tiers = distinct prices, highest = category 1, hue spread 150..360; one Ticket per seat (skipping `-1`), price from its row;
- count hall: N tickets, row `m`, num `0..N-1`, category 0.
Bad date / missing price → error, nothing created.

### F7 Day page (the seat plan)
Day tabs for all days of the event. Seat map: each row is a coloured band (hue by price tier) with price at left, row letter both sides, aisle gaps, seats as buttons. Seat states: free / held-by-me / held-by-other / sold. Count hall: shows free count, my held count, `+` / `−`.
Superuser also sees sold count and revenue (seated halls only).

### F8 Hold a seat (click)
Click free seat → held, owner = me. Click my own held seat → free. Click someone else's held or any sold seat → nothing. Then the page reloads.

### F9 Sell
"Satış Yap" → JS confirm listing my held seats `ROW-NUM : price` + total → sells **all** my held seats on that day (status 2, one `satış` log each).

### F10 Cancel sale
Textarea `a-32, b-25` (seated) → each sold seat → free + `satış iptal` log. Count hall: number N → the first N sold tickets → free + log. JS confirm first. **Any logged-in user can cancel any sale.**

### F11 Count-hall hold
`+` takes the first free ticket for me; `−` frees one of mine.

### F12 Log lookup
Day log newest first; tab to other days; search `row-num` → that seat's log for the day (silently falls back to full log if no match).

## Quirks / edge cases found (not yet changed)

Concurrency (the reservation core — most important):
1. **Hold race**: F8/F11 read the ticket then write; two users clicking the same free seat at the same moment both succeed, last write owns it, the first user still sees a "held" seat on reload only if they reload. No lock, no transaction.
2. **Sell is not atomic** and doesn't re-check status/owner at write time; a hold lost in a race can still be sold by the loser if the page was stale.
3. Holds never expire; a user who leaves strands seats until the same user (or no one) frees them. Superuser has no release tool except the admin.

Correctness:
4. State changes via GET (`click/`, `reserve`, `dereserve`, `sell/`): no CSRF, prefetch/double-click safe-ish but a link preview could sell tickets.
5. `click/<ticket_id>` does not check the ticket belongs to the day in the URL.
6. Cancel (seated): malformed input (`a32`, empty item from trailing comma) → IndexError 500; row case-sensitive; unknown seat silently skipped.
7. Cancel (count): non-numeric → 500; negative → 500; cancels arbitrary sold tickets (no order).
8. Cancel/free leaves `lastModifiedBy` as the old holder.
9. Sell with nothing held: silent no-op. No success/failure messages anywhere.
10. Revenue shown only for seated halls; `None` when nothing sold.
11. `index` login check never triggers (AnonymousUser is truthy); the template handles it.
12. `lookup_log` only the first matching ticket; debug `print`s left in views.
13. `seatPlan` is stored but never used.
14. Prices are frozen per ticket; editing hall prices never alters existing days (intended — keep).
15. Hall seats shape drives rendering (`seats.all` order = display order); `tickets_dict` mutated in memory per request for the template.

## Decisions (2026-10-26, confirmed with Sina)

- Target: Node + Express + SQLite/libsql (Turso), React/Vite UI from `_starter/`.
- Hold/sell become atomic conditional UPDATEs in a transaction (quirks 1-3); visible rules unchanged.
- Fix: cancel input validation + toasts (6-9), POST + CSRF for every state change (4), Başkan = every superuser power except `/admin/` (cancel, revenue, create hall/event/day, edit prices). In the port the Django-admin-only jobs need real screens (see Gaps below).
- Not chosen: hold expiry / release button.
- Cutover: fresh DB, no data-migration script (old data only imported if cheap). Accounts are recreated, so no Django hash verifier needed.
- Must-port untouched: seat map rendering (row bands, tier hues, aisles, `-1` gaps), count-hall mode, price tiers/categories, per-ticket log, price frozen per ticket.

## Gaps filled in the port (decided 2026-10-26)

- Delete hall / event / day: **superuser only**, with a typed confirmation; a day with sold tickets is blocked or needs the extra confirmation (it deletes the sales log).
- Başkan + superuser: edit (rename, change day date) hall/event/day; release a single seat or all holds of one sales point; manage sales accounts (create, disable, reset password); see which sales point holds each seat; per-day report with per-sales-point breakdown + CSV export.
- Sales points: unchanged.
