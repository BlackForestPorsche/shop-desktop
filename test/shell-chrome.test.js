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
  // Overlay-on keeps running even if document.hidden flaps; otherwise appActive.
  assert.match(source, /function idleRunning\(\)/);
  assert.match(source, /if \(overlay\.classList\.contains\("on"\)\) return true;/);
  assert.match(source, /return appActive;/);
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

test("idle overlay caps ambient FPS and promotes its compositor layer", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "shell-chrome.js"), "utf8");
  assert.match(source, /AMBIENT_FRAME_MS = 1000 \/ 30/);
  assert.match(source, /mode === "ambient" && lastFrame && t - lastFrame < AMBIENT_FRAME_MS/);
  assert.match(source, /transform: translateZ\(0\)/);
  assert.match(source, /backface-visibility: hidden/);
});

test("Settings launch starts combat through preload IPC without changing idle rules", () => {
  const chrome = fs.readFileSync(path.join(__dirname, "..", "src", "shell-chrome.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  assert.match(chrome, /function launchGame\(\)/);
  assert.match(chrome, /takeCommand\(flagship\)/);
  assert.match(preload, /ipcRenderer\.on\("shell:launch-pirate"/);
  assert.match(main, /wc\.send\("shell:launch-pirate"\)|webContents\.send\("shell:launch-pirate"\)/);
  // No visible in-page launcher and no change to the ambient hint / dismiss rules.
  assert.equal(/Launch pirate game/.test(chrome), false);
  assert.match(chrome, /HINT_AMBIENT = "Click to return to the shop"/);
  assert.match(chrome, /dismissEvents = \["click", "auxclick"\]/);
});

test("Launch pirate never silently no-ops: status IPC, recovery, visibility flaps", () => {
  const chrome = fs.readFileSync(path.join(__dirname, "..", "src", "shell-chrome.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");

  // Returns { ok, reason } and reports status — no empty stub launchGame.
  assert.match(chrome, /return \{ ok: false, reason: "canvas-2d-unavailable" \}/);
  assert.match(chrome, /reportStatus\("launch-aborted"/);
  assert.match(chrome, /cleared-failed-latch/);
  assert.match(chrome, /function isOverlayVisible/);
  assert.match(chrome, /function refreshLayout/);
  // Full-size host pinned in CSS pixels (0×0 clipped when a shop transform creates a containing block).
  assert.match(chrome, /pinHostToViewport/);
  assert.match(chrome, /100vw/);
  assert.equal(/width: "0"/.test(chrome), false);
  // launch-ok / overlay-not-visible come from preload after paint (not sync in launchGame).
  assert.match(preload, /overlay-not-visible/);
  assert.match(preload, /launch-ok/);
  // document.hidden must not block Settings launch or an already-shown overlay.
  assert.match(chrome, /Force wake: document\.hidden must not block/);
  assert.match(chrome, /Keep the pirate overlay alive across Windows visibility flaps/);
  assert.match(chrome, /if \(overlay\.classList\.contains\("on"\)\) \{\s*appActive = true;/);
  // Idle spawn shares the recovery path.
  assert.match(chrome, /idle-spawn-aborted/);
  assert.match(chrome, /idle-recovered/);

  assert.match(preload, /shell:pirate-status/);
  assert.match(preload, /reportPirateStatus/);
  assert.match(preload, /chrome-not-mounted/);
  assert.match(preload, /onStatus:/);
  assert.match(preload, /isOverlayVisible/);

  assert.match(main, /async function launchPirateFromSettings/);
  assert.match(main, /pirate: menu-click/);
  assert.match(main, /pirate: launch-requested/);
  assert.match(main, /pirate: launch-aborted/);
  assert.match(main, /pirate: in-page-failed/);
  assert.match(main, /no-renderer-ack/);
  assert.match(main, /Could not open the pirate game/);
  assert.match(main, /shell:pirate-status/);
  assert.match(main, /tryPirateShellOverlay/);
  assert.match(main, /attachPirateShellOverlay/);
  assert.match(main, /openPirateGameWindow/);
  assert.match(main, /tryDedicatedPirateWindow/);
  assert.match(main, /last-resort dedicated window/);
  // Must use console.log/warn so teeConsole writes tools.log (info was missing).
  assert.match(main, /console\.log\("pirate: menu-click"\)/);
  assert.match(main, /console\.log\("pirate: launch-requested from-settings"\)/);
  // Host is pinned in CSS pixels on documentElement (not % alone).
  assert.match(chrome, /pinHostToViewport/);
  assert.match(chrome, /ensureHostAttached/);
  assert.match(chrome, /refreshLayout/);
  assert.match(preload, /afterPaint/);
  assert.match(preload, /dismissOverlay/);
});

test("pirate shell overlay preferred over dedicated window", () => {
  const root = path.join(__dirname, "..");
  assert.ok(fs.existsSync(path.join(root, "assets", "pirate-game.html")));
  assert.ok(fs.existsSync(path.join(root, "src", "pirate-preload.js")));
  assert.ok(fs.existsSync(path.join(root, "src", "pirate-window.js")));
  const pirateWindow = fs.readFileSync(path.join(root, "src", "pirate-window.js"), "utf8");
  const piratePreload = fs.readFileSync(path.join(root, "src", "pirate-preload.js"), "utf8");
  const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
  assert.match(pirateWindow, /function attachPirateShellOverlay/);
  assert.match(pirateWindow, /function openPirateGameWindow/);
  assert.match(pirateWindow, /pirate-game\.html/);
  assert.match(pirateWindow, /pirate-preload\.js/);
  assert.match(pirateWindow, /WebContentsView/);
  assert.match(piratePreload, /mountShellChrome/);
  assert.match(piratePreload, /launchOnly:\s*true/);
  assert.match(piratePreload, /shell:pirate-overlay-close/);
  assert.match(piratePreload, /shell:pirate-relaunch/);
  // Launch order: in-page → shell overlay → dedicated window last.
  const inPageAt = main.indexOf("tryInPagePirateLaunch");
  const shellAt = main.indexOf("tryPirateShellOverlay");
  const dedicatedAt = main.indexOf("tryDedicatedPirateWindow");
  assert.ok(inPageAt > 0 && shellAt > inPageAt && dedicatedAt > shellAt);
});

test("package version is 1.5.26 for brand icon and silent Windows update", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.equal(pkg.version, "1.5.26");
});
