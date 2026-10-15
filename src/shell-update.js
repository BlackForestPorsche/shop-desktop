"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const DEFAULT_REPO = "BlackForestPorsche/shop-desktop";
const DEFAULT_BRANCH = "main";
/** Written by applyGitUpdate; launcher runs npm install after Electron has quit. */
const PENDING_NPM_FLAG = ".bf-pending-npm";

function appRootFromMain(mainDir = __dirname) {
  return path.join(mainDir, "..");
}

function pendingNpmFlagPath(root) {
  return path.join(root, PENDING_NPM_FLAG);
}

function isGitInstall(root) {
  try {
    return fs.existsSync(path.join(root, ".git"));
  } catch {
    return false;
  }
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

/**
 * Env for npm / electron install spawned from inside Electron.
 * Drop skip-download and platform overrides that leave Linux without a usable binary
 * (launcher then shows "Could not download the window runtime").
 */
function cleanUpdateEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  const drop = [
    "ELECTRON_SKIP_BINARY_DOWNLOAD",
    "ELECTRON_RUN_AS_NODE",
    "ELECTRON_OVERRIDE_DIST_PATH",
    "npm_config_platform",
    "npm_config_arch",
    "npm_config_target_platform",
    "npm_config_target_arch",
    "npm_config_electron_mirror",
  ];
  for (const key of drop) {
    delete env[key];
  }
  for (const key of Object.keys(env)) {
    const lower = key.toLowerCase();
    if (
      lower === "electron_skip_binary_download" ||
      lower === "npm_config_platform" ||
      lower === "npm_config_arch"
    ) {
      delete env[key];
    }
  }
  env.npm_config_ignore_scripts = "false";
  return env;
}

function electronBinaryPath(root, platform = process.platform) {
  const name = platform === "win32" ? "electron.exe" : "electron";
  return path.join(root, "node_modules", "electron", "dist", name);
}

function electronInstallScript(root) {
  return path.join(root, "node_modules", "electron", "install.js");
}

function systemNodePath() {
  const fromEnv = process.env.BF_SYSTEM_NODE;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["node"], {
    encoding: "utf8",
  });
  if (which.status === 0) {
    const first = (which.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (first && fs.existsSync(first) && path.basename(first).toLowerCase() !== "electron") {
      return first;
    }
  }
  if (process.versions.electron) {
    throw new Error(
      "Could not find system Node to download the window runtime. Install Node.js and ensure `node` is on PATH.",
    );
  }
  return process.execPath;
}

function ensureElectronBinary(root, { env = cleanUpdateEnv(), platform = process.platform } = {}) {
  const bin = electronBinaryPath(root, platform);
  if (fs.existsSync(bin)) {
    try {
      fs.accessSync(bin, fs.constants.X_OK);
      return { ok: true, path: bin, downloaded: false };
    } catch {
      // fall through and re-download
    }
  }

  const installJs = electronInstallScript(root);
  if (!fs.existsSync(installJs)) {
    throw new Error(`Electron is not installed under ${root}. Run: npm install`);
  }

  const node = systemNodePath();
  const result = spawnSync(node, [installJs], {
    cwd: root,
    encoding: "utf8",
    timeout: 600_000,
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || "Could not download the Electron window runtime");
  }

  if (!fs.existsSync(bin)) {
    throw new Error(
      `Electron download finished but ${bin} is missing (wrong platform binary?). Run: bash scripts/ensure-electron.sh`,
    );
  }
  return { ok: true, path: bin, downloaded: true };
}

function runNpmInstall(root, { env = cleanUpdateEnv() } = {}) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const install = spawnSync(npm, ["install"], {
    cwd: root,
    encoding: "utf8",
    timeout: 600_000,
    env,
  });
  if (install.error) throw install.error;
  if (install.status !== 0) {
    const detail = (install.stderr || install.stdout || "").trim();
    throw new Error(detail || "npm install failed after pulling the update");
  }
  ensureElectronBinary(root, { env });
  return { ok: true };
}

function markPendingNpmInstall(root) {
  fs.writeFileSync(pendingNpmFlagPath(root), `${new Date().toISOString()}\n`, "utf8");
}

function clearPendingNpmInstall(root) {
  try {
    fs.unlinkSync(pendingNpmFlagPath(root));
  } catch (error) {
    if (error && error.code !== "ENOENT") throw error;
  }
}

function hasPendingNpmInstall(root) {
  return fs.existsSync(pendingNpmFlagPath(root));
}

function finishPendingNpmInstall(root, { env = cleanUpdateEnv() } = {}) {
  if (!hasPendingNpmInstall(root)) {
    ensureElectronBinary(root, { env });
    return { ran: false };
  }
  runNpmInstall(root, { env });
  clearPendingNpmInstall(root);
  return { ran: true };
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

async function checkGitUpdate(root, { remote = "origin", branch = DEFAULT_BRANCH } = {}) {
  runGit(root, ["fetch", "--quiet", remote, branch]);
  const current = runGit(root, ["rev-parse", "HEAD"]);
  const upstream = runGit(root, ["rev-parse", `${remote}/${branch}`]);
  if (current === upstream) {
    return {
      mode: "git",
      available: false,
      current,
      upstream,
    };
  }

  let summary = "";
  try {
    summary = runGit(root, [
      "log",
      "--oneline",
      "--no-decorate",
      `${current}..${upstream}`,
    ]);
  } catch {
    summary = "";
  }

  return {
    mode: "git",
    available: true,
    current,
    upstream,
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
  branch = DEFAULT_BRANCH,
} = {}) {
  if (!packaged && isGitInstall(root)) {
    return checkGitUpdate(root, { branch });
  }
  return checkReleaseUpdate(currentVersion, { repo });
}

function applyGitUpdate(root, { remote = "origin", branch = DEFAULT_BRANCH } = {}) {
  runGit(root, ["pull", "--ff-only", remote, branch]);

  if (process.platform === "linux") {
    markPendingNpmInstall(root);
    return {
      mode: "git",
      applied: true,
      deferredNpm: true,
    };
  }

  runNpmInstall(root);
  return {
    mode: "git",
    applied: true,
    deferredNpm: false,
  };
}

function linuxRelaunchSpec(root) {
  const launcher = path.join(root, "scripts", "blackforest-tools.sh");
  if (!fs.existsSync(launcher)) return null;
  return {
    execPath: "/bin/bash",
    args: [launcher],
  };
}

module.exports = {
  DEFAULT_REPO,
  DEFAULT_BRANCH,
  PENDING_NPM_FLAG,
  appRootFromMain,
  isGitInstall,
  parseSemver,
  compareSemver,
  versionFromReleaseAssetName,
  pickPortableAsset,
  cleanUpdateEnv,
  electronBinaryPath,
  ensureElectronBinary,
  runNpmInstall,
  markPendingNpmInstall,
  clearPendingNpmInstall,
  hasPendingNpmInstall,
  finishPendingNpmInstall,
  pendingNpmFlagPath,
  checkGitUpdate,
  checkReleaseUpdate,
  checkShellUpdate,
  applyGitUpdate,
  linuxRelaunchSpec,
};
