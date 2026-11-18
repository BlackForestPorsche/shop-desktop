"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

async function loadCors() {
  const file = path.join(__dirname, "..", "labels", "shared", "cors.mjs");
  return import(pathToFileURL(file).href);
}

const SHOP = "https://shop.blackforestautomotive.com";

test("shop origin may use Labels editor APIs", async () => {
  const { corsAllowed } = await loadCors();
  const q = new URLSearchParams();
  assert.equal(corsAllowed(SHOP, "GET", "/api/printer", q), true);
  assert.equal(corsAllowed(SHOP, "GET", "/api/qr", q), true);
  assert.equal(corsAllowed(SHOP, "GET", "/api/labels", q), true);
  assert.equal(corsAllowed(SHOP, "PUT", "/api/labels", q), true);
  assert.equal(corsAllowed(SHOP, "POST", "/api/print", q), true);
  assert.equal(corsAllowed(SHOP, "OPTIONS", "/api/print", q), true);
});

test("Create RO real print stays off the shop origin", async () => {
  const { corsAllowed } = await loadCors();
  const dry = new URLSearchParams({ dryRun: "1" });
  const live = new URLSearchParams();
  assert.equal(corsAllowed(SHOP, "POST", "/api/print-ro", dry), true);
  assert.equal(corsAllowed(SHOP, "POST", "/api/print-ro", live), false);
  assert.equal(corsAllowed("https://evil.example", "GET", "/api/printer", live), false);
});
