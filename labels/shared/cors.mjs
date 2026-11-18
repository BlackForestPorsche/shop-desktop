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

/**
 * Shop-site Labels page (layout editor + print) talks to this desk service.
 * Create RO real prints stay on Desk (same machine, no shop Origin needed).
 * Lock/gate never goes through this server.
 */
export function corsAllowed(origin, method, pathname, query, env = process.env) {
  if (!shopOrigins(env).has(origin)) return false;
  const read = method === "GET" || method === "OPTIONS";
  const write = method === "POST" || method === "PUT" || method === "OPTIONS";
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