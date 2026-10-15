#!/usr/bin/env bash
# Make sure the Electron binary is on disk for this OS. npm can leave the package
# installed without a binary when install scripts were skipped, ELECTRON_SKIP_BINARY_DOWNLOAD
# was set, or a Windows build was fetched on Linux (then the launcher shows
# "Could not download the window runtime").
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELECTRON_DIR="$ROOT/node_modules/electron"
ELECTRON_BIN="$ELECTRON_DIR/dist/electron"
INSTALL_JS="$ELECTRON_DIR/install.js"

# Never inherit Electron/npm overrides from a parent Tools / agent session.
unset ELECTRON_SKIP_BINARY_DOWNLOAD || true
unset ELECTRON_RUN_AS_NODE || true
unset ELECTRON_OVERRIDE_DIST_PATH || true
unset npm_config_platform || true
unset npm_config_arch || true
unset npm_config_target_platform || true
unset npm_config_target_arch || true

if [[ -x "$ELECTRON_BIN" ]]; then
  # Reject a non-ELF "electron" left over from a bad extract.
  if command -v file >/dev/null 2>&1; then
    if file -b "$ELECTRON_BIN" 2>/dev/null | grep -qiE 'ELF|executable'; then
      exit 0
    fi
    echo "Removing unusable Electron binary at $ELECTRON_BIN" >&2
    rm -f "$ELECTRON_BIN"
  else
    exit 0
  fi
fi

# Windows artifact on a Linux desk — wipe dist so install.js re-fetches linux.
if [[ -f "$ELECTRON_DIR/dist/electron.exe" && ! -x "$ELECTRON_BIN" ]]; then
  echo "Found a Windows Electron build on Linux; re-downloading the Linux runtime..." >&2
  rm -rf "$ELECTRON_DIR/dist"
  rm -f "$ELECTRON_DIR/path.txt"
fi

if [[ ! -f "$INSTALL_JS" ]]; then
  echo "Electron is not installed. From $ROOT run: npm install" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to download the window runtime." >&2
  exit 1
fi

download_once() {
  echo "Downloading the Black Forest Tools window runtime..."
  (
    cd "$ROOT"
    # npm can skip package install scripts; call Electron's downloader directly.
    node "$INSTALL_JS"
  )
}

download_once || true
if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "Retrying Electron download..." >&2
  rm -rf "$ELECTRON_DIR/dist"
  rm -f "$ELECTRON_DIR/path.txt"
  download_once || true
fi

if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "Could not download Electron." >&2
  echo "From $ROOT try: npm rebuild electron" >&2
  echo "Also check: unset ELECTRON_SKIP_BINARY_DOWNLOAD npm_config_platform" >&2
  exit 1
fi
