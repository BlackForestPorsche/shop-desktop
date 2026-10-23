"use strict";

/**
 * Installed first from entry.js (Tools and widget). Goals: a thrown error, a rejected
 * promise, a dead renderer or a dying GPU process never silently ends the app, and
 * whatever happened lands in %LOCALAPPDATA%\blackforest-tools\tools.log plus Crashpad
 * minidumps in ...\blackforest-tools\crashes\.
 */

const path = require("node:path");
const { logDir, createLogger, formatParts } = require("./crash-log");
const gpuFallback = require("./gpu-fallback");

const RENDERER_RELOAD_MAX = 3;
const RENDERER_RELOAD_WINDOW_MS = 2 * 60 * 1000;
const RECOVERABLE_RENDERER_REASONS = new Set(["crashed", "oom", "launch-failed", "integrity-failure", "abnormal-exit"]);

function createLimiter(max, windowMs, clock = Date.now) {
  let hits = [];
  return function allow() {
    const nowMs = clock();
    hits = hits.filter((ts) => nowMs - ts < windowMs);
    if (hits.length >= max) return false;
    hits.push(nowMs);
    return true;
  };
}

function teeConsole(log, target = console) {
  // Must include console.info: pirate launch diagnostics use it, and a GUI
  // Windows start has no attached console — tools.log is the only record.
  for (const [method, level] of [
    ["log", "info"],
    ["info", "info"],
    ["warn", "warn"],
    ["error", "error"],
  ]) {
    const original = target[method] ? target[method].bind(target) : () => {};
    target[method] = (...args) => {
      try {
        log[level](...args);
      } catch {
        // ignore
      }
      try {
        original(...args);
      } catch {
        // A GUI launch (Startup shortcut) can have no valid stdout; that is not a crash.
      }
    };
  }
}

/**
 * @param {{
 *   app: import("electron").App,
 *   crashReporter?: import("electron").CrashReporter,
 *   proc?: NodeJS.Process,
 *   env?: NodeJS.ProcessEnv,
 *   offlinePath?: string,
 *   label?: string,
 *   console?: Console,
 * }} options
 */
function installCrashGuards(options) {
  const app = options.app;
  const proc = options.proc || process;
  const env = options.env || process.env;
  const dir = logDir(env, proc.platform);
  const log = createLogger({ dir, pid: proc.pid });
  const label = options.label || "tools";

  for (const stream of [proc.stdout, proc.stderr]) {
    if (stream && typeof stream.on === "function") stream.on("error", () => {});
  }
  teeConsole(log, options.console || console);

  proc.on("uncaughtException", (error, origin) => {
    log.error(`uncaughtException (${origin || "unknown"})`, error);
  });
  proc.on("unhandledRejection", (reason) => {
    log.error("unhandledRejection", reason);
  });

  try {
    if (options.crashReporter) {
      app.setPath("crashDumps", path.join(dir, "crashes"));
      options.crashReporter.start({ uploadToServer: false, compress: true, ignoreSystemCrashHandler: false });
    }
  } catch (error) {
    log.warn("crashReporter.start failed", error);
  }

  let gpuState = gpuFallback.readState(dir);
  const gpu = gpuFallback.decide({ env, argv: proc.argv, state: gpuState });
  try {
    if (gpu.disableGpu) app.disableHardwareAcceleration();
    if (gpu.disableGpuSandbox) app.commandLine.appendSwitch("disable-gpu-sandbox");
    // Windows: Chromium's native window-occlusion calc can stop/start painting and
    // flicker the frame (partial cover, taskbar peek, another window sliding by).
    // Shop Widget already disables this; Tools must too (same Electron shell).
    if (proc.platform === "win32") {
      app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
    }
  } catch (error) {
    log.warn("GPU fallback could not be applied", error);
  }

  const version = (() => {
    try {
      return typeof app.getVersion === "function" ? app.getVersion() : "";
    } catch {
      return "";
    }
  })();
  log.info(
    `start ${label} v${version || options.version || "?"}`,
    `electron=${proc.versions && proc.versions.electron}`,
    `chrome=${proc.versions && proc.versions.chrome}`,
    `node=${proc.versions && proc.versions.node}`,
    `${proc.platform}/${proc.arch}`,
    `gpu=${gpu.disableGpu ? "off" : "on"}(${gpu.source})${gpu.disableGpuSandbox ? " gpu-sandbox=off" : ""}`,
    `argv=${formatParts([proc.argv.slice(1)])}`,
  );

  const allowReload = createLimiter(RENDERER_RELOAD_MAX, RENDERER_RELOAD_WINDOW_MS);

  app.on("child-process-gone", (_event, details) => {
    log.error("child-process-gone", details);
    if (!details || details.type !== "GPU") return;
    const result = gpuFallback.recordGpuFailure(gpuState, details);
    gpuState = result.state;
    gpuFallback.writeState(dir, gpuState);
    if (result.escalated) {
      log.error(
        `GPU process kept failing; next start runs with ${gpuState.disableGpu ? "hardware acceleration off" : "GPU sandbox off"}. Relaunching.`,
      );
      try {
        app.relaunch();
        app.exit(0);
      } catch (error) {
        log.error("relaunch after GPU fallback failed", error);
      }
    }
  });

  app.on("render-process-gone", (_event, contents, details) => {
    log.error("render-process-gone", details);
    if (!details || !RECOVERABLE_RENDERER_REASONS.has(details.reason)) return;
    setTimeout(() => {
      try {
        if (!contents || contents.isDestroyed()) return;
        if (allowReload()) {
          log.warn("reloading window after renderer exit");
          contents.reload();
        } else if (options.offlinePath) {
          log.warn("renderer keeps dying; showing the offline page");
          contents.loadFile(options.offlinePath).catch((error) => log.error("offline page failed", error));
        }
      } catch (error) {
        log.error("renderer recovery failed", error);
      }
    }, 750);
  });

  app.on("browser-window-created", (_event, win) => {
    try {
      win.on("unresponsive", () => log.warn("window unresponsive"));
      win.on("responsive", () => log.info("window responsive again"));
      win.webContents.on("preload-error", (_e, preloadPath, error) => {
        log.error("preload-error", preloadPath, error);
      });
    } catch (error) {
      log.warn("could not watch window", error);
    }
  });

  return { log, dir, gpu };
}

module.exports = { installCrashGuards, createLimiter, teeConsole };
