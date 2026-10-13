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

test("shell chrome idle clock does not require window focus", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "shell-chrome.js"), "utf8");
  assert.equal(/windowFocused/.test(source), false);
  assert.equal(/addEventListener\("blur"/.test(source), false);
  assert.match(source, /function idleRunning\(\) \{\s*return appActive;/);
});

test("preload wires BF_IDLE_MS into mountShellChrome", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");
  assert.match(source, /resolveIdleIntervalMs/);
  assert.match(source, /BF_IDLE_MS/);
  assert.match(source, /idleIntervalMs:/);
});
