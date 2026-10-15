"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  readLatch,
  setLatch,
  clearLatch,
  sessionId,
  acceptsPublish,
  latchPath,
} = require("../src/lock-latch");

function tmpEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-latch-"));
  return { XDG_DATA_HOME: dir };
}

test("no latch file means unlocked", () => {
  const env = tmpEnv();
  assert.equal(readLatch(env), null);
  assert.equal(acceptsPublish(readLatch(env), { token: "x" }), true);
});

test("latch survives a reread (restart) and has no expiry", () => {
  const env = tmpEnv();
  setLatch({ source: "lock", revokedSessionId: "aaa", now: 1 }, env);
  const again = readLatch(env);
  assert.equal(again.locked, true);
  assert.equal(again.at, 1);
  assert.deepEqual(again.revoked, ["aaa"]);
  assert.ok(fs.existsSync(latchPath(env)));
});

test("repeat locks keep the first timestamp and collect revoked Bearers", () => {
  const env = tmpEnv();
  setLatch({ revokedSessionId: "a", now: 10 }, env);
  setLatch({ revokedSessionId: "b", now: 20 }, env);
  setLatch({ revokedSessionId: "b", now: 30 }, env);
  const latch = readLatch(env);
  assert.equal(latch.at, 10);
  assert.deepEqual(latch.revoked, ["a", "b"]);
});

test("publish of a revoked Bearer is refused, a new Bearer is accepted", () => {
  const env = tmpEnv();
  const old = { token: "old-token" };
  setLatch({ revokedSessionId: sessionId(old) }, env);
  const latch = readLatch(env);
  assert.equal(acceptsPublish(latch, old), false);
  assert.equal(acceptsPublish(latch, { token: "fresh-token" }), true);
  assert.equal(acceptsPublish(latch, {}), false);
});

test("clearLatch is the only way back to unlocked", () => {
  const env = tmpEnv();
  setLatch({ source: "lock" }, env);
  assert.equal(clearLatch(env), true);
  assert.equal(readLatch(env), null);
  assert.equal(clearLatch(env), true);
});
