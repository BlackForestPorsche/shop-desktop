"use strict";

/**
 * Loopback HTTP bridge so Black Forest Desk (Firefox/Chromium extension) can
 * share the widget Bearer with Tools / Plasma without re-typing the desk PIN.
 *
 * Binds 127.0.0.1 only. Never logs the token.
 *
 * GET    /v1/widget-session  — Desk imports Tools/Plasma session
 * POST   /v1/widget-session  — Desk (or site capture) publishes token into the shared file
 * DELETE /v1/widget-session  — website/Desk lock → clear shared Bearer (+ Tools SPA via onLock)
 * POST   /v1/lock            — same as DELETE (explicit lock alias)
 */

const http = require("node:http");
const {
  readSession,
  writeSession,
  peekSession,
  sessionIsExpired,
  purgeExpiredSession,
  clearSession,
} = require("./shared-session");
const { sessionId } = require("./lock-latch");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8788;
const PATH_HEALTH = "/health";
const PATH_SESSION = "/v1/widget-session";
const PATH_LOCK = "/v1/lock";
const HEALTH_REMINT_MS = 4_000;

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
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

function missMeta(peek) {
  const stale = typeof peek === "function" ? peek() : peekSession();
  const expired = sessionIsExpired(stale);
  return {
    sessionExpired: expired,
    person: stale && stale.person ? stale.person : "",
    hint: expired ? "bridge_up_session_expired" : "bridge_up_no_session",
    message: expired
      ? "Tools session expired — unlock Tools again (or Use shop session / desk PIN in Desk)."
      : "Tools is running, but has no shared Bearer yet. Re-unlock Tools with your desk PIN, or unlock the shop site in this Firefox profile.",
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
 *   peekSession?: typeof peekSession,
 *   host?: string,
 *   port?: number,
 *   onPublished?: (session: object) => void,
 *   onSessionMiss?: (info: { sessionExpired: boolean }) => void | Promise<void>,
 *   onLock?: (info: { source: string }) => void | Promise<void>,
 *   clearSession?: typeof clearSession,
 *   acceptPublish?: (session: object) => boolean,
 *   lockInfo?: () => { locked: boolean, lockedAt: number },
 * }} [opts]
 */
function startDeskSessionBridge(opts = {}) {
  const read = opts.readSession || readSession;
  const write = opts.writeSession || writeSession;
  const peek = opts.peekSession || peekSession;
  const clear = opts.clearSession || clearSession;
  const host = opts.host || bridgeHost();
  const port = opts.port != null ? opts.port : bridgePort();

  function applyLock(source) {
    const existing = read();
    const had = Boolean(existing && existing.token);
    // Prefer onLock (Tools clears jar + revokes Bearer). Fallback: drop shared file only.
    const after =
      typeof opts.onLock === "function"
        ? Promise.resolve(opts.onLock({ source: source || "bridge", session: existing || null }))
        : Promise.resolve().then(() => {
            try {
              clear();
            } catch {
              // ignore
            }
          });
    return after
      .catch(() => {
        try {
          clear();
        } catch {
          // ignore
        }
      })
      .then(() => ({
        ok: true,
        locked: true,
        hadSession: had,
        source: source || "bridge",
      }));
  }

  const server = http.createServer((req, res) => {
    // Any synchronous throw here would be an uncaught exception in Tools' main process.
    try {
      handleRequest(req, res);
    } catch (error) {
      try {
        if (!res.headersSent) {
          json(res, 500, { ok: false, error: "bridge_error" });
        } else {
          res.end();
        }
      } catch {
        // socket already gone
      }
    }
  });
  server.on("clientError", (_error, socket) => {
    try {
      socket.destroy();
    } catch {
      // ignore
    }
  });

  function handleRequest(req, res) {
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
      const respondHealth = (session) => {
        const meta = session && session.token
          ? {
              hasSession: true,
              sessionExpired: false,
              person: session.person || "",
              hint: "session_ready",
            }
          : {
              hasSession: false,
              ...missMeta(peek),
            };
        json(res, 200, {
          ok: true,
          service: "blackforest-tools-desk-bridge",
          hasSession: meta.hasSession,
          sessionExpired: Boolean(meta.sessionExpired),
          person: meta.person || "",
          hint: meta.hint,
          sessionId: session && session.token ? sessionId(session) : "",
          ...(typeof opts.lockInfo === "function" ? opts.lockInfo() : {}),
        });
      };
      const session = read();
      if (session && session.token) {
        respondHealth(session);
        return;
      }
      // An expired Bearer must not read as "Tools signed out" to Desk (which would
      // clear the site gate). Give Tools one chance to re-mint from the live gate first.
      const stale = missMeta(peek);
      if (stale.sessionExpired && typeof opts.onSessionMiss === "function") {
        const bounded = Promise.race([
          Promise.resolve(opts.onSessionMiss({ sessionExpired: true })),
          new Promise((resolve) => setTimeout(resolve, HEALTH_REMINT_MS)),
        ]);
        bounded.then(
          () => respondHealth(read()),
          () => respondHealth(read()),
        );
        return;
      }
      respondHealth(session);
      return;
    }

    if (pathname === PATH_LOCK) {
      if (method !== "POST" && method !== "DELETE") {
        json(res, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      applyLock("v1-lock")
        .then((body) => json(res, 200, body))
        .catch((error) => {
          json(res, 500, {
            ok: false,
            error: "lock_failed",
            message: error instanceof Error ? error.message : "lock failed",
          });
        });
      return;
    }

    if (pathname === PATH_SESSION) {
      if (method === "GET") {
        const respondMiss = () => {
          const meta = missMeta(peek);
          // Drop stale file so health matches Desk (optional purge).
          if (meta.sessionExpired) {
            try {
              purgeExpiredSession();
            } catch {
              // ignore
            }
          }
          json(res, 404, {
            ok: false,
            error: "no_session",
            hint: meta.hint,
            sessionExpired: Boolean(meta.sessionExpired),
            message: meta.message,
          });
        };

        const payload = sessionPayload(read());
        if (payload) {
          json(res, 200, payload);
          return;
        }

        const meta = missMeta(peek);
        if (typeof opts.onSessionMiss === "function") {
          Promise.resolve(opts.onSessionMiss({ sessionExpired: Boolean(meta.sessionExpired) }))
            .then(() => {
              const retry = sessionPayload(read());
              if (retry) {
                json(res, 200, retry);
                return;
              }
              respondMiss();
            })
            .catch(() => {
              respondMiss();
            });
          return;
        }

        respondMiss();
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
            if (typeof opts.acceptPublish === "function" && !opts.acceptPublish(next)) {
              json(res, 409, {
                ok: false,
                error: "locked",
                message: "Tools is locked. Unlock with the PIN first.",
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

      if (method === "DELETE") {
        applyLock("delete-session")
          .then((body) => json(res, 200, body))
          .catch((error) => {
            json(res, 500, {
              ok: false,
              error: "lock_failed",
              message: error instanceof Error ? error.message : "lock failed",
            });
          });
        return;
      }

      json(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }

    json(res, 404, { ok: false, error: "not_found" });
  }

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
  PATH_LOCK,
  bridgeHost,
  bridgePort,
  startDeskSessionBridge,
  sessionPayload,
  parsePublishBody,
  missMeta,
};
