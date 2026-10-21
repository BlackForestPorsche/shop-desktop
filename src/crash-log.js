"use strict";

/**
 * Tools log file. Never throws: a full disk or a locked file must not become a crash.
 *
 * Windows: %LOCALAPPDATA%\blackforest-tools\tools.log (rotates to tools.log.1)
 * Linux:   $XDG_STATE_HOME/blackforest-tools/tools.log
 * Override the folder with BF_TOOLS_LOG_DIR.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const util = require("node:util");

const DIR_NAME = "blackforest-tools";
const LOG_NAME = "tools.log";
const MAX_LOG_BYTES = 1024 * 1024;
const BURST_LINES = 200;
const BURST_WINDOW_MS = 10_000;

function logDir(env = process.env, platform = process.platform, homedir = os.homedir()) {
  if (env.BF_TOOLS_LOG_DIR) return env.BF_TOOLS_LOG_DIR;
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.win32.join(homedir, "AppData", "Local");
    return path.win32.join(local, DIR_NAME);
  }
  return path.join(env.XDG_STATE_HOME || path.join(homedir, ".local", "state"), DIR_NAME);
}

/** Bearer / gate tokens and PINs must never land in a file Logan emails around. */
function redact(text) {
  return String(text)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/(bf_shop_gate=)[^;\s"']+/gi, "$1[redacted]")
    .replace(
      /("?(?:token|widgetToken|gateToken|pin|password)"?\s*[:=]\s*"?)[^",\s}&]+/gi,
      "$1[redacted]",
    );
}

function formatPart(part) {
  if (part instanceof Error) {
    return part.stack || `${part.name}: ${part.message}`;
  }
  if (typeof part === "string") return part;
  try {
    return util.inspect(part, { depth: 3, breakLength: 160, maxArrayLength: 20, maxStringLength: 2000 });
  } catch {
    return "[unprintable]";
  }
}

function formatParts(parts) {
  return redact(parts.map(formatPart).join(" "));
}

/**
 * @param {{ dir: string, fileName?: string, maxBytes?: number, fsImpl?: typeof fs, clock?: () => number, pid?: number }} options
 */
function createLogger(options) {
  const dir = options.dir;
  const fileName = options.fileName || LOG_NAME;
  const maxBytes = options.maxBytes || MAX_LOG_BYTES;
  const fsImpl = options.fsImpl || fs;
  const clock = options.clock || Date.now;
  const pid = options.pid || process.pid;
  const file = path.join(dir, fileName);

  let ready = false;
  let bytes = 0;
  let windowStart = 0;
  let windowLines = 0;
  let dropped = 0;

  function ensureReady() {
    if (ready) return true;
    try {
      fsImpl.mkdirSync(dir, { recursive: true });
      try {
        bytes = fsImpl.statSync(file).size;
      } catch {
        bytes = 0;
      }
      ready = true;
    } catch {
      return false;
    }
    return true;
  }

  function rotate() {
    try {
      try {
        fsImpl.unlinkSync(`${file}.1`);
      } catch {
        // none yet
      }
      fsImpl.renameSync(file, `${file}.1`);
    } catch {
      try {
        fsImpl.writeFileSync(file, "");
      } catch {
        // give up quietly
      }
    }
    bytes = 0;
  }

  function write(level, ...parts) {
    try {
      const nowMs = clock();
      if (nowMs - windowStart > BURST_WINDOW_MS) {
        windowStart = nowMs;
        windowLines = 0;
        if (dropped) {
          const note = `${new Date(nowMs).toISOString()} [warn] pid=${pid} (${dropped} log lines suppressed)\n`;
          dropped = 0;
          append(note);
        }
      }
      if (windowLines >= BURST_LINES) {
        dropped += 1;
        return;
      }
      windowLines += 1;
      append(`${new Date(nowMs).toISOString()} [${level}] pid=${pid} ${formatParts(parts)}\n`);
    } catch {
      // logging is best-effort
    }
  }

  function append(line) {
    if (!ensureReady()) return;
    if (bytes + line.length > maxBytes) rotate();
    fsImpl.appendFileSync(file, line);
    bytes += line.length;
  }

  return {
    dir,
    file,
    info: (...parts) => write("info", ...parts),
    warn: (...parts) => write("warn", ...parts),
    error: (...parts) => write("error", ...parts),
  };
}

module.exports = { DIR_NAME, LOG_NAME, MAX_LOG_BYTES, logDir, redact, formatParts, createLogger };
