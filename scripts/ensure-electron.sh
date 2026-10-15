#!/usr/bin/env bash
# Make sure the Linux Electron binary is on disk. The menu launcher shows
# "Could not download the window runtime" when this script exits non-zero.
#
# Common failure modes after Settings → Update and restart:
#   - npm install ran while Electron was live and wiped dist/
#   - ELECTRON_SKIP_BINARY_DOWNLOAD left install.js as a no-op
#   - npm_config_platform=win32 fetched electron.exe on Linux
#   - electron package present but install.js / dist incomplete
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
export npm_config_ignore_scripts=false

have_linux_electron() {
  [[ -x "$ELECTRON_BIN" ]] || return 1
  if command -v file >/dev/null 2>&1; then
    file -b "$ELECTRON_BIN" 2>/dev/null | grep -qiE 'ELF' || return 1
  fi
  return 0
}

if have_linux_electron; then
  exit 0
fi

# Windows artifact or junk binary on a Linux desk — wipe so install.js re-fetches linux.
if [[ -d "$ELECTRON_DIR/dist" ]]; then
  echo "Removing unusable Electron dist under $ELECTRON_DIR/dist" >&2
  rm -rf "$ELECTRON_DIR/dist"
  rm -f "$ELECTRON_DIR/path.txt"
fi

ensure_electron_package() {
  if [[ -f "$INSTALL_JS" ]]; then
    return 0
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "Node/npm required. From $ROOT: sudo pacman -S nodejs npm && npm install" >&2
    return 1
  fi
  echo "Electron package missing; running npm install..." >&2
  (
    cd "$ROOT"
    npm install
  )
  [[ -f "$INSTALL_JS" ]]
}

download_once() {
  echo "Downloading the Black Forest Tools window runtime..."
  (
    cd "$ROOT"
    # Force a real download even if a stale path.txt/version claims installed.
    rm -f "$ELECTRON_DIR/path.txt"
    rm -rf "$ELECTRON_DIR/dist"
    node "$INSTALL_JS"
  )
}

rebuild_fallback() {
  echo "Trying npm rebuild electron..." >&2
  (
    cd "$ROOT"
    npm rebuild electron
  ) || (
    cd "$ROOT"
    npm install electron@"$(node -p "require('./node_modules/electron/package.json').version" 2>/dev/null || echo '38.2.1')" --no-save
  ) || true
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to download the window runtime." >&2
  exit 1
fi

if ! ensure_electron_package; then
  echo "Electron is not installed. From $ROOT run: npm install" >&2
  exit 1
fi

download_once || true
if ! have_linux_electron; then
  echo "Retrying Electron download (cleared cache markers)..." >&2
  rm -rf "$ELECTRON_DIR/dist" "$HOME/.cache/electron" 2>/dev/null || true
  rm -f "$ELECTRON_DIR/path.txt"
  download_once || true
fi

if ! have_linux_electron; then
  rebuild_fallback
fi

if ! have_linux_electron; then
  echo "Could not download Electron." >&2
  echo "From $ROOT try:" >&2
  echo "  unset ELECTRON_SKIP_BINARY_DOWNLOAD npm_config_platform" >&2
  echo "  rm -rf node_modules/electron/dist ~/.cache/electron" >&2
  echo "  npm install && node node_modules/electron/install.js" >&2
  exit 1
fi

echo "Window runtime ready: $ELECTRON_BIN"
