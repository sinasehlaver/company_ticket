#!/bin/bash
# npm run test:sqld — whole node:test suite against a throwaway sqld (libsql over HTTP, like Turso).
set -euo pipefail
cd "$(dirname "$0")/.."
SQLD=${SQLD:-$(command -v sqld || echo /usr/local/bin/sqld)}
[[ -x "$SQLD" ]] || { echo "sqld not found (set SQLD=...)" >&2; exit 1; }
PORT=$(/Users/sina/Projects/.claude/scripts/freeport.sh)
DATA=$(mktemp -d -t ct-sqld)
"$SQLD" --db-path "$DATA/db" --http-listen-addr "127.0.0.1:$PORT" --no-welcome >"$DATA/sqld.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true; wait $PID 2>/dev/null || true; rm -rf "$DATA"' EXIT
for _ in $(seq 1 100); do
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  kill -0 $PID 2>/dev/null || { cat "$DATA/sqld.log" >&2; exit 1; }
  sleep 0.1
done
curl -sf "http://127.0.0.1:$PORT/health" >/dev/null || { echo "sqld did not come up" >&2; cat "$DATA/sqld.log" >&2; exit 1; }
TEST_DB_URL="http://127.0.0.1:$PORT" node --test --test-concurrency=1 "server/**/*.test.js"
