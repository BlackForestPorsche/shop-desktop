"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  upToDateDetail,
  changeLines,
  gitUpdateDetail,
  updateFailedDetail,
  releaseUpdateDetail,
  aboutDetail,
} = require("../src/dialog-copy");
const {
  openUpdateProgress,
  openStartingNotice,
  bindStartingNoticeDismiss,
  STARTING_HTML,
  UPDATING_HTML,
} = require("../src/update-progress");

// Words a person at the desk should never have to read in a dialog.
const INTERNAL = /git pull|npm install|checkout|bootstrap|localhost|127\.0\.0\.1|Bearer|SPA|\.json|:8080|:8788/i;

test("update dialogs speak in plain words on every path", () => {
  const texts = [
    upToDateDetail("git", "1.5.35", "win32"),
    upToDateDetail("git", "1.5.35", "linux"),
    upToDateDetail("release", "1.5.35", "win32"),
    upToDateDetail("release", "1.5.35", "linux"),
    gitUpdateDetail({ summary: "abc1234 Fix the Yard button", shortCurrent: "aaaaaaa", shortUpstream: "bbbbbbb" }),
    gitUpdateDetail({}, { restartOnly: true }),
    gitUpdateDetail({}, { restartOnly: true, what: "The widget" }),
    releaseUpdateDetail({ currentVersion: "1.5.30", assetName: "Black.Forest.Tools-Setup-1.5.35.exe" }),
    releaseUpdateDetail({ currentVersion: "1.5.30", gitError: "auth failed" }),
    aboutDetail({ version: "1.5.35", revision: "Version 1.5.35 (abc1234)", labelsRunning: true }),
    aboutDetail({ version: "1.5.35", labelsRunning: false }),
  ];
  for (const text of texts) {
    assert.ok(text.length > 20);
    assert.equal(INTERNAL.test(text), false, text);
  }
});

test("an up-to-date Portable copy on Windows points at Setup", () => {
  assert.match(upToDateDetail("release", "1.5.35", "win32"), /Setup/);
  assert.equal(/Setup/.test(upToDateDetail("git", "1.5.35", "win32")), false);
  assert.match(upToDateDetail("git", "1.5.35", "linux"), /1\.5\.35/);
});

test("the update prompt lists what is new without commit ids or merges", () => {
  const lines = changeLines(
    [
      "4b62a65 Tools 1.5.34: fix Yard button",
      "2305f27 Merge pull request #69 from BlackForestPorsche/x",
      "24a3a27 Fix Windows desks opening the default Electron page",
      "967dc08 Fix Windows desks opening the default Electron page",
    ].join("\n"),
  );
  assert.deepEqual(lines, [
    "• Tools 1.5.34: fix Yard button",
    "• Fix Windows desks opening the default Electron page",
  ]);
  const many = changeLines(Array.from({ length: 9 }, (_, i) => `abcdef${i} Change ${i}`).join("\n"));
  assert.equal(many.length, 6);
  assert.equal(many[5], "• and 4 more");
  assert.deepEqual(changeLines(""), []);
});

test("a failed update says Tools still works and what to do next", () => {
  const win = updateFailedDetail(new Error("fatal: unable to access\nline two\nline three\nline four"), "win32");
  assert.match(win, /keeps working/);
  assert.match(win, /Setup again/);
  assert.match(win, /Reason: line two line three line four/);
  assert.match(updateFailedDetail("boom", "linux"), /install-manjaro\.sh/);
});

test("About says whether labels can print", () => {
  assert.match(aboutDetail({ version: "1.5.35", labelsRunning: true }), /which is running/);
  assert.match(aboutDetail({ version: "1.5.35", labelsRunning: false }), /Restart Labels service/);
  assert.match(aboutDetail({ version: "1.5.35" }), /^Version 1\.5\.35/);
});

function fakeBrowserWindow(log) {
  return class FakeWindow {
    constructor(options) {
      this.options = options;
      this.handlers = {};
      this.destroyed = false;
      log.push(this);
    }
    setMenuBarVisibility() {}
    on(name, fn) {
      this.handlers[name] = fn;
    }
    once(name, fn) {
      this.handlers[name] = fn;
    }
    loadFile(file) {
      this.file = file;
      return Promise.resolve();
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
    show() {
      this.shown = true;
    }
  };
}

test("the update notice cannot be closed by hand until the update ends", () => {
  const made = [];
  const notice = openUpdateProgress(null, { BrowserWindow: fakeBrowserWindow(made) });
  assert.equal(made.length, 1);
  assert.equal(made[0].file, UPDATING_HTML);
  let prevented = false;
  made[0].handlers.close({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
  notice.close();
  assert.equal(made[0].destroyed, true);
  notice.close();
});

function fakeShopWindow({
  visible = false,
  loading = true,
  url = "about:blank",
  handlers = {},
} = {}) {
  const wcHandlers = {};
  return {
    destroyed: false,
    visible,
    webContents: {
      destroyed: false,
      loading,
      getURL: () => url,
      isDestroyed() {
        return this.destroyed;
      },
      isLoading: () => loading,
      on(event, fn) {
        wcHandlers[event] = fn;
      },
      emit(event, ...args) {
        if (wcHandlers[event]) wcHandlers[event](...args);
      },
    },
    isDestroyed() {
      return this.destroyed;
    },
    isVisible() {
      return this.visible;
    },
    on(event, fn) {
      handlers[event] = fn;
    },
    once(event, fn) {
      handlers[event] = fn;
    },
    emit(event) {
      if (handlers[event]) handlers[event]();
    },
    wcHandlers,
  };
}

test("the starting notice goes away when the shop finishes loading", () => {
  const made = [];
  let pending = null;
  const timers = {
    setTimeoutFn: (fn) => {
      pending = fn;
      return 1;
    },
    clearTimeoutFn: () => {},
  };
  const notice = openStartingNotice({ BrowserWindow: fakeBrowserWindow(made), ...timers });
  const win = fakeShopWindow({ visible: false, loading: true, url: "https://shop.example/" });
  bindStartingNoticeDismiss(win, notice);
  pending();
  assert.equal(made.length, 1);
  win.webContents.loading = false;
  win.webContents.emit("did-finish-load");
  assert.equal(made[0].destroyed, true);
});

test("the starting notice skips the splash when the shop is already usable", () => {
  const made = [];
  let pending = null;
  const ready = { ok: true };
  const timers = {
    setTimeoutFn: (fn) => {
      pending = fn;
      return 1;
    },
    clearTimeoutFn: () => {
      pending = null;
    },
  };
  const start = openStartingNotice({
    BrowserWindow: fakeBrowserWindow(made),
    isReady: () => ready.ok,
    ...timers,
  });
  ready.ok = true;
  pending();
  assert.equal(made.length, 0);
  start.close();
});

test("the starting notice shows only for a slow start", () => {
  const made = [];
  let pending = null;
  const timers = {
    setTimeoutFn: (fn) => {
      pending = fn;
      return 1;
    },
    clearTimeoutFn: () => {
      pending = null;
    },
  };
  const BrowserWindow = fakeBrowserWindow(made);

  // A normal start: the window opens before the delay runs out.
  const quick = openStartingNotice({ BrowserWindow, ...timers });
  quick.close();
  assert.equal(pending, null);
  assert.equal(made.length, 0);

  // A slow start: the notice appears, can be closed by hand, and goes away with the window.
  const slow = openStartingNotice({ BrowserWindow, ...timers });
  pending();
  assert.equal(made.length, 1);
  assert.equal(made[0].file, STARTING_HTML);
  let prevented = false;
  made[0].handlers.close({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, false);
  slow.close();
  assert.equal(made[0].destroyed, true);
});

test("the notice pages and the offline page exist and run no remote code", () => {
  for (const file of [UPDATING_HTML, STARTING_HTML]) {
    const html = fs.readFileSync(file, "utf8");
    assert.match(html, /default-src 'none'/);
    assert.equal(/<script/i.test(html), false);
  }
  const offline = fs.readFileSync(path.join(__dirname, "..", "assets", "offline.html"), "utf8");
  assert.match(offline, /Trying again by itself/);
  assert.equal(/src="http/i.test(offline), false);
});
