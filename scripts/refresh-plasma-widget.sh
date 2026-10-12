#!/usr/bin/env bash
# Button-triggered: pull shop-desktop and reinstall the Plasma widget.
# Same path as the 30-minute timer, but always reports status (notify-send).
# No background loop — call this on demand only.
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export PATH

NOTIFY=1
FORCE_REINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --quiet) NOTIFY=0 ;;
    --force) FORCE_REINSTALL=1 ;;
  esac
done

notify() {
  local summary="$1"
  local body="${2:-}"
  if [[ "$NOTIFY" -eq 0 ]]; then
    printf '%s\n' "$summary${body:+ — $body}"
    return 0
  fi
  if command -v notify-send >/dev/null 2>&1; then
    notify-send -a "Black Forest Shop" -u low "$summary" "$body" 2>/dev/null || true
  else
    printf '%s\n' "$summary${body:+ — $body}"
  fi
}

if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  notify "Widget update failed" "shop-desktop is not a git checkout."
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
fi

CHANGED=0
if [[ -n "$PULL_REF" ]]; then
  if git merge --ff-only "$PULL_REF" >/dev/null 2>&1; then
    NEW="$(git rev-parse HEAD)"
    if [[ "$OLD" != "$NEW" ]]; then
      CHANGED=1
    fi
  elif [[ "$FORCE_REINSTALL" -eq 0 ]]; then
    notify "Widget update skipped" "Local changes blocked a fast-forward."
    exit 0
  fi
elif [[ "$FORCE_REINSTALL" -eq 0 ]]; then
  notify "Widget update skipped" "No upstream for $BRANCH yet."
  exit 0
fi

if [[ "$CHANGED" -eq 1 || "$FORCE_REINSTALL" -eq 1 ]]; then
  bash "$ROOT/scripts/install-plasma-widget.sh" --skip-timer --skip-desk
  if systemctl --user is-active plasma-plasmashell.service >/dev/null 2>&1; then
    systemctl --user restart plasma-plasmashell.service
  fi
  if [[ "$CHANGED" -eq 1 ]]; then
    notify "Shop widget updated" "Pulled $(git rev-parse --short HEAD) and reinstalled the plasmoid."
  else
    notify "Shop widget reinstalled" "Plasmoid files refreshed from this checkout."
  fi
else
  notify "Shop widget up to date" "No new commits on $BRANCH."
fi
