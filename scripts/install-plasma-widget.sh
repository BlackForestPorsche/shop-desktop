#!/usr/bin/env bash
# Install the Black Forest Shop Plasma 6 plasmoid + session helper for this user.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLASMOID_ID="com.blackforestautomotive.shop"
SRC="$ROOT/plasma/plasmoids/$PLASMOID_ID"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
DEST="$DATA_HOME/plasma/plasmoids/$PLASMOID_ID"
BIN_DIR="$HOME/.local/bin"
SESSION_HELPER_SRC="$ROOT/scripts/blackforest-widget-session"
SESSION_HELPER_DEST="$BIN_DIR/blackforest-widget-session"
SESSION_DIR="$DATA_HOME/blackforest-tools"

if [[ ! -f "$SRC/metadata.json" ]]; then
  echo "Missing plasmoid at $SRC" >&2
  exit 1
fi

if [[ ! -f "$SESSION_HELPER_SRC" ]]; then
  echo "Missing session helper at $SESSION_HELPER_SRC" >&2
  exit 1
fi

mkdir -p "$BIN_DIR" "$(dirname "$DEST")" "$SESSION_DIR"
chmod 700 "$SESSION_DIR"

rm -rf "$DEST"
cp -a "$SRC" "$DEST"

install -m 0755 "$SESSION_HELPER_SRC" "$SESSION_HELPER_DEST"

# Refresh Plasma applet cache when available (Plasma 5 or 6 tooling).
if command -v kbuildsycoca6 >/dev/null 2>&1; then
  kbuildsycoca6 --noincremental 2>/dev/null || true
elif command -v kbuildsycoca5 >/dev/null 2>&1; then
  kbuildsycoca5 --noincremental 2>/dev/null || true
fi

echo "Installed Plasma widget: $PLASMOID_ID"
echo "  Plasmoid: $DEST"
echo "  Session helper: $SESSION_HELPER_DEST"
echo "  Session data dir: $SESSION_DIR (mode 700)"
echo
echo "Add it: right-click the desktop or panel → Add Widgets → search “Black Forest Shop”."
echo "Unlock once in any instance; every copy shares that session."
echo "Configure each copy for lot, book-today, or notes."
echo
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Note: $BIN_DIR is not on PATH. Log out once, or ensure ~/.local/bin is on PATH"
  echo "so the widget can call blackforest-widget-session."
fi
echo "If the widget does not appear, log out of Plasma or run: plasmashell --replace &"
echo "Requires Plasma 6 (X-Plasma-API-Minimum-Version 6.0)."
