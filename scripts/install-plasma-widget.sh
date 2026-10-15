#!/usr/bin/env bash
# Install the Black Forest Shop Plasma 6 plasmoid + session helper for this user.
# Also arms a 30-minute systemd user timer (like Pro Circuit) so git pulls reinstall the widget.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLASMOID_ID="com.blackforestautomotive.shop"
SRC="$ROOT/plasma/plasmoids/$PLASMOID_ID"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
DEST="$DATA_HOME/plasma/plasmoids/$PLASMOID_ID"
BIN_DIR="$HOME/.local/bin"
SESSION_HELPER_SRC="$ROOT/scripts/blackforest-widget-session"
SESSION_HELPER_DEST="$BIN_DIR/blackforest-widget-session"
UPDATE_SCRIPT="$ROOT/scripts/update-plasma-widget.sh"
SESSION_DIR="$DATA_HOME/blackforest-tools"
SKIP_TIMER=0

for arg in "$@"; do
  if [[ "$arg" == "--skip-timer" ]]; then
    SKIP_TIMER=1
  fi
done

if [[ ! -f "$SRC/metadata.json" ]]; then
  echo "Missing plasmoid at $SRC" >&2
  exit 1
fi

if [[ ! -f "$SESSION_HELPER_SRC" ]]; then
  echo "Missing session helper at $SESSION_HELPER_SRC" >&2
  exit 1
fi

if [[ ! -f "$UPDATE_SCRIPT" ]]; then
  echo "Missing update script at $UPDATE_SCRIPT" >&2
  exit 1
fi

mkdir -p "$BIN_DIR" "$(dirname "$DEST")" "$SESSION_DIR"
chmod 700 "$SESSION_DIR"

rm -rf "$DEST"
cp -a "$SRC" "$DEST"

install -m 0755 "$SESSION_HELPER_SRC" "$SESSION_HELPER_DEST"
chmod +x "$UPDATE_SCRIPT" "$ROOT/scripts/install-plasma-widget.sh"

# Prefer kpackagetool6 when available (matches Pro Circuit).
if command -v kpackagetool6 >/dev/null 2>&1; then
  if kpackagetool6 -t Plasma/Applet -l 2>/dev/null | grep -q "$PLASMOID_ID"; then
    kpackagetool6 -t Plasma/Applet -u "$SRC" >/dev/null 2>&1 || true
  else
    kpackagetool6 -t Plasma/Applet -i "$SRC" >/dev/null 2>&1 || true
  fi
fi

if command -v kbuildsycoca6 >/dev/null 2>&1; then
  kbuildsycoca6 --noincremental 2>/dev/null || true
elif command -v kbuildsycoca5 >/dev/null 2>&1; then
  kbuildsycoca5 --noincremental 2>/dev/null || true
fi

if [[ "$SKIP_TIMER" -eq 0 ]]; then
  if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "Note: this copy is not a git checkout, so the 30-minute auto-update timer was not enabled."
  else
    UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    mkdir -p "$UNIT_DIR"

    cat > "$UNIT_DIR/blackforest-shop-widget-update.service" <<EOF
[Unit]
Description=Update the Black Forest Shop Plasma widget from git

[Service]
Type=oneshot
ExecStart=$UPDATE_SCRIPT
EOF

    cat > "$UNIT_DIR/blackforest-shop-widget-update.timer" <<EOF
[Unit]
Description=Check GitHub for Black Forest Shop widget changes

[Timer]
OnBootSec=2min
OnUnitInactiveSec=30min
Persistent=true

[Install]
WantedBy=timers.target
EOF

    if command -v systemctl >/dev/null 2>&1; then
      systemctl --user daemon-reload
      systemctl --user enable --now blackforest-shop-widget-update.timer
      echo "Auto-update timer: every 30 minutes (blackforest-shop-widget-update.timer)"
    else
      echo "Note: systemctl not available; install the timer manually later."
    fi
  fi
fi

echo "Installed Plasma widget: $PLASMOID_ID"
echo "  Plasmoid: $DEST"
echo "  Session helper: $SESSION_HELPER_DEST"
echo "  Session data dir: $SESSION_DIR (mode 700)"
echo
echo "Add it: right-click the desktop or panel → Add Widgets → search “Black Forest Shop”."
echo "Unlock once in any instance; every copy shares that session."
echo "Configure each copy for lot, book-today, or notes."
echo "Notes view can leave a note for another desk person (shop beta 0.1.18+)."
echo
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Note: $BIN_DIR is not on PATH. Log out once, or ensure ~/.local/bin is on PATH"
  echo "so the widget can call blackforest-widget-session."
fi
echo "If the widget does not appear, log out of Plasma or run: plasmashell --replace &"
echo "Requires Plasma 6 (X-Plasma-API-Minimum-Version 6.0)."
