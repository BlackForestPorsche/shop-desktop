"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  shouldHandleGateCookieSet,
  unlockAutoExchangeAction,
} = require("../src/session-sync-guards");

test("shouldHandleGateCookieSet blocks during exchange/mint/lock and lock cooldown", () => {
  assert.equal(shouldHandleGateCookieSet({}), true);
  assert.equal(shouldHandleGateCookieSet({ exchangingGate: true }), false);
  assert.equal(shouldHandleGateCookieSet({ mintingWidgetSession: true }), false);
  assert.equal(shouldHandleGateCookieSet({ applyingRemoteLock: true }), false);
  assert.equal(
    shouldHandleGateCookieSet({ localLockUntil: 1000, now: 500 }),
    false,
  );
  assert.equal(
    shouldHandleGateCookieSet({ localLockUntil: 1000, now: 1000 }),
    true,
  );
});

test("unlockAutoExchangeAction prefers leave when gate already present", () => {
  assert.equal(unlockAutoExchangeAction({ url: "https://shop/x" }), "skip");
  assert.equal(
    unlockAutoExchangeAction({
      url: "https://shop.blackforestautomotive.com/unlock",
      hasSession: true,
      gatePresent: true,
    }),
    "leave",
  );
  assert.equal(
    unlockAutoExchangeAction({
      url: "https://shop.blackforestautomotive.com/unlock",
      hasSession: true,
      gatePresent: false,
    }),
    "exchange",
  );
  assert.equal(
    unlockAutoExchangeAction({
      url: "https://shop.blackforestautomotive.com/unlock",
      hasSession: true,
      localLockUntil: 2000,
      now: 1000,
    }),
    "skip",
  );
  assert.equal(
    unlockAutoExchangeAction({
      url: "https://shop.blackforestautomotive.com/unlock",
      hasSession: true,
      exchangingGate: true,
    }),
    "skip",
  );
});
