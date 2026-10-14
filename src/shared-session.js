"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  parseSessionJson,
  isSessionExpired,
} = require("./widget-helpers");

const DIR_NAME = "blackforest-tools";
const FILE_NAME = "widget-session.json";
const SHOP_BASE = "https://shop.blackforestautomotive.com";

function dataHome(env = process.env) {
  return env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
}

function sessionDir(env = process.env) {
  return path.join(dataHome(env), DIR_NAME);
}

function sessionFilePath(env = process.env) {
  return path.join(sessionDir(env), FILE_NAME);
}

function ensureSessionDir(env = process.env) {
  const dir = sessionDir(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best effort on platforms that ignore chmod.
  }
  return dir;
}

/** Raw on-disk session (may be expired). Does not delete the file. */
function peekSession(env = process.env) {
  const file = sessionFilePath(env);
  try {
    return parseSessionJson(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function sessionIsExpired(session, nowMs = Date.now()) {
  return Boolean(session && isSessionExpired(session, nowMs, 0));
}

/** Delete widget-session.json when present but past expiresAt. */
function purgeExpiredSession(env = process.env) {
  const parsed = peekSession(env);
  if (!parsed || !sessionIsExpired(parsed)) {
    return false;
  }
  clearSession(env);
  return true;
}

/** Live session only — expired files count as missing (Desk bridge → 404). */
function readSession(env = process.env) {
  const parsed = peekSession(env);
  if (!parsed || sessionIsExpired(parsed)) {
    return null;
  }
  return parsed;
}

function writeSession(session, env = process.env) {
  if (!session || !session.token || !session.expiresAt) {
    throw new Error("session requires token and expiresAt");
  }
  ensureSessionDir(env);
  const file = sessionFilePath(env);
  const payload = JSON.stringify({
    token: session.token,
    expiresAt: session.expiresAt,
    person: session.person || "",
    role: session.role || "",
    loginAt: session.loginAt || new Date().toISOString(),
  });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, payload, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort.
  }
  return file;
}

function clearSession(env = process.env) {
  const file = sessionFilePath(env);
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function sessionFingerprint(session) {
  if (!session || !session.token) {
    return "";
  }
  return `${session.token.length}:${session.expiresAt}:${session.person || ""}:${session.role || ""}`;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function parseJsonPayload(raw) {
  if (!raw) {
    return null;
  }
  if (asObject(raw)) {
    return raw;
  }
  let text = "";
  if (Buffer.isBuffer(raw)) {
    text = raw.toString("utf8");
  } else if (typeof raw === "string") {
    text = raw;
  } else {
    return null;
  }
  text = text.trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractPersonPin(raw) {
  const data = parseJsonPayload(raw);
  if (!data) {
    return null;
  }
  const person =
    data.person ||
    (data.data && data.data.person) ||
    (data.payload && data.payload.person);
  const pin =
    data.pin ||
    (data.data && data.data.pin) ||
    (data.payload && data.payload.pin);
  if (person == null || pin == null) {
    return null;
  }
  const personText = String(person).trim().toLowerCase();
  const pinText = String(pin);
  if (!personText || !pinText) {
    return null;
  }
  return { person: personText, pin: pinText };
}

/**
 * Desk unlock JSON (shop beta 0.1.25+) may include widgetToken + widgetExpiresAt.
 * Viewers/Dwight omit widgetToken. Also accept token+expiresAt from widget session mint.
 */
function extractUnlockWidgetSession(raw) {
  const data = parseJsonPayload(raw);
  if (!data) {
    return null;
  }
  const candidates = [data, asObject(data.data), asObject(data.payload), asObject(data.result)].filter(
    Boolean,
  );
  for (const obj of candidates) {
    const token = obj.widgetToken || obj.token || obj.accessToken || obj.bearer;
    const expiresAt = obj.widgetExpiresAt || obj.expiresAt;
    if (!token || !expiresAt) {
      continue;
    }
    // Avoid capturing unrelated API payloads that happen to include token fields.
    const person = obj.person ? String(obj.person).trim().toLowerCase() : "";
    const role = obj.role ? String(obj.role) : "";
    const looksUnlock = Boolean(obj.widgetToken || person || role || obj.ok === true);
    if (!looksUnlock) {
      continue;
    }
    return {
      token: String(token),
      expiresAt: String(expiresAt),
      person,
      role,
      loginAt: new Date().toISOString(),
    };
  }
  return null;
}

async function mintWidgetSession(person, pin, fetchImpl = fetch) {
  const res = await fetchImpl(`${SHOP_BASE}/api/widget/session`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ person, pin }),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status !== 200 || !body || !body.token || !body.expiresAt) {
    const err = new Error("widget_session_failed");
    err.status = res.status;
    throw err;
  }
  const next = {
    token: body.token,
    expiresAt: body.expiresAt,
    person: body.person || person,
    role: body.role || "",
    loginAt: new Date().toISOString(),
  };
  writeSession(next);
  return next;
}

async function revokeWidgetSession(token, fetchImpl = fetch) {
  if (!token) {
    clearSession();
    return;
  }
  try {
    await fetchImpl(`${SHOP_BASE}/api/widget/logout`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    // Local clear still happens.
  }
  clearSession();
}

function apiError(code, status, message) {
  const err = new Error(message || code);
  err.code = code;
  err.status = status;
  return err;
}

async function readJsonBody(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Mint a widget Bearer from an existing SPA bf_shop_gate cookie (shop beta 0.1.34+).
 * Caller should use Electron session.fetch so the gate cookie is sent.
 * Writes ~/.local/share/blackforest-tools/widget-session.json on success.
 * Fixes Tools looking unlocked (gate jar) while Desk bridge has no session file.
 */
async function mintWidgetSessionFromGate(fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(`${SHOP_BASE}/api/widget/session/from-gate`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
  } catch (error) {
    const err = apiError("network", 0, error instanceof Error ? error.message : "network");
    err.cause = error;
    throw err;
  }
  const body = await readJsonBody(res);
  if (res.status === 401 || res.status === 403) {
    throw apiError("unauthorized", res.status, "shop gate rejected");
  }
  if (res.status === 429) {
    throw apiError("rate_limited", res.status, "from-gate rate limited");
  }
  if (res.status !== 200 || !body) {
    throw apiError("from_gate_failed", res.status, `from-gate failed (HTTP ${res.status})`);
  }
  const token = body.token || body.accessToken || body.bearer || body.widgetToken;
  const expiresAt = body.expiresAt || body.widgetExpiresAt;
  if (!token || !expiresAt) {
    throw apiError("from_gate_failed", res.status, "from-gate returned no token");
  }
  const next = {
    token: String(token),
    expiresAt: String(expiresAt),
    person: body.person ? String(body.person).trim().toLowerCase() : "",
    role: body.role ? String(body.role) : "",
    loginAt: new Date().toISOString(),
  };
  writeSession(next);
  return next;
}

/**
 * Exchange a widget Bearer token for the SPA bf_shop_gate cookie (shop beta 0.1.25+).
 * Caller should use Electron session.fetch so Set-Cookie lands in the jar.
 * Cookie: Path=/, HttpOnly, Secure on HTTPS, SameSite=None on HTTPS.
 * TTL = earlier of normal shop lock and widget token remaining life.
 */
async function exchangeWidgetSession(token, fetchImpl = fetch) {
  if (!token) {
    throw apiError("no_token", 0, "no widget token");
  }
  let res;
  try {
    res = await fetchImpl(`${SHOP_BASE}/api/widget/session/exchange`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
  } catch (error) {
    const err = apiError("network", 0, error instanceof Error ? error.message : "network");
    err.cause = error;
    throw err;
  }
  const body = await readJsonBody(res);
  if (res.status === 401 || res.status === 403) {
    throw apiError("unauthorized", res.status, "widget token rejected");
  }
  if (res.status === 429) {
    throw apiError("rate_limited", res.status, "exchange rate limited");
  }
  if (res.status !== 200 || !body || body.ok !== true) {
    throw apiError("exchange_failed", res.status, `exchange failed (HTTP ${res.status})`);
  }
  return {
    ok: true,
    person: body.person || "",
    role: body.role || "",
    expiresAt: body.expiresAt || "",
  };
}

/**
 * Mint a one-time Firefox handoff URL (shop beta 0.1.25+).
 * Ticket TTL 60s, single use. Rate limit 10/min/token → 429.
 */
async function requestFirefoxHandoff(token, fetchImpl = fetch) {
  if (!token) {
    throw apiError("no_token", 0, "no widget token");
  }
  let res;
  try {
    res = await fetchImpl(`${SHOP_BASE}/api/widget/session/handoff`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
  } catch (error) {
    const err = apiError("network", 0, error instanceof Error ? error.message : "network");
    err.cause = error;
    throw err;
  }
  const body = await readJsonBody(res);
  if (res.status === 401 || res.status === 403) {
    throw apiError("unauthorized", res.status, "widget token rejected");
  }
  if (res.status === 429) {
    throw apiError("rate_limited", res.status, "handoff rate limited (10/min)");
  }
  if (res.status !== 200 || !body || typeof body.url !== "string" || !body.url) {
    throw apiError("handoff_failed", res.status, `handoff failed (HTTP ${res.status})`);
  }
  if (!body.url.startsWith(`${SHOP_BASE}/`)) {
    throw apiError("handoff_bad_url", res.status, "handoff url not on shop host");
  }
  return { url: body.url };
}

module.exports = {
  DIR_NAME,
  FILE_NAME,
  SHOP_BASE,
  dataHome,
  sessionDir,
  sessionFilePath,
  ensureSessionDir,
  peekSession,
  sessionIsExpired,
  purgeExpiredSession,
  readSession,
  writeSession,
  clearSession,
  sessionFingerprint,
  extractPersonPin,
  extractUnlockWidgetSession,
  mintWidgetSession,
  mintWidgetSessionFromGate,
  revokeWidgetSession,
  exchangeWidgetSession,
  requestFirefoxHandoff,
};
