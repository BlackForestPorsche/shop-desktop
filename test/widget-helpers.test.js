"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizePerson,
  parseSessionJson,
  isSessionExpired,
  shouldRefreshToken,
  classifyWidgetHttpError,
} = require("../src/widget-helpers");

test("normalizePerson lowercases and trims", () => {
  assert.equal(normalizePerson(" Logan "), "logan");
  assert.equal(normalizePerson(""), "");
});

test("parseSessionJson requires token and expiresAt", () => {
  assert.equal(parseSessionJson(""), null);
  assert.equal(parseSessionJson("{"), null);
  assert.equal(parseSessionJson(JSON.stringify({ token: "t" })), null);
  const ok = parseSessionJson(
    JSON.stringify({
      token: "t",
      expiresAt: "2026-10-10T00:00:00.000Z",
      person: "logan",
      role: "tech",
    }),
  );
  assert.equal(ok.token, "t");
  assert.equal(ok.person, "logan");
  assert.equal(ok.role, "tech");
});

test("isSessionExpired respects skew", () => {
  const now = Date.parse("2026-10-09T12:00:00.000Z");
  assert.equal(
    isSessionExpired(
      { expiresAt: "2026-10-09T12:00:30.000Z" },
      now,
      60_000,
    ),
    true,
  );
  assert.equal(
    isSessionExpired(
      { expiresAt: "2026-10-09T12:05:00.000Z" },
      now,
      60_000,
    ),
    false,
  );
});

test("shouldRefreshToken when under 30 minutes remain and within 12h login", () => {
  const now = Date.parse("2026-10-09T12:00:00.000Z");
  assert.equal(
    shouldRefreshToken(
      {
        token: "t",
        expiresAt: "2026-10-09T12:20:00.000Z",
        loginAt: "2026-10-09T04:00:00.000Z",
      },
      now,
    ),
    true,
  );
  assert.equal(
    shouldRefreshToken(
      {
        token: "t",
        expiresAt: "2026-10-09T13:00:00.000Z",
        loginAt: "2026-10-09T04:00:00.000Z",
      },
      now,
    ),
    false,
  );
  assert.equal(
    shouldRefreshToken(
      {
        token: "t",
        expiresAt: "2026-10-09T12:20:00.000Z",
        loginAt: "2026-10-09T00:00:00.000Z",
      },
      now,
    ),
    false,
  );
});

test("classifyWidgetHttpError covers auth and rate limit cases", () => {
  assert.equal(classifyWidgetHttpError(401).code, "unauthorized");
  assert.equal(
    classifyWidgetHttpError(403, { error: "pin_change_required" }).code,
    "pin_change_required",
  );
  assert.equal(classifyWidgetHttpError(403, { error: "nope" }).code, "forbidden");
  assert.deepEqual(classifyWidgetHttpError(429, null, "45"), {
    code: "rate_limited",
    retryAfter: 45,
  });
  assert.equal(classifyWidgetHttpError(404).code, "not_found");
});
