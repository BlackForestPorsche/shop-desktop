"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { resolveAppIconPath } = require("../src/app-icon");

const ROOT = path.join(__dirname, "..");

test("resolveAppIconPath prefers .ico on Windows when present", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bft-icon-"));
  fs.mkdirSync(path.join(dir, "assets"));
  const ico = path.join(dir, "assets", "icon.ico");
  const png = path.join(dir, "assets", "icon.png");
  fs.writeFileSync(ico, "ico");
  fs.writeFileSync(png, "png");
  assert.equal(resolveAppIconPath(dir, "win32"), ico);
  assert.equal(resolveAppIconPath(dir, "linux"), png);
});

test("resolveAppIconPath falls back to png when ico is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bft-icon-png-"));
  fs.mkdirSync(path.join(dir, "assets"));
  const png = path.join(dir, "assets", "icon.png");
  fs.writeFileSync(png, "png");
  assert.equal(resolveAppIconPath(dir, "win32"), png);
});

test("repo ships brand icon.png and icon.ico for Windows desks", () => {
  const png = path.join(ROOT, "assets", "icon.png");
  const ico = path.join(ROOT, "assets", "icon.ico");
  assert.ok(fs.existsSync(png), "assets/icon.png missing");
  assert.ok(fs.existsSync(ico), "assets/icon.ico missing");
  assert.ok(fs.statSync(png).size > 100);
  assert.ok(fs.statSync(ico).size > 100);
  // ICO header: reserved 0, type 1 (icon), count > 0
  const header = Buffer.alloc(6);
  const fd = fs.openSync(ico, "r");
  fs.readSync(fd, header, 0, 6, 0);
  fs.closeSync(fd);
  assert.equal(header.readUInt16LE(0), 0);
  assert.equal(header.readUInt16LE(2), 1);
  assert.ok(header.readUInt16LE(4) >= 1);
});

test("ensure-icon.js writes both png and ico", () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "ensure-icon.js")], {
    encoding: "utf8",
    cwd: ROOT,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /icon\.ico/);
});
