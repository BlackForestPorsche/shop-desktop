"use strict";

/**
 * Preload for the pirate shell overlay (WebContentsView on the shop window) and
 * the last-resort dedicated BrowserWindow. Mounts shell chrome on a blank local
 * page — no shop SPA CSS, no CSP fight — and starts combat immediately.
 */

const { ipcRenderer } = require("electron");
const { mountShellChrome } = require("./shell-chrome");

function reportPirateStatus(event, reason) {
  try {
    ipcRenderer.send("shell:pirate-status", {
      event: String(event || "").slice(0, 80),
      reason: String(reason || "").slice(0, 200),
    });
  } catch {
    // ignore
  }
}

function afterPaint() {
  return new Promise((resolve) => {
    try {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    } catch {
      setTimeout(resolve, 32);
    }
  });
}

function boot() {
  let chrome = null;
  try {
    // Idle interval huge: this surface is launch-only, not a screensaver host.
    // launchOnly: Esc / stand down / water click closes the overlay (back to shop).
    chrome = mountShellChrome({
      idleIntervalMs: 24 * 60 * 60 * 1000,
      launchOnly: true,
      onStatus: (info) => {
        const event = info && info.event;
        const reason = info && info.reason;
        reportPirateStatus(event, reason);
        if (event === "overlay-dismissed") {
          try {
            ipcRenderer.send("shell:pirate-overlay-close", {
              reason: String(reason || "dismissed").slice(0, 200),
            });
          } catch {
            // ignore
          }
        }
      },
      submitPirateScore: (run) => ipcRenderer.invoke("shell:pirate-board", run),
      onError: (error) => {
        try {
          const text = error && error.stack ? error.stack : String(error);
          ipcRenderer.send("shell:renderer-error", {
            where: "pirate-overlay",
            text: String(text).slice(0, 4000),
          });
        } catch {
          // ignore
        }
      },
    });
  } catch (error) {
    reportPirateStatus("launch-aborted", error && error.message ? error.message : String(error));
    return;
  }

  async function runLaunch(source) {
    reportPirateStatus("launch-requested", source || "shell-overlay");
    try {
      const result = chrome.launchGame();
      if (result && typeof result === "object") {
        if (!result.ok) {
          reportPirateStatus("launch-aborted", result.reason || "unknown");
          return;
        }
        if (typeof chrome.refreshLayout === "function") chrome.refreshLayout();
        await afterPaint();
        if (typeof chrome.refreshLayout === "function") chrome.refreshLayout();
        if (typeof chrome.isOverlayVisible === "function" && !chrome.isOverlayVisible()) {
          if (typeof chrome.dismissOverlay === "function") chrome.dismissOverlay();
          reportPirateStatus("launch-aborted", "overlay-not-visible");
          return;
        }
        reportPirateStatus("launch-ok", result.reason || "shell-overlay");
        return;
      }
      if (!result) reportPirateStatus("launch-aborted", "launchGame-false");
      else reportPirateStatus("launch-ok", "legacy-true");
    } catch (error) {
      reportPirateStatus("launch-aborted", error && error.message ? error.message : String(error));
    }
  }

  ipcRenderer.on("shell:pirate-relaunch", () => {
    runLaunch("shell-overlay-relaunch").catch(() => {});
  });
  runLaunch("shell-overlay").catch(() => {});
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
