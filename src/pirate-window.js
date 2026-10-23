"use strict";

/**
 * Dedicated BrowserWindow for Settings → Launch pirate.
 * Used when the in-page overlay path fails or reports an invisible overlay —
 * so Launch always does something visible (especially on flaky Windows desks).
 */

const path = require("node:path");

const PIRATE_HTML = path.join(__dirname, "..", "assets", "pirate-game.html");
const PIRATE_PRELOAD = path.join(__dirname, "pirate-preload.js");
const ICON_PATH = path.join(__dirname, "..", "assets", "icon.png");

/**
 * @param {{
 *   BrowserWindow: typeof import("electron").BrowserWindow,
 *   parent?: import("electron").BrowserWindow | null,
 *   existing?: import("electron").BrowserWindow | null,
 * }} options
 * @returns {{ ok: boolean, reason: string, window: import("electron").BrowserWindow | null }}
 */
function openPirateGameWindow(options) {
  const BrowserWindow = options.BrowserWindow;
  if (!BrowserWindow) {
    return { ok: false, reason: "no-BrowserWindow", window: null };
  }

  const existing = options.existing;
  if (existing && !existing.isDestroyed()) {
    try {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      // Re-run launch in the existing window.
      existing.webContents.send("shell:pirate-relaunch");
    } catch {
      // fall through to recreate
    }
    if (!existing.isDestroyed()) {
      return { ok: true, reason: "focused-existing", window: existing };
    }
  }

  let win;
  try {
    win = new BrowserWindow({
      width: 1100,
      height: 720,
      minWidth: 640,
      minHeight: 480,
      show: false,
      title: "Pirate — Black Forest Tools",
      backgroundColor: "#0b0f14",
      autoHideMenuBar: true,
      icon: ICON_PATH,
      parent: options.parent && !options.parent.isDestroyed() ? options.parent : undefined,
      webPreferences: {
        preload: PIRATE_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
  } catch (error) {
    return {
      ok: false,
      reason: error && error.message ? error.message : "create-failed",
      window: null,
    };
  }

  win.once("ready-to-show", () => {
    try {
      if (!win.isDestroyed()) {
        win.show();
        win.focus();
      }
    } catch {
      // ignore
    }
  });
  setTimeout(() => {
    try {
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    } catch {
      // ignore
    }
  }, 4_000);

  win.loadFile(PIRATE_HTML).catch(() => {
    // Caller / status IPC will surface failure if chrome never boots.
  });

  return { ok: true, reason: "opened", window: win };
}

module.exports = {
  openPirateGameWindow,
  PIRATE_HTML,
  PIRATE_PRELOAD,
};
