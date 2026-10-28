"""Encrypted full dump + additive restore. Format: b"CTB1" + 12-byte nonce + AES-256-GCM(JSON dump)."""
import base64
import json
import os
from datetime import datetime

from django.apps import apps
from django.core import serializers
from django.db import transaction

MAGIC = b"CTB1"
# users included (password hashes!) -> the file is always encrypted. Sessions are not worth keeping.
LABELS = ["auth.user", "ticketsystem.hall", "ticketsystem.event", "ticketsystem.day",
          "ticketsystem.ticket", "ticketsystem.log"]  # parents before children


def parse_key(b64):
    try:
        key = base64.b64decode(b64 or "", validate=True)
    except ValueError:
        key = b""
    if len(key) != 32:
        raise ValueError("BACKUP_KEY must be 32 random bytes, base64 encoded")
    return key


def dump():
    return {label: json.loads(serializers.serialize(
        "json", apps.get_model(label).objects.order_by("pk").iterator())) for label in LABELS}


def seal(data, key):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = os.urandom(12)
    return MAGIC + nonce + AESGCM(key).encrypt(nonce, json.dumps(data).encode(), MAGIC)


def unseal(blob, key):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if blob[:4] != MAGIC:
        raise ValueError("not a company-ticket backup")
    return json.loads(AESGCM(key).decrypt(blob[4:16], blob[16:], MAGIC))


def restore(data, apply=False):
    """Adds rows whose pk is missing; never edits or deletes. Returns {label: {'missing': [pks], 'differs': [pks]}}."""
    report = {}
    with transaction.atomic():
        for label in LABELS:
            model = apps.get_model(label)
            existing = {o.pk: o for o in model.objects.all().iterator()}
            missing, differs = [], []
            for obj in serializers.deserialize("json", json.dumps(data.get(label, []))):
                live = existing.get(obj.object.pk)
                if live is None:
                    missing.append(obj.object.pk)
                    if apply:
                        obj.save()
                elif _fields(live) != _fields(obj.object):
                    differs.append(obj.object.pk)
            report[label] = {"missing": missing, "differs": differs}
    return report


def _fields(o):
    """Comparable values. The JSON serializer keeps milliseconds only, so a fresh backup would otherwise differ on every timestamp."""
    vals = {f.attname: getattr(o, f.attname) for f in o._meta.concrete_fields if f.name != "last_login"}
    return {k: v.replace(microsecond=v.microsecond // 1000 * 1000) if isinstance(v, datetime) else v for k, v in vals.items()}
