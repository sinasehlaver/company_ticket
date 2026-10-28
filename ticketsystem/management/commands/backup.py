import os
from datetime import date

from django.core.management.base import BaseCommand, CommandError

from ticketsystem import backup


class Command(BaseCommand):
    help = "Write an encrypted full dump. Needs BACKUP_KEY (base64, 32 bytes) in the environment."

    def add_arguments(self, parser):
        parser.add_argument("out", nargs="?", default=f"company-{date.today().isoformat()}.bak.enc")

    def handle(self, *args, **opts):
        try:
            key = backup.parse_key(os.environ.get("BACKUP_KEY"))
        except ValueError as e:
            raise CommandError(str(e))
        data = backup.dump()
        fd = os.open(opts["out"], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(backup.seal(data, key))
        self.stdout.write(f"{opts['out']} " + str({k: len(v) for k, v in data.items()}))
