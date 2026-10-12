"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  sessionFilePath,
  sessionDir,
  readSession,
  writeSession,
  clearSession,
  sessionFingerprint,
  extractPersonPin,
  ensureSessionDir,
} = require("../src/shared-session");

function tempEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-shared-session-"));
  return { XDG_DATA_HOME: root, root };
}

test("extractPersonPin reads widget and site unlock shapes", () => {
  assert.deepEqual(
    extractPersonPin(JSON.stringify({ person: "Logan", pin: "1234" })),
    { person: "logan", pin: "1234" },
  );
  assert.deepEqual(
    extractPersonPin(JSON.stringify({ data: { person: "steve", pin: "9999" } })),
    { person: "steve", pin: "9999" },
  );
  assert.equal(extractPersonPin("{"), null);
  assert.equal(extractPersonPin(JSON.stringify({ person: "logan" })), null);
});

test("write/read/clear session uses mode-safe shared path", () => {
  const env = tempEnv();
  const file = sessionFilePath(env);
  assert.equal(file, path.join(env.XDG_DATA_HOME, "blackforest-tools", "widget-session.json"));
  ensureSessionDir(env);
  const dirStat = fs.statSync(sessionDir(env));
  assert.equal(dirStat.mode & 0o777, 0o700);

  writeSession(
    {
      token: "tok",
      expiresAt: "2099-01-01T00:00:00.000Z",
      person: "logan",
      role: "desk",
      loginAt: "2026-10-12T00:00:00.000Z",
    },
    env,
  );
  const fileStat = fs.statSync(file);
  assert.equal(fileStat.mode & 0o777, 0o600);
  const got = readSession(env);
  assert.equal(got.token, "tok");
  assert.equal(got.person, "logan");
  assert.equal(
    sessionFingerprint(got),
    "3:2099-01-01T00:00:00.000Z:logan:desk",
  );
  clearSession(env);
  assert.equal(readSession(env), null);
  fs.rmSync(env.root, { recursive: true, force: true });
});

test("readSession treats expired sessions as missing", () => {
  const env = tempEnv();
  writeSession(
    {
      token: "tok",
      expiresAt: "2000-01-01T00:00:00.000Z",
      person: "logan",
      role: "desk",
    },
    env,
  );
  assert.equal(readSession(env), null);
  fs.rmSync(env.root, { recursive: true, force: true });
});
