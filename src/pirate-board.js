"use strict";

/** Shop pirate boards. Day / week / month are the ongoing periods. Revision is this Tools version. */
const BOARD_IDS = Object.freeze(["day", "week", "month", "revision"]);

const DEFAULT_LABELS = Object.freeze({
  day: "Today",
  week: "This week",
  month: "This month",
  revision: "This revision",
});

/** Same cap the shop route accepts. A run above this is not a real pirate score. */
const MAX_SCORE = 2_000_000;

function whole(value, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(max, n);
}

/**
 * Score payload for the shop. The signed-in desk person is not a field —
 * the shop reads that off the widget session.
 * @param {{ score?: number, wave?: number, sunk?: number }} [run]
 */
function submitBody(run) {
  return {
    score: whole(run && run.score, MAX_SCORE),
    wave: whole(run && run.wave, 5000),
    sunk: whole(run && run.sunk, 100000),
  };
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") return null;
  const person = typeof row.person === "string" ? row.person : "";
  const name = typeof row.name === "string" && row.name ? row.name : person;
  const score = Math.max(0, Math.floor(Number(row.score) || 0));
  if (!person && !name) return null;
  return {
    person,
    name,
    score,
    wave: Math.max(0, Math.floor(Number(row.wave) || 0)),
    sunk: Math.max(0, Math.floor(Number(row.sunk) || 0)),
  };
}

function emptyBoards(revision) {
  const boards = {};
  for (const id of BOARD_IDS) {
    const label =
      id === "revision" && revision ? `This revision (${revision})` : DEFAULT_LABELS[id];
    boards[id] = { id, label, rows: [] };
  }
  return boards;
}

/**
 * @param {Record<string, unknown> | null | undefined} body
 * @param {string} [fallbackRevision]
 */
function normalizeBoard(body, fallbackRevision) {
  const source = body && body.boards && typeof body.boards === "object" ? body.boards : {};
  const revision =
    body && typeof body.revision === "string" && body.revision ? body.revision : fallbackRevision || "";
  const boards = emptyBoards(revision);
  for (const id of BOARD_IDS) {
    const column = source[id] && typeof source[id] === "object" ? source[id] : null;
    if (!column) continue;
    const rows = Array.isArray(column.rows) ? column.rows.map(normalizeRow).filter(Boolean) : [];
    rows.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
    boards[id] = {
      id,
      label:
        typeof column.label === "string" && column.label
          ? column.label
          : boards[id].label,
      rows,
    };
  }
  return {
    ok: true,
    you: body && typeof body.you === "string" ? body.you : "",
    name: body && typeof body.name === "string" ? body.name : "",
    revision,
    posted: Boolean(body && body.posted),
    stale: Boolean(body && body.stale),
    message: body && typeof body.message === "string" ? body.message : "",
    boards,
  };
}

function boardFailure(error, message) {
  return {
    ok: false,
    error,
    you: "",
    name: "",
    revision: "",
    posted: false,
    stale: false,
    message,
    boards: emptyBoards(""),
  };
}

function lockedBoard(message) {
  return boardFailure(
    "locked",
    message || "Sign in on this desk. A score posts only while that person is signed in.",
  );
}

function unavailableBoard(message) {
  return boardFailure("unavailable", message || "Could not reach the shop board.");
}

function formatScore(score) {
  const n = Math.max(0, Math.floor(Number(score) || 0));
  return n.toLocaleString("en-US");
}

/**
 * Plain text for the Settings dialog. Four boards, revision beside the periods.
 * @param {ReturnType<typeof normalizeBoard> | ReturnType<typeof boardFailure>} board
 */
function formatLeaderboardDetail(board) {
  if (!board || !board.ok) {
    return (board && board.message) || "Could not reach the shop board.";
  }
  const lines = [];
  if (board.message) lines.push(board.message);
  if (board.name) lines.push(`Signed in as ${board.name}.`);
  else if (board.you) lines.push(`Signed in as ${board.you}.`);
  if (lines.length) lines.push("");
  for (const id of BOARD_IDS) {
    const column = board.boards[id];
    lines.push(column.label);
    const rows = column.rows.slice(0, 8);
    if (!rows.length) {
      lines.push("  No scores yet.");
    } else {
      rows.forEach((row, index) => {
        const you = row.person && row.person === board.you ? " (you)" : "";
        lines.push(`  ${index + 1}. ${row.name}${you} — ${formatScore(row.score)}`);
      });
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

module.exports = {
  BOARD_IDS,
  DEFAULT_LABELS,
  MAX_SCORE,
  submitBody,
  normalizeBoard,
  emptyBoards,
  lockedBoard,
  unavailableBoard,
  formatScore,
  formatLeaderboardDetail,
};
