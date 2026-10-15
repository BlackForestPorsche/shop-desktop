"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getRevision, readGitTip } = require("../src/revision");

const SHA = "5d5d770aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bf-rev-"));
}

test("packaged build without .git shows version only", () => {
  const root = tmpRoot();
  assert.equal(readGitTip(root), null);
  assert.deepEqual(getRevision({ root, version: "1.5.13" }), {
    version: "1.5.13",
    sha: null,
    label: "Version 1.5.13",
  });
});

test("loose branch ref resolves to short sha", () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, ".git/refs/heads"), { recursive: true });
  fs.writeFileSync(path.join(root, ".git/HEAD"), "ref: refs/heads/main\n");
  fs.writeFileSync(path.join(root, ".git/refs/heads/main"), `${SHA}\n`);
  const rev = getRevision({ root, version: "1.5.13" });
  assert.equal(rev.sha, "5d5d770");
  assert.equal(rev.label, "Version 1.5.13 (5d5d770)");
});

test("packed ref resolves", () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.writeFileSync(path.join(root, ".git/HEAD"), "ref: refs/heads/main\n");
  fs.writeFileSync(
    path.join(root, ".git/packed-refs"),
    `# pack-refs\n${SHA} refs/heads/main\n`,
  );
  assert.equal(readGitTip(root), SHA);
});

test("detached HEAD resolves", () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.writeFileSync(path.join(root, ".git/HEAD"), `${SHA}\n`);
  assert.equal(readGitTip(root), SHA);
});

test("matches real git in this checkout", () => {
  const root = path.join(__dirname, "..");
  const tip = readGitTip(root);
  if (!tip) return;
  const real = require("node:child_process")
    .execFileSync("git", ["rev-parse", "HEAD"], { cwd: root })
    .toString()
    .trim();
  assert.equal(tip, real);
});

test("getRevision never throws on a bad root", () => {
  const rev = getRevision({ root: undefined, version: "1.5.13" });
  assert.equal(rev.sha, null);
  assert.equal(rev.label, "Version 1.5.13");
});
