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
  // Live shop Lock (beta 0.1.36+): TanStack hashes the serverFn — no "lockShop" in URL/body.
  if (
    /\/_serverFn\/462df016712e9460dba3b3206037fe5482e55863b0e6af87f8c2b89dff89fc9a\b/i.test(
      String(url || ""),
    )
  ) {
    return true;
  }
  return /lockShop|clearGateSession/i.test(hay);
}

module.exports = {
  looksLikeLockRequest,
};
