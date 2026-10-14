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
 * - "leave": gate already healed this session — navigate home (no re-exchange)
 * - "exchange": mint/refresh gate from Bearer (debounced by caller)
 *
 * gatePresent alone is not enough: a stale/half-applied bf_shop_gate makes
 * leave→home bounce back to /unlock while Desk still has a live Bearer.
 * When gatePresent && !exchangedThisSession → exchange once (probe/heal).
 * After a successful exchange this session, leave is safe.
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
  exchangedThisSession = false,
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
    // Probe/heal once before leave — do not trust jar presence alone.
    if (!exchangedThisSession) {
      return "exchange";
    }
    return "leave";
  }
  return "exchange";
}

/**
 * New shared Bearer from Desk/website unlock must clear local_lock before exchange.
 * Otherwise file-watch / publish races return reason "local_lock" and Tools stays on /unlock.
 */
function shouldClearLocalLockOnSharedPublish({
  previousFingerprint = "",
  nextFingerprint = "",
} = {}) {
  return Boolean(nextFingerprint && nextFingerprint !== previousFingerprint);
}

module.exports = {
  shouldHandleGateCookieSet,
  unlockAutoExchangeAction,
  shouldClearLocalLockOnSharedPublish,
};
