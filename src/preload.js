"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const { mountShellChrome } = require("./shell-chrome");
const { resolveIdleIntervalMs } = require("./idle-fleet");

contextBridge.exposeInMainWorld("blackForestTools", {
  checkForDesktopUpdates: () => ipcRenderer.invoke("shell:check-updates"),
});

function boot() {
  // Idle fleet only — Check for updates lives in Settings → Check for updates.
  // BF_IDLE_MS (ms) shortens the interval for QA; unset → 5 minutes.
  mountShellChrome({
    idleIntervalMs: resolveIdleIntervalMs(process.env.BF_IDLE_MS),
  });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
