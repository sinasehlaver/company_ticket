# Company Ticket System

Ticket sales for the ODTÜ "Company" Musicals Community: halls with seat maps, events, show days, seat reservation and sale, per-ticket log. Django 5.2, deployed on Render (free) with a Turso database. Used about two months a year.

## Run locally

Quickest: `./start.sh` (venv, migrate, bootstrap with dev passwords, serves on 127.0.0.1:5130 and opens it). Or by hand:

```sh
pip install -r requirements.txt
DEBUG=1 python manage.py migrate
DEBUG=1 ADMIN_PASSWORD=choose-one TICKET_USER_PASSWORD=choose-one python manage.py bootstrap   # superuser "sina" + 5 sales users
DEBUG=1 python manage.py runserver 127.0.0.1:5130
DEBUG=1 python manage.py test
```

Without `DATABASE_URL` it uses `./db.sqlite3`. `DATABASE_URL` must be `libsql://` (Turso), `wss://`, or `ws://127.0.0.1` (a local `sqld`).

Turso goes through `company/libsql_backend/` (a patch over `django-libsql`, which breaks on Django 5.1+ and its driver drops 1 row per 100 fetched). `scripts/smoke_libsql.py` checks the libsql path end to end against a throwaway sqld; the test suite runs on SQLite only.

## Prices

Each hall stores its price schema, so creating a show day only needs a date. On the "new day" page (and Sahneler → hall → *Bilet fiyatlarını düzenle*): type a price in the brush box, then click or drag over the rows to paint them; or edit single rows, or paste a schema like `a-f:75,g-k:60,l-z:50`. Single-price halls (Mimarlık) show one price box. "Save for hall" (on by default) makes the next day come prefilled.

Hall setup (JSON for `seats` / `seatPlan`): KKM → `kkm_seats.json`, `kkm_seatplan.json`, schema `a-f:75,g-k:60,l-z:50`. Mimarlık with 280 seats → seats `{"count": 280}`, seatPlan `{"all": [{"count": 280}]}`, price `60`.

## Deploy and backups

[DEPLOY.md](DEPLOY.md): Render + Turso setup, daily encrypted backup to a private GitHub repo, restore.
