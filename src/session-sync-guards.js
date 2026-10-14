"use strict";

/**
 * Decisions for Tools shared-login sync so gate cookie /unlock auto-exchange
 * cannot fight lock-clear or re-enter exchange→reload storms.
 */

/**
 * Gate cookie SET in the Electron jar.
 * Return false while exchange/mint/lock is in flight — Set-Cookie from exchange
 * must not call syncToolsSpaAfterUnlock (force from-gate + force exchange + reload).
 */
function shouldHandleGateCookieSet({
  exchangingGate = false,
  mintingWidgetSession = false,
  applyingRemoteLock = false,
  localLockUntil = 0,
  now = Date.now(),
} = {}) {
  if (exchangingGate || mintingWidgetSession || applyingRemoteLock) {
    return false;
  }
  if (now < localLockUntil) {
    return false;
  }
  return true;
}

/**
 * Auto-exchange while the SPA URL is still /unlock.
 * - "skip": busy, locked, or no shared Bearer
 * - "leave": gate already in jar — navigate home, do not force-exchange again
 * - "exchange": mint gate from Bearer (debounced by caller)
 */
function unlockAutoExchangeAction({
  url = "",
  exchangingGate = false,
  mintingWidgetSession = false,
  applyingRemoteLock = false,
  localLockUntil = 0,
  now = Date.now(),
  hasSession = false,
  gatePresent = false,
} = {}) {
  if (!url || !String(url).includes("/unlock")) {
    return "skip";
  }
  if (applyingRemoteLock || exchangingGate || mintingWidgetSession) {
    return "skip";
  }
  // SPA Lock / menu Lock shop just cleared the jar — do not mint a new gate.
  if (now < localLockUntil) {
    return "skip";
  }
  if (!hasSession) {
    return "skip";
  }
  if (gatePresent) {
    return "leave";
  }
  return "exchange";
}

module.exports = {
  shouldHandleGateCookieSet,
  unlockAutoExchangeAction,
};
