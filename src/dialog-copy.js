"use strict";

/**
 * Words for the dialogs Tools and the Shop Widget show. Kept in one place so
 * both say the same thing, in words for the person at the desk.
 */

const PRODUCT = "Black Forest Tools";

function upToDateDetail(mode, version, platform = process.platform) {
  const lines = [`You have the newest version (${version}).`];
  if (mode === "git") {
    lines.push("", `${PRODUCT} checks for updates by itself and asks before it restarts.`);
  } else if (platform === "win32") {
    lines.push(
      "",
      "This is the Portable copy, which does not update by itself.",
      `Run ${PRODUCT} Setup once on this computer to get updates automatically.`,
    );
  }
  return lines.join("\n");
}

/** Up to five plain lines from the update's change list. */
function changeLines(summary, limit = 5) {
  const lines = String(summary || "")
    .split("\n")
    .map((line) => line.replace(/^[0-9a-f]{7,40}\s+/i, "").trim())
    .filter((line) => line && !/^merge\b/i.test(line));
  const unique = [...new Set(lines)];
  const shown = unique.slice(0, limit).map((line) => `• ${line}`);
  if (unique.length > limit) shown.push(`• and ${unique.length - limit} more`);
  return shown;
}

function gitUpdateDetail(info, { restartOnly = false, what = PRODUCT } = {}) {
  if (restartOnly) {
    return [
      "The update is already downloaded.",
      `${what} keeps running the older version until it restarts.`,
    ].join("\n");
  }
  const lines = [
    `${what} downloads the update and restarts. It usually takes less than a minute.`,
    "The shop site is not affected.",
  ];
  const changes = changeLines(info && info.summary);
  if (changes.length) lines.push("", "What is new:", ...changes);
  if (info && info.shortCurrent && info.shortUpstream) {
    lines.push("", `Revision ${info.shortCurrent} → ${info.shortUpstream}`);
  }
  return lines.join("\n");
}

function updateFailedDetail(error, platform = process.platform) {
  const reason = error instanceof Error ? error.message : String(error || "The update failed.");
  return [
    `${PRODUCT} is still on the version it had, and keeps working.`,
    "Choose Settings → Check for updates to try again.",
    platform === "win32"
      ? `If it keeps failing, run ${PRODUCT} Setup again on this computer.`
      : "If it keeps failing, run scripts/install-manjaro.sh in the shop-desktop folder again.",
    "",
    `Reason: ${reason.trim().split("\n").slice(-3).join(" ")}`,
  ].join("\n");
}

function releaseUpdateDetail(info) {
  const lines = [`This computer has ${info.currentVersion}.`];
  if (info.gitError) {
    lines.push(
      "The automatic update could not reach GitHub from this computer, so the download opens in your browser.",
    );
  } else {
    lines.push(
      "This is the Portable copy, so the download opens in your browser.",
      `Run ${PRODUCT} Setup once to get updates automatically from then on.`,
    );
  }
  if (info.assetName) lines.push("", `File: ${info.assetName}`);
  return lines.join("\n");
}

function aboutDetail({ version, revision = "", labelsRunning = false } = {}) {
  return [
    revision || `Version ${version}`,
    "",
    "The Black Forest Automotive shop, in its own window.",
    "The book, the lot, notes, parts, and crew are the live shop site: nothing is stored in this app, and the site updates by itself.",
    "",
    "Signing in here also signs in the Shop Widgets and Black Forest Desk on this computer. Shop → Lock shop locks them all.",
    labelsRunning
      ? "Repair order labels print through the Labels service, which is running."
      : "Repair order labels print through the Labels service. It is not running: choose Labels → Restart Labels service.",
    "",
    `${PRODUCT} checks for its own updates and asks before it restarts. Settings → Check for updates checks now.`,
  ].join("\n");
}

module.exports = {
  upToDateDetail,
  changeLines,
  gitUpdateDetail,
  updateFailedDetail,
  releaseUpdateDetail,
  aboutDetail,
};
