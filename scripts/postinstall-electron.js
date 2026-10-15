"use strict";

const path = require("node:path");
const { ensureElectronBinary } = require("./electron-binary");

const root = path.join(__dirname, "..");

try {
  ensureElectronBinary(root);
  process.exit(0);
} catch (error) {
  // During a fresh npm install, electron may not be unpacked yet — package install.js runs next.
  if (!require("node:fs").existsSync(path.join(root, "node_modules", "electron", "install.js"))) {
    process.exit(0);
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
