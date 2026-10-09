#!/usr/bin/env bash
# Make sure the Electron binary is on disk. npm can leave the package installed
# without running electron's download script.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELECTRON_DIR="$ROOT/node_modules/electron"
ELECTRON_BIN="$ELECTRON_DIR/dist/electron"
INSTALL_JS="$ELECTRON_DIR/install.js"

if [[ -x "$ELECTRON_BIN" ]]; then
  exit 0
fi

if [[ ! -f "$INSTALL_JS" ]]; then
  echo "Electron is not installed. From $ROOT run: npm install" >&2
  exit 1
fi

echo "Downloading the Black Forest Tools window runtime..."
(
  cd "$ROOT"
  # npm 12 can skip package install scripts; call Electron's downloader directly.
  node "$INSTALL_JS"
)

if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "Could not download Electron." >&2
  echo "From $ROOT try: npm rebuild electron" >&2
  exit 1
fi
