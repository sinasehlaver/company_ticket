import base64
import os
import tempfile
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse

from . import backup
from .models import Day, Event, Hall, Log, Ticket
from .pricing import PriceError, format_schema, parse_schema, tiers

User = get_user_model()
SEATS = {"all": [{"a": ["1", "2", "-1", "3"]}, {"-": []}, {"b": ["1", "2"]}, {"c": ["1"]}]}


def make_hall(**kw):
    return Hall.objects.create(name="KKM", seats=SEATS, seatPlan={}, **kw)


class PricingTests(TestCase):
    def test_roundtrip(self):
        self.assertEqual(parse_schema("a-c:75, d:60"), {"a": 75, "b": 75, "c": 75, "d": 60})
        self.assertEqual(format_schema(parse_schema("a-c:75,d:60,e-f:60")), "a-c:75,d-f:60")

    def test_rejects_junk(self):
        for bad in ("a-c", "c-a:5", "a:99999", "a;b:5", "1-2:5"):
            with self.assertRaises(PriceError, msg=bad):
                parse_schema(bad)

    def test_tiers_highest_first(self):
        t = tiers({"a": 75, "b": 60, "c": 60})
        self.assertEqual(t[75][0], 1)
        self.assertEqual(t[60][0], 2)
        self.assertEqual(tiers({"a": 5})[5][0], 1)  # single tier used to divide by zero


class CreateDayTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser("root", password="x-pass-123")
        self.seller = User.objects.create_user("carsi", password="x-pass-123")
        self.hall = make_hall(price_schema="a:75,b-c:60")
        self.event = Event.objects.create(name="Show", hall=self.hall)
        self.url = reverse("create_day", args=[self.event.id])

    def test_form_prefilled_from_hall(self):
        self.client.force_login(self.admin)
        r = self.client.get(self.url)
        self.assertContains(r, 'name="price_a" min="0" max="32767" value="75"')

    def test_creates_tickets_and_remembers(self):
        self.client.force_login(self.admin)
        r = self.client.post(self.url, {"date": "2026-11-01T20:00", "price_a": 90, "price_b": 60, "price_c": 60, "remember": "1"})
        day = Day.objects.get()
        self.assertRedirects(r, reverse("get_day", args=[day.id]))
        self.assertEqual(Ticket.objects.filter(day=day).count(), 3 + 2 + 1)  # -1 gap skipped
        self.assertEqual(set(Ticket.objects.filter(row="a").values_list("price", flat=True)), {90})
        self.assertEqual(Ticket.objects.get(row="a", num="1").category, 1)
        self.hall.refresh_from_db()
        self.assertEqual(self.hall.price_schema, "a:90,b-c:60")
        self.assertEqual(self.client.get(reverse("get_day", args=[day.id])).status_code, 200)

    def test_missing_row_price_rejected(self):
        self.client.force_login(self.admin)
        r = self.client.post(self.url, {"date": "2026-11-01T20:00", "price_a": 90, "price_b": 60})
        self.assertContains(r, "sırası için geçerli bir fiyat")
        self.assertEqual(Day.objects.count(), 0)

    def test_bad_date_and_negative_price(self):
        self.client.force_login(self.admin)
        base = {"price_a": 1, "price_b": 1, "price_c": 1}
        self.assertContains(self.client.post(self.url, {**base, "date": "nope"}), "tarih")
        self.assertContains(self.client.post(self.url, {"date": "2026-11-01T20:00", **base, "price_a": -5}), "sırası için")
        self.assertEqual(Day.objects.count(), 0)

    def test_count_hall(self):
        hall = Hall.objects.create(name="Mimarlık", seats={"count": 4}, seatPlan={}, price_schema="60")
        ev = Event.objects.create(name="M", hall=hall)
        self.client.force_login(self.admin)
        self.client.post(reverse("create_day", args=[ev.id]), {"date": "2026-11-01T20:00", "price": "55"})
        self.assertEqual(Ticket.objects.filter(event=ev, price=55).count(), 4)

    def test_only_superuser(self):
        self.assertEqual(self.client.post(self.url, {}).status_code, 302)  # anonymous -> login
        self.client.force_login(self.seller)
        self.assertEqual(self.client.post(self.url, {"date": "2026-11-01T20:00"}).status_code, 302)
        self.assertEqual(self.client.post(reverse("hall_prices", args=[self.hall.id]), {}).status_code, 302)
        self.assertEqual(Day.objects.count(), 0)
        self.assertEqual(Hall.objects.get().price_schema, "a:75,b-c:60")

    def test_hall_prices_edit(self):
        self.client.force_login(self.admin)
        self.client.post(reverse("hall_prices", args=[self.hall.id]), {"price_a": 10, "price_b": 10, "price_c": 5})
        self.assertEqual(Hall.objects.get().price_schema, "a-b:10,c:5")


class BackupTests(TestCase):
    def setUp(self):
        self.key = backup.parse_key(base64.b64encode(os.urandom(32)).decode())
        User.objects.create_user("carsi", password="x-pass-123")
        hall = make_hall()
        ev = Event.objects.create(name="Show", hall=hall)
        day = Day.objects.create(date="2026-11-01T20:00:00Z", event=ev, tickets_dict={"a": {"-1": [75, 200]}})
        t = Ticket.objects.create(row="a", num="1", event=ev, day=day, price=75, category=1, status=2)
        Log.objects.create(ticket=t, day=day, action="satış", user="carsi")

    def test_seal_roundtrip_and_wrong_key(self):
        blob = backup.seal(backup.dump(), self.key)
        self.assertNotIn(b"carsi", blob)
        self.assertEqual(backup.unseal(blob, self.key)["ticketsystem.ticket"][0]["fields"]["row"], "a")
        with self.assertRaises(Exception):
            backup.unseal(blob, backup.parse_key(base64.b64encode(os.urandom(32)).decode()))

    def test_bad_key_rejected(self):
        for bad in (None, "", "short", base64.b64encode(b"x" * 16).decode()):
            with self.assertRaises(ValueError):
                backup.parse_key(bad)

    def test_restore_additive(self):
        data = backup.dump()
        Ticket.objects.update(status=0)  # live moved on after the backup
        Log.objects.all().delete()
        Hall.objects.all().delete()  # cascades everything
        dry = backup.restore(data, apply=False)
        self.assertEqual(Hall.objects.count(), 0)
        self.assertEqual(dry["ticketsystem.hall"]["missing"], [data["ticketsystem.hall"][0]["pk"]])
        backup.restore(data, apply=True)
        self.assertEqual((Hall.objects.count(), Ticket.objects.count(), Log.objects.count()), (1, 1, 1))
        Ticket.objects.update(status=1)
        report = backup.restore(data, apply=True)  # existing row differs -> kept, reported
        self.assertEqual(Ticket.objects.get().status, 1)
        self.assertEqual(len(report["ticketsystem.ticket"]["differs"]), 1)
        self.assertEqual(sum(len(r["missing"]) for r in report.values()), 0)

    def test_fresh_backup_has_no_differences(self):
        report = backup.restore(backup.unseal(backup.seal(backup.dump(), self.key), self.key))
        self.assertEqual(sum(len(r["differs"]) + len(r["missing"]) for r in report.values()), 0)

    def test_command_file_is_private(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "x.bak.enc")
            os.environ["BACKUP_KEY"] = base64.b64encode(os.urandom(32)).decode()
            try:
                call_command("backup", path, stdout=StringIO())
                self.assertEqual(oct(os.stat(path).st_mode & 0o777), "0o600")
                out = StringIO()
                call_command("restore", path, stdout=out)
                self.assertIn("DRY RUN", out.getvalue())
            finally:
                del os.environ["BACKUP_KEY"]


class BootstrapTests(TestCase):
    def test_idempotent_and_never_touches_existing(self):
        os.environ.update(ADMIN_PASSWORD="admin-pass-123", TICKET_USER_PASSWORD="seller-pass-123")
        try:
            call_command("bootstrap", stdout=StringIO())
            u = User.objects.get(username="carsi")
            u.set_password("changed"); u.save()
            call_command("bootstrap", stdout=StringIO())
            self.assertTrue(User.objects.get(username="carsi").check_password("changed"))
            self.assertTrue(User.objects.get(username="sina").is_superuser)
            self.assertEqual(User.objects.count(), 6)
        finally:
            del os.environ["ADMIN_PASSWORD"], os.environ["TICKET_USER_PASSWORD"]

    def test_healthz_needs_no_login(self):
        self.assertEqual(self.client.get("/healthz").content, b"ok")


class DriverTests(TestCase):
    def test_list_returns_every_row(self):
        # libsql_client's fetchmany dropped 1 row per chunk of 100; only visible over a libsql connection
        hall = make_hall()
        ev = Event.objects.create(name="E", hall=hall)
        day = Day.objects.create(date="2026-11-01T20:00:00Z", event=ev, tickets_dict={})
        Ticket.objects.bulk_create([Ticket(row="a", num=i, event=ev, day=day, price=1, category=1) for i in range(350)])
        self.assertEqual(len(list(Ticket.objects.all())), 350)
