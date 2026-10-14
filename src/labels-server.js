"use strict";

/**
 * Own the Labels (LabelWriter 550) HTTP server from Black Forest Tools.
 *
 * Desk / Create RO keep calling http://127.0.0.1:8080. Tools either adopts an
 * already-running Labels process (legacy labels.service / start-labels.sh) or
 * spawns the vendored copy under labels/ with system Node.
 *
 * Not part of the pirate idle overlay — print path stays LabelWriter via CUPS
 * / PrintTo inside the Labels server.
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const DEFAULT_PORT = 8080;
const DEFAULT_HOST = "127.0.0.1";
const PROBE_TIMEOUT_MS = 1500;
const READY_WAIT_MS = 12_000;
const READY_POLL_MS = 200;

function labelsPort(env = process.env) {
  const raw = env.LABELS_PORT || env.BF_LABELS_PORT || env.PORT;
  const n = raw ? Number.parseInt(String(raw), 10) : DEFAULT_PORT;
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

function labelsRootFromAppRoot(appRoot) {
  return path.join(appRoot, "labels");
}

function labelsServerEntry(labelsRoot) {
  return path.join(labelsRoot, "server.mjs");
}

function labelsUrl(port = DEFAULT_PORT, host = DEFAULT_HOST) {
  return `http://${host}:${port}/`;
}

function resolveNodeBinary(env = process.env) {
  if (env.LABELS_NODE && fs.existsSync(env.LABELS_NODE)) return env.LABELS_NODE;
  if (process.platform === "win32") {
    return "node.exe";
  }
  for (const candidate of ["/usr/bin/node", "/usr/local/bin/node"]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "node";
}

function probeLabels(url, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitUntilReady(url, { timeoutMs = READY_WAIT_MS, pollMs = READY_POLL_MS } = {}) {
  const started = Date.now();
  return new Promise(async (resolve) => {
    while (Date.now() - started < timeoutMs) {
      if (await probeLabels(url)) {
        resolve(true);
        return;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    resolve(false);
  });
}

function ensureLabelsDeps(labelsRoot, { npmBin = "npm", spawnSyncFn } = {}) {
  const nodeModules = path.join(labelsRoot, "node_modules");
  const pdfLib = path.join(nodeModules, "pdf-lib");
  if (fs.existsSync(pdfLib)) {
    return { ok: true, installed: false };
  }
  const spawnSync = spawnSyncFn || require("node:child_process").spawnSync;
  const result = spawnSync(npmBin, ["install", "--omit=dev"], {
    cwd: labelsRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "npm install failed").trim();
    return { ok: false, installed: false, error: detail.split("\n").slice(-3).join(" ") };
  }
  return { ok: true, installed: true };
}

async function startLabelsServer(options) {
  const env = options.env || process.env;
  const port = labelsPort(env);
  const host = DEFAULT_HOST;
  const url = labelsUrl(port, host);
  const log = options.log || console.log;
  const probe = options.probeFn || probeLabels;
  const wait = options.waitFn || waitUntilReady;
  const ensureDeps = options.ensureDepsFn || ensureLabelsDeps;
  const spawnFn = options.spawnFn || spawn;

  if (await probe(url)) {
    return {
      ok: true,
      owned: false,
      adopted: true,
      port,
      url,
      child: null,
      reason: "Labels already answering on port — adopted existing server.",
    };
  }

  const labelsRoot = labelsRootFromAppRoot(options.appRoot);
  const entry = labelsServerEntry(labelsRoot);
  if (!fs.existsSync(entry)) {
    return {
      ok: false,
      owned: false,
      adopted: false,
      port,
      url,
      child: null,
      reason: `Vendored Labels server missing at ${entry}`,
    };
  }

  const deps = ensureDeps(labelsRoot);
  if (!deps.ok) {
    return {
      ok: false,
      owned: false,
      adopted: false,
      port,
      url,
      child: null,
      reason: `Labels dependencies missing: ${deps.error || "npm install failed"}`,
    };
  }

  const nodeBin = resolveNodeBinary(env);
  const childEnv = {
    ...env,
    PORT: String(port),
    LABELS_PORT: String(port),
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  const logDir =
    process.platform === "win32"
      ? path.join(env.LOCALAPPDATA || env.TEMP || labelsRoot, "blackforest-tools")
      : path.join(env.XDG_STATE_HOME || path.join(env.HOME || labelsRoot, ".local", "state"), "blackforest-tools");
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    // best-effort
  }
  const logFile = path.join(logDir, "labels-server.log");
  let out = "ignore";
  let err = "ignore";
  try {
    const fd = fs.openSync(logFile, "a");
    out = fd;
    err = fd;
  } catch {
    // ignore
  }

  const child = spawnFn(nodeBin, [entry], {
    cwd: labelsRoot,
    env: childEnv,
    detached: true,
    stdio: ["ignore", out, err],
    windowsHide: true,
  });
  child.unref();

  child.on("error", (error) => {
    log("Labels server child error:", error);
  });

  const ready = await wait(url);
  if (!ready) {
    try {
      child.kill();
    } catch {
      // ignore
    }
    return {
      ok: false,
      owned: false,
      adopted: false,
      port,
      url,
      child: null,
      reason: `Labels server did not become ready at ${url} (log: ${logFile})`,
    };
  }

  log(`Labels server owned by Tools at ${url}`);
  return {
    ok: true,
    owned: true,
    adopted: false,
    port,
    url,
    child,
    reason: "Started vendored Labels server.",
    logFile,
  };
}

function stopLabelsServer(handle, { force = false } = {}) {
  if (!handle || !handle.owned || !handle.child) {
    return { stopped: false };
  }
  if (!force) {
    return { stopped: false, reason: "left running for Desk print" };
  }
  try {
    if (process.platform === "win32") {
      handle.child.kill();
    } else {
      try {
        process.kill(-handle.child.pid, "SIGTERM");
      } catch {
        handle.child.kill("SIGTERM");
      }
    }
    return { stopped: true };
  } catch (error) {
    return { stopped: false, reason: String(error && error.message ? error.message : error) };
  }
}

module.exports = {
  DEFAULT_PORT,
  DEFAULT_HOST,
  labelsPort,
  labelsRootFromAppRoot,
  labelsServerEntry,
  labelsUrl,
  resolveNodeBinary,
  probeLabels,
  waitUntilReady,
  ensureLabelsDeps,
  startLabelsServer,
  stopLabelsServer,
};
