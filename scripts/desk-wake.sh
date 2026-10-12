#!/usr/bin/env bash
# Oneshot after graphical login: start anything that should be up, leave running things alone.
# Quiet when everything is already fine. No polling loop.
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export PATH

PLASMOID_ID="com.blackforestautomotive.shop"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
PLASMOID_DEST="$DATA_HOME/plasma/plasmoids/$PLASMOID_ID"
SESSION_HELPER="$HOME/.local/bin/blackforest-widget-session"
SESSION_DIR="$DATA_HOME/blackforest-tools"
ACTIONS=0

log() {
  # Only speak when we actually did something.
  printf '%s\n' "$*"
  ACTIONS=$((ACTIONS + 1))
}

have_systemctl() {
  command -v systemctl >/dev/null 2>&1
}

ensure_user_unit_running() {
  local unit="$1"
  have_systemctl || return 0
  if ! systemctl --user cat "$unit" >/dev/null 2>&1; then
    return 0
  fi
  if systemctl --user is-active --quiet "$unit"; then
    return 0
  fi
  if systemctl --user start "$unit" >/dev/null 2>&1; then
    log "Started $unit"
  else
    log "Could not start $unit"
  fi
}

ensure_user_timer() {
  local timer="$1"
  have_systemctl || return 0
  if ! systemctl --user cat "$timer" >/dev/null 2>&1; then
    return 0
  fi
  local enabled=0 active=0
  systemctl --user is-enabled --quiet "$timer" 2>/dev/null && enabled=1 || true
  systemctl --user is-active --quiet "$timer" 2>/dev/null && active=1 || true
  if [[ "$enabled" -eq 1 && "$active" -eq 1 ]]; then
    return 0
  fi
  if systemctl --user enable --now "$timer" >/dev/null 2>&1; then
    log "Enabled $timer"
  else
    log "Could not enable $timer"
  fi
}

# 1) Cursor agent worker — restart only if down. Never stop it as cleanup.
ensure_user_unit_running "agent-worker.service"

# 2) Shop plasmoid + session helper (idempotent; skip heavy reinstall when present).
if [[ ! -x "$SESSION_HELPER" || ! -f "$PLASMOID_DEST/metadata.json" ]]; then
  if [[ -x "$ROOT/scripts/install-plasma-widget.sh" ]]; then
    bash "$ROOT/scripts/install-plasma-widget.sh" --skip-timer --skip-desk >/dev/null 2>&1 || true
    log "Reinstalled shop Plasma widget / session helper"
  fi
fi
mkdir -p "$SESSION_DIR"
chmod 700 "$SESSION_DIR" 2>/dev/null || true

# Keep the existing 30-minute shop widget timer armed if the unit exists.
ensure_user_timer "blackforest-shop-widget-update.timer"

# 3) Pro Circuit auto-update — verify/restart only; do not change its schedule.
ensure_user_timer "pro-circuit-update.timer"

if [[ "$ACTIONS" -eq 0 ]]; then
  exit 0
fi
if command -v notify-send >/dev/null 2>&1; then
  notify-send -a "Black Forest" -u low "Desk wake" "Brought $ACTIONS shop desk item(s) back up." 2>/dev/null || true
fi
