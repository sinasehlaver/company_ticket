import os
import secrets

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

STAFF = ["mimarlik", "kutuphane", "carsi", "hazirlik", "disari"]


class Command(BaseCommand):
    help = ("Idempotent first-run setup, safe to run on every start (Render free has no shell). Creates the superuser from "
            "ADMIN_USERNAME/ADMIN_PASSWORD and the sales users from TICKET_USER_PASSWORD, only if they do not exist yet. "
            "Existing users are never touched. Unset passwords: skipped for admin, random (printed once) for sales users.")

    def handle(self, *args, **opts):
        User = get_user_model()
        admin, admin_pw = os.environ.get("ADMIN_USERNAME", "sina"), os.environ.get("ADMIN_PASSWORD")
        if admin_pw and not User.objects.filter(username=admin).exists():
            User.objects.create_superuser(username=admin, password=admin_pw)
            self.stdout.write(f"created superuser {admin}")
        shared = os.environ.get("TICKET_USER_PASSWORD")
        for name in STAFF:
            if not User.objects.filter(username=name).exists():
                pw = shared or secrets.token_urlsafe(9)
                User.objects.create_user(username=name, password=pw)
                self.stdout.write(f"created {name}" + ("" if shared else f" with password {pw}"))
