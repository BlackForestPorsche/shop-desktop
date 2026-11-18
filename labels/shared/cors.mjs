export const SHOP_ORIGINS = new Set(["https://shop.blackforestautomotive.com"]);

/**
 * Shop-site Labels page (layout editor + print) talks to this desk service.
 * Create RO real prints stay on Desk (same machine, no shop Origin needed).
 * Lock/gate never goes through this server.
 */
export function corsAllowed(origin, method, pathname, query) {
  if (!SHOP_ORIGINS.has(origin)) return false;
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
