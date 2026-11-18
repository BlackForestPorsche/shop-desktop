"use strict";

const path = require("node:path");

const UPDATING_HTML = path.join(__dirname, "..", "assets", "updating.html");

/**
 * Small notice shown while an update downloads and installs, so the person at
 * the desk can see Tools is working and not stuck. It cannot be closed by hand:
 * the caller closes it when the update finishes or fails.
 *
 * @returns {{ close: () => void }}
 */
function openUpdateProgress(parent, { BrowserWindow } = {}) {
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
      title: "Updating Black Forest Tools",
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
      if (!finished) event.preventDefault();
    });
    notice.once("ready-to-show", () => {
      if (notice && !notice.isDestroyed() && !finished) notice.show();
    });
    notice.loadFile(UPDATING_HTML).catch(() => {});
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

module.exports = { openUpdateProgress, UPDATING_HTML };
