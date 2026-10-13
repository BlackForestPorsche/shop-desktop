"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("shell chrome source does not inject a Check for updates header button", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "shell-chrome.js"), "utf8");
  assert.equal(/Check for updates/.test(source), false);
  assert.equal(/class="bar"/.test(source), false);
  assert.equal(/part="updates"/.test(source), false);
  assert.match(source, /Pirate idle overlay/);
});
