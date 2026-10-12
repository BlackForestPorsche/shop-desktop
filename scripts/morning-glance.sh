#!/usr/bin/env bash
# One-shot login glance: today's book / lot / open notes via the widget API.
# Uses the shared session. No polling. notify-send is enough.
set -euo pipefail

PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export PATH

BASE="https://shop.blackforestautomotive.com"
HELPER="$HOME/.local/bin/blackforest-widget-session"
TITLE="Morning glance"
TMPDIR="${TMPDIR:-/tmp}"
SESSION_FILE="$(mktemp "$TMPDIR/bf-morning-session.XXXXXX")"
trap 'rm -f "$SESSION_FILE"' EXIT

notify() {
  local body="$1"
  if command -v notify-send >/dev/null 2>&1; then
    notify-send -a "Black Forest Shop" -u normal "$TITLE" "$body" 2>/dev/null || true
  else
    printf '%s\n%s\n' "$TITLE" "$body"
  fi
}

if [[ ! -x "$HELPER" ]]; then
  notify "Shop session helper missing. Run: cd ~/shop-desktop && npm run install-plasma"
  exit 0
fi

if ! "$HELPER" read >"$SESSION_FILE" 2>/dev/null; then
  notify "Not signed in to the shop widgets. Unlock lot or notes once."
  exit 0
fi

# chmod so only this user can read the temp token copy
chmod 600 "$SESSION_FILE" 2>/dev/null || true

mapfile -t CREDS < <(python3 - <<PY
import json, datetime
from pathlib import Path
raw = Path("$SESSION_FILE").read_text(encoding="utf-8")
try:
    data = json.loads(raw)
except Exception:
    print("")
    print("")
    raise SystemExit(0)
token = data.get("token") or ""
expires = data.get("expiresAt") or ""
person = data.get("person") or ""
ok = bool(token and expires)
if ok:
    try:
        exp = datetime.datetime.fromisoformat(expires.replace("Z", "+00:00"))
        now = datetime.datetime.now(datetime.timezone.utc)
        ok = now < exp
    except Exception:
        ok = False
if not ok:
    print("")
    print("")
else:
    print(token)
    print(person)
PY
)

TOKEN="${CREDS[0]:-}"
PERSON="${CREDS[1]:-}"
rm -f "$SESSION_FILE"

if [[ -z "$TOKEN" ]]; then
  notify "Shop session expired. Unlock lot or notes once."
  exit 0
fi

fetch_view() {
  local view_id="$1"
  curl -sS --max-time 12 \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/json" \
    "${BASE}/api/widget/views/${view_id}" || true
}

BOOK="$(fetch_view book-today)"
LOT="$(fetch_view lot)"
NOTES="$(fetch_view notes)"
TOKEN=""

BODY="$(PERSON="$PERSON" BOOK="$BOOK" LOT="$LOT" NOTES="$NOTES" python3 - <<'PY'
import json, os

def load(name):
    raw = os.environ.get(name) or ""
    if not raw.strip():
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None

def summary(view, fallback_count_label):
    if not view or not isinstance(view, dict):
        return "n/a"
    if view.get("error"):
        return "n/a"
    s = view.get("summary")
    if isinstance(s, str) and s.strip():
        return s.strip()
    if isinstance(s, dict):
        parts = [f"{k} {v}" for k, v in s.items()]
        if parts:
            return ", ".join(parts)
    items = view.get("items") or []
    if isinstance(items, list):
        return f"{len(items)} {fallback_count_label}"
    return "n/a"

person = (os.environ.get("PERSON") or "").strip()
who = f"Signed in as {person}. " if person else ""
book = summary(load("BOOK"), "on the book")
lot = summary(load("LOT"), "on the lot")
notes = summary(load("NOTES"), "open notes")
print(f"{who}Book: {book} · Lot: {lot} · Notes: {notes}")
PY
)"

notify "$BODY"
exit 0
