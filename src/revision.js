"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SHA_RE = /^[0-9a-f]{40}$/i;

function readTrim(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function resolveGitDir(root) {
  const dotGit = path.join(root, ".git");
  let stat;
  try {
    stat = fs.statSync(dotGit);
  } catch {
    return null;
  }
  if (stat.isDirectory()) return dotGit;
  const match = readTrim(dotGit).match(/^gitdir:\s*(.+)$/);
  return match ? path.resolve(root, match[1]) : null;
}

function lookupPackedRef(gitDir, ref) {
  for (const line of readTrim(path.join(gitDir, "packed-refs")).split("\n")) {
    const [sha, name] = line.split(" ");
    if (name === ref && SHA_RE.test(sha)) return sha;
  }
  return "";
}

/**
 * Full git tip SHA for a git-checkout install, read from .git directly (no git binary).
 * Returns null for packaged builds (AppImage / Windows) that ship without .git.
 */
function readGitTip(root) {
  const gitDir = resolveGitDir(root);
  if (!gitDir) return null;
  const head = readTrim(path.join(gitDir, "HEAD"));
  if (SHA_RE.test(head)) return head;
  const ref = head.match(/^ref:\s*(.+)$/);
  if (!ref) return null;
  const refName = ref[1];
  const loose = readTrim(path.join(gitDir, refName));
  if (SHA_RE.test(loose)) return loose;
  return lookupPackedRef(gitDir, refName) || null;
}

/** @returns {{ version: string, sha: string | null, label: string }} */
function getRevision({ root, version }) {
  let tip = null;
  try {
    tip = readGitTip(root);
  } catch {
    tip = null;
  }
  const sha = tip ? tip.slice(0, 7) : null;
  return {
    version,
    sha,
    label: sha ? `Version ${version} (${sha})` : `Version ${version}`,
  };
}

module.exports = { getRevision, readGitTip };
