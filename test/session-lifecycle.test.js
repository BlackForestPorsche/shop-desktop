"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SESSION_VANISH_SETTLE_MS,
  classifySessionVanish,
  classifyGateRemoval,
  isLockHourExpiry,
  sessionTimerAction,
} = require("../src/session-lifecycle");
const { refreshWidgetSession } = require("../src/shared-session");

const NOW = Date.parse("2026-10-15T18:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

test("a vanished session past its expiry is expiry, not a lock", () => {
  assert.equal(classifySessionVanish({ token: "t", expiresAt: iso(NOW - 1000) }, NOW), "expired");
  assert.equal(classifySessionVanish({ token: "t", expiresAt: iso(NOW + 60_000) }, NOW), "cleared");
  assert.equal(classifySessionVanish(null, NOW), "cleared");
  assert.ok(SESSION_VANISH_SETTLE_MS > 0);
});

test("a gate that merely ran out is renewed; deliberate removals and 8pm stay locks", () => {
  const sec = (ms) => ms / 1000;
  const noon = Date.parse("2026-10-15T19:00:00.000Z"); // 12:00 PDT
  const eightPm = Date.parse("2026-10-16T03:00:00.000Z"); // 20:00 PDT
  assert.equal(classifyGateRemoval("expired", sec(noon), noon + 1000), "expired");
  assert.equal(classifyGateRemoval("expired", sec(eightPm), eightPm + 500), "lock");
  assert.equal(classifyGateRemoval("explicit", sec(noon), noon), "lock");
  assert.equal(classifyGateRemoval("expired_overwrite", sec(noon), noon), "lock");
  assert.equal(classifyGateRemoval("expired", sec(noon + 3_600_000), noon), "lock");
  assert.equal(classifyGateRemoval("expired", undefined, noon), "lock");
  assert.equal(isLockHourExpiry(eightPm), true);
  assert.equal(isLockHourExpiry(noon), false);
});

test("timer renews a session near expiry but never while locked or busy", () => {
  const nearEnd = { token: "t", expiresAt: iso(NOW + 10 * 60_000), loginAt: iso(NOW - 3_600_000) };
  const fresh = { token: "t", expiresAt: iso(NOW + 6 * 3_600_000), loginAt: iso(NOW) };
  assert.equal(sessionTimerAction({ session: nearEnd, nowMs: NOW }), "renew");
  assert.equal(sessionTimerAction({ session: fresh, nowMs: NOW }), "none");
  assert.equal(sessionTimerAction({ session: nearEnd, nowMs: NOW, locked: true }), "none");
  assert.equal(sessionTimerAction({ session: nearEnd, nowMs: NOW, busy: true }), "none");
  assert.equal(sessionTimerAction({ session: null, nowMs: NOW }), "none");
});

function fakeRes(status, body) {
  return { status, headers: new Headers(), text: async () => JSON.stringify(body), json: async () => body };
}

test("refreshWidgetSession returns the rotated Bearer without writing it", async () => {
  let seen;
  const next = await refreshWidgetSession(
    { token: "old", person: "logan", role: "desk", loginAt: "2026-10-15T08:00:00.000Z" },
    async (url, init) => {
      seen = { url, init };
      return fakeRes(200, { token: "new", expiresAt: "2099-01-01T00:00:00.000Z", person: "Logan" });
    },
  );
  assert.match(seen.url, /\/api\/widget\/session\/refresh$/);
  assert.equal(seen.init.headers.Authorization, "Bearer old");
  assert.equal(next.token, "new");
  assert.equal(next.person, "logan");
  assert.equal(next.loginAt, "2026-10-15T08:00:00.000Z");
});

test("refreshWidgetSession maps rejections to stable codes", async () => {
  const cur = { token: "old" };
  await assert.rejects(refreshWidgetSession(cur, async () => fakeRes(401, {})), { code: "unauthorized" });
  await assert.rejects(refreshWidgetSession(cur, async () => fakeRes(429, {})), { code: "rate_limited" });
  await assert.rejects(refreshWidgetSession(cur, async () => fakeRes(500, {})), { code: "refresh_failed" });
  await assert.rejects(
    refreshWidgetSession(cur, async () => {
      throw new Error("down");
    }),
    { code: "network" },
  );
  await assert.rejects(refreshWidgetSession(null), { code: "no_token" });
});
