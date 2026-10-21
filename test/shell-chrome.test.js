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
  // Blur may only release held game keys; it must never gate the idle clock.
  for (const m of source.matchAll(/addEventListener\("blur", (\w+)\)/g)) {
    assert.equal(m[1], "clearHeldInput");
  }
  assert.match(source, /function idleRunning\(\) \{\s*return appActive( && !failed)?;/);
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
  assert.match(source, /overlay\.addEventListener\(name, onOverlayClick\)/);
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

test("combat is opt-in: ambient idle shows no play UI and a ship click takes the helm", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "shell-chrome.js"), "utf8");
  // Ambient hint is unchanged; the HUD, cards and wreck panel start hidden.
  assert.match(source, /HINT_AMBIENT = "Click to return to the shop"/);
  assert.match(source, /<div class="hud" hidden>/);
  assert.match(source, /<div class="cards cond" hidden>/);
  assert.match(source, /<div class="wreck" hidden>/);
  assert.equal(/Play|Start game|Join the fight/i.test(HINT_FROM(source, "HINT_AMBIENT")), false);
  // Take the helm only from a click on a ship; empty water still dismisses.
  assert.match(source, /const ship = e\.type === "click" && e\.button === 0 \? shipAt/);
  assert.match(source, /takeCommand\(ship\)/);
  assert.match(source, /if \(mode === "play"\) return;/);
  // Game input goes through pointerdown, never the dismiss click path.
  assert.match(source, /overlay\.addEventListener\("pointerdown", onOverlayPointerDown\)/);
  // The idle spawner only runs for the screensaver.
  assert.match(source, /mode !== "ambient"\) return;/);
});

test("combat leaves Labels and the DYMO print path alone", () => {
  for (const file of ["shell-chrome.js", "idle-combat.js", "idle-fx.js", "idle-art.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");
    assert.equal(/dymo|labels-server|label-connect/i.test(source), false, file);
  }
});

function HINT_FROM(source, name) {
  const m = new RegExp(`${name} = "([^"]*)"`).exec(source);
  return m ? m[1] : "";
}

test("Settings launch starts combat through preload IPC without changing idle rules", () => {
  const chrome = fs.readFileSync(path.join(__dirname, "..", "src", "shell-chrome.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  assert.match(chrome, /function launchGame\(\)/);
  assert.match(chrome, /takeCommand\(flagship\)/);
  assert.match(preload, /ipcRenderer\.on\("shell:launch-pirate"/);
  assert.match(main, /webContents\.send\("shell:launch-pirate"\)/);
  // No visible in-page launcher and no change to the ambient hint / dismiss rules.
  assert.equal(/Launch pirate game/.test(chrome), false);
  assert.match(chrome, /HINT_AMBIENT = "Click to return to the shop"/);
  assert.match(chrome, /dismissEvents = \["click", "auxclick"\]/);
});
