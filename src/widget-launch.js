"use strict";

const path = require("node:path");

function isWidgetArgv(argv) {
  return Array.isArray(argv) && argv.slice(1).some((arg) => arg === "--widget");
}

/**
 * How to start another Shop Widget window / Tools using the running Electron
 * binary (no npm, no cmd.exe, no console flash on Windows).
 * Unpackaged checkout: `electron.exe <appRoot> --widget`. Packaged: `app.exe --widget`.
 */
function electronLaunchSpec({ execPath, appRoot, packaged, widget = false, view = "" }) {
  const args = [];
  if (!packaged) {
    args.push(appRoot);
  }
  if (widget) {
    args.push("--widget");
    if (view) {
      args.push(`--view=${view}`);
    }
  }
  return {
    command: execPath,
    args,
    options: {
      cwd: packaged ? path.dirname(execPath) : appRoot,
      detached: true,
      stdio: "ignore",
      env: (() => {
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        return env;
      })(),
    },
  };
}

module.exports = { isWidgetArgv, electronLaunchSpec };
