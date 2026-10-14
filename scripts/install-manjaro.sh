#!/usr/bin/env bash
# Put Black Forest Tools in the Manjaro application menu for this user.
# Also enables start-at-login (systemd --user + XDG). Opt out with --no-autostart.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHER="$ROOT/scripts/blackforest-tools.sh"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
APP_DIR="$DATA_HOME/applications"
ICON_DIR="$DATA_HOME/icons/hicolor/512x512/apps"
BIN_DIR="$HOME/.local/bin"
ENABLE_AUTOSTART=1

for arg in "$@"; do
  case "$arg" in
    --no-autostart) ENABLE_AUTOSTART=0 ;;
    --autostart) ENABLE_AUTOSTART=1 ;;
  esac
done

chmod +x \
  "$LAUNCHER" \
  "$ROOT/scripts/install-manjaro.sh" \
  "$ROOT/scripts/ensure-electron.sh" \
  "$ROOT/scripts/ensure-labels.sh" \
  "$ROOT/scripts/sync-labels-vendor.sh" \
  "$ROOT/scripts/enable-tools-autostart.sh" \
  "$ROOT/scripts/disable-tools-autostart.sh" \
  "$ROOT/scripts/open-firefox-signed-in.sh" \
  "$ROOT/scripts/blackforest-widget-session"

if ! command -v npm >/dev/null 2>&1; then
  echo "Install Node first: sudo pacman -S nodejs npm" >&2
  exit 1
fi

if [[ ! -d "$ROOT/node_modules/electron" ]]; then
  echo "Installing packages..."
  (cd "$ROOT" && npm install)
fi

echo "Installing Labels server dependencies..."
bash "$ROOT/scripts/ensure-labels.sh"

echo "Installing the window runtime..."
bash "$ROOT/scripts/ensure-electron.sh"

mkdir -p "$APP_DIR" "$ICON_DIR" "$BIN_DIR"
ICON_SRC="$ROOT/assets/icon.png"
if [[ ! -f "$ICON_SRC" ]]; then
  mkdir -p "$ROOT/assets"
  curl -fsSL "https://shop.blackforestautomotive.com/__grok/icon-180.png" -o "$ICON_SRC" \
    || curl -fsSL "https://shop.blackforestautomotive.com/favicon-32.png" -o "$ICON_SRC"
fi
cp "$ICON_SRC" "$ICON_DIR/blackforest-tools.png"
ln -sfn "$LAUNCHER" "$BIN_DIR/blackforest-tools"
ln -sfn "$ROOT/scripts/open-firefox-signed-in.sh" "$BIN_DIR/blackforest-firefox-signed-in"

cat > "$APP_DIR/blackforest-tools.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Black Forest Tools
GenericName=Shop tools
Comment=Live window for shop.blackforestautomotive.com
Exec=$LAUNCHER %u
Icon=blackforest-tools
Terminal=false
Categories=Office;Utility;
StartupWMClass=black-forest-tools
Keywords=shop;automotive;blackforest;
StartupNotify=true
EOF

cat > "$APP_DIR/blackforest-firefox-signed-in.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Shop in Firefox (signed in)
GenericName=Shop Firefox handoff
Comment=Open shop.blackforestautomotive.com in Firefox using the shared widget session
Exec=$ROOT/scripts/open-firefox-signed-in.sh
Icon=blackforest-tools
Terminal=false
Categories=Network;Office;Utility;
Keywords=shop;firefox;blackforest;
StartupNotify=true
EOF

chmod +x "$APP_DIR/blackforest-tools.desktop" "$APP_DIR/blackforest-firefox-signed-in.desktop"
update-desktop-database "$APP_DIR" 2>/dev/null || true
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "$DATA_HOME/icons/hicolor" 2>/dev/null || true
fi

echo "Black Forest Tools is in the application menu."
echo "Labels service: starts with Tools on :8080 (adopts existing labels.service) — Labels → status / restart"
echo "Command: blackforest-tools"
echo "Firefox signed-in: blackforest-firefox-signed-in (or Shop → Open in Firefox signed in)"
echo "If the command is not found, log out once, or open it from the menu."

if [[ "$ENABLE_AUTOSTART" -eq 1 ]]; then
  echo
  bash "$ROOT/scripts/enable-tools-autostart.sh"
else
  echo
  echo "Login autostart skipped (--no-autostart)."
  echo "Enable later: bash \"$ROOT/scripts/enable-tools-autostart.sh\""
fi

echo
echo "If the window closes right away, run this in a terminal and send the output:"
echo "  cd ~/shop-desktop && npm start"
echo "Log file: \${XDG_STATE_HOME:-\$HOME/.local/state}/blackforest-tools/launch.log"
