"use strict";

/**
 * Loopback HTTP bridge so Black Forest Desk (Firefox/Chromium extension) can
 * share the widget Bearer with Tools / Plasma without re-typing the desk PIN.
 *
 * Binds 127.0.0.1 only. Never logs the token.
 *
 * GET  /v1/widget-session  — Desk imports Tools/Plasma session
 * POST /v1/widget-session  — Desk (or site capture) publishes token into the shared file
 */

const http = require("node:http");
const { readSession, writeSession } = require("./shared-session");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8788;
const PATH_HEALTH = "/health";
const PATH_SESSION = "/v1/widget-session";

function bridgePort(env = process.env) {
  const raw = env.BLACKFOREST_DESK_BRIDGE_PORT || env.BF_DESK_BRIDGE_PORT;
  const n = raw ? Number.parseInt(String(raw), 10) : DEFAULT_PORT;
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

function bridgeHost(env = process.env) {
  const host = String(env.BLACKFOREST_DESK_BRIDGE_HOST || DEFAULT_HOST).trim();
  // Refuse non-loopback binds — this endpoint returns a Bearer token.
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    return DEFAULT_HOST;
  }
  return host === "localhost" ? "127.0.0.1" : host;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
  });
  res.end(payload);
}

function sessionPayload(session) {
  if (!session || !session.token) {
    return null;
  }
  return {
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    person: session.person || "",
    role: session.role || "",
    source: "blackforest-tools",
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 32_768) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function parsePublishBody(text) {
  let data;
  try {
    data = JSON.parse(text || "{}");
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") {
    return null;
  }
  const token = data.token || data.widgetToken || data.accessToken || data.bearer;
  const expiresAt = data.expiresAt || data.widgetExpiresAt;
  if (!token || !expiresAt) {
    return null;
  }
  return {
    token: String(token),
    expiresAt: String(expiresAt),
    person: data.person ? String(data.person).trim().toLowerCase() : "",
    role: data.role ? String(data.role) : "",
    loginAt: new Date().toISOString(),
  };
}

/**
 * @param {{
 *   readSession?: typeof readSession,
 *   writeSession?: typeof writeSession,
 *   host?: string,
 *   port?: number,
 *   onPublished?: (session: object) => void,
 * }} [opts]
 */
function startDeskSessionBridge(opts = {}) {
  const read = opts.readSession || readSession;
  const write = opts.writeSession || writeSession;
  const host = opts.host || bridgeHost();
  const port = opts.port != null ? opts.port : bridgePort();

  const server = http.createServer((req, res) => {
    const method = req.method || "GET";
    if (method === "OPTIONS") {
      json(res, 204, {});
      return;
    }

    let pathname = "/";
    try {
      pathname = new URL(req.url || "/", `http://${host}:${port}`).pathname;
    } catch {
      json(res, 400, { ok: false, error: "bad_request" });
      return;
    }

    if (pathname === PATH_HEALTH || pathname === "/") {
      if (method !== "GET") {
        json(res, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      const session = read();
      json(res, 200, {
        ok: true,
        service: "blackforest-tools-desk-bridge",
        hasSession: Boolean(session && session.token),
        person: session && session.person ? session.person : "",
      });
      return;
    }

    if (pathname === PATH_SESSION) {
      if (method === "GET") {
        const payload = sessionPayload(read());
        if (!payload) {
          json(res, 404, {
            ok: false,
            error: "no_session",
            message: "Unlock Black Forest Tools, Plasma, Desk, or the shop site first.",
          });
          return;
        }
        json(res, 200, payload);
        return;
      }

      if (method === "POST") {
        readBody(req)
          .then((text) => {
            const next = parsePublishBody(text);
            if (!next) {
              json(res, 400, {
                ok: false,
                error: "bad_request",
                message: "Body needs token + expiresAt (or widgetToken + widgetExpiresAt).",
              });
              return;
            }
            try {
              write(next);
              if (typeof opts.onPublished === "function") {
                opts.onPublished(next);
              }
              json(res, 200, {
                ok: true,
                person: next.person,
                role: next.role,
                expiresAt: next.expiresAt,
              });
            } catch (error) {
              json(res, 500, {
                ok: false,
                error: "write_failed",
                message: error instanceof Error ? error.message : "write failed",
              });
            }
          })
          .catch(() => {
            json(res, 400, { ok: false, error: "bad_request" });
          });
        return;
      }

      json(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }

    json(res, 404, { ok: false, error: "not_found" });
  });

  server.listen(port, host);

  return {
    server,
    host,
    port,
    close() {
      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  PATH_HEALTH,
  PATH_SESSION,
  bridgeHost,
  bridgePort,
  startDeskSessionBridge,
  sessionPayload,
  parsePublishBody,
};
