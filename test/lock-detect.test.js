"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { looksLikeLockRequest } = require("../src/lock-detect");

test("looksLikeLockRequest matches lockShop and widget logout", () => {
  assert.equal(
    looksLikeLockRequest(
      "https://shop.blackforestautomotive.com/_serverFn/lockShop",
      "POST",
      "{}",
    ),
    true,
  );
  assert.equal(
    looksLikeLockRequest(
      "https://shop.blackforestautomotive.com/api/widget/logout",
      "POST",
      "",
    ),
    true,
  );
  assert.equal(looksLikeLockRequest("/_server/lockShop", "POST", ""), true);
});

test("looksLikeLockRequest rejects unlock and session mint/exchange", () => {
  assert.equal(
    looksLikeLockRequest(
      "https://shop.blackforestautomotive.com/_serverFn/unlockShop",
      "POST",
      JSON.stringify({ person: "logan", pin: "7895" }),
    ),
    false,
  );
  assert.equal(
    looksLikeLockRequest(
      "https://shop.blackforestautomotive.com/api/widget/session/exchange",
      "POST",
      "{}",
    ),
    false,
  );
  assert.equal(
    looksLikeLockRequest(
      "https://shop.blackforestautomotive.com/api/widget/session",
      "POST",
      JSON.stringify({ person: "logan", pin: "7895" }),
    ),
    false,
  );
  assert.equal(looksLikeLockRequest("/unlock", "GET", ""), false);
});
