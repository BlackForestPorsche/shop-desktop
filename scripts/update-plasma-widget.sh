#!/usr/bin/env bash
# Pull shop-desktop from GitHub and reinstall the Plasma widget when HEAD moved.
# Same idea as Pro Circuit's update.sh (ff-only pull + package update + plasmashell restart).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLASMOID_ID="com.blackforestautomotive.shop"
PLASMOID_SRC="$ROOT/plasma/plasmoids/$PLASMOID_ID"

if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "shop-desktop is not a git checkout; cannot auto-update the widget." >&2
  exit 1
fi

BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
cd "$ROOT"
OLD="$(git rev-parse HEAD)"
git fetch --quiet origin "$BRANCH"
if ! git merge --ff-only "origin/$BRANCH" >/dev/null 2>&1; then
  echo "Could not fast-forward $BRANCH (local changes?). Skipping widget update." >&2
  exit 0
fi
NEW="$(git rev-parse HEAD)"

if [[ "$OLD" == "$NEW" ]]; then
  exit 0
fi

bash "$ROOT/scripts/install-plasma-widget.sh" --skip-timer

# Reload Plasma so lot/notes QML picks up the new files (same as Pro Circuit).
if systemctl --user is-active plasma-plasmashell.service >/dev/null 2>&1; then
  systemctl --user restart plasma-plasmashell.service
fi
