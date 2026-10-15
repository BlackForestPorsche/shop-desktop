"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { sessionDir } = require("./shared-session");
const { renameWithRetry } = require("./fs-atomic");

const FILE_NAME = "lock-latch.json";
const MAX_REVOKED = 8;

/**
 * Sticky lock: set by every intentional lock (Tools Lock, website Lock via Desk,
 * session file removed) and cleared only by an intentional unlock (PIN in Tools,
 * a new Bearer from website unlock / Plasma). It is persisted so a Tools restart
 * does not forget it, and it never expires on a timer.
 */

function latchPath(env = process.env) {
  return path.join(sessionDir(env), FILE_NAME);
}

function sessionId(session) {
  if (!session || !session.token) {
    return "";
  }
  return crypto.createHash("sha256").update(String(session.token)).digest("hex").slice(0, 16);
}

function tokenId(token) {
  return sessionId({ token });
}

function readLatch(env = process.env) {
  try {
    const raw = fs.readFileSync(latchPath(env), "utf8");
    const data = JSON.parse(raw);
    if (!data || data.locked !== true) {
      return null;
    }
    return {
      locked: true,
      at: Number(data.at) || 0,
      source: String(data.source || ""),
      revoked: Array.isArray(data.revoked) ? data.revoked.map(String).filter(Boolean) : [],
    };
  } catch {
    return null;
  }
}

function writeLatch(latch, env = process.env) {
  const file = latchPath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(latch), { mode: 0o600 });
  renameWithRetry(tmp, file);
}

/** Record an intentional lock. `revokedSessionId` is the Bearer that was just revoked. */
function setLatch({ source = "lock", revokedSessionId = "", now = Date.now() } = {}, env = process.env) {
  const previous = readLatch(env);
  const revoked = [...(previous ? previous.revoked : [])];
  if (revokedSessionId && !revoked.includes(revokedSessionId)) {
    revoked.push(revokedSessionId);
  }
  const next = {
    locked: true,
    at: previous && previous.at ? previous.at : now,
    source: String(source || "lock"),
    revoked: revoked.slice(-MAX_REVOKED),
  };
  try {
    writeLatch(next, env);
  } catch {
    // Memory copy in main.js still holds the lock for this run.
  }
  return next;
}

function clearLatch(env = process.env) {
  try {
    fs.unlinkSync(latchPath(env));
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      return false;
    }
  }
  return true;
}

/**
 * A publish (POST /v1/widget-session) may only break the latch with a Bearer that
 * was not revoked by a lock. A stale Desk copy of the locked Bearer is refused.
 */
function acceptsPublish(latch, session) {
  if (!latch || !latch.locked) {
    return true;
  }
  const id = sessionId(session);
  if (!id) {
    return false;
  }
  return !latch.revoked.includes(id);
}

module.exports = {
  FILE_NAME,
  latchPath,
  sessionId,
  tokenId,
  readLatch,
  setLatch,
  clearLatch,
  acceptsPublish,
};
