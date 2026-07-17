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

# Use an isolated strong token for the run (>= MIN_TOKEN_LEN so the worker's
# fail-closed auth accepts it), and restore any real .dev.vars afterwards.
TOKEN="smoke-test-token-0123456789"
AUTH="Authorization: Bearer $TOKEN"
BACKUP=""
if [ -f .dev.vars ]; then BACKUP=".dev.vars.smoke-bak"; mv .dev.vars "$BACKUP"; fi
# AUTHOR_NAME set so the share-page header/metadata assertion has something to find.
{ echo "SYNC_TOKEN=$TOKEN"; echo "AUTHOR_NAME=Smoke Tester"; } >.dev.vars

echo "Starting wrangler dev on :$PORT …"
npx wrangler dev --port "$PORT" >/tmp/jotter-cloud-smoke.log 2>&1 &
DEV_PID=$!
cleanup() {
  kill "$DEV_PID" 2>/dev/null
  pkill -f "wrangler dev" 2>/dev/null
  rm -f .dev.vars
  [ -n "$BACKUP" ] && mv "$BACKUP" .dev.vars
}
trap cleanup EXIT

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

# --- Phase 1 hardening ---
# /version advertises a usable token is set (fail-closed diagnostic).
chk "GET /version configured=true" true \
  "$(curl -s "$URL/version" | sed -E 's/.*"configured":(true|false).*/\1/')"
# Baseline hardening header present on the HTML landing page.
chk "landing has nosniff header"   nosniff \
  "$(curl -s -D - -o /dev/null "$URL/" | grep -i x-content-type-options | grep -io nosniff)"
# Body-size cap: a >1 MB draft is refused before it hits R2. Build the payload in a
# file (a 1.1 MB inline arg would blow past the shell's ARG_MAX) and stream it.
BIGFILE="$(mktemp)"
{ printf '{"id":"draft-big","updated_at":1,"content":"'; head -c 1100000 /dev/zero | tr '\0' a; printf '"}'; } >"$BIGFILE"
chk "PUT oversized draft -> 413"   413 \
  "$(code -X PUT -H "$AUTH" -H 'content-type: application/json' \
     --data-binary "@$BIGFILE" "$URL/drafts/draft-big")"
rm -f "$BIGFILE"

# --- drafts round-trip (R2) ---
code -X PUT -H "$AUTH" -H 'content-type: application/json' \
  -d '{"id":"draft-smoke","title":"","content":"hi","updated_at":123}' \
  "$URL/drafts/draft-smoke" >/dev/null
chk "PUT then GET /drafts/:id"     200 "$(code -H "$AUTH" "$URL/drafts/draft-smoke")"
chk "DELETE /drafts/:id"           200 "$(code -X DELETE -H "$AUTH" "$URL/drafts/draft-smoke")"
chk "GET tombstoned /drafts/:id"   404 "$(code -H "$AUTH" "$URL/drafts/draft-smoke")"

# --- share round-trip (D1) ---
# updatedAt (ms) is optional; when sent it renders an "Updated <date>" footer line.
# Empty title on purpose: exercises the first-heading title fallback ("# hi" -> "hi").
SID="$(curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"draftId":"draft-smoke","title":"","content":"# hi","updatedAt":1720915200000}' "$URL/share" \
  | sed -E 's/.*"shareId":"([^"]+)".*/\1/')"
chk "POST /share -> GET /s/:id"    200 "$(code "$URL/s/$SID")"
chk "share page renders Updated"   Updated \
  "$(curl -s "$URL/s/$SID" | grep -o 'Updated' | head -1)"
# Title falls back to the first heading ("hi") when the note has no title; tab
# title is suffixed "— Jotter"; and the inline favicon is present.
chk "tab title from first heading" "<title>hi — Jotter</title>" \
  "$(curl -s "$URL/s/$SID" | grep -o '<title>hi — Jotter</title>' | head -1)"
chk "share page has favicon"       1 \
  "$(curl -s "$URL/s/$SID" | grep -c 'rel="icon"')"
# Header shows the configured author; metadata row shows word count + read time.
chk "meta shows author name"       "Smoke Tester" \
  "$(curl -s "$URL/s/$SID" | grep -o 'Smoke Tester' | head -1)"
chk "meta shows read time"         "min read" \
  "$(curl -s "$URL/s/$SID" | grep -o 'min read' | head -1)"
chk "DELETE /share/:id (revoke)"   200 "$(code -X DELETE -H "$AUTH" "$URL/share/$SID")"
chk "GET /s/:id after revoke"      404 "$(code "$URL/s/$SID")"

# --- delete cascades to the share (a deleted note must not stay live at its link) ---
code -X PUT -H "$AUTH" -H 'content-type: application/json' \
  -d '{"id":"draft-casc","title":"","content":"secret","updated_at":9}' \
  "$URL/drafts/draft-casc" >/dev/null
CSID="$(curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"draftId":"draft-casc","title":"C","content":"# secret"}' "$URL/share" \
  | sed -E 's/.*"shareId":"([^"]+)".*/\1/')"
chk "share live before delete"     200 "$(code "$URL/s/$CSID")"
code -X DELETE -H "$AUTH" "$URL/drafts/draft-casc" >/dev/null
chk "delete draft revokes share"   404 "$(code "$URL/s/$CSID")"

if [ "$fail" = "0" ]; then echo "PASS — all routes ok"; else echo "SMOKE FAILED"; fi
exit "$fail"
