"use strict";

/**
 * Guards against invisible OS-level or shell overlay layers that swallow clicks
 * on the shop window (slow-start splash, floating notices, stranded pirate view).
 */

/** @type {Set<{ close: () => void }>} */
const floatingBlockers = new Set();

/**
 * @param {{ close: () => void }} handle
 * @returns {() => void}
 */
function registerFloatingBlocker(handle) {
  floatingBlockers.add(handle);
  return () => floatingBlockers.delete(handle);
}

function dismissAllFloatingBlockers() {
  for (const handle of floatingBlockers) {
    try {
      handle.close();
    } catch {
      // ignore
    }
  }
  floatingBlockers.clear();
}

/**
 * Any click, key, or focus in the main shop window dismisses the slow-start
 * splash and other floating blockers so the shop cannot stay “dead” behind a
 * stuck always-on-top notice.
 *
 * @param {import("electron").BrowserWindow | null | undefined} win
 * @param {{ close: () => void } | null | undefined} startingNotice
 * @param {() => void} [extra]
 */
function bindShopInputUnblock(win, startingNotice, extra) {
  if (!win || win.isDestroyed()) {
    if (startingNotice) startingNotice.close();
    dismissAllFloatingBlockers();
    return;
  }

  let done = false;
  const unblock = () => {
    if (done) return;
    done = true;
    if (startingNotice) startingNotice.close();
    dismissAllFloatingBlockers();
    if (typeof extra === "function") extra();
  };

  const wc = win.webContents;
  win.on("focus", unblock);
  win.once("show", unblock);
  win.once("closed", unblock);
  if (wc && !wc.isDestroyed()) {
    wc.on("before-input-event", unblock);
    wc.on("did-finish-load", unblock);
    wc.on("did-navigate", unblock);
    wc.on("did-navigate-in-page", unblock);
  }

  try {
    if (win.isVisible() && wc && !wc.isDestroyed() && !wc.isLoading()) {
      const url = wc.getURL();
      if (url && url !== "about:blank") unblock();
    }
  } catch {
    // ignore
  }
}

module.exports = {
  registerFloatingBlocker,
  dismissAllFloatingBlockers,
  bindShopInputUnblock,
};