"""End-to-end check over a real libsql connection (the Django test runner cannot build a test DB on this driver).
Run against a THROWAWAY sqld, never Turso prod (it creates a hall and a day):
  sqld --http-listen-addr 127.0.0.1:<port> --db-path /tmp/x/data.sqld
  DEBUG=1 DATABASE_URL=ws://127.0.0.1:<port> DATABASE_AUTH_TOKEN=x ADMIN_PASSWORD=test-pass-123 python manage.py migrate
  (same env) python manage.py bootstrap && python scripts/smoke_libsql.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "company.settings")
import django  # noqa: E402

django.setup()
from django.test import Client  # noqa: E402

from ticketsystem.models import Day, Event, Hall, Ticket  # noqa: E402

assert Hall.objects.count() == 0, "use an empty database"
seats = json.load(open("kkm_seats.json"))
hall = Hall.objects.create(name="KKM", seats=seats, seatPlan=json.load(open("kkm_seatplan.json")), price_schema="a-f:75,g-z:50")
event = Event.objects.create(name="Smoke", hall=hall)
rows = [r for d in seats["all"] for r in d if r != "-"]
c = Client(HTTP_HOST="localhost")
assert c.login(username="sina", password=os.environ["ADMIN_PASSWORD"])
r = c.post(f"/event/{event.id}/add/", {"date": "2026-11-01T20:00", **{f"price_{x}": 75 if x < "g" else 50 for x in rows}})
assert r.status_code == 302, r.status_code
day = Day.objects.get()
total = Ticket.objects.filter(day=day).count()
assert len(list(Ticket.objects.filter(day=day))) == total, "fetchmany dropped rows"
assert c.get(f"/day/{day.id}/").status_code == 200
print(f"ok: {total} tickets, day page renders")
