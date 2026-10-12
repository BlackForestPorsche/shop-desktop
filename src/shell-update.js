"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const DEFAULT_REPO = "BlackForestPorsche/shop-desktop";
const DEFAULT_BRANCH = "main";

function appRootFromMain(mainDir = __dirname) {
  return path.join(mainDir, "..");
}

function isGitInstall(root) {
  try {
    return fs.existsSync(path.join(root, ".git"));
  } catch {
    return false;
  }
}

/** Prefer the branch this checkout tracks (feature branch until main catches up). */
function resolveGitBranch(root, { remote = "origin", branch } = {}) {
  if (typeof branch === "string" && branch.trim() && branch !== DEFAULT_BRANCH) {
    return branch.trim();
  }
  try {
    const upstream = runGit(root, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]);
    const prefix = `${remote}/`;
    if (upstream.startsWith(prefix)) {
      return upstream.slice(prefix.length);
    }
  } catch {
    // no upstream configured
  }
  try {
    const head = runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (head && head !== "HEAD") return head;
  } catch {
    // detached HEAD
  }
  return DEFAULT_BRANCH;
}

function parseSemver(text) {
  if (typeof text !== "string") return null;
  const match = text.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    raw: `${match[1]}.${match[2]}.${match[3]}`,
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
  };
}

function compareSemver(a, b) {
  const left = typeof a === "string" ? parseSemver(a) : a;
  const right = typeof b === "string" ? parseSemver(b) : b;
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i++) {
    if (left.parts[i] > right.parts[i]) return 1;
    if (left.parts[i] < right.parts[i]) return -1;
  }
  return 0;
}

function versionFromReleaseAssetName(name) {
  const parsed = parseSemver(name || "");
  return parsed ? parsed.raw : null;
}

function pickPortableAsset(assets) {
  if (!Array.isArray(assets)) return null;
  const portable = assets.find((asset) =>
    /portable/i.test(asset.name || "") && /\.exe$/i.test(asset.name || ""),
  );
  return portable || assets.find((asset) => /\.exe$/i.test(asset.name || "")) || null;
}

function runGit(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || `git ${args.join(" ")} failed`);
  }
  return (result.stdout || "").trim();
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "BlackForestTools-shell-update",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          resolve(fetchJson(response.headers.location));
          return;
        }
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (status !== 200) {
            reject(new Error(`GitHub answered ${status}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(15_000, () => {
      request.destroy(new Error("Timed out checking for app updates"));
    });
  });
}

async function checkGitUpdate(root, { remote = "origin", branch } = {}) {
  const targetBranch = resolveGitBranch(root, { remote, branch });
  runGit(root, ["fetch", "--quiet", remote, targetBranch]);
  const current = runGit(root, ["rev-parse", "HEAD"]);
  const upstream = runGit(root, ["rev-parse", `${remote}/${targetBranch}`]);
  if (current === upstream) {
    return {
      mode: "git",
      available: false,
      current,
      upstream,
      branch: targetBranch,
    };
  }

  let summary = "";
  let aheadCount = 0;
  try {
    aheadCount = Number(
      runGit(root, ["rev-list", "--count", `${current}..${upstream}`]) || "0",
    );
    summary = runGit(root, [
      "log",
      "--oneline",
      "--no-decorate",
      `${current}..${upstream}`,
    ]);
  } catch {
    summary = "";
    aheadCount = 0;
  }

  // Only offer an update when the remote tip has commits we do not have
  // (avoids false prompts when this PC is ahead of origin/main on a feature branch).
  return {
    mode: "git",
    available: aheadCount > 0,
    current,
    upstream,
    branch: targetBranch,
    summary,
    shortCurrent: current.slice(0, 7),
    shortUpstream: upstream.slice(0, 7),
  };
}

async function checkReleaseUpdate(currentVersion, { repo = DEFAULT_REPO } = {}) {
  const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
  const asset = pickPortableAsset(release.assets || []);
  const remoteVersion =
    versionFromReleaseAssetName(asset?.name) ||
    parseSemver(release.tag_name || "")?.raw ||
    parseSemver(release.name || "")?.raw;

  if (!remoteVersion) {
    return {
      mode: "release",
      available: false,
      currentVersion,
      reason: "Could not read a version from the latest GitHub release.",
    };
  }

  const newer = compareSemver(remoteVersion, currentVersion) > 0;
  return {
    mode: "release",
    available: newer,
    currentVersion,
    remoteVersion,
    releaseName: release.name || release.tag_name || remoteVersion,
    releaseUrl: release.html_url,
    downloadUrl: asset?.browser_download_url || release.html_url,
    assetName: asset?.name || null,
  };
}

async function checkShellUpdate({
  root = appRootFromMain(),
  currentVersion,
  packaged = false,
  repo = DEFAULT_REPO,
  branch,
} = {}) {
  if (!packaged && isGitInstall(root)) {
    return checkGitUpdate(root, { branch });
  }
  return checkReleaseUpdate(currentVersion, { repo });
}

function applyGitUpdate(root, { remote = "origin", branch } = {}) {
  const targetBranch = resolveGitBranch(root, { remote, branch });
  runGit(root, ["pull", "--ff-only", remote, targetBranch]);

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const install = spawnSync(npm, ["install"], {
    cwd: root,
    encoding: "utf8",
    timeout: 600_000,
    env: process.env,
  });
  if (install.error) throw install.error;
  if (install.status !== 0) {
    const detail = (install.stderr || install.stdout || "").trim();
    throw new Error(detail || "npm install failed after pulling the update");
  }

  return {
    mode: "git",
    applied: true,
  };
}

module.exports = {
  DEFAULT_REPO,
  DEFAULT_BRANCH,
  appRootFromMain,
  isGitInstall,
  resolveGitBranch,
  parseSemver,
  compareSemver,
  versionFromReleaseAssetName,
  pickPortableAsset,
  checkGitUpdate,
  checkReleaseUpdate,
  checkShellUpdate,
  applyGitUpdate,
};
