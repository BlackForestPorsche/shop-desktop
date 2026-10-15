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

const env = { ...process.env };
delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_OVERRIDE_DIST_PATH;
delete env.npm_config_platform;
delete env.npm_config_arch;

// Prefer system node when this postinstall is triggered from inside Electron.
let nodePath = process.execPath;
if (process.versions.electron) {
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["node"], {
    encoding: "utf8",
  });
  const first = (which.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (first) nodePath = first;
}

const result = spawnSync(nodePath, [installJs], {
  cwd: root,
  stdio: "inherit",
  env,
});

process.exit(result.status === null ? 1 : result.status);
