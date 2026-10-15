#!/usr/bin/env bash
# Launch the Black Forest Tools window from a git checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELECTRON="$ROOT/node_modules/electron/dist/electron"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/blackforest-tools"
LOG_FILE="$LOG_DIR/launch.log"
PENDING_NPM="$ROOT/.bf-pending-npm"

mkdir -p "$LOG_DIR"

notify_fail() {
  local msg=$1
  echo "$msg" | tee -a "$LOG_FILE" >&2
  if command -v zenity >/dev/null 2>&1; then
    zenity --error --title="Black Forest Tools" --text="$msg" --width=420 2>/dev/null || true
  elif command -v kdialog >/dev/null 2>&1; then
    kdialog --error "$msg" 2>/dev/null || true
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send -u critical "Black Forest Tools" "$msg" 2>/dev/null || true
  fi
}

{
  echo "---- $(date -Is) ----"
  echo "ROOT=$ROOT"
  echo "USER=$USER"
  echo "DISPLAY=${DISPLAY:-}"
  echo "WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-}"
  echo "XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-}"
} >>"$LOG_FILE"

# After Settings → Update and restart: git pull already ran inside Electron; npm
# install waits until this launcher runs so the live binary is not overwritten.
if [[ -f "$PENDING_NPM" ]]; then
  {
    echo "Pending post-update npm install..."
    unset ELECTRON_SKIP_BINARY_DOWNLOAD || true
    unset ELECTRON_RUN_AS_NODE || true
    unset npm_config_platform || true
    unset npm_config_arch || true
    cd "$ROOT"
    if ! npm install; then
      echo "npm install after update failed"
      exit 1
    fi
    rm -f "$PENDING_NPM"
  } >>"$LOG_FILE" 2>&1 || {
    tail_lines="$(tail -n 12 "$LOG_FILE" 2>/dev/null || true)"
    notify_fail "Could not finish the desktop app update (npm install).\n\ncd ~/shop-desktop\nnpm install\nbash scripts/ensure-electron.sh\n\nLog: $LOG_FILE\n\n$tail_lines"
    exit 1
  }
fi

if ! bash "$ROOT/scripts/ensure-electron.sh" >>"$LOG_FILE" 2>&1; then
  tail_lines="$(tail -n 12 "$LOG_FILE" 2>/dev/null || true)"
  notify_fail "Could not download the window runtime. Open a terminal and run:\n\ncd ~/shop-desktop\nbash scripts/ensure-electron.sh\n\nLog: $LOG_FILE\n\n$tail_lines"
  exit 1
fi

cd "$ROOT"
set +e
"$ELECTRON" "$ROOT" "$@" >>"$LOG_FILE" 2>&1
status=$?
set -e

if [[ $status -ne 0 ]]; then
  notify_fail "Black Forest Tools quit on start (exit $status).\n\nIn a terminal run:\ncd ~/shop-desktop && npm start\n\nLog: $LOG_FILE"
  exit "$status"
fi
