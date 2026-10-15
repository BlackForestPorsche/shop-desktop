"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  resolveNodeRuntime,
  labelsRootFromAppRoot,
  labelsDataDir,
  ensureLabelsDeps,
  npmCommand,
  startLabelsServer,
} = require("../src/labels-server");
const { sessionDir, dataHome } = require("../src/shared-session");
const { widgetSessionDir, widgetSessionFile } = require("../src/widget-session-path");
const { renameWithRetry } = require("../src/fs-atomic");
const { isWidgetArgv, electronLaunchSpec } = require("../src/widget-launch");

const WIN_ENV = {
  LOCALAPPDATA: "C:\\Users\\desk\\AppData\\Local",
  ProgramFiles: "C:\\Program Files",
  PATH: "C:\\Windows\\System32;C:\\tools",
};

test("Windows session dir is %LOCALAPPDATA%\\blackforest-tools", () => {
  const dir = widgetSessionDir(WIN_ENV, "win32", "C:\\Users\\desk");
  assert.match(dir.replace(/\\/g, "/"), /AppData\/Local\/blackforest-tools$/);
  assert.equal(
    sessionDir(WIN_ENV, "win32").replace(/\\/g, "/"),
    "C:/Users/desk/AppData/Local/blackforest-tools".replace(/\\/g, "/"),
  );
  assert.match(widgetSessionFile(WIN_ENV, "win32", "C:\\Users\\desk").replace(/\\/g, "/"), /blackforest-tools\/widget-session\.json$/);
});

test("Windows session dir falls back to AppData\\Local under the profile", () => {
  const dir = widgetSessionDir({}, "win32", "C:\\Users\\desk");
  assert.match(dir.replace(/\\/g, "/"), /AppData\/Local\/blackforest-tools$/);
});

test("Linux session dir keeps XDG_DATA_HOME", () => {
  assert.equal(sessionDir({ XDG_DATA_HOME: "/data" }, "linux"), path.join("/data", "blackforest-tools"));
  assert.equal(dataHome({ XDG_DATA_HOME: "/data" }, "linux"), "/data");
  assert.equal(dataHome({ LOCALAPPDATA: "C:\\L" }, "win32"), "C:\\L");
});

test("renameWithRetry retries EPERM/EBUSY then succeeds", () => {
  let calls = 0;
  const sleeps = [];
  renameWithRetry("a", "b", {
    rename: () => {
      calls += 1;
      if (calls < 3) {
        const error = new Error("busy");
        error.code = calls === 1 ? "EPERM" : "EBUSY";
        throw error;
      }
    },
    sleep: (ms) => sleeps.push(ms),
  });
  assert.equal(calls, 3);
  assert.equal(sleeps.length, 2);
});

test("renameWithRetry rethrows non-retryable errors immediately and gives up eventually", () => {
  let calls = 0;
  assert.throws(
    () =>
      renameWithRetry("a", "b", {
        rename: () => {
          calls += 1;
          const error = new Error("missing");
          error.code = "ENOENT";
          throw error;
        },
        sleep: () => {},
      }),
    /missing/,
  );
  assert.equal(calls, 1);

  calls = 0;
  assert.throws(
    () =>
      renameWithRetry("a", "b", {
        attempts: 3,
        rename: () => {
          calls += 1;
          const error = new Error("locked");
          error.code = "EBUSY";
          throw error;
        },
        sleep: () => {},
      }),
    /locked/,
  );
  assert.equal(calls, 3);
});

test("renameWithRetry really renames on disk", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bft-rename-"));
  const from = path.join(dir, "a.tmp");
  const to = path.join(dir, "a.json");
  fs.writeFileSync(from, "x");
  renameWithRetry(from, to);
  assert.equal(fs.readFileSync(to, "utf8"), "x");
});

test("Windows node runtime prefers PATH node.exe, then Program Files, then Electron-as-node", () => {
  const onPath = resolveNodeRuntime(WIN_ENV, {
    platform: "win32",
    exists: (p) => p === "C:\\tools\\node.exe",
  });
  assert.deepEqual(onPath, { bin: "C:\\tools\\node.exe", asNode: false });

  const pf = resolveNodeRuntime(WIN_ENV, {
    platform: "win32",
    exists: (p) => p === "C:\\Program Files\\nodejs\\node.exe",
  });
  assert.deepEqual(pf, { bin: "C:\\Program Files\\nodejs\\node.exe", asNode: false });

  const fallback = resolveNodeRuntime(WIN_ENV, {
    platform: "win32",
    exists: () => false,
    execPath: "C:\\Users\\desk\\shop-desktop\\node_modules\\electron\\dist\\electron.exe",
    electron: true,
  });
  assert.equal(fallback.asNode, true);
  assert.match(fallback.bin, /electron\.exe$/);
});

test("LABELS_NODE override wins and plain node name is the last resort outside Electron", () => {
  const env = { ...WIN_ENV, LABELS_NODE: "D:\\node\\node.exe" };
  assert.deepEqual(resolveNodeRuntime(env, { platform: "win32", exists: (p) => p === env.LABELS_NODE }), {
    bin: "D:\\node\\node.exe",
    asNode: false,
  });
  assert.deepEqual(resolveNodeRuntime({ PATH: "" }, { platform: "win32", exists: () => false, electron: false }), {
    bin: "node.exe",
    asNode: false,
  });
});

test("labels root uses unpacked resources for an asar install, checkout otherwise", () => {
  const res = path.join("C:", "Program Files", "Black Forest Tools", "resources");
  const asar = path.join(res, "app.asar");
  assert.equal(
    labelsRootFromAppRoot(asar, res, (p) => p === path.join(res, "labels", "server.mjs")),
    path.join(res, "labels"),
  );
  assert.equal(labelsRootFromAppRoot(asar, res, () => false), path.join(asar, "labels"));
  assert.equal(labelsRootFromAppRoot("C:\\Users\\desk\\shop-desktop", res, () => true), path.join("C:\\Users\\desk\\shop-desktop", "labels"));
});

test("Labels data dir lives under LOCALAPPDATA on Windows only", () => {
  assert.equal(labelsDataDir(WIN_ENV, "win32"), "C:\\Users\\desk\\AppData\\Local\\blackforest-tools\\labels");
  assert.equal(labelsDataDir({}, "linux"), "");
  assert.equal(labelsDataDir({ LABELS_DATA_DIR: "/x" }, "win32"), "/x");
});

test("npm install for Labels deps uses npm.cmd through a shell on Windows", () => {
  assert.deepEqual(npmCommand("win32"), { bin: "npm.cmd", shell: true });
  assert.deepEqual(npmCommand("linux"), { bin: "npm", shell: false });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bft-labels-win-"));
  let seen = null;
  const result = ensureLabelsDeps(tmp, {
    platform: "win32",
    spawnSyncFn: (bin, args, opts) => {
      seen = { bin, args, opts };
      return { status: 0 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(seen.bin, "npm.cmd");
  assert.equal(seen.opts.shell, true);
  assert.equal(seen.opts.windowsHide, true);
});

test("ensureLabelsDeps surfaces a spawn error message", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bft-labels-err-"));
  const result = ensureLabelsDeps(tmp, {
    spawnSyncFn: () => ({ status: null, error: new Error("spawn npm ENOENT") }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT/);
});

test("startLabelsServer runs Electron as Node and sets the data dir when no system Node exists", async () => {
  const appRoot = path.join(__dirname, "..");
  let spawned = null;
  const handle = await startLabelsServer({
    appRoot,
    env: { ...WIN_ENV, ELECTRON_RUN_AS_NODE: "" },
    probeFn: async () => false,
    waitFn: async () => true,
    ensureDepsFn: () => ({ ok: true }),
    resolveRuntimeFn: () => ({ bin: "C:\\electron.exe", asNode: true }),
    spawnFn: (bin, args, opts) => {
      spawned = { bin, args, opts };
      return { pid: 1, unref() {}, on() {}, kill() {} };
    },
  });
  assert.equal(handle.ok, true);
  assert.equal(spawned.bin, "C:\\electron.exe");
  assert.equal(spawned.opts.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(spawned.opts.windowsHide, true);
});

test("startLabelsServer never leaks ELECTRON_RUN_AS_NODE to a real Node", async () => {
  let spawned = null;
  await startLabelsServer({
    appRoot: path.join(__dirname, ".."),
    env: { PATH: process.env.PATH, ELECTRON_RUN_AS_NODE: "1" },
    probeFn: async () => false,
    waitFn: async () => true,
    ensureDepsFn: () => ({ ok: true }),
    resolveRuntimeFn: () => ({ bin: "node", asNode: false }),
    spawnFn: (bin, args, opts) => {
      spawned = opts;
      return { pid: 1, unref() {}, on() {}, kill() {} };
    },
  });
  assert.equal("ELECTRON_RUN_AS_NODE" in spawned.env, false);
});

test("widget flag routing and launch specs avoid npm/cmd", () => {
  assert.equal(isWidgetArgv(["electron.exe", "--widget"]), true);
  assert.equal(isWidgetArgv(["electron.exe", "C:\\app", "--widget", "--view=lot"]), true);
  assert.equal(isWidgetArgv(["electron.exe", "C:\\app"]), false);
  assert.equal(isWidgetArgv(["C:\\Program Files\\x\\app.exe"]), false);

  const dev = electronLaunchSpec({
    execPath: "C:\\e\\electron.exe",
    appRoot: "C:\\Users\\desk\\shop-desktop",
    packaged: false,
    widget: true,
    view: "lot",
  });
  assert.equal(dev.command, "C:\\e\\electron.exe");
  assert.deepEqual(dev.args, ["C:\\Users\\desk\\shop-desktop", "--widget", "--view=lot"]);
  assert.equal(dev.options.detached, true);
  assert.equal(dev.options.shell, undefined);

  const packaged = electronLaunchSpec({
    execPath: "C:\\Program Files\\BFT\\Black Forest Tools.exe",
    appRoot: "C:\\Program Files\\BFT\\resources\\app.asar",
    packaged: true,
    widget: false,
  });
  assert.deepEqual(packaged.args, []);
});

test("package.json starts through entry.js and exposes a widget script", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.equal(pkg.main, "src/entry.js");
  assert.match(pkg.scripts.widget, /--widget/);
});

test("Firefox handoff plan: Linux uses firefox/xdg-open, Windows uses firefox.exe then default browser", () => {
  const { firefoxLaunchPlan, findWindowsFirefox } = require("../src/firefox-launch");
  const url = "https://shop.blackforestautomotive.com/handoff?x=1";
  assert.deepEqual(firefoxLaunchPlan(url, { platform: "linux" }), [
    { cmd: "firefox", args: ["--new-tab", url] },
    { cmd: "xdg-open", args: [url] },
  ]);
  const exe = "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
  assert.equal(findWindowsFirefox(WIN_ENV, (p) => p === exe), exe);
  assert.deepEqual(firefoxLaunchPlan(url, { platform: "win32", env: WIN_ENV, exists: (p) => p === exe }), [
    { cmd: exe, args: ["--new-tab", url] },
    { external: url },
  ]);
  assert.deepEqual(firefoxLaunchPlan(url, { platform: "win32", env: WIN_ENV, exists: () => false }), [{ external: url }]);
});

test("Windows install scripts launch electron.exe directly and include the widget shortcut", () => {
  const root = path.join(__dirname, "..");
  const install = fs.readFileSync(path.join(root, "scripts", "install-windows.ps1"), "utf8");
  assert.match(install, /electron\.exe/);
  assert.match(install, /--widget/);
  assert.match(install, /Black Forest Shop Widget\.lnk/);
  assert.match(install, /-WindowStyle Hidden/);
  const bootstrap = fs.readFileSync(path.join(root, "scripts", "bootstrap-windows.ps1"), "utf8");
  assert.match(bootstrap, /electron\.exe/);
});

function findPwsh() {
  const { spawnSync } = require("node:child_process");
  const candidates = [process.env.PWSH, path.join(os.homedir(), "pwsh", "pwsh"), "pwsh"].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-NoProfile", "-Command", "1"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return "";
}

const PWSH = findPwsh();

test("PowerShell scripts parse cleanly when pwsh is available", { skip: !PWSH }, () => {
  const { spawnSync } = require("node:child_process");
  const root = path.join(__dirname, "..", "scripts");
  for (const name of fs.readdirSync(root).filter((n) => n.endsWith(".ps1"))) {
    const file = path.join(root, name);
    const script = `$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}',[ref]$t,[ref]$e);if($e.Count){$e|ForEach-Object{$_.Message};exit 1}`;
    const result = spawnSync(PWSH, ["-NoProfile", "-Command", script], { encoding: "utf8" });
    assert.equal(result.status, 0, `${name}: ${result.stdout}${result.stderr}`);
  }
});

test("widget session round-trips through the shared file (atomic write)", () => {
  const { writeSession, readSession, clearSession } = require("../src/widget-session");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bft-widget-"));
  const file = path.join(dir, "nested", "widget-session.json");
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  writeSession({ token: "abc", expiresAt, person: "dwight", role: "desk" }, file);
  const read = readSession(file);
  assert.equal(read.token, "abc");
  assert.equal(read.person, "dwight");
  assert.equal(fs.existsSync(`${file}.tmp`), false);
  clearSession(file);
  assert.equal(readSession(file), null);
});
