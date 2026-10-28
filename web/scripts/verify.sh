#!/bin/bash
# Build the client, bring the real server up on a kernel-assigned port against a throwaway file DB, run a check script.
#   npm run verify                 -> verify-ui.mjs
#   npm run verify -- other.mjs    -> another script (gets APP_URL + the test passwords in env)
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build --silent >/dev/null
port=$(../../.claude/scripts/freeport.sh)
dir=$(mktemp -d -t company-ticket-verify)
export DATABASE_URL="file:$dir/verify.db" PORT="$port" HOST=127.0.0.1 APP_URL="http://127.0.0.1:$port"
export ADMIN_PASSWORD=verify-admin-pw BASKAN_PASSWORD=verify-baskan-pw TICKET_USER_PASSWORD=verify-sales-pw
unset NODE_ENV

node server/index.js > "$dir/server.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true; rm -rf "$dir"' EXIT

for _ in $(seq 1 100); do
  curl -sf "$APP_URL/healthz" >/dev/null && break
  kill -0 $PID 2>/dev/null || { cat "$dir/server.log"; exit 1; }
  sleep 0.1
done
curl -sf "$APP_URL/healthz" >/dev/null || { echo "server did not come up"; cat "$dir/server.log"; exit 1; }

# not exec'd, so the trap still runs to kill the server + drop the scratch DB
status=0
node "${1:-verify-ui.mjs}" || status=$?
[[ $status -eq 0 ]] || { echo "--- server log ---"; tail -40 "$dir/server.log"; }
exit $status
