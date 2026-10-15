"use strict";

const { isSessionExpired, shouldRefreshToken } = require("./widget-helpers");

/**
 * A Bearer session that runs out of time is not a lock. Only an intentional lock
 * (menu, SPA Lock, Desk DELETE /v1/lock) may latch Tools; natural expiry must renew
 * quietly while the website gate is still good.
 */

/** Wait this long before treating a vanished widget-session.json as a lock. */
const SESSION_VANISH_SETTLE_MS = 1_500;

/**
 * widget-session.json disappeared. "expired" when the last live session was already
 * past expiresAt (purge by Desk bridge / refresh timer), otherwise "cleared".
 */
function classifySessionVanish(previous, nowMs = Date.now()) {
  if (previous && previous.expiresAt && isSessionExpired(previous, nowMs, 0)) {
    return "expired";
  }
  return "cleared";
}

const LOCK_TIME_ZONE = "America/Los_Angeles";
const LOCK_HOUR = 20;

/** True when `ms` is the site's 8pm shop-time lock boundary (the gate's own expiry), +/- 90s. */
function isLockHourExpiry(ms) {
  if (!Number.isFinite(ms)) {
    return false;
  }
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCK_TIME_ZONE,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });
  for (const delta of [0, 90_000, -90_000]) {
    const parts = fmt.formatToParts(new Date(ms + delta));
    const hour = Number(parts.find((p) => p.type === "hour").value);
    const minute = Number(parts.find((p) => p.type === "minute").value);
    if (hour === LOCK_HOUR && minute === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Why did bf_shop_gate leave the jar?
 * - "expired": the cookie simply ran out (its expiry was the Bearer's, not the 8pm lock) — renew it.
 * - "lock": anything deliberate (explicit/expired_overwrite/overwrite/evicted keep the old
 *   present-check; 8pm expiry is the real lock).
 */
function classifyGateRemoval(cause, expirationDateSec, nowMs = Date.now()) {
  if (String(cause || "").toLowerCase() !== "expired") {
    return "lock";
  }
  const expMs = Number(expirationDateSec) * 1000;
  if (!Number.isFinite(expMs) || expMs > nowMs + 5_000) {
    return "lock";
  }
  return isLockHourExpiry(expMs) ? "lock" : "expired";
}

function sessionTimerAction({
  session = null,
  nowMs = Date.now(),
  locked = false,
  busy = false,
} = {}) {
  if (locked || busy || !session || !session.token) {
    return "none";
  }
  return shouldRefreshToken(session, nowMs) ? "renew" : "none";
}

module.exports = {
  SESSION_VANISH_SETTLE_MS,
  classifySessionVanish,
  classifyGateRemoval,
  isLockHourExpiry,
  sessionTimerAction,
};
