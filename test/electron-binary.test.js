"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  binaryPath,
  isExecutable,
  looksLikeElf,
  wipeDist,
  ensureElectronBinary,
} = require("../scripts/electron-binary");

test("binaryPath uses electron on linux and electron.exe on win32", () => {
  assert.match(binaryPath("/app", "linux"), /dist\/electron$/);
  assert.match(binaryPath("/app", "win32"), /dist\/electron\.exe$/);
});

test("ensureElectronBinary chmod-repairs a non-executable linux binary", () => {
  const root = path.join(__dirname, "..");
  const bin = binaryPath(root, process.platform);
  if (process.platform === "win32" || !fs.existsSync(bin)) {
    return; // skip when electron dist is not installed in CI/checkout
  }
  const modeBefore = fs.statSync(bin).mode;
  fs.chmodSync(bin, 0o644);
  assert.equal(isExecutable(bin), false);
  const result = ensureElectronBinary(root);
  assert.equal(result.ok, true);
  assert.equal(isExecutable(bin), true);
  assert.ok(result.repaired === "chmod" || result.repaired === "none" || result.repaired === "download");
  // leave executable for later tests
  fs.chmodSync(bin, modeBefore | 0o111);
});

test("looksLikeElf recognizes a real electron binary when present", () => {
  const root = path.join(__dirname, "..");
  const bin = binaryPath(root, process.platform);
  if (process.platform === "linux" && fs.existsSync(bin)) {
    assert.equal(looksLikeElf(bin), true);
  }
});

test("wipeDist removes dist and path.txt", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bf-elec-"));
  try {
    const electronDir = path.join(tmp, "node_modules", "electron");
    fs.mkdirSync(path.join(electronDir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(electronDir, "dist", "electron"), "x");
    fs.writeFileSync(path.join(electronDir, "path.txt"), "electron");
    wipeDist(tmp);
    assert.equal(fs.existsSync(path.join(electronDir, "dist")), false);
    assert.equal(fs.existsSync(path.join(electronDir, "path.txt")), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
