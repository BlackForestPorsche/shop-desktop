"use strict";

/**
 * Own the Labels (LabelWriter 550) HTTP server from Black Forest Tools.
 *
 * Desk / Create RO keep calling http://127.0.0.1:8080 — we start the vendored
 * `labels/server.mjs` when nothing is already listening (so a leftover
 * labels.service / prior Tools run is adopted, not double-bound).
 */

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const DEFAULT_PORT = 8080;
const PROBE_TIMEOUT_MS = 400;
const READY_TIMEOUT_MS = 8000;
const READY_POLL_MS = 150;

function labelsPort(env = process.env) {
  const raw = env.LABELS_PORT || env.BF_LABELS_PORT || "";
  const n = Number.parseInt(String(raw), 10);
  if (Number.isFinite(n) && n > 0 && n < 65536) return n;
  return DEFAULT_PORT;
}

function labelsUrl(port = labelsPort()) {
  return `http://127.0.0.1:${port}/`;
}

function labelsRootFromAppRoot(appRoot) {
  return path.join(appRoot, "labels");
}

function labelsServerEntry(labelsRoot) {
  return path.join(labelsRoot, "server.mjs");
}

function probeLabels(url = labelsUrl(), { timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitForLabels(url, { timeoutMs = READY_TIMEOUT_MS, pollMs = READY_POLL_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeLabels(url)) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

function ensureLabelsDeps(labelsRoot, { spawnSyncFn = spawnSync } = {}) {
  const marker = path.join(labelsRoot, "node_modules", "pdf-lib");
  if (fs.existsSync(marker)) {
    return { ok: true, installed: false };
  }
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSyncFn(npmBin, ["install", "--omit=dev"], {
    cwd: labelsRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) {
    return {
      ok: false,
      installed: false,
      error: (result.stderr || result.stdout || "npm install failed").trim(),
    };
  }
  return { ok: true, installed: true };
}

/**
 * Start or adopt the Labels server.
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   url: string,
 *   port: number,
 *   adopted: boolean,
 *   owned: boolean,
 *   child: import('node:child_process').ChildProcess | null,
 *   reason: string,
 * }>
 */
async function startLabelsServer({
  appRoot,
  env = process.env,
  probeFn = probeLabels,
  waitFn = waitForLabels,
  spawnFn = spawn,
  ensureDepsFn = ensureLabelsDeps,
} = {}) {
  const port = labelsPort(env);
  const url = labelsUrl(port);
  if (await probeFn(url)) {
    return {
      ok: true,
      url,
      port,
      adopted: true,
      owned: false,
      child: null,
      reason: "adopted existing Labels on :" + port,
    };
  }

  const labelsRoot = labelsRootFromAppRoot(appRoot);
  const entry = labelsServerEntry(labelsRoot);
  if (!fs.existsSync(entry)) {
    return {
      ok: false,
      url,
      port,
      adopted: false,
      owned: false,
      child: null,
      reason: "vendored labels/server.mjs missing",
    };
  }

  const deps = ensureDepsFn(labelsRoot);
  if (!deps.ok) {
    return {
      ok: false,
      url,
      port,
      adopted: false,
      owned: false,
      child: null,
      reason: `labels deps: ${deps.error || "install failed"}`,
    };
  }

  const nodeBin = process.env.LABELS_NODE || process.execPath;
  let child;
  try {
    child = spawnFn(nodeBin, [entry], {
      cwd: labelsRoot,
      env: { ...env, PORT: String(port) },
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    child.unref();
  } catch (error) {
    return {
      ok: false,
      url,
      port,
      adopted: false,
      owned: false,
      child: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const ready = await waitFn(url);
  if (!ready) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      url,
      port,
      adopted: false,
      owned: false,
      child: null,
      reason: "Labels did not become ready on :" + port,
    };
  }

  return {
    ok: true,
    url,
    port,
    adopted: false,
    owned: true,
    child,
    reason: "started vendored Labels server",
  };
}

function stopLabelsServer(handle, { force = false } = {}) {
  if (!handle || !handle.owned || !handle.child) {
    return { stopped: false, reason: "not owned" };
  }
  // Keep Labels up across Tools restarts so Desk print keeps working — only
  // force-kill when the caller explicitly asks (tests / uninstall).
  if (!force) {
    return { stopped: false, reason: "left running for Desk print" };
  }
  try {
    handle.child.kill();
    return { stopped: true, reason: "killed" };
  } catch (error) {
    return {
      stopped: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

module.exports = {
  DEFAULT_PORT,
  labelsPort,
  labelsUrl,
  labelsRootFromAppRoot,
  labelsServerEntry,
  probeLabels,
  waitForLabels,
  ensureLabelsDeps,
  startLabelsServer,
  stopLabelsServer,
};
