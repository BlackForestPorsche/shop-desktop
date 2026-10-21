"use strict";

/**
 * GPU process fallback. A flaky Windows GPU driver (RDP, VM, old Intel/AMD, sandbox
 * launch failure) makes Chromium restart the GPU process and, after a few failures,
 * take the whole browser process down. Count GPU failures; the second one turns
 * hardware acceleration off for the next start (first sandbox failure also drops the
 * GPU sandbox). State lives in gpu-fallback.json next to tools.log.
 *
 * Force off: BF_TOOLS_DISABLE_GPU=1 or --bf-disable-gpu
 * Force on:  BF_TOOLS_ENABLE_GPU=1 (ignores the saved fallback; delete gpu-fallback.json to reset)
 */

const fs = require("node:fs");
const path = require("node:path");

const STATE_NAME = "gpu-fallback.json";
const FAIL_LIMIT = 2;
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const SANDBOX_REASONS = new Set(["launch-failed", "integrity-failure"]);

function emptyState() {
  return { disableGpu: false, disableGpuSandbox: false, failures: [], reason: "", at: "" };
}

function statePath(dir) {
  return path.join(dir, STATE_NAME);
}

function readState(dir, fsImpl = fs) {
  try {
    const raw = JSON.parse(fsImpl.readFileSync(statePath(dir), "utf8"));
    return {
      ...emptyState(),
      disableGpu: raw.disableGpu === true,
      disableGpuSandbox: raw.disableGpuSandbox === true,
      failures: Array.isArray(raw.failures) ? raw.failures.filter((n) => Number.isFinite(n)) : [],
      reason: typeof raw.reason === "string" ? raw.reason : "",
      at: typeof raw.at === "string" ? raw.at : "",
    };
  } catch {
    return emptyState();
  }
}

function writeState(dir, state, fsImpl = fs) {
  try {
    fsImpl.mkdirSync(dir, { recursive: true });
    fsImpl.writeFileSync(statePath(dir), JSON.stringify(state, null, 2));
    return true;
  } catch {
    return false;
  }
}

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

/** What to apply before app.ready. */
function decide({ env = process.env, argv = process.argv, state = emptyState() } = {}) {
  if (truthy(env.BF_TOOLS_ENABLE_GPU)) {
    return { disableGpu: false, disableGpuSandbox: false, source: "env-enable" };
  }
  if (truthy(env.BF_TOOLS_DISABLE_GPU) || argv.includes("--bf-disable-gpu")) {
    return { disableGpu: true, disableGpuSandbox: state.disableGpuSandbox, source: "forced" };
  }
  if (state.disableGpu || state.disableGpuSandbox) {
    return {
      disableGpu: state.disableGpu,
      disableGpuSandbox: state.disableGpuSandbox,
      source: "fallback-file",
    };
  }
  return { disableGpu: false, disableGpuSandbox: false, source: "default" };
}

/**
 * Record one GPU process failure. `escalated` is true when this failure turned a
 * fallback on that was off before (caller relaunches so it takes effect).
 */
function recordGpuFailure(state, details, nowMs = Date.now()) {
  const reason = String((details && details.reason) || "");
  if (reason === "clean-exit") {
    return { state, escalated: false };
  }
  const failures = [...state.failures, nowMs].filter((ts) => nowMs - ts <= FAIL_WINDOW_MS);
  const next = { ...state, failures, reason: reason || "unknown", at: new Date(nowMs).toISOString() };
  if (SANDBOX_REASONS.has(reason)) next.disableGpuSandbox = true;
  if (failures.length >= FAIL_LIMIT) next.disableGpu = true;
  const escalated =
    (next.disableGpu && !state.disableGpu) || (next.disableGpuSandbox && !state.disableGpuSandbox);
  return { state: next, escalated };
}

module.exports = {
  STATE_NAME,
  FAIL_LIMIT,
  emptyState,
  statePath,
  readState,
  writeState,
  decide,
  recordGpuFailure,
};
