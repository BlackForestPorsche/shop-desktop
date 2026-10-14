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
  exchangeWidgetSession,
  requestFirefoxHandoff,
  extractUnlockWidgetSession,
  peekSession,
  purgeExpiredSession,
  mintWidgetSessionFromGate,
  SHOP_BASE,
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
  assert.equal(peekSession(env)?.person, "logan");
  assert.equal(purgeExpiredSession(env), true);
  assert.equal(peekSession(env), null);
  assert.equal(purgeExpiredSession(env), false);
  fs.rmSync(env.root, { recursive: true, force: true });
});

test("mintWidgetSessionFromGate writes shared session from shop gate", async () => {
  const env = tempEnv();
  const prev = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = env.XDG_DATA_HOME;
  try {
    const next = await mintWidgetSessionFromGate(async (url, init) => {
      assert.equal(url, `${SHOP_BASE}/api/widget/session/from-gate`);
      assert.equal(init.method, "POST");
      return {
        status: 200,
        async json() {
          return {
            token: "from-gate-tok",
            expiresAt: "2099-01-01T00:00:00.000Z",
            person: "Logan",
            role: "desk",
          };
        },
      };
    });
    assert.equal(next.token, "from-gate-tok");
    assert.equal(readSession()?.person, "logan");
  } finally {
    if (prev === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prev;
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test("extractUnlockWidgetSession reads desk unlock widgetToken fields", () => {
  const got = extractUnlockWidgetSession(
    JSON.stringify({
      ok: true,
      person: "Logan",
      role: "desk",
      widgetToken: "wt-1",
      widgetExpiresAt: "2099-01-01T00:00:00.000Z",
    }),
  );
  assert.equal(got.token, "wt-1");
  assert.equal(got.expiresAt, "2099-01-01T00:00:00.000Z");
  assert.equal(got.person, "logan");
  assert.equal(got.role, "desk");
  assert.ok(got.loginAt);
  // Viewers / Dwight: no widgetToken and no token
  assert.equal(
    extractUnlockWidgetSession(JSON.stringify({ ok: true, person: "dwight", role: "viewer" })),
    null,
  );
  // token+expiresAt+person (widget mint / unlock without widgetToken alias)
  const minted = extractUnlockWidgetSession(
    JSON.stringify({
      token: "minted-tok",
      expiresAt: "2099-01-01T00:00:00.000Z",
      person: "logan",
      role: "desk",
    }),
  );
  assert.equal(minted.token, "minted-tok");
  assert.equal(minted.person, "logan");
  // Bare token without person/role/ok — ignore (unrelated API)
  assert.equal(
    extractUnlockWidgetSession(JSON.stringify({ token: "not-enough", expiresAt: "2099-01-01T00:00:00.000Z" })),
    null,
  );
});

test("exchangeWidgetSession posts Bearer and maps contract statuses", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      status: 200,
      async json() {
        return {
          ok: true,
          person: "logan",
          role: "desk",
          expiresAt: "2099-01-01T00:00:00.000Z",
        };
      },
    };
  };
  const got = await exchangeWidgetSession("tok", fetchImpl);
  assert.equal(calls[0].url, `${SHOP_BASE}/api/widget/session/exchange`);
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.equal(got.ok, true);
  assert.equal(got.person, "logan");

  await assert.rejects(
    () =>
      exchangeWidgetSession("tok", async () => ({
        status: 401,
        async json() {
          return { error: "unauthorized" };
        },
      })),
    (err) => err && err.code === "unauthorized" && err.status === 401,
  );
});

test("requestFirefoxHandoff returns shop URL and rejects off-host urls", async () => {
  const good = await requestFirefoxHandoff("tok", async () => ({
    status: 200,
    async json() {
      return { url: `${SHOP_BASE}/api/widget/session/handoff/abc` };
    },
  }));
  assert.equal(good.url, `${SHOP_BASE}/api/widget/session/handoff/abc`);

  await assert.rejects(
    () =>
      requestFirefoxHandoff("tok", async () => ({
        status: 200,
        async json() {
          return { url: "https://evil.example/steal" };
        },
      })),
    (err) => err && err.code === "handoff_bad_url",
  );

  await assert.rejects(
    () =>
      requestFirefoxHandoff("tok", async () => ({
        status: 429,
        async json() {
          return { error: "rate_limited" };
        },
      })),
    (err) => err && err.code === "rate_limited",
  );
});
