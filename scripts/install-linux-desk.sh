#!/usr/bin/env bash
# Black Forest Tools — Linux desk install (Manjaro / Arch)
set -euo pipefail
REPO_URL="${REPO_URL:-https://github.com/BlackForestPorsche/shop-desktop.git}"
INSTALL_ROOT="${INSTALL_ROOT:-$HOME/shop-desktop}"
BRANCH="${BRANCH:-main}"
echo "Black Forest Tools — Linux install"
echo "Target: $INSTALL_ROOT"
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing $1. On Manjaro: sudo pacman -S nodejs npm git" >&2; exit 1; }; }
need git; need npm
if [[ -d "$INSTALL_ROOT/.git" ]]; then
  echo "Updating existing checkout..."
  git -C "$INSTALL_ROOT" fetch --quiet origin "$BRANCH"
  git -C "$INSTALL_ROOT" checkout "$BRANCH" >/dev/null 2>&1 || true
  git -C "$INSTALL_ROOT" merge --ff-only "origin/$BRANCH" || echo "Could not fast-forward; continuing."
elif [[ -e "$INSTALL_ROOT" ]]; then
  echo "$INSTALL_ROOT exists but is not a git checkout." >&2; exit 1
else
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$INSTALL_ROOT"
fi
cd "$INSTALL_ROOT"
npm install
# install-menu enables login autostart by default (pass --no-autostart to skip).
if [[ "${NO_AUTOSTART:-0}" == "1" ]]; then
  npm run install-menu -- --no-autostart
else
  npm run install-menu
fi
echo
echo "Done. Open Black Forest Tools from the menu, or: blackforest-tools"
echo "It will also start at login (disable: bash scripts/disable-tools-autostart.sh)."
echo "Optional Plasma widget: cd \"$INSTALL_ROOT\" && npm run install-plasma"
