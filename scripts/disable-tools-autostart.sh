#!/usr/bin/env bash
# Stop Black Forest Tools from launching at login.
set -euo pipefail

AUTOSTART_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_NAME="blackforest-tools.service"
DESKTOP_PATH="$AUTOSTART_DIR/blackforest-tools.desktop"

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now "$UNIT_NAME" 2>/dev/null || true
  systemctl --user daemon-reload 2>/dev/null || true
fi

rm -f "$UNIT_DIR/$UNIT_NAME" "$DESKTOP_PATH"

echo "Black Forest Tools will no longer start at login."
echo "Removed: $DESKTOP_PATH"
echo "Removed: $UNIT_DIR/$UNIT_NAME (if present)"
