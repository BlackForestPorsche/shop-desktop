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

function readSession(env = process.env) {
  const file = sessionFilePath(env);
  try {
    const text = fs.readFileSync(file, "utf8");
    const parsed = parseSessionJson(text);
    if (!parsed || isSessionExpired(parsed, Date.now(), 0)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
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

function extractPersonPin(raw) {
  if (!raw) {
    return null;
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
    const data = JSON.parse(text);
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
  } catch {
    return null;
  }
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

module.exports = {
  DIR_NAME,
  FILE_NAME,
  SHOP_BASE,
  dataHome,
  sessionDir,
  sessionFilePath,
  ensureSessionDir,
  readSession,
  writeSession,
  clearSession,
  sessionFingerprint,
  extractPersonPin,
  mintWidgetSession,
  revokeWidgetSession,
};
