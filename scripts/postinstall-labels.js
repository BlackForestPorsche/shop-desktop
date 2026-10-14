"use strict";

/**
 * Ensure vendored Labels server deps (pdf-lib, qrcode) are installed under labels/.
 * Best-effort: failure here must not block Electron postinstall on machines
 * that only need the shop window yet.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const labelsRoot = path.join(root, "labels");
const marker = path.join(labelsRoot, "node_modules", "pdf-lib");

if (!fs.existsSync(path.join(labelsRoot, "package.json"))) {
  process.exit(0);
}

if (fs.existsSync(marker)) {
  process.exit(0);
}

const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmBin, ["install", "--omit=dev"], {
  cwd: labelsRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

if (result.status !== 0) {
  console.warn(
    "[postinstall-labels] Could not install Labels deps yet. Run: npm run ensure-labels",
  );
  // Soft fail — Tools can still open; Labels start will retry ensureLabelsDeps.
  process.exit(0);
}
