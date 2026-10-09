#!/usr/bin/env bash
# Launch the Black Forest Tools window from a git checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELECTRON="$ROOT/node_modules/electron/dist/electron"

if [[ ! -x "$ELECTRON" && -f "$ROOT/node_modules/electron/install.js" ]]; then
  node "$ROOT/node_modules/electron/install.js"
fi

if [[ ! -x "$ELECTRON" ]]; then
  echo "Black Forest Tools has not been installed yet." >&2
  echo "From $ROOT run: npm install" >&2
  exit 1
fi

cd "$ROOT"
exec "$ELECTRON" "$ROOT" "$@"
