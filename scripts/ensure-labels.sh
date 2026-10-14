#!/usr/bin/env bash
# Install vendored Labels (LabelWriter) server dependencies under labels/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABELS="$ROOT/labels"

if [[ ! -f "$LABELS/package.json" ]]; then
  echo "Vendored Labels tree missing at $LABELS" >&2
  exit 1
fi

if [[ -d "$LABELS/node_modules/pdf-lib" ]]; then
  echo "Labels dependencies already present."
  exit 0
fi

echo "Installing Labels server dependencies..."
(cd "$LABELS" && npm install --omit=dev)
echo "Labels dependencies ready."
