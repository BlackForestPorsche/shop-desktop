"use strict";

/**
 * Single Electron entry for the Setup / git-checkout / packaged shapes.
 * `--widget` (Shop Widget shortcut) loads the widget process; anything else is Tools.
 * Keeping the switch here means Tools' main.js and its single-instance lock are
 * never loaded for widget windows.
 */
const path = require("node:path");
const { isWidgetArgv } = require("./widget-launch");

const widget = isWidgetArgv(process.argv);

try {
  const { app, crashReporter } = require("electron");
  require("./crash-guard").installCrashGuards({
    app,
    crashReporter,
    offlinePath: path.join(__dirname, "..", "assets", "offline.html"),
    label: widget ? "widget" : "tools",
  });
} catch (error) {
  // Crash logging must never be the reason the app does not start.
  console.error("Crash guard unavailable:", error);
}

if (widget) {
  require("./widget-main");
} else {
  require("./main");
}
