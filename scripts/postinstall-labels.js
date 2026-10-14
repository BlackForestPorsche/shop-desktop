#!/usr/bin/env node
/** Best-effort Labels dependency install after Tools npm install. */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const root = path.join(__dirname, "..");
const labels = path.join(root, "labels");
const pkg = path.join(labels, "package.json");
if (!fs.existsSync(pkg)) {
  console.warn("[postinstall-labels] labels/package.json missing — skip");
  process.exit(0);
}
if (fs.existsSync(path.join(labels, "node_modules", "pdf-lib"))) {
  process.exit(0);
}
const r = spawnSync("npm", ["install", "--omit=dev"], {
  cwd: labels,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(r.status === null ? 1 : r.status);
