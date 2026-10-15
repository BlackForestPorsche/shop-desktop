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

test("idle overlay dismisses on click only — not mousemove or hover", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "shell-chrome.js"), "utf8");
  assert.match(source, /function onSoftActivity/);
  assert.match(source, /function onDismissClick/);
  assert.match(source, /if \(fleet\.length\) return;/);
  assert.match(source, /Click to return to the shop/);
  // Soft activity must include move events but must not dismiss.
  assert.match(source, /"mousemove"/);
  assert.match(source, /"pointermove"/);
  assert.match(source, /dismissEvents = \["click", "auxclick"\]/);
  // Old "any input dismisses" path must be gone.
  assert.equal(/function onActivity\(\)/.test(source), false);
  assert.equal(/Move the mouse or press a key/.test(source), false);
});

test("idle overlay sails, sinks, and respawns toward the idle target", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "shell-chrome.js"), "utf8");
  assert.match(source, /stepShipSail/);
  assert.match(source, /applyCannonHit/);
  assert.match(source, /shipsCollide/);
  assert.match(source, /stepShipSink/);
  assert.match(source, /syncFleet\(\)/);
});

test("preload wires BF_IDLE_MS into mountShellChrome", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");
  assert.match(source, /resolveIdleIntervalMs/);
  assert.match(source, /BF_IDLE_MS/);
  assert.match(source, /idleIntervalMs:/);
});
