#!/usr/bin/env bash
# company_ticket (Node app in web/): API :5140 + vite :5141 with watch, opens Chrome. pm's ▶ Start runs this.
# Local DB web/data/company.db; dev passwords below apply only when the users are first created there.
# Ctrl+C stops both. The old Django app: scripts/start-django.sh (:5130).
set -euo pipefail
cd "$(dirname "$0")/web"

[[ -f node_modules/.package-lock.json && ! package-lock.json -nt node_modules/.package-lock.json ]] || npm install --no-audit --no-fund

for port in 5140 5141; do
  pid="$(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
  [[ -z "$pid" ]] || { echo "Port $port is in use by pid $pid ($(ps -o comm= -p "$pid")). Stop it and re-run."; exit 1; }
done

unset DATABASE_URL DATABASE_AUTH_TOKEN NODE_ENV   # always the local file DB, never Turso
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-dev-admin-pass}"
export BASKAN_PASSWORD="${BASKAN_PASSWORD:-dev-baskan-pass}"
export TICKET_USER_PASSWORD="${TICKET_USER_PASSWORD:-dev-ticket-pass}"

URL=http://127.0.0.1:5141/
echo
echo "  company_ticket: $URL   (DB: web/data/company.db)"
echo "  first-run logins: sina / $ADMIN_PASSWORD   baskan / $BASKAN_PASSWORD   mimarlik (etc.) / $TICKET_USER_PASSWORD"
echo "  Ctrl+C to stop"
echo
(
  for _ in $(seq 1 150); do curl -sf -o /dev/null "$URL" && break; sleep 0.2; done
  open -a "Google Chrome" "$URL" 2>/dev/null || open "$URL"
) &
exec npm run dev
