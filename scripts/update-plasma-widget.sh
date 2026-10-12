#!/usr/bin/env bash
# Pull shop-desktop from GitHub and reinstall the Plasma widget when HEAD moved.
# Same idea as Pro Circuit's update.sh (ff-only pull + package update + plasmashell restart).
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"

if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "shop-desktop is not a git checkout; cannot auto-update the widget." >&2
  exit 1
fi

cd "$ROOT"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
OLD="$(git rev-parse HEAD)"
PULL_REF=""

if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
  git fetch --quiet
  PULL_REF="@{u}"
elif git fetch --quiet origin "$BRANCH" 2>/dev/null; then
  PULL_REF="origin/$BRANCH"
elif git fetch --quiet origin main 2>/dev/null && [[ "$BRANCH" == "main" ]]; then
  PULL_REF="origin/main"
else
  echo "No upstream for $BRANCH; skipping widget update." >&2
  exit 0
fi

if ! git merge --ff-only "$PULL_REF" >/dev/null 2>&1; then
  echo "Could not fast-forward $BRANCH (local changes?). Skipping widget update." >&2
  exit 0
fi
NEW="$(git rev-parse HEAD)"

if [[ "$OLD" == "$NEW" ]]; then
  exit 0
fi

bash "$ROOT/scripts/install-plasma-widget.sh" --skip-timer --skip-desk

# Reload Plasma so lot/notes QML picks up the new files (same as Pro Circuit).
if systemctl --user is-active plasma-plasmashell.service >/dev/null 2>&1; then
  systemctl --user restart plasma-plasmashell.service
fi
