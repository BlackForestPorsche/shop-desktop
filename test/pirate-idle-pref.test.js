"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  PREFS_NAME,
  prefsPath,
  readPirateIdleEnabled,
  writePirateIdleEnabled,
  createPirateIdlePref,
} = require("../src/pirate-idle-pref");

test("missing pref file defaults to idle overlay ON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-pirate-idle-"));
  assert.equal(readPirateIdleEnabled(dir), true);
  assert.equal(PREFS_NAME, "pirate-idle-overlay.json");
  assert.equal(prefsPath(dir), path.join(dir, PREFS_NAME));
});

test("write and read persist enabled false and true", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-pirate-idle-"));
  writePirateIdleEnabled(dir, false);
  assert.equal(readPirateIdleEnabled(dir), false);
  const raw = JSON.parse(fs.readFileSync(prefsPath(dir), "utf8"));
  assert.equal(raw.enabled, false);
  writePirateIdleEnabled(dir, true);
  assert.equal(readPirateIdleEnabled(dir), true);
});

test("createPirateIdlePref defaults on and persists toggles", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-pirate-idle-"));
  const pref = createPirateIdlePref({ userDataDir: dir });
  assert.equal(pref.isEnabled(), true);
  pref.setEnabled(false);
  assert.equal(pref.isEnabled(), false);
  assert.equal(readPirateIdleEnabled(dir), false);
  const again = createPirateIdlePref({ userDataDir: dir });
  assert.equal(again.isEnabled(), false);
  again.setEnabled(true);
  assert.equal(readPirateIdleEnabled(dir), true);
});

test("bad JSON falls back to ON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-pirate-idle-"));
  fs.writeFileSync(prefsPath(dir), "{not-json", "utf8");
  assert.equal(readPirateIdleEnabled(dir), true);
});
