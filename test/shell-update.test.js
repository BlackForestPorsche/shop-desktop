"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseSemver,
  compareSemver,
  versionFromReleaseAssetName,
  pickPortableAsset,
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
