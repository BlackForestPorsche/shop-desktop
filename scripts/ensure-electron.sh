#!/usr/bin/env bash
# Make sure the Electron binary is on disk and executable. npm can leave the
# package installed without a runnable binary (skipped download, partial
# extract, or mode 644 after an in-app update).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELECTRON_BIN="$ROOT/node_modules/electron/dist/electron"

if [[ -x "$ELECTRON_BIN" ]] && [[ -s "$ELECTRON_BIN" ]] && [[ -f "$ROOT/node_modules/electron/path.txt" ]]; then
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. From $ROOT run: npm install" >&2
  exit 1
fi

node "$ROOT/scripts/ensure-electron-run.js"

if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "Could not download Electron." >&2
  echo "From $ROOT try: npm rebuild electron" >&2
  exit 1
fi
