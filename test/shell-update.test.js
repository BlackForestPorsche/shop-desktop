"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  parseSemver,
  compareSemver,
  versionFromReleaseAssetName,
  pickPortableAsset,
  cleanUpdateEnv,
  markPendingNpmInstall,
  clearPendingNpmInstall,
  hasPendingNpmInstall,
  pendingNpmFlagPath,
  linuxRelaunchSpec,
  PENDING_NPM_FLAG,
} = require("../src/shell-update");

test("parseSemver reads dotted versions from free text", () => {
  assert.equal(parseSemver("1.2.3").raw, "1.2.3");
  assert.equal(parseSemver("Black Forest Tools-Portable-1.1.0.exe").raw, "1.1.0");
  assert.equal(parseSemver("no version here"), null);
});

test("compareSemver orders versions", () => {
  assert.equal(compareSemver("1.1.0", "1.0.0"), 1);
  assert.equal(compareSemver("1.0.0", "1.1.0"), -1);
  assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
});

test("versionFromReleaseAssetName prefers the portable build version", () => {
  assert.equal(
    versionFromReleaseAssetName("Black.Forest.Tools-Portable-1.1.0.exe"),
    "1.1.0",
  );
});

test("pickPortableAsset prefers a portable exe over other assets", () => {
  const asset = pickPortableAsset([
    { name: "notes.txt", browser_download_url: "https://example/notes" },
    {
      name: "Black.Forest.Tools-Portable-1.1.0.exe",
      browser_download_url: "https://example/portable",
    },
    {
      name: "Black.Forest.Tools-Setup-1.1.0.exe",
      browser_download_url: "https://example/setup",
    },
  ]);
  assert.equal(asset.browser_download_url, "https://example/portable");
});

test("cleanUpdateEnv drops skip-download and platform overrides", () => {
  const cleaned = cleanUpdateEnv({
    PATH: "/usr/bin",
    ELECTRON_SKIP_BINARY_DOWNLOAD: "1",
    ELECTRON_RUN_AS_NODE: "1",
    npm_config_platform: "win32",
    npm_config_arch: "x64",
    KEEP_ME: "yes",
  });
  assert.equal(cleaned.KEEP_ME, "yes");
  assert.equal(cleaned.PATH, "/usr/bin");
  assert.equal(cleaned.ELECTRON_SKIP_BINARY_DOWNLOAD, undefined);
  assert.equal(cleaned.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(cleaned.npm_config_platform, undefined);
  assert.equal(cleaned.npm_config_arch, undefined);
  assert.equal(cleaned.npm_config_ignore_scripts, "false");
});

test("pending npm flag marks deferred post-update install", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-shell-update-"));
  try {
    assert.equal(hasPendingNpmInstall(root), false);
    markPendingNpmInstall(root);
    assert.equal(hasPendingNpmInstall(root), true);
    assert.equal(path.basename(pendingNpmFlagPath(root)), PENDING_NPM_FLAG);
    clearPendingNpmInstall(root);
    assert.equal(hasPendingNpmInstall(root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("linuxRelaunchSpec points at the menu launcher", () => {
  const root = path.join(__dirname, "..");
  const spec = linuxRelaunchSpec(root);
  assert.ok(spec);
  assert.equal(spec.execPath, "/bin/bash");
  assert.match(spec.args[0], /blackforest-tools\.sh$/);
});
