"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const electronName = process.platform === "win32" ? "electron.exe" : "electron";
const electronBin = path.join(root, "node_modules", "electron", "dist", electronName);
const installJs = path.join(root, "node_modules", "electron", "install.js");

if (fs.existsSync(electronBin)) {
  process.exit(0);
}

if (!fs.existsSync(installJs)) {
  // npm is still installing electron; the package's own install script will run next.
  process.exit(0);
}

const result = spawnSync(process.execPath, [installJs], {
  cwd: root,
  stdio: "inherit",
});

process.exit(result.status === null ? 1 : result.status);
