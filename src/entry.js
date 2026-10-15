"use strict";

/**
 * Single Electron entry for the Setup / git-checkout / packaged shapes.
 * `--widget` (Shop Widget shortcut) loads the widget process; anything else is Tools.
 * Keeping the switch here means Tools' main.js and its single-instance lock are
 * never loaded for widget windows.
 */
const { isWidgetArgv } = require("./widget-launch");

if (isWidgetArgv(process.argv)) {
  require("./widget-main");
} else {
  require("./main");
}
