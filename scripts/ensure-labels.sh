#!/usr/bin/env bash
# Ensure vendored labels/ deps are installed (idempotent).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/labels"
if [[ ! -d node_modules/pdf-lib ]] || [[ ! -d node_modules/qrcode ]]; then
  npm ci --omit=dev
fi
