#!/usr/bin/env bash
# scripts/start-django.sh — the Django reference app, local dev: venv, migrate, bootstrap users, runserver on 127.0.0.1:5130, open browser.
# Uses ./db.sqlite3 (no DATABASE_URL). Not for production; see DEPLOY.md.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-5130}"
export DEBUG=1
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-dev-admin-pass}"
export TICKET_USER_PASSWORD="${TICKET_USER_PASSWORD:-dev-ticket-pass}"
unset DATABASE_URL

if [ ! -x venv/bin/python ]; then
  echo "→ creating venv..."
  python3 -m venv venv
fi
if ! venv/bin/python -c "import django" 2>/dev/null; then
  echo "→ installing requirements..."
  venv/bin/pip install --quiet --upgrade pip
  venv/bin/pip install --quiet -r requirements.txt
fi

if lsof -ti "tcp:$PORT" >/dev/null 2>&1; then
  echo "! port $PORT is busy. Try:  PORT=5132 scripts/start-django.sh"
  exit 1
fi

venv/bin/python manage.py migrate --noinput
venv/bin/python manage.py bootstrap

URL="http://127.0.0.1:$PORT"
echo
echo "  company_ticket: $URL   (admin user: sina / $ADMIN_PASSWORD)"
echo "  Ctrl+C to stop"
echo

( sleep 1.5; command -v open >/dev/null && open "$URL" || true ) &
exec venv/bin/python manage.py runserver "127.0.0.1:$PORT"
