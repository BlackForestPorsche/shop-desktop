#!/usr/bin/env bash
# Open shop.blackforestautomotive.com in Firefox already signed in via widget handoff.
# Requires a shared widget session and the site POST /api/widget/session/handoff route.
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
SHOP_BASE="${BLACKFOREST_SHOP_BASE:-https://shop.blackforestautomotive.com}"
HELPER="$ROOT/scripts/blackforest-widget-session"

if [[ ! -x "$HELPER" ]]; then
  chmod +x "$HELPER" 2>/dev/null || true
fi

if ! session_json="$("$HELPER" read 2>/dev/null)"; then
  echo "No shared shop session. Unlock a Plasma widget or Black Forest Tools first." >&2
  exit 2
fi

token="$(
  printf '%s' "$session_json" | node -e '
    let s = "";
    process.stdin.on("data", (c) => (s += c));
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(s);
        if (!j.token) process.exit(3);
        process.stdout.write(String(j.token));
      } catch {
        process.exit(3);
      }
    });
  '
)" || {
  echo "Shared session file is missing a token." >&2
  exit 3
}

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

code="$(
  curl -sS -o "$tmp" -w '%{http_code}' \
    -X POST "$SHOP_BASE/api/widget/session/handoff" \
    -H "Accept: application/json" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d '{}'
)" || {
  echo "Could not reach the shop handoff endpoint." >&2
  exit 4
}

if [[ "$code" == "401" || "$code" == "403" ]]; then
  echo "Shared widget session was rejected (HTTP $code). Unlock again, then retry." >&2
  exit 5
fi

if [[ "$code" == "429" ]]; then
  echo "Handoff rate-limited (10/min). Wait a minute and try again." >&2
  exit 5
fi

if [[ "$code" != "200" ]]; then
  echo "Handoff failed (HTTP $code). Shop beta 0.1.25+ required for POST /api/widget/session/handoff." >&2
  exit 6
fi

url="$(
  node -e '
    const fs = require("fs");
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!j.url || typeof j.url !== "string") process.exit(7);
    if (!j.url.startsWith(process.argv[2] + "/")) process.exit(8);
    process.stdout.write(j.url);
  ' "$tmp" "$SHOP_BASE"
)" || {
  echo "Handoff response did not include a shop URL." >&2
  exit 7
}

if command -v firefox >/dev/null 2>&1; then
  exec firefox "$url"
fi
exec xdg-open "$url"
