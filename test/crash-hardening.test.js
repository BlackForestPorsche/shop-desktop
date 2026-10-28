"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const { logDir, redact, createLogger } = require("../src/crash-log");
const gpu = require("../src/gpu-fallback");
const { installCrashGuards, createLimiter } = require("../src/crash-guard");
const { ensureLabelsDepsAsync, startLabelsServer } = require("../src/labels-server");
const { buildAppMenuTemplate } = require("../src/app-menu");

const SRC = (name) => fs.readFileSync(path.join(__dirname, "..", "src", name), "utf8");

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("log folder is %LOCALAPPDATA%\\blackforest-tools on Windows", () => {
  assert.equal(
    logDir({ LOCALAPPDATA: "C:\\Users\\Logan\\AppData\\Local" }, "win32", "C:\\Users\\Logan"),
    "C:\\Users\\Logan\\AppData\\Local\\blackforest-tools",
  );
  assert.equal(
    logDir({}, "win32", "C:\\Users\\Logan"),
    "C:\\Users\\Logan\\AppData\\Local\\blackforest-tools",
  );
  assert.equal(logDir({ XDG_STATE_HOME: "/s" }, "linux", "/home/x"), path.join("/s", "blackforest-tools"));
  assert.equal(logDir({ BF_TOOLS_LOG_DIR: "/custom" }, "win32", "C:\\x"), "/custom");
});

test("redact hides Bearer tokens, gate cookies and PINs", () => {
  const text = redact('Authorization: Bearer abc.def-123 bf_shop_gate=zzz; {"widgetToken":"secret","pin":"1234"}');
  assert.ok(!/abc\.def|zzz|secret|1234/.test(text), text);
});

test("logger appends, rotates, and never throws on an unwritable folder", () => {
  const dir = tmpDir("bft-log-");
  const log = createLogger({ dir, maxBytes: 400 });
  for (let i = 0; i < 20; i += 1) log.error("boom", new Error(`e${i}`));
  assert.ok(fs.existsSync(path.join(dir, "tools.log")));
  assert.ok(fs.existsSync(path.join(dir, "tools.log.1")), "rotated");

  const blocker = path.join(dir, "file-not-dir");
  fs.writeFileSync(blocker, "x");
  const broken = createLogger({ dir: path.join(blocker, "sub") });
  assert.doesNotThrow(() => broken.error("still fine"));
});

test("GPU fallback: second GPU failure turns acceleration off; env overrides win", () => {
  let state = gpu.emptyState();
  let r = gpu.recordGpuFailure(state, { reason: "crashed" }, 1000);
  assert.equal(r.escalated, false);
  state = r.state;
  r = gpu.recordGpuFailure(state, { reason: "crashed" }, 2000);
  assert.equal(r.escalated, true);
  assert.equal(r.state.disableGpu, true);
  assert.equal(gpu.decide({ env: {}, argv: [], state: r.state }).disableGpu, true);
  assert.equal(gpu.decide({ env: { BF_TOOLS_ENABLE_GPU: "1" }, argv: [], state: r.state }).disableGpu, false);
  assert.equal(gpu.decide({ env: { BF_TOOLS_DISABLE_GPU: "1" }, argv: [], state: gpu.emptyState() }).disableGpu, true);
  assert.equal(gpu.decide({ env: {}, argv: ["--bf-disable-gpu"], state: gpu.emptyState() }).disableGpu, true);
  assert.equal(gpu.decide({ env: {}, argv: [], state: gpu.emptyState() }).source, "default");
});

test("GPU fallback: sandbox launch failure drops the GPU sandbox first; clean exits and old failures are ignored", () => {
  const first = gpu.recordGpuFailure(gpu.emptyState(), { reason: "launch-failed" }, 5000);
  assert.equal(first.state.disableGpuSandbox, true);
  assert.equal(first.state.disableGpu, false);
  assert.equal(first.escalated, true);
  assert.equal(gpu.recordGpuFailure(gpu.emptyState(), { reason: "clean-exit" }, 1).escalated, false);
  const stale = gpu.recordGpuFailure({ ...gpu.emptyState(), failures: [1] }, { reason: "crashed" }, 30 * 60 * 1000);
  assert.equal(stale.state.disableGpu, false);
});

test("GPU fallback state round-trips and tolerates garbage", () => {
  const dir = tmpDir("bft-gpu-");
  assert.deepEqual(gpu.readState(dir), gpu.emptyState());
  fs.writeFileSync(gpu.statePath(dir), "{nope");
  assert.deepEqual(gpu.readState(dir), gpu.emptyState());
  assert.equal(gpu.writeState(dir, { ...gpu.emptyState(), disableGpu: true }), true);
  assert.equal(gpu.readState(dir).disableGpu, true);
});

test("renderer reload limiter allows 3 per window", () => {
  let t = 0;
  const allow = createLimiter(3, 1000, () => t);
  assert.deepEqual([allow(), allow(), allow(), allow()], [true, true, true, false]);
  t = 2000;
  assert.equal(allow(), true);
});

test("installCrashGuards disables CalculateNativeWinOcclusion on Windows only", () => {
  const fakeConsole = { log() {}, warn() {}, error() {} };
  for (const [platform, expect] of [
    ["win32", true],
    ["linux", false],
    ["darwin", false],
  ]) {
    const dir = tmpDir(`bft-occ-${platform}-`);
    const switches = [];
    const app = new EventEmitter();
    Object.assign(app, {
      getVersion: () => "1",
      setPath() {},
      disableHardwareAcceleration() {},
      commandLine: {
        appendSwitch: (name, value) => switches.push(value ? `${name}=${value}` : name),
      },
    });
    const proc = new EventEmitter();
    Object.assign(proc, {
      platform,
      arch: "x64",
      pid: 1,
      argv: ["electron", "."],
      versions: { electron: "38", chrome: "1", node: "22" },
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    installCrashGuards({ app, proc, env: { BF_TOOLS_LOG_DIR: dir }, console: fakeConsole });
    const hit = switches.includes("disable-features=CalculateNativeWinOcclusion");
    assert.equal(hit, expect, platform);
    const basicStore = switches.includes("password-store=basic");
    assert.equal(basicStore, platform === "linux", platform);
  }
});

test("installCrashGuards logs uncaught errors, applies saved GPU fallback, and relaunches once on GPU failure", () => {
  const dir = tmpDir("bft-guard-");
  gpu.writeState(dir, { ...gpu.emptyState(), disableGpu: true });
  const calls = [];
  const app = new EventEmitter();
  Object.assign(app, {
    getVersion: () => "9.9.9",
    setPath: () => {},
    disableHardwareAcceleration: () => calls.push("disable-gpu"),
    commandLine: { appendSwitch: (s) => calls.push(`switch:${s}`) },
    relaunch: () => calls.push("relaunch"),
    exit: () => calls.push("exit"),
  });
  const proc = new EventEmitter();
  Object.assign(proc, {
    platform: "linux",
    arch: "x64",
    pid: 1,
    argv: ["electron", "."],
    versions: { electron: "38", chrome: "1", node: "22" },
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  const fakeConsole = { log() {}, warn() {}, error() {}, info() {} };
  const guard = installCrashGuards({
    app,
    proc,
    env: { BF_TOOLS_LOG_DIR: dir },
    crashReporter: { start: () => calls.push("crashReporter") },
    console: fakeConsole,
  });
  assert.ok(calls.includes("disable-gpu"));
  assert.ok(calls.includes("crashReporter"));
  assert.equal(calls.some((c) => String(c).includes("CalculateNativeWinOcclusion")), false);

  proc.emit("uncaughtException", new Error("kaboom"), "uncaughtException");
  proc.emit("unhandledRejection", new Error("rejected"));
  proc.stdout.emit("error", new Error("EPIPE"));
  fakeConsole.error("Labels server failed:", "no node");
  fakeConsole.info("pirate: launch-requested from-settings");
  fakeConsole.log("pirate: menu-click");
  const text = fs.readFileSync(path.join(guard.dir, "tools.log"), "utf8");
  assert.match(text, /start tools v9\.9\.9/);
  assert.match(text, /kaboom/);
  assert.match(text, /rejected/);
  assert.match(text, /Labels server failed/);
  // console.info must reach tools.log (1.5.22 logged pirate: via info only — invisible on Windows).
  assert.match(text, /pirate: launch-requested from-settings/);
  assert.match(text, /pirate: menu-click/);

  const fresh = tmpDir("bft-guard2-");
  const app2 = new EventEmitter();
  Object.assign(app2, {
    getVersion: () => "1",
    setPath() {},
    disableHardwareAcceleration() {},
    commandLine: { appendSwitch() {} },
    relaunch: () => calls.push("relaunch2"),
    exit: () => calls.push("exit2"),
  });
  installCrashGuards({ app: app2, proc, env: { BF_TOOLS_LOG_DIR: fresh }, console: fakeConsole });
  app2.emit("child-process-gone", {}, { type: "GPU", reason: "crashed" });
  assert.ok(!calls.includes("relaunch2"));
  app2.emit("child-process-gone", {}, { type: "GPU", reason: "crashed" });
  assert.ok(calls.includes("relaunch2") && calls.includes("exit2"));
  assert.equal(gpu.readState(fresh).disableGpu, true);
});

test("Labels spawn failures and a missing npm are reported, not thrown", async () => {
  const appRoot = path.join(__dirname, "..");
  const handle = await startLabelsServer({
    appRoot,
    probeFn: async () => false,
    waitFn: async () => true,
    ensureDepsFn: async () => ({ ok: true }),
    spawnFn: () => {
      throw new Error("spawn EINVAL");
    },
  });
  assert.equal(handle.ok, false);
  assert.match(handle.reason, /EINVAL/);

  const tmp = tmpDir("bft-labels-async-");
  const res = await ensureLabelsDepsAsync(tmp, {
    spawnFn: () => {
      throw new Error("npm missing");
    },
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /npm missing/);

  const failing = await ensureLabelsDepsAsync(tmp, {
    spawnFn: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setImmediate(() => {
        child.stderr.emit("data", "ENOTFOUND registry");
        child.emit("close", 1);
      });
      return child;
    },
  });
  assert.equal(failing.ok, false);
  assert.match(failing.error, /ENOTFOUND/);

  fs.mkdirSync(path.join(tmp, "node_modules", "pdf-lib"), { recursive: true });
  assert.deepEqual(await ensureLabelsDepsAsync(tmp, { spawnFn: () => assert.fail("no npm") }), {
    ok: true,
    installed: false,
  });
});

test("Help menu offers the logs folder when wired", () => {
  const noop = () => {};
  const base = {
    onShopHome: noop, onBack: noop, onForward: noop, onReload: noop, onHardReload: noop,
    onCheckSiteUpdates: noop, onCheckAppUpdates: noop, onOpenFirefoxSignedIn: noop,
    onLabelsStatus: noop, onRestartLabels: noop, onLockShop: noop, onOpenInBrowser: noop,
    onAbout: noop, revisionLabel: null,
  };
  const help = (h) => buildAppMenuTemplate(h).find((i) => i.label === "Help").submenu.map((i) => i.label);
  assert.ok(!help(base).some((l) => /logs/i.test(l)));
  assert.ok(help({ ...base, onOpenLogs: noop }).some((l) => /logs folder/i.test(l)));
});

test("crash-prone paths stay guarded in source", () => {
  const main = SRC("main.js");
  assert.match(main, /sharedSessionWatcher\.on\("error"/);
  assert.match(main, /function loadUrlSafe/);
  assert.equal(/\n\s*(?:await )?mainWindow\.loadURL\(/.test(main), false);
  assert.match(main, /startupStep\("gate-session"/);
  assert.match(main, /ensureLabelsRunning\(\{ interactive: false \}\)\.catch/);
  assert.match(SRC("shell-chrome.js"), /failIdle\(error\)/);
  assert.match(SRC("entry.js"), /installCrashGuards/);
  assert.match(SRC("shell-update.js"), /await runGitAsync\(root, \["fetch"/);
  assert.match(SRC("shell-update.js"), /resolveGitUpdateRoot/);
  assert.match(SRC("main.js"), /relaunchAfterGitUpdate/);
});

test("teeConsole hooks console.info into tools.log", () => {
  const source = SRC("crash-guard.js");
  assert.match(source, /\["info", "info"\]/);
  assert.match(source, /Must include console\.info/);
});

test("openPirateGameWindow focuses an existing window or creates one", () => {
  const { openPirateGameWindow } = require("../src/pirate-window");
  const created = [];
  class FakeWin {
    constructor(opts) {
      created.push(opts);
      this.opts = opts;
      this._destroyed = false;
      this._visible = false;
      this.webContents = { send: (...args) => (this._sent = args) };
    }
    isDestroyed() {
      return this._destroyed;
    }
    isMinimized() {
      return false;
    }
    isVisible() {
      return this._visible;
    }
    restore() {}
    show() {
      this._visible = true;
    }
    focus() {}
    once(ev, fn) {
      if (ev === "ready-to-show") setImmediate(fn);
    }
    on() {}
    loadFile() {
      return Promise.resolve();
    }
  }
  const first = openPirateGameWindow({ BrowserWindow: FakeWin, parent: null, existing: null });
  assert.equal(first.ok, true);
  assert.equal(first.reason, "opened-dedicated-window");
  assert.equal(created.length, 1);
  assert.match(created[0].webPreferences.preload, /pirate-preload\.js/);

  const again = openPirateGameWindow({
    BrowserWindow: FakeWin,
    parent: null,
    existing: first.window,
  });
  assert.equal(again.ok, true);
  assert.equal(again.reason, "focused-existing");
  assert.deepEqual(first.window._sent, ["shell:pirate-relaunch"]);
  assert.equal(created.length, 1, "did not create a second window");
});

test("attachPirateShellOverlay covers parent content without a second window", () => {
  const { attachPirateShellOverlay, detachPirateShellOverlay } = require("../src/pirate-window");
  const views = [];
  class FakeWCV {
    constructor(opts) {
      this.opts = opts;
      this.webContents = {
        isDestroyed: () => false,
        destroy() {},
        loadFile() {
          return Promise.resolve();
        },
        send() {},
      };
      views.push(this);
    }
    setBackgroundColor() {}
    setBounds(b) {
      this.bounds = b;
    }
  }
  const children = [];
  const parent = {
    isDestroyed: () => false,
    getContentSize: () => [1024, 768],
    contentView: {
      addChildView(v) {
        children.push(v);
      },
      removeChildView(v) {
        const i = children.indexOf(v);
        if (i >= 0) children.splice(i, 1);
      },
    },
  };
  const attached = attachPirateShellOverlay({
    parent,
    WebContentsView: FakeWCV,
    existing: null,
  });
  assert.equal(attached.ok, true);
  assert.match(attached.reason, /shell-overlay/);
  assert.equal(views.length, 1);
  assert.equal(children.length, 1);
  assert.deepEqual(views[0].bounds, { x: 0, y: 0, width: 1024, height: 768 });
  assert.match(views[0].opts.webPreferences.preload, /pirate-preload\.js/);
  detachPirateShellOverlay(parent, attached.handle);
  assert.equal(children.length, 0);
});
