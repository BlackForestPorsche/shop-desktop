#!/usr/bin/env bash
# Re-copy Labels server sources from a local label-connect checkout into labels/.
# Usage: bash scripts/sync-labels-vendor.sh [/path/to/label-connect]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:-$HOME/label-connect}"
DEST="$ROOT/labels"

if [[ ! -f "$SRC/server.mjs" ]]; then
  echo "label-connect checkout not found at $SRC (pass path as arg 1)" >&2
  exit 1
fi

mkdir -p "$DEST"
cp "$SRC/server.mjs" "$DEST/server.mjs"
rm -rf "$DEST/shared" "$DEST/public"
cp -a "$SRC/shared" "$DEST/shared"
cp -a "$SRC/public" "$DEST/public"
cp "$SRC/package.json" "$DEST/package.json.tmp"
cp "$SRC/package-lock.json" "$DEST/package-lock.json" 2>/dev/null || true

python3 - <<PY
import json
from pathlib import Path
src = Path("$DEST/package.json.tmp")
pkg = json.loads(src.read_text())
pkg["name"] = "blackforest-tools-labels"
pkg["description"] = "Vendored Labels (LabelWriter 550) server owned by Black Forest Tools."
pkg["private"] = True
pkg["scripts"] = {"start": "node server.mjs"}
Path("$DEST/package.json").write_text(json.dumps(pkg, indent=2) + "\n")
src.unlink()
PY

COMMIT="$(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo unknown)"
VERSION="$(python3 -c "import json;print(json.load(open('$SRC/package.json'))['version'])")"
cat > "$DEST/VENDOR.txt" <<EOF
Vendored Labels (LabelWriter 550) server for Black Forest Tools.

Upstream: https://github.com/BlackForestPorsche/label-connect
Synced from commit: $COMMIT
Upstream version: $VERSION

Owned at runtime by Tools: Electron main spawns \`node server.mjs\` on PORT 8080
when nothing already answers there (so a leftover labels.service still works during
the transition). Desk extension keeps calling http://127.0.0.1:8080/api/print-ro.

Do not mix this into the pirate idle overlay. Re-sync from label-connect when
print/layout changes land there (scripts/sync-labels-vendor.sh).
EOF

echo "Synced Labels vendor from $SRC ($COMMIT, v$VERSION) → $DEST"
