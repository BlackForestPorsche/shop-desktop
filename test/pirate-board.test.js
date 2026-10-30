"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BOARD_IDS,
  submitBody,
  normalizeBoard,
  formatLeaderboardDetail,
  lockedBoard,
} = require("../src/pirate-board");
const {
  clearPirateBoardCache,
  fetchPirateBoard,
  submitPirateScore,
  pirateBoardFromDesk,
  BOARD_PATH,
} = require("../src/pirate-board-sync");

function sampleBody(extra = {}) {
  return {
    ok: true,
    you: "logan",
    name: "Logan",
    revision: "1.5.28",
    posted: true,
    boards: {
      day: {
        label: "Today",
        rows: [{ person: "logan", name: "Logan", score: 1200, wave: 4, sunk: 9 }],
      },
      week: {
        label: "This week",
        rows: [
          { person: "stephen", name: "Stephen", score: 4000, wave: 8, sunk: 20 },
          { person: "logan", name: "Logan", score: 1200, wave: 4, sunk: 9 },
        ],
      },
      month: { label: "This month", rows: [] },
      revision: {
        label: "This revision (1.5.28)",
        rows: [{ person: "logan", name: "Logan", score: 1200, wave: 4, sunk: 9 }],
      },
    },
    ...extra,
  };
}

test("submit body is score, wave, and sunk — never a person", () => {
  const body = submitBody({
    score: 10.9,
    wave: 2,
    sunk: 1,
    person: "logan",
    revision: "9.9.9",
  });
  assert.deepEqual(body, { score: 10, wave: 2, sunk: 1 });
  assert.equal(Object.hasOwn(body, "person"), false);
  assert.equal(Object.hasOwn(body, "revision"), false);
});

test("normalize keeps day, week, month, and this revision side by side", () => {
  const board = normalizeBoard(sampleBody());
  assert.deepEqual(Object.keys(board.boards), [...BOARD_IDS]);
  assert.equal(board.boards.revision.label, "This revision (1.5.28)");
  assert.equal(board.boards.week.rows[0].person, "stephen");
  assert.equal(board.boards.day.rows[0].person, "logan");
  const text = formatLeaderboardDetail(board);
  assert.match(text, /Today/);
  assert.match(text, /This week/);
  assert.match(text, /This month/);
  assert.match(text, /This revision \(1\.5\.28\)/);
  assert.match(text, /Stephen — 4,000/);
  assert.match(text, /Logan \(you\) — 1,200/);
  assert.match(text, /Signed in as Logan/);
});

test("a locked desk is not presented as an empty company board", () => {
  const text = formatLeaderboardDetail(
    lockedBoard("Sign in on this desk. A score posts only while that person is signed in."),
  );
  assert.match(text, /Sign in on this desk/);
  assert.equal(/No scores yet/.test(text), false);
  assert.equal(/Logan/.test(text), false);
});

test("a score posts with the session token and the app revision, not the payload person", async () => {
  clearPirateBoardCache();
  /** @type {{ method?: string, path?: string, token?: string, body?: Record<string, unknown> }} */
  let seen = {};
  const request = async (method, path, opts) => {
    seen = { method, path, token: opts.token, body: opts.body };
    return { status: 200, body: sampleBody() };
  };
  const readSession = () => ({ token: "stephen-token", person: "stephen" });
  const board = await pirateBoardFromDesk(
    { score: 50, wave: 3, sunk: 4, person: "logan", revision: "0.0.1" },
    { version: "1.5.28", request, readSession, cache: false },
  );
  assert.equal(seen.method, "POST");
  assert.equal(seen.path, BOARD_PATH);
  assert.equal(seen.token, "stephen-token");
  assert.deepEqual(seen.body, { score: 50, wave: 3, sunk: 4, revision: "1.5.28" });
  assert.equal(Object.hasOwn(seen.body, "person"), false);
  assert.equal(board.ok, true);
  assert.equal(board.you, "logan");
  assert.match(board.message, /Posted for Logan/);
});

test("no signed-in session does not call the shop", async () => {
  clearPirateBoardCache();
  let called = 0;
  const board = await submitPirateScore({
    revision: "1.5.28",
    run: { score: 80, wave: 2, sunk: 3, person: "logan" },
    request: async () => {
      called += 1;
      return { status: 200, body: sampleBody() };
    },
    readSession: () => null,
    cache: false,
  });
  assert.equal(called, 0);
  assert.equal(board.ok, false);
  assert.equal(board.error, "locked");
});

test("a zero score only reads the boards", async () => {
  clearPirateBoardCache();
  let method = "";
  const board = await fetchPirateBoard({
    revision: "1.5.28",
    request: async (verb, path) => {
      method = `${verb} ${path}`;
      return { status: 200, body: sampleBody({ posted: false }) };
    },
    readSession: () => ({ token: "t", person: "carla" }),
    cache: false,
  });
  assert.equal(method, "GET /api/widget/pirate-board?revision=1.5.28");
  assert.equal(board.ok, true);
  assert.equal(board.posted, false);
});

test("a missing shop route is not filled in with a local ranking", async () => {
  clearPirateBoardCache();
  const board = await submitPirateScore({
    revision: "1.5.28",
    run: { score: 90, wave: 1, sunk: 1 },
    request: async () => ({ status: 404, body: { error: "not_found" } }),
    readSession: () => ({ token: "t", person: "logan" }),
    cache: false,
  });
  assert.equal(board.ok, false);
  assert.match(board.message, /not published/);
  assert.equal(board.you, "logan");
  assert.equal(board.name, "Logan");
  assert.equal(board.boards.day.rows.length, 0);
  assert.equal(board.boards.revision.rows.length, 0);
});
