"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  electronPaths,
  inspectElectron,
  ensureElectronBinary,
  cleanEnv,
  ensureLauncherScriptsExecutable,
} = require("../scripts/electron-binary");

const POSIX = process.platform !== "win32";

function makeRoot({ binary = true, mode = 0o755, pathTxt = "electron", version = true, dist = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-electron-test-"));
  const p = electronPaths(root, "linux");
  fs.mkdirSync(p.pkgDir, { recursive: true });
  fs.writeFileSync(p.installJs, "");
  if (dist) fs.mkdirSync(p.dist, { recursive: true });
  if (binary) fs.writeFileSync(p.binary, "#!/bin/sh\nexit 0\n", { mode });
  if (binary) fs.chmodSync(p.binary, mode);
  if (pathTxt !== null) fs.writeFileSync(p.pathTxt, pathTxt);
  if (version && dist) fs.writeFileSync(p.versionFile, "38.2.1");
  return { root, p };
}

function fakeInstall(calls) {
  return (root, installJs) => {
    calls.push(installJs);
    const p = electronPaths(root, "linux");
    fs.mkdirSync(p.dist, { recursive: true });
    fs.writeFileSync(p.binary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    fs.chmodSync(p.binary, 0o755);
    fs.writeFileSync(p.versionFile, "38.2.1");
    fs.writeFileSync(p.pathTxt, "electron");
    return true;
  };
}

test("healthy install is left alone", { skip: !POSIX }, () => {
  const { root } = makeRoot();
  const calls = [];
  const result = ensureElectronBinary(root, { platform: "linux", runInstall: fakeInstall(calls) });
  assert.deepEqual([result.ok, result.action], [true, "none"]);
  assert.equal(calls.length, 0);
});

test("non-executable binary (mode 644) is repaired with chmod, not a download", { skip: !POSIX }, () => {
  const { root, p } = makeRoot({ mode: 0o644 });
  assert.equal(inspectElectron(root, "linux").state, "not-executable");
  const calls = [];
  const result = ensureElectronBinary(root, { platform: "linux", runInstall: fakeInstall(calls) });
  assert.deepEqual([result.ok, result.action], [true, "chmod"]);
  assert.equal(calls.length, 0);
  fs.accessSync(p.binary, fs.constants.X_OK);
});

test("missing binary triggers a clean install", { skip: !POSIX }, () => {
  const { root, p } = makeRoot({ binary: false });
  fs.writeFileSync(path.join(p.dist, "locales"), "partial");
  const calls = [];
  const result = ensureElectronBinary(root, { platform: "linux", runInstall: fakeInstall(calls) });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(fs.existsSync(path.join(p.dist, "locales")), false);
});

test("stale path.txt is wiped and reinstalled", { skip: !POSIX }, () => {
  const { root } = makeRoot({ pathTxt: "electron.exe" });
  assert.equal(inspectElectron(root, "linux").state, "stale-metadata");
  const calls = [];
  const result = ensureElectronBinary(root, { platform: "linux", runInstall: fakeInstall(calls) });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
});

test("missing path.txt counts as stale", { skip: !POSIX }, () => {
  const { root } = makeRoot({ pathTxt: null });
  assert.equal(inspectElectron(root, "linux").state, "stale-metadata");
});

test("failed first install is retried once with a fresh cache", { skip: !POSIX }, () => {
  const { root } = makeRoot({ binary: false });
  const caches = [];
  let n = 0;
  const runInstall = (r, installJs) => {
    n += 1;
    caches.push(process.env.ELECTRON_CACHE);
    return n === 1 ? false : fakeInstall([])(r, installJs);
  };
  const result = ensureElectronBinary(root, { platform: "linux", runInstall });
  assert.equal(result.ok, true);
  assert.equal(n, 2);
  assert.equal(caches[0], process.env.ELECTRON_CACHE);
  assert.ok(caches[1]);
  assert.notEqual(caches[1], caches[0]);
  assert.equal(process.env.ELECTRON_CACHE, caches[0]);
});

test("gives up (ok=false) when install never produces a binary", { skip: !POSIX }, () => {
  const { root } = makeRoot({ binary: false });
  const result = ensureElectronBinary(root, { platform: "linux", runInstall: () => false });
  assert.equal(result.ok, false);
});

test("missing electron package is reported, not installed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-electron-test-"));
  const calls = [];
  const result = ensureElectronBinary(root, { platform: "linux", runInstall: fakeInstall(calls) });
  assert.deepEqual([result.ok, result.state], [false, "missing-package"]);
  assert.equal(calls.length, 0);
});

test("cleanEnv drops skip/platform overrides", () => {
  const env = cleanEnv({
    ELECTRON_SKIP_BINARY_DOWNLOAD: "1",
    npm_config_platform: "win32",
    PATH: "/usr/bin",
  });
  assert.deepEqual(env, { PATH: "/usr/bin" });
});

test("ensureLauncherScriptsExecutable restores +x on launcher scripts only", { skip: !POSIX }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-launcher-test-"));
  const dir = path.join(root, "scripts");
  fs.mkdirSync(dir);
  for (const name of ["blackforest-tools.sh", "blackforest-widget-session", "notes.js"]) {
    fs.writeFileSync(path.join(dir, name), "#!/usr/bin/env bash\n");
    fs.chmodSync(path.join(dir, name), 0o644);
  }
  const fixed = ensureLauncherScriptsExecutable(root, "linux");
  assert.deepEqual(fixed.sort(), ["blackforest-tools.sh", "blackforest-widget-session"]);
  assert.ok(fs.statSync(path.join(dir, "blackforest-tools.sh")).mode & 0o100);
  assert.ok(fs.statSync(path.join(dir, "blackforest-widget-session")).mode & 0o100);
  assert.equal(fs.statSync(path.join(dir, "notes.js")).mode & 0o111, 0);
  assert.deepEqual(ensureLauncherScriptsExecutable(root, "linux"), []);
});
