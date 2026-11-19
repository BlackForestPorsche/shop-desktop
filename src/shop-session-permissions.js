"use strict";

/**
 * Permissions the shop BrowserWindow may grant.
 *
 * Labels Print posts to http://127.0.0.1:8080 from the HTTPS shop origin.
 * Chromium Local Network Access asks for loopback-network (and the legacy
 * local-network-access alias). Denying those makes GET /api/printer sometimes
 * still work while POST /api/print fails with a network TypeError.
 *
 * Do not allow local-network (LAN) — only loopback for the desk Labels service.
 */

const SHOP_SESSION_PERMISSIONS = new Set([
  "notifications",
  "clipboard-read",
  "clipboard-sanitized-write",
  "fullscreen",
  "loopback-network",
  "local-network-access",
]);

function shopSessionPermissionAllowed(permission) {
  return SHOP_SESSION_PERMISSIONS.has(String(permission || ""));
}

module.exports = {
  SHOP_SESSION_PERMISSIONS,
  shopSessionPermissionAllowed,
};
