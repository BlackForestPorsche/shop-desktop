"use strict";

/**
 * Pirate game surface for Settings → Launch pirate (and recovery).
 *
 * Preferred fallback when the in-page shop overlay fails: a WebContentsView
 * (or legacy BrowserView) attached to the shop BrowserWindow — same OS window,
 * covering the content area. A separate BrowserWindow is last resort only.
 */

const path = require("node:path");

const PIRATE_HTML = path.join(__dirname, "..", "assets", "pirate-game.html");
const PIRATE_PRELOAD = path.join(__dirname, "pirate-preload.js");
const ICON_PATH = path.join(__dirname, "..", "assets", "icon.png");

/**
 * @param {import("electron").BrowserWindow} win
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function contentOverlayBounds(win) {
  try {
    const size = win.getContentSize();
    const width = Math.max(1, size[0] | 0);
    const height = Math.max(1, size[1] | 0);
    return { x: 0, y: 0, width, height };
  } catch {
    try {
      const b = win.getBounds();
      return { x: 0, y: 0, width: Math.max(1, b.width | 0), height: Math.max(1, b.height | 0) };
    } catch {
      return { x: 0, y: 0, width: 800, height: 600 };
    }
  }
}

/**
 * @param {object} view
 * @returns {boolean}
 */
function viewAlive(view) {
  if (!view) return false;
  try {
    const wc = view.webContents;
    return !!(wc && !wc.isDestroyed());
  } catch {
    return false;
  }
}

/**
 * Attach (or reuse) a pirate overlay view on the shop window.
 * @param {{
 *   parent: import("electron").BrowserWindow,
 *   WebContentsView?: typeof import("electron").WebContentsView,
 *   BrowserView?: typeof import("electron").BrowserView,
 *   existing?: { kind: string, view: object, webContents: import("electron").WebContents } | null,
 *   onResizeHook?: (fn: () => void) => void,
 * }} options
 * @returns {{
 *   ok: boolean,
 *   reason: string,
 *   handle: { kind: string, view: object, webContents: import("electron").WebContents } | null,
 * }}
 */
function attachPirateShellOverlay(options) {
  const parent = options.parent;
  if (!parent || parent.isDestroyed()) {
    return { ok: false, reason: "no-parent-window", handle: null };
  }

  const existing = options.existing;
  if (existing && viewAlive(existing.view)) {
    try {
      existing.view.setBounds(contentOverlayBounds(parent));
      existing.webContents.send("shell:pirate-relaunch");
      // Re-stack on top if the API allows.
      try {
        if (existing.kind === "web-contents-view" && parent.contentView) {
          parent.contentView.addChildView(existing.view);
        } else if (existing.kind === "browser-view" && typeof parent.addBrowserView === "function") {
          parent.addBrowserView(existing.view);
        }
      } catch {
        // ignore restack errors
      }
      return { ok: true, reason: "focused-existing-overlay", handle: existing };
    } catch (error) {
      // fall through to recreate
      try {
        detachPirateShellOverlay(parent, existing);
      } catch {
        // ignore
      }
    }
  }

  const bounds = contentOverlayBounds(parent);
  const prefs = {
    preload: PIRATE_PRELOAD,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    backgroundThrottling: false,
  };

  // Prefer WebContentsView (Electron 30+).
  if (typeof options.WebContentsView === "function" && parent.contentView) {
    try {
      const view = new options.WebContentsView({ webPreferences: prefs });
      try {
        view.setBackgroundColor("#0b0f14");
      } catch {
        // ignore
      }
      view.setBounds(bounds);
      parent.contentView.addChildView(view);
      const handle = { kind: "web-contents-view", view, webContents: view.webContents };
      view.webContents.loadFile(PIRATE_HTML).catch(() => {});
      return { ok: true, reason: "opened-shell-overlay", handle };
    } catch (error) {
      // try BrowserView next
    }
  }

  // Legacy BrowserView.
  if (typeof options.BrowserView === "function" && typeof parent.addBrowserView === "function") {
    try {
      const view = new options.BrowserView({ webPreferences: prefs });
      try {
        view.setBackgroundColor("#0b0f14");
      } catch {
        // ignore
      }
      parent.addBrowserView(view);
      view.setBounds(bounds);
      const handle = { kind: "browser-view", view, webContents: view.webContents };
      view.webContents.loadFile(PIRATE_HTML).catch(() => {});
      return { ok: true, reason: "opened-shell-overlay-browserview", handle };
    } catch (error) {
      return {
        ok: false,
        reason: error && error.message ? error.message : "shell-overlay-failed",
        handle: null,
      };
    }
  }

  return { ok: false, reason: "no-overlay-view-api", handle: null };
}

/**
 * @param {import("electron").BrowserWindow | null} parent
 * @param {{ kind: string, view: object, webContents: import("electron").WebContents } | null} handle
 */
function detachPirateShellOverlay(parent, handle) {
  if (!handle || !handle.view) return;
  try {
    if (parent && !parent.isDestroyed()) {
      if (handle.kind === "web-contents-view" && parent.contentView) {
        parent.contentView.removeChildView(handle.view);
      } else if (handle.kind === "browser-view" && typeof parent.removeBrowserView === "function") {
        parent.removeBrowserView(handle.view);
      }
    }
  } catch {
    // ignore
  }
  try {
    const wc = handle.webContents;
    if (wc && !wc.isDestroyed()) wc.destroy();
  } catch {
    // ignore
  }
}

/**
 * Sync overlay bounds to the shop window content area.
 * @param {import("electron").BrowserWindow} parent
 * @param {{ view: object } | null} handle
 */
function syncPirateShellOverlayBounds(parent, handle) {
  if (!parent || parent.isDestroyed() || !handle || !viewAlive(handle.view)) return;
  try {
    handle.view.setBounds(contentOverlayBounds(parent));
  } catch {
    // ignore
  }
}

/**
 * Last-resort separate BrowserWindow (only if shell overlay cannot attach).
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

  return { ok: true, reason: "opened-dedicated-window", window: win };
}

module.exports = {
  attachPirateShellOverlay,
  detachPirateShellOverlay,
  syncPirateShellOverlayBounds,
  openPirateGameWindow,
  contentOverlayBounds,
  PIRATE_HTML,
  PIRATE_PRELOAD,
};
