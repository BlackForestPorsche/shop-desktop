"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  jobUrl,
  parseFollowBody,
  followDecision,
  createFollowState,
  normalizeEvent,
  readFollowEnabled,
  writeFollowEnabled,
} = require("../src/follow-mode");

test("jobUrl uses lowercase ro and optional tab", () => {
  assert.equal(
    jobUrl("1042"),
    "https://shop.blackforestautomotive.com/job?ro=1042",
  );
  assert.equal(
    jobUrl("J006310", { tab: "kits" }),
    "https://shop.blackforestautomotive.com/job?ro=J006310&tab=kits",
  );
  assert.equal(jobUrl("1042", { tab: "nope" }), "https://shop.blackforestautomotive.com/job?ro=1042");
  assert.equal(jobUrl("  "), "");
});

test("parseFollowBody requires ro as scraped", () => {
  assert.equal(parseFollowBody("{").error, "bad_json");
  assert.equal(parseFollowBody("{}").error, "missing_ro");
  const ok = parseFollowBody(
    JSON.stringify({
      ro: "1042",
      event: "create_ro",
      owner: "Whatcott",
      model: "Boxster",
      tab: "notes",
    }),
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.ro, "1042");
  assert.equal(ok.event, "create");
  assert.equal(ok.owner, "Whatcott");
  assert.equal(ok.model, "Boxster");
  assert.equal(ok.tab, "notes");
});

test("normalizeEvent maps Desk Dwight-style names", () => {
  assert.equal(normalizeEvent("create_ro"), "create");
  assert.equal(normalizeEvent("close_ro"), "close");
  assert.equal(normalizeEvent("cancel_ro"), "cancel");
  assert.equal(normalizeEvent("estimate_saved"), "estimate");
  assert.equal(normalizeEvent("change"), "change");
});

test("followDecision respects toggle, events, and debounce", () => {
  assert.equal(
    followDecision({ enabled: false, payload: { ro: "1", event: "open" } }).reason,
    "follow_off",
  );
  assert.equal(
    followDecision({ enabled: true, payload: { ro: "1", event: "close" } }).reason,
    "event_ignored",
  );
  assert.equal(
    followDecision({
      enabled: true,
      payload: { ro: "1", event: "open" },
      lastRo: "1",
      lastAtMs: 1000,
      nowMs: 1500,
    }).reason,
    "debounced",
  );
  assert.equal(
    followDecision({
      enabled: true,
      payload: { ro: "1", event: "create" },
      lastRo: "1",
      lastAtMs: 1000,
      nowMs: 4000,
    }).navigate,
    true,
  );
});

test("createFollowState persists enabled flag", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-follow-"));
  try {
    assert.equal(readFollowEnabled(dir), false);
    const state = createFollowState({ userDataDir: dir });
    state.setEnabled(true);
    assert.equal(readFollowEnabled(dir), true);
    assert.equal(createFollowState({ userDataDir: dir }).isEnabled(), true);
    writeFollowEnabled(dir, false);
    assert.equal(readFollowEnabled(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
