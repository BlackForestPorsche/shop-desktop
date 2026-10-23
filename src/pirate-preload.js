"use strict";

/**
 * Preload for the dedicated pirate BrowserWindow (Settings → Launch pirate fallback).
 * Mounts shell chrome on a blank local page and starts combat immediately — no shop
 * SPA, no CSP fight, no document.hidden from the desk site.
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

function boot() {
  let chrome = null;
  try {
    // Idle interval huge: this window is launch-only, not a screensaver host.
    chrome = mountShellChrome({
      idleIntervalMs: 24 * 60 * 60 * 1000,
      onStatus: (info) => reportPirateStatus(info && info.event, info && info.reason),
      onError: (error) => {
        try {
          const text = error && error.stack ? error.stack : String(error);
          ipcRenderer.send("shell:renderer-error", {
            where: "pirate-window",
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

  function runLaunch(source) {
    reportPirateStatus("launch-requested", source || "dedicated-window");
    try {
      const result = chrome.launchGame();
      if (result && typeof result === "object") {
        if (!result.ok) {
          reportPirateStatus("launch-aborted", result.reason || "unknown");
          return;
        }
        if (typeof chrome.isOverlayVisible === "function" && !chrome.isOverlayVisible()) {
          reportPirateStatus("launch-aborted", "overlay-not-visible");
          return;
        }
        reportPirateStatus("launch-ok", result.reason || "dedicated-window");
        return;
      }
      if (!result) reportPirateStatus("launch-aborted", "launchGame-false");
      else reportPirateStatus("launch-ok", "legacy-true");
    } catch (error) {
      reportPirateStatus("launch-aborted", error && error.message ? error.message : String(error));
    }
  }

  ipcRenderer.on("shell:pirate-relaunch", () => runLaunch("dedicated-relaunch"));
  runLaunch("dedicated-window");
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
