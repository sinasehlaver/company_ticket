import os

from django.core.management.base import BaseCommand, CommandError

from ticketsystem import backup


class Command(BaseCommand):
    help = "Additive restore from an encrypted dump (dry run unless --apply). Never edits or deletes existing rows."

    def add_arguments(self, parser):
        parser.add_argument("file")
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **opts):
        try:
            key = backup.parse_key(os.environ.get("BACKUP_KEY"))
            with open(opts["file"], "rb") as f:
                data = backup.unseal(f.read(), key)
        except (ValueError, OSError) as e:
            raise CommandError(str(e))
        report = backup.restore(data, apply=opts["apply"])
        self.stdout.write("APPLIED" if opts["apply"] else "DRY RUN (nothing changed)")
        for label, r in report.items():  # counts + ids only: this output lands in public Actions logs
            self.stdout.write(f"{label}: {len(r['missing'])} missing"
                              f"{' (ids ' + ','.join(map(str, r['missing'][:50])) + ')' if r['missing'] else ''}"
                              f", {len(r['differs'])} differ (kept live)")
