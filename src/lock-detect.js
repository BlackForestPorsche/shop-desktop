"use strict";

/**
 * Heuristic for shop SPA lockShop / widget logout requests intercepted in preload.
 * Must not match unlockShop or session mint/exchange/handoff/from-gate.
 */
function looksLikeLockRequest(url, method, body) {
  if (String(method || "GET").toUpperCase() !== "POST") {
    return false;
  }
  const hay = `${url || ""}\n${body == null ? "" : String(body)}`;
  if (/unlockShop|widgetToken|widgetExpiresAt/i.test(hay)) {
    return false;
  }
  if (/widget\/logout/i.test(hay)) {
    return true;
  }
  if (/\/api\/widget\/session/i.test(hay)) {
    return false;
  }
  return /lockShop|clearGateSession/i.test(hay);
}

module.exports = {
  looksLikeLockRequest,
};
