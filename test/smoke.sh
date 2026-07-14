#!/usr/bin/env bash
# Route smoke test for the worker: boots a local `wrangler dev` (miniflare R2 + D1)
# and asserts every route's status. No live deploy or secrets needed — the token
# comes from .dev.vars (created with a default if absent). Run: pnpm test
set -uo pipefail
cd "$(dirname "$0")/.."

PORT=8799
URL="http://127.0.0.1:$PORT"
fail=0

chk() { # label expected actual
  if [ "$2" = "$3" ]; then
    echo "ok   $1 -> $3"
  else
    echo "FAIL $1: expected $2, got $3"
    fail=1
  fi
}
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

# wrangler dev reads the token from .dev.vars; create one if the dev hasn't.
[ -f .dev.vars ] || echo "SYNC_TOKEN=dev-token" >.dev.vars
TOKEN="$(grep '^SYNC_TOKEN=' .dev.vars | head -1 | cut -d= -f2-)"
AUTH="Authorization: Bearer $TOKEN"

echo "Starting wrangler dev on :$PORT …"
npx wrangler dev --port "$PORT" >/tmp/jotter-cloud-smoke.log 2>&1 &
DEV_PID=$!
trap 'kill "$DEV_PID" 2>/dev/null; pkill -f "wrangler dev" 2>/dev/null' EXIT

# Wait for the server to answer (first boot compiles the worker).
ready=0
for _ in $(seq 1 40); do
  if [ "$(code "$URL/")" = "200" ]; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != "1" ]; then
  echo "FAIL: wrangler dev never became ready"; tail -20 /tmp/jotter-cloud-smoke.log; exit 1
fi

# --- public + auth ---
chk "GET / (landing)"              200 "$(code "$URL/")"
chk "GET /version (public)"        200 "$(code "$URL/version")"
chk "GET /drafts (no token)"       401 "$(code "$URL/drafts")"
chk "GET /drafts (bad token)"      401 "$(code -H 'Authorization: Bearer nope' "$URL/drafts")"
chk "GET /health (double Bearer)"  400 "$(code -H "Authorization: Bearer $AUTH" "$URL/health")"
chk "GET /health (token)"          200 "$(code -H "$AUTH" "$URL/health")"

# --- drafts round-trip (R2) ---
code -X PUT -H "$AUTH" -H 'content-type: application/json' \
  -d '{"id":"draft-smoke","title":"","content":"hi","updated_at":123}' \
  "$URL/drafts/draft-smoke" >/dev/null
chk "PUT then GET /drafts/:id"     200 "$(code -H "$AUTH" "$URL/drafts/draft-smoke")"
chk "DELETE /drafts/:id"           200 "$(code -X DELETE -H "$AUTH" "$URL/drafts/draft-smoke")"
chk "GET tombstoned /drafts/:id"   404 "$(code -H "$AUTH" "$URL/drafts/draft-smoke")"

# --- share round-trip (D1) ---
SID="$(curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"draftId":"draft-smoke","title":"T","content":"# hi"}' "$URL/share" \
  | sed -E 's/.*"shareId":"([^"]+)".*/\1/')"
chk "POST /share -> GET /s/:id"    200 "$(code "$URL/s/$SID")"
chk "DELETE /share/:id (revoke)"   200 "$(code -X DELETE -H "$AUTH" "$URL/share/$SID")"
chk "GET /s/:id after revoke"      404 "$(code "$URL/s/$SID")"

if [ "$fail" = "0" ]; then echo "PASS — all routes ok"; else echo "SMOKE FAILED"; fi
exit "$fail"
