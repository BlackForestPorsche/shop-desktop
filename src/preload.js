"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const { mountShellChrome } = require("./shell-chrome");

contextBridge.exposeInMainWorld("blackForestTools", {
  checkForDesktopUpdates: () => ipcRenderer.invoke("shell:check-updates"),
});

function boot() {
  // Idle fleet only — Check for updates lives in Settings → Check for updates.
  mountShellChrome();
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
