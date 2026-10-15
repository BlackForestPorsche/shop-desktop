#!/usr/bin/env bash
# Start Black Forest Tools at graphical login (shop desks, default ON).
#
# Installs:
#   1) systemd --user unit WantedBy=graphical-session.target (primary on Manjaro)
#   2) XDG autostart .desktop as a fallback if the session skips the unit
#
# The XDG entry sets Hidden=true when systemd was enabled successfully, so a
# normal Plasma login only starts Tools once. Electron’s requestSingleInstanceLock
# still guards against a second window if both paths ever fire.
#
#   bash scripts/enable-tools-autostart.sh
# Opt out later: bash scripts/disable-tools-autostart.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHER="$ROOT/scripts/blackforest-tools.sh"
AUTOSTART_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_NAME="blackforest-tools.service"
DESKTOP_NAME="blackforest-tools.desktop"
SYSTEMD_ENABLED=0

if [[ ! -x "$LAUNCHER" ]]; then
  chmod +x "$LAUNCHER" || true
fi
if [[ ! -f "$LAUNCHER" ]]; then
  echo "Missing launcher: $LAUNCHER" >&2
  exit 1
fi

mkdir -p "$AUTOSTART_DIR" "$UNIT_DIR"

cat > "$UNIT_DIR/$UNIT_NAME" <<EOF
[Unit]
Description=Black Forest Tools (start at login)
Documentation=file://$ROOT/README.md
After=graphical-session-pre.target
PartOf=graphical-session.target

[Service]
Type=simple
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$LAUNCHER
Restart=no

[Install]
WantedBy=graphical-session.target
EOF

if command -v systemctl >/dev/null 2>&1; then
  # daemon-reload / enable need a user bus; desks have one at login, CI often does not.
  if systemctl --user daemon-reload 2>/dev/null && systemctl --user enable "$UNIT_NAME" 2>/dev/null; then
    SYSTEMD_ENABLED=1
    echo "Login autostart: systemd --user ($UNIT_NAME, WantedBy=graphical-session.target)"
  else
    echo "Note: systemd user unit written to $UNIT_DIR/$UNIT_NAME but could not enable yet."
    echo "      After login run: systemctl --user daemon-reload && systemctl --user enable $UNIT_NAME"
  fi
else
  echo "Note: systemctl not available; systemd user unit written but not enabled."
fi

# When systemd was enabled, hide the XDG entry so Plasma only starts Tools once.
# If enable failed (no user bus yet), leave XDG active so login still opens Tools.
XDG_HIDDEN="false"
if [[ "$SYSTEMD_ENABLED" -eq 1 ]]; then
  XDG_HIDDEN="true"
fi

cat > "$AUTOSTART_DIR/$DESKTOP_NAME" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Black Forest Tools
GenericName=Shop tools
Comment=Open the shop tools window at login
Exec=$LAUNCHER
Icon=blackforest-tools
Terminal=false
Categories=Office;Utility;
StartupWMClass=black-forest-tools
X-GNOME-Autostart-enabled=true
Hidden=$XDG_HIDDEN
StartupNotify=false
EOF

chmod +x "$AUTOSTART_DIR/$DESKTOP_NAME"
echo "Login autostart: XDG ($AUTOSTART_DIR/$DESKTOP_NAME, Hidden=$XDG_HIDDEN)"
echo "Disable: bash \"$ROOT/scripts/disable-tools-autostart.sh\""
