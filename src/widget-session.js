"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  parseSessionJson,
  isSessionExpired,
} = require("./widget-helpers");
const { widgetSessionDir, widgetSessionFile } = require("./widget-session-path");
const { renameWithRetry } = require("./fs-atomic");

function ensureSessionDir(dir = widgetSessionDir()) {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // Best-effort on filesystems that ignore mode.
    }
  }
}

function readSession(file = widgetSessionFile()) {
  try {
    const text = fs.readFileSync(file, "utf8");
    const session = parseSessionJson(text);
    if (!session) return null;
    if (isSessionExpired(session, Date.now(), 0)) return null;
    return session;
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    return null;
  }
}

function writeSession(session, file = widgetSessionFile()) {
  if (!session || !session.token || !session.expiresAt) {
    throw new Error("Session needs token and expiresAt");
  }
  const dir = path.dirname(file);
  ensureSessionDir(dir);
  const payload = JSON.stringify({
    token: session.token,
    expiresAt: session.expiresAt,
    person: session.person || "",
    role: session.role || "",
    loginAt: session.loginAt || new Date().toISOString(),
  });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, payload, { encoding: "utf8", mode: 0o600 });
  renameWithRetry(tmp, file);
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Best-effort.
    }
  }
}

function clearSession(file = widgetSessionFile()) {
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error && error.code !== "ENOENT") throw error;
  }
}

module.exports = {
  widgetSessionDir,
  widgetSessionFile,
  ensureSessionDir,
  readSession,
  writeSession,
  clearSession,
};
