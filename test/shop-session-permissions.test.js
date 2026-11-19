"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  shopSessionPermissionAllowed,
  SHOP_SESSION_PERMISSIONS,
} = require("../src/shop-session-permissions");

test("shop session allows loopback for Labels Print and denies LAN", () => {
  assert.equal(shopSessionPermissionAllowed("loopback-network"), true);
  assert.equal(shopSessionPermissionAllowed("local-network-access"), true);
  assert.equal(shopSessionPermissionAllowed("local-network"), false);
  assert.equal(shopSessionPermissionAllowed("geolocation"), false);
  assert.equal(shopSessionPermissionAllowed("notifications"), true);
  assert.ok(SHOP_SESSION_PERMISSIONS.has("loopback-network"));
});

test("main wires shop session permission helpers", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  assert.match(source, /shopSessionPermissionAllowed/);
  assert.match(source, /setPermissionRequestHandler/);
  assert.match(source, /setPermissionCheckHandler/);
});
