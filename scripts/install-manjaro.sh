#!/usr/bin/env bash
# Put Black Forest Tools in the Manjaro application menu for this user.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHER="$ROOT/scripts/blackforest-tools.sh"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
APP_DIR="$DATA_HOME/applications"
ICON_DIR="$DATA_HOME/icons/hicolor/512x512/apps"
BIN_DIR="$HOME/.local/bin"

chmod +x "$LAUNCHER" "$ROOT/scripts/install-manjaro.sh"

if [[ ! -x "$ROOT/node_modules/electron/dist/electron" ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "Install Node first: sudo pacman -S nodejs npm" >&2
    exit 1
  fi
  echo "Installing the window runtime..."
  (cd "$ROOT" && npm install)
fi

mkdir -p "$APP_DIR" "$ICON_DIR" "$BIN_DIR"
ICON_SRC="$ROOT/assets/icon.png"
if [[ ! -f "$ICON_SRC" ]]; then
  mkdir -p "$ROOT/assets"
  curl -fsSL "https://shop.blackforestautomotive.com/__grok/icon-180.png" -o "$ICON_SRC" \
    || curl -fsSL "https://shop.blackforestautomotive.com/favicon-32.png" -o "$ICON_SRC"
fi
cp "$ICON_SRC" "$ICON_DIR/blackforest-tools.png"
ln -sfn "$LAUNCHER" "$BIN_DIR/blackforest-tools"

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

chmod +x "$APP_DIR/blackforest-tools.desktop"
update-desktop-database "$APP_DIR" 2>/dev/null || true
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "$DATA_HOME/icons/hicolor" 2>/dev/null || true
fi

echo "Black Forest Tools is in the application menu."
echo "Command: blackforest-tools"
echo "If the command is not found, log out once, or open it from the menu."
