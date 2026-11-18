"use strict";

const path = require("node:path");

const UPDATING_HTML = path.join(__dirname, "..", "assets", "updating.html");
const STARTING_HTML = path.join(__dirname, "..", "assets", "starting.html");

/**
 * Small notice shown while an update downloads and installs, so the person at
 * the desk can see Tools is working and not stuck. Unless `closable`, it cannot
 * be closed by hand: the caller closes it when the update finishes or fails.
 *
 * @returns {{ close: () => void }}
 */
function openUpdateProgress(
  parent,
  { BrowserWindow, page = UPDATING_HTML, title = "Updating Black Forest Tools", closable = false } = {},
) {
  let notice = null;
  let finished = false;
  try {
    const hasParent = Boolean(parent && !parent.isDestroyed());
    notice = new BrowserWindow({
      width: 440,
      height: 132,
      parent: hasParent ? parent : undefined,
      modal: hasParent,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: !hasParent,
      title,
      backgroundColor: "#efe9dc",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        javascript: false,
      },
    });
    notice.setMenuBarVisibility(false);
    notice.on("close", (event) => {
      if (!finished && !closable) event.preventDefault();
    });
    notice.once("ready-to-show", () => {
      if (notice && !notice.isDestroyed() && !finished) notice.show();
    });
    notice.loadFile(page).catch(() => {});
  } catch (error) {
    console.error("Could not show the update notice:", error && error.message ? error.message : error);
    notice = null;
  }
  return {
    close() {
      finished = true;
      try {
        if (notice && !notice.isDestroyed()) notice.destroy();
      } catch {
        // The update result matters, not the notice.
      }
      notice = null;
    },
  };
}

/**
 * The same notice for a slow start: shown only when opening the shop window
 * takes longer than `delayMs` (no network at login), so a normal start never
 * flashes it. Close it after the main window exists.
 *
 * @returns {{ close: () => void }}
 */
function openStartingNotice({
  BrowserWindow,
  delayMs = 1200,
  isReady = () => false,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let notice = null;
  let closed = false;
  const timer = setTimeoutFn(() => {
    if (closed) return;
    if (isReady()) {
      closed = true;
      return;
    }
    notice = openUpdateProgress(null, {
      BrowserWindow,
      page: STARTING_HTML,
      title: "Opening Black Forest Tools",
      // Quitting during a slow start must still work.
      closable: true,
    });
    if (isReady()) notice.close();
  }, delayMs);
  return {
    close() {
      closed = true;
      clearTimeoutFn(timer);
      if (notice) notice.close();
      notice = null;
    },
  };
}

/**
 * Close the slow-start notice once the shop window is shown or the main frame
 * has finished loading (including Follow silent navigations).
 *
 * @param {import("electron").BrowserWindow | null | undefined} win
 * @param {{ close: () => void }} startingNotice
 */
function bindStartingNoticeDismiss(win, startingNotice) {
  if (!win || win.isDestroyed()) {
    startingNotice.close();
    return;
  }
  let done = false;
  const dismiss = () => {
    if (done) return;
    done = true;
    startingNotice.close();
  };

  const wc = win.webContents;
  win.once("show", dismiss);
  win.once("closed", dismiss);
  wc.on("did-finish-load", dismiss);
  wc.on("did-navigate", dismiss);
  wc.on("did-navigate-in-page", dismiss);

  if (win.isVisible()) dismiss();
  else if ((!wc.isDestroyed || !wc.isDestroyed()) && !wc.isLoading()) {
    const url = wc.getURL();
    if (url && url !== "about:blank") dismiss();
  }
}

module.exports = {
  openUpdateProgress,
  openStartingNotice,
  bindStartingNoticeDismiss,
  UPDATING_HTML,
  STARTING_HTML,
};
