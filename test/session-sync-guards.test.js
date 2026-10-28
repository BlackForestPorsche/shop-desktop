"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  shouldHandleGateCookieSet,
  shouldMintAfterLeavingUnlock,
  unlockAutoExchangeAction,
  shouldClearLocalLockOnSharedPublish,
  shouldPollSharedSession,
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

test("unlockAutoExchangeAction exchanges once before leave when gate present", () => {
  assert.equal(unlockAutoExchangeAction({ url: "https://shop/x" }), "skip");
  // Stale/half-applied gate: probe with exchange before leave.
  assert.equal(
    unlockAutoExchangeAction({
      url: "https://shop.blackforestautomotive.com/unlock",
      hasSession: true,
      gatePresent: true,
      exchangedThisSession: false,
    }),
    "exchange",
  );
  // After a successful exchange this session, leave home (no re-exchange storm).
  assert.equal(
    unlockAutoExchangeAction({
      url: "https://shop.blackforestautomotive.com/unlock",
      hasSession: true,
      gatePresent: true,
      exchangedThisSession: true,
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

test("shouldClearLocalLockOnSharedPublish when Bearer fingerprint changes", () => {
  assert.equal(shouldClearLocalLockOnSharedPublish({}), false);
  assert.equal(
    shouldClearLocalLockOnSharedPublish({
      previousFingerprint: "",
      nextFingerprint: "tok|exp",
    }),
    true,
  );
  assert.equal(
    shouldClearLocalLockOnSharedPublish({
      previousFingerprint: "old",
      nextFingerprint: "new",
    }),
    true,
  );
  assert.equal(
    shouldClearLocalLockOnSharedPublish({
      previousFingerprint: "same",
      nextFingerprint: "same",
    }),
    false,
  );
});

test("shouldMintAfterLeavingUnlock mints Bearer after a PIN unlock, even inside the lock cooldown", () => {
  const base = {
    url: "https://shop.blackforestautomotive.com/",
    gatePresent: true,
    hasSession: false,
  };
  assert.equal(shouldMintAfterLeavingUnlock(base), true);
  assert.equal(shouldMintAfterLeavingUnlock({ ...base, url: "https://shop.blackforestautomotive.com/unlock" }), false);
  assert.equal(shouldMintAfterLeavingUnlock({ ...base, hasSession: true }), false);
  assert.equal(shouldMintAfterLeavingUnlock({ ...base, gatePresent: false }), false);
  assert.equal(shouldMintAfterLeavingUnlock({ ...base, isShopUrl: false }), false);
  assert.equal(shouldMintAfterLeavingUnlock({ ...base, applyingRemoteLock: true }), false);
  assert.equal(shouldMintAfterLeavingUnlock({ ...base, exchangingGate: true }), false);
  assert.equal(shouldMintAfterLeavingUnlock({ ...base, mintingWidgetSession: true }), false);
});

test("shouldPollSharedSession covers Linux inotify misses and a failed watch", () => {
  assert.equal(shouldPollSharedSession({ platform: "linux" }), true);
  assert.equal(shouldPollSharedSession({ platform: "win32" }), false);
  assert.equal(shouldPollSharedSession({ platform: "win32", watchFailed: true }), true);
});
