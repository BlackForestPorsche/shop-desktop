"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const ENABLE = path.join(ROOT, "scripts", "enable-tools-autostart.sh");
const DISABLE = path.join(ROOT, "scripts", "disable-tools-autostart.sh");

test("enable-tools-autostart.sh writes systemd unit and XDG desktop", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bft-autostart-"));
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    PATH: process.env.PATH,
  };
  // systemctl may be missing in CI; script still writes the unit file.
  const result = spawnSync("bash", [ENABLE], { env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const unit = path.join(home, ".config", "systemd", "user", "blackforest-tools.service");
  const desktop = path.join(home, ".config", "autostart", "blackforest-tools.desktop");
  assert.ok(fs.existsSync(unit), "systemd unit missing");
  assert.ok(fs.existsSync(desktop), "XDG desktop missing");

  const unitText = fs.readFileSync(unit, "utf8");
  assert.match(unitText, /WantedBy=graphical-session\.target/);
  assert.match(unitText, /blackforest-tools\.sh/);

  const desktopText = fs.readFileSync(desktop, "utf8");
  assert.match(desktopText, /Black Forest Tools/);
  assert.match(desktopText, /blackforest-tools\.sh/);

  const off = spawnSync("bash", [DISABLE], { env, encoding: "utf8" });
  assert.equal(off.status, 0, off.stderr || off.stdout);
  assert.equal(fs.existsSync(unit), false);
  assert.equal(fs.existsSync(desktop), false);

  fs.rmSync(home, { recursive: true, force: true });
});

test("install-manjaro.sh accepts --no-autostart flag in its source", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "install-manjaro.sh"), "utf8");
  assert.match(src, /--no-autostart/);
  assert.match(src, /enable-tools-autostart\.sh/);
});

test("install-windows.ps1 enables autostart by default", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "install-windows.ps1"), "utf8");
  assert.match(src, /NoAutostart/);
  assert.match(src, /enable-tools-autostart\.ps1/);
});
