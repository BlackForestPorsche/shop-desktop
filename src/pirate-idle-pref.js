"use strict";

/**
 * Pirate idle overlay preference (Settings checkbox).
 * Prefs live in userData (pirate-idle-overlay.json). Default ON so desks that
 * already like the screensaver keep it. Manual Launch pirate is separate.
 */

const fs = require("node:fs");
const path = require("node:path");

const PREFS_NAME = "pirate-idle-overlay.json";

function prefsPath(userDataDir) {
  return path.join(String(userDataDir || ""), PREFS_NAME);
}

/** Default true — missing / unreadable file means keep current idle behavior. */
function readPirateIdleEnabled(userDataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsPath(userDataDir), "utf8"));
    if (raw && Object.prototype.hasOwnProperty.call(raw, "enabled")) {
      return Boolean(raw.enabled);
    }
  } catch {
    // Missing file or bad JSON → default on.
  }
  return true;
}

function writePirateIdleEnabled(userDataDir, enabled) {
  const dir = String(userDataDir || "");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    prefsPath(dir),
    `${JSON.stringify({ enabled: Boolean(enabled) }, null, 2)}\n`,
    "utf8",
  );
}

function createPirateIdlePref({ userDataDir, readEnabled, writeEnabled } = {}) {
  let enabled =
    typeof readEnabled === "function"
      ? Boolean(readEnabled())
      : readPirateIdleEnabled(userDataDir);

  return {
    isEnabled() {
      return enabled;
    },
    setEnabled(next) {
      enabled = Boolean(next);
      if (typeof writeEnabled === "function") {
        writeEnabled(enabled);
      } else if (userDataDir) {
        writePirateIdleEnabled(userDataDir, enabled);
      }
      return enabled;
    },
  };
}

module.exports = {
  PREFS_NAME,
  prefsPath,
  readPirateIdleEnabled,
  writePirateIdleEnabled,
  createPirateIdlePref,
};
