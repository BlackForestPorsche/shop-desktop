"use strict";

const Api = require("./widget-api");
const { readSession: readSharedSession } = require("./shared-session");
const {
  submitBody,
  normalizeBoard,
  lockedBoard,
  unavailableBoard,
} = require("./pirate-board");

const BOARD_PATH = "/api/widget/pirate-board";

/** Last shop payload this process actually received. Display fallback only. */
const sharedCache = { current: null };

function clearPirateBoardCache() {
  sharedCache.current = null;
}

function cacheBox(opts) {
  if (opts && opts.cache === false) return null;
  if (opts && opts.cache && typeof opts.cache === "object") return opts.cache;
  return sharedCache;
}

function withCache(result, allowCache, box) {
  if (!box) return result;
  if (result.ok) {
    box.current = result;
    return result;
  }
  if (!allowCache || !box.current) return result;
  return {
    ...box.current,
    posted: false,
    stale: true,
    message: `${result.message} Showing the last shop board.`,
  };
}

function fromResponse(res, revision) {
  const status = (res && res.status) || 0;
  const body = res && res.body;
  if (status === 200 && body && body.ok && body.boards) {
    return normalizeBoard(body, revision);
  }
  if (status === 401) {
    return lockedBoard("Sign in on this desk. A score posts only while that person is signed in.");
  }
  if (status === 403) {
    return lockedBoard("The shop board is for a desk sign-in.");
  }
  if (status === 404) {
    return unavailableBoard("The shop has not published the pirate board yet.");
  }
  if (status === 400) {
    return unavailableBoard("The shop did not accept that score.");
  }
  if (status === 429) {
    return unavailableBoard("The shop board is busy. Try again in a minute.");
  }
  return unavailableBoard("Could not reach the shop board.");
}

function sessionToken(readSession) {
  try {
    const session = readSession();
    if (!session || !session.token) return "";
    return String(session.token);
  } catch {
    return "";
  }
}

/**
 * GET the four shop boards for this Tools version.
 * Revision comes from the app, not from a renderer payload.
 */
async function fetchPirateBoard(opts = {}) {
  const request = opts.request || Api.request;
  const readSession = opts.readSession || readSharedSession;
  const revision = String(opts.revision || "");
  const box = cacheBox(opts);
  const token = sessionToken(readSession);
  if (!token) {
    if (box) box.current = null;
    return lockedBoard("Sign in on this desk to see the shop board.");
  }
  const path = `${BOARD_PATH}?revision=${encodeURIComponent(revision)}`;
  try {
    const res = await request("GET", path, { token });
    return withCache(fromResponse(res, revision), true, box);
  } catch {
    return withCache(unavailableBoard("Could not reach the shop board."), true, box);
  }
}

/**
 * POST a run for the signed-in person, then return the four boards.
 * `opts.revision` is the Tools version (main process). A person or revision
 * on `opts.run` is ignored.
 */
async function submitPirateScore(opts = {}) {
  const request = opts.request || Api.request;
  const readSession = opts.readSession || readSharedSession;
  const revision = String(opts.revision || "");
  const box = cacheBox(opts);
  const token = sessionToken(readSession);
  if (!token) {
    if (box) box.current = null;
    return lockedBoard(
      "Sign in on this desk. A score posts only while that person is signed in.",
    );
  }
  const body = submitBody(opts.run);
  if (body.score <= 0) return fetchPirateBoard(opts);
  try {
    const res = await request("POST", BOARD_PATH, {
      token,
      body: { score: body.score, wave: body.wave, sunk: body.sunk, revision },
    });
    const board = withCache(fromResponse(res, revision), true, box);
    if (board.ok && !board.message && board.name) {
      board.message = board.posted
        ? `Posted for ${board.name}.`
        : `${board.name} is signed in. This run did not beat a shop best.`;
    }
    return board;
  } catch {
    return withCache(
      unavailableBoard("Could not reach the shop board. This run was not posted."),
      true,
      box,
    );
  }
}

/**
 * Renderer entry. The renderer may send score, wave, and sunk.
 * Person and revision on that payload are ignored; revision is `deps.version`.
 */
function pirateBoardFromDesk(payload, deps = {}) {
  const version = deps.version != null ? deps.version : deps.revision;
  const run = payload && typeof payload === "object" ? payload : null;
  const score = run ? Number(run.score) : 0;
  if (run && Number.isFinite(score) && score > 0) {
    return submitPirateScore({
      revision: version,
      run: { score: run.score, wave: run.wave, sunk: run.sunk },
      request: deps.request,
      readSession: deps.readSession,
      cache: deps.cache,
    });
  }
  return fetchPirateBoard({
    revision: version,
    request: deps.request,
    readSession: deps.readSession,
    cache: deps.cache,
  });
}

module.exports = {
  BOARD_PATH,
  clearPirateBoardCache,
  fetchPirateBoard,
  submitPirateScore,
  pirateBoardFromDesk,
};
