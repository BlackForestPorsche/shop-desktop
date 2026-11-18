"use strict";

/**
 * AllData Follow mode — Desk POSTs /v1/follow; Tools navigates to /job?ro=…
 * Prefs live in userData (follow-mode.json). Never stores tokens.
 */

const fs = require("node:fs");
const path = require("node:path");
const { SHOP_HOST } = require("./policy");

const PREFS_NAME = "follow-mode.json";
const DEBOUNCE_MS = 2_000;
const NAV_EVENTS = new Set(["open", "create", "change"]);
const TAB_VALUES = new Set(["notes", "details", "guide", "kits"]);

function prefsPath(userDataDir) {
  return path.join(String(userDataDir || ""), PREFS_NAME);
}

function readFollowEnabled(userDataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsPath(userDataDir), "utf8"));
    return Boolean(raw && raw.enabled);
  } catch {
    return false;
  }
}

function writeFollowEnabled(userDataDir, enabled) {
  const dir = String(userDataDir || "");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    prefsPath(dir),
    `${JSON.stringify({ enabled: Boolean(enabled) }, null, 2)}\n`,
    "utf8",
  );
}

function normalizeRo(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

function normalizeTab(value) {
  const tab = String(value || "")
    .trim()
    .toLowerCase();
  return TAB_VALUES.has(tab) ? tab : "";
}

function normalizeEvent(value) {
  const event = String(value || "open")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (event === "create_ro" || event === "create-ro") return "create";
  if (event === "close_ro") return "close";
  if (event === "cancel_ro") return "cancel";
  if (event === "estimate_saved" || event === "estimate_emailed" || event === "estimate") {
    return "estimate";
  }
  if (NAV_EVENTS.has(event) || event === "close" || event === "cancel" || event === "estimate") {
    return event;
  }
  return "open";
}

/**
 * Build the shared site job URL. Query key is always lowercase `ro`.
 * @param {string} ro
 * @param {{ tab?: string, host?: string }} [opts]
 */
function jobUrl(ro, opts = {}) {
  const pageRo = normalizeRo(ro);
  if (!pageRo) return "";
  const host = String(opts.host || SHOP_HOST).trim() || SHOP_HOST;
  const url = new URL(`https://${host}/job`);
  url.searchParams.set("ro", pageRo);
  const tab = normalizeTab(opts.tab);
  if (tab) url.searchParams.set("tab", tab);
  return url.href;
}

function optionalField(value, max) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.slice(0, max);
}

/**
 * Parse Desk Follow POST body. Never requires tokens.
 * @returns {{ ok: true, ro: string, event: string, owner: string, year: string, model: string, job: string, plate: string, tab: string, source: string, at: string } | { ok: false, error: string }}
 */
function parseFollowBody(text) {
  let data;
  try {
    data = JSON.parse(text || "{}");
  } catch {
    return { ok: false, error: "bad_json" };
  }
  if (!data || typeof data !== "object") {
    return { ok: false, error: "bad_request" };
  }
  const ro = normalizeRo(data.ro != null ? data.ro : data.roNumber);
  if (!ro) {
    return { ok: false, error: "missing_ro" };
  }
  return {
    ok: true,
    ro,
    event: normalizeEvent(data.event),
    owner: optionalField(data.owner != null ? data.owner : data.customer, 80),
    year: optionalField(data.year, 8),
    model: optionalField(data.model != null ? data.model : data.car, 48),
    job: optionalField(data.job, 80),
    plate: optionalField(data.plate, 24),
    tab: normalizeTab(data.tab),
    source: optionalField(data.source, 40) || "alldata",
    at: optionalField(data.at, 40) || new Date().toISOString(),
  };
}

/**
 * Decide whether Tools should navigate for this Follow ping.
 * @param {{ enabled: boolean, payload: { ro: string, event: string, tab?: string }, lastRo?: string, lastTab?: string, lastAtMs?: number, nowMs?: number, debounceMs?: number }} args
 */
function followDecision({
  enabled,
  payload,
  lastRo = "",
  lastTab = "",
  lastAtMs = 0,
  nowMs = Date.now(),
  debounceMs = DEBOUNCE_MS,
}) {
  if (!enabled) {
    return { navigate: false, reason: "follow_off" };
  }
  if (!payload || !payload.ro) {
    return { navigate: false, reason: "missing_ro" };
  }
  if (!NAV_EVENTS.has(payload.event)) {
    return { navigate: false, reason: "event_ignored" };
  }
  const tab = normalizeTab(payload.tab) || "";
  if (payload.ro !== lastRo) {
    return { navigate: true, reason: "open_job" };
  }
  if (tab !== lastTab) {
    return { navigate: true, reason: "open_job" };
  }
  if (nowMs - lastAtMs < debounceMs) {
    return { navigate: false, reason: "debounced" };
  }
  return { navigate: false, reason: "unchanged" };
}

function createFollowState({ userDataDir, readEnabled, writeEnabled } = {}) {
  let enabled =
    typeof readEnabled === "function"
      ? Boolean(readEnabled())
      : readFollowEnabled(userDataDir);
  let lastRo = "";
  let lastTab = "";
  let lastAtMs = 0;

  return {
    isEnabled() {
      return enabled;
    },
    setEnabled(next) {
      enabled = Boolean(next);
      if (typeof writeEnabled === "function") {
        writeEnabled(enabled);
      } else if (userDataDir) {
        writeFollowEnabled(userDataDir, enabled);
      }
      return enabled;
    },
    /**
     * @param {ReturnType<typeof parseFollowBody>} payload
     * @param {{ nowMs?: number }} [opts]
     */
    decide(payload, opts = {}) {
      if (!payload || !payload.ok) {
        return { navigate: false, reason: payload && payload.error ? payload.error : "bad_request" };
      }
      const decision = followDecision({
        enabled,
        payload,
        lastRo,
        lastTab,
        lastAtMs,
        nowMs: opts.nowMs,
      });
      const tab = payload.tab || "";
      if (decision.navigate) {
        lastRo = payload.ro;
        lastTab = tab;
        lastAtMs = opts.nowMs != null ? opts.nowMs : Date.now();
      } else if (
        payload.ro === lastRo &&
        tab === lastTab &&
        (decision.reason === "debounced" || decision.reason === "unchanged")
      ) {
        lastAtMs = opts.nowMs != null ? opts.nowMs : Date.now();
      }
      return decision;
    },
  };
}

module.exports = {
  PREFS_NAME,
  DEBOUNCE_MS,
  NAV_EVENTS,
  TAB_VALUES,
  prefsPath,
  readFollowEnabled,
  writeFollowEnabled,
  normalizeRo,
  normalizeTab,
  normalizeEvent,
  jobUrl,
  parseFollowBody,
  followDecision,
  createFollowState,
};
