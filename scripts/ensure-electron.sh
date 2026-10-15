#!/usr/bin/env bash
# Ensure the Electron window runtime is present and executable.
# Failures surface in blackforest-tools.sh as:
#   "Could not download the window runtime"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

unset ELECTRON_SKIP_BINARY_DOWNLOAD || true
unset ELECTRON_RUN_AS_NODE || true
unset ELECTRON_OVERRIDE_DIST_PATH || true
unset npm_config_platform || true
unset npm_config_arch || true

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to download the window runtime." >&2
  exit 1
fi

# Shared repair: chmod non-executable binary, or wipe soft-skip metadata and re-download.
exec node "$ROOT/scripts/electron-binary.js" "$ROOT"
