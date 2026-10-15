"use strict";

const fs = require("node:fs");

const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Windows refuses to rename over a file another process holds open (a widget or
 * Desk reading widget-session.json at that instant). Retry briefly; other
 * platforms behave like plain renameSync.
 */
function renameWithRetry(from, to, { attempts = 8, delayMs = 25, rename = fs.renameSync, sleep = sleepSync } = {}) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      lastError = error;
      if (!error || !RETRYABLE.has(error.code)) {
        throw error;
      }
      sleep(delayMs * (i + 1));
    }
  }
  throw lastError;
}

module.exports = { renameWithRetry };
