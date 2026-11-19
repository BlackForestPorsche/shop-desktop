/** Production shop origins allowed to call the desk Labels HTTP API from the browser. */
export const SHOP_ORIGINS = new Set([
  "https://shop.blackforestautomotive.com",
  "https://www.shop.blackforestautomotive.com",
]);

/** Extra allowlist from the desk (comma- or space-separated full origins). */
export function shopOrigins(env = process.env) {
  const out = new Set(SHOP_ORIGINS);
  const raw = String(env.LABELS_CORS_ORIGINS || "").trim();
  if (!raw) return out;
  for (const piece of raw.split(/[\s,]+/)) {
    const origin = piece.trim();
    if (origin) out.add(origin);
  }
  return out;
}

/** Desk (Chrome / Firefox) backgrounds send these Origins on Create RO print. */
export function isDeskExtensionOrigin(origin) {
  const value = String(origin || "");
  return /^chrome-extension:\/\//i.test(value) || /^moz-extension:\/\//i.test(value);
}

/**
 * Shop-site Labels page (layout editor + print) talks to this desk service.
 * Live Create RO print is Desk only (chrome-extension:// / moz-extension://).
 * Shop may dry-run /api/print-ro; real print stays off the shop Origin.
 * Lock/gate never goes through this server.
 */
export function corsAllowed(origin, method, pathname, query, env = process.env) {
  const read = method === "GET" || method === "OPTIONS";
  const write = method === "POST" || method === "PUT" || method === "OPTIONS";

  // Tools 1.5.42 hardened non-shop POST to 403. Desk still posts live Create RO
  // with an extension Origin — allow that path only (not shop live print-ro).
  if (isDeskExtensionOrigin(origin)) {
    if (pathname === "/api/print-ro") return write;
    return false;
  }

  if (!shopOrigins(env).has(origin)) return false;
  if (pathname === "/api/printer") return read;
  if (pathname === "/api/qr") return read;
  if (pathname === "/api/labels") return read || method === "PUT" || method === "OPTIONS";
  if (pathname === "/api/print") return write;
  if (pathname === "/api/print-ro") {
    const dry = query.get("dryRun") === "1" || query.get("dryRun") === "true";
    return dry && (method === "POST" || method === "OPTIONS");
  }
  return false;
}

/** Whether this server build allows the shop origin to POST layout prints. */
export function shopPrintCorsEnabled(env = process.env) {
  const q = new URLSearchParams();
  for (const origin of shopOrigins(env)) {
    if (corsAllowed(origin, "POST", "/api/print", q, env)) return true;
  }
  return false;
}