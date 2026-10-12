#!/usr/bin/env bash
# Install user systemd oneshots for desk wake + morning glance (graphical login).
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
BIN_DIR="$HOME/.local/bin"
DESK_WAKE="$ROOT/scripts/desk-wake.sh"
MORNING="$ROOT/scripts/morning-glance.sh"
REFRESH="$ROOT/scripts/refresh-plasma-widget.sh"

chmod +x "$DESK_WAKE" "$MORNING" "$REFRESH" \
  "$ROOT/scripts/install-plasma-widget.sh" \
  "$ROOT/scripts/update-plasma-widget.sh" \
  "$ROOT/scripts/blackforest-widget-session" \
  "$ROOT/scripts/install-desk-automations.sh"

mkdir -p "$UNIT_DIR" "$BIN_DIR"
ln -sfn "$REFRESH" "$BIN_DIR/blackforest-refresh-widget"
ln -sfn "$DESK_WAKE" "$BIN_DIR/blackforest-desk-wake"
ln -sfn "$MORNING" "$BIN_DIR/blackforest-morning-glance"

# Keep session helper current too.
if [[ -f "$ROOT/scripts/blackforest-widget-session" ]]; then
  install -m 0755 "$ROOT/scripts/blackforest-widget-session" "$BIN_DIR/blackforest-widget-session"
fi

cat > "$UNIT_DIR/blackforest-desk-wake.service" <<EOF
[Unit]
Description=Black Forest desk wake (oneshot after login)
After=graphical-session-pre.target
PartOf=graphical-session.target

[Service]
Type=oneshot
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$DESK_WAKE

[Install]
WantedBy=graphical-session.target
EOF

cat > "$UNIT_DIR/blackforest-morning-glance.service" <<EOF
[Unit]
Description=Black Forest morning glance (oneshot after login)
After=graphical-session.target blackforest-desk-wake.service
PartOf=graphical-session.target

[Service]
Type=oneshot
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
# Short settle so Plasma/notify is up; still a oneshot, not a daemon.
ExecStartPre=/bin/sleep 4
ExecStart=$MORNING

[Install]
WantedBy=graphical-session.target
EOF

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload
  systemctl --user enable blackforest-desk-wake.service
  systemctl --user enable blackforest-morning-glance.service
  echo "Enabled: blackforest-desk-wake.service, blackforest-morning-glance.service"
  echo "WantedBy=graphical-session.target (runs once per login)."
else
  echo "Note: systemctl not available; unit files written to $UNIT_DIR"
fi

echo "Commands: blackforest-desk-wake, blackforest-morning-glance, blackforest-refresh-widget"
echo "Test now: systemctl --user start blackforest-desk-wake.service"
echo "          systemctl --user start blackforest-morning-glance.service"
