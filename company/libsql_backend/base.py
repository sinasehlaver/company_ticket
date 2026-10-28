"""django-libsql 0.1.3 bundles a Django 4.x copy of the SQLite schema editor that breaks on Django >= 5.1 (index_together was removed).
Use Django's own current SQLite schema editor on top of its connection wrapper."""
from django.db.backends.sqlite3.schema import DatabaseSchemaEditor as SQLiteSchemaEditor
from libsql.db.backends.libsql.base import DatabaseWrapper as LibsqlWrapper


class DatabaseSchemaEditor(SQLiteSchemaEditor):
    pass


class DatabaseWrapper(LibsqlWrapper):
    SchemaEditorClass = DatabaseSchemaEditor


def _fetchmany(self, size=None):
    # libsql_client 0.3.1 loops `for i, row in enumerate(self): if i == size: break`, which consumes and drops
    # row number size+1 of every chunk. Django fetches in chunks of 100, so list(queryset) silently lost 1 row per 100.
    if size is None or size < 1:
        size = self.arraysize
    rows = []
    for _ in range(size):
        row = next(self, None)
        if row is None:
            break
        rows.append(row)
    return rows


from libsql_client.dbapi2.types import Cursor  # noqa: E402

Cursor.fetchmany = _fetchmany
