"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const {
  registerFloatingBlocker,
  dismissAllFloatingBlockers,
  bindShopInputUnblock,
} = require("../src/input-block-guards");
const { openUpdateProgress, openStartingNotice } = require("../src/update-progress");

test("dismissAllFloatingBlockers closes every registered notice", () => {
  let closed = 0;
  registerFloatingBlocker({ close: () => (closed += 1) });
  registerFloatingBlocker({ close: () => (closed += 1) });
  dismissAllFloatingBlockers();
  assert.equal(closed, 2);
});

test("shop window focus dismisses the slow-start notice", () => {
  let closed = false;
  const notice = { close: () => (closed = true) };
  const handlers = {};
  const wcHandlers = {};
  const win = {
    destroyed: false,
    visible: true,
    isDestroyed: () => false,
    isVisible: () => true,
    on(event, fn) {
      handlers[event] = fn;
    },
    once(event, fn) {
      handlers[`once:${event}`] = fn;
    },
    webContents: {
      destroyed: false,
      loading: false,
      isDestroyed: () => false,
      isLoading: () => false,
      getURL: () => "https://shop.example/",
      on(event, fn) {
        wcHandlers[event] = fn;
      },
    },
  };
  bindShopInputUnblock(win, notice);
  handlers.focus();
  assert.equal(closed, true);
});

test("the starting splash does not show after the shop is already ready", () => {
  const made = [];
  const ready = { ok: false };
  let pending = null;
  const timers = {
    setTimeoutFn: (fn) => {
      pending = fn;
      return 1;
    },
    clearTimeoutFn: () => {},
  };
  const BrowserWindow = class FakeWindow {
    constructor(options) {
      this.options = options;
      this.handlers = {};
      this.destroyed = false;
      made.push(this);
    }
    setMenuBarVisibility() {}
    on(name, fn) {
      this.handlers[name] = fn;
    }
    once(name, fn) {
      this.handlers[name] = fn;
    }
    loadFile() {
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
  const start = openStartingNotice({
    BrowserWindow,
    isReady: () => ready.ok,
    ...timers,
  });
  ready.ok = false;
  pending();
  assert.equal(made.length, 1);
  ready.ok = true;
  made[0].handlers["ready-to-show"]();
  assert.equal(made[0].shown, undefined);
  assert.equal(made[0].destroyed, true);
  start.close();
});

test("bindStartingNoticeDismiss delegates to shop input unblock", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "update-progress.js"), "utf8");
  assert.match(source, /bindShopInputUnblock/);
});