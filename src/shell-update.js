"use strict";

const { spawn, spawnSync, execFile } = require("node:child_process");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { readGitTip } = require("./revision");
const {
  ensureElectronBinary,
  ensureLauncherScriptsExecutable,
  cleanEnv: cleanElectronEnv,
} = require("../scripts/electron-binary");

function cleanUpdateEnv(env = process.env) {
  return { ...cleanElectronEnv(env), npm_config_ignore_scripts: "false" };
}

function assertRuntimeReady(root) {
  const runtime = ensureElectronBinary(root);
  if (!runtime.ok && runtime.state !== "missing-package") {
    throw new Error(
      "npm install finished but the window runtime is not ready. Run: bash scripts/ensure-electron.sh",
    );
  }
  return runtime;
}

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

/**
 * Standard desk checkouts created by Setup / bootstrap / install-linux-desk.sh.
 * Portable leftovers should prefer these over downloading another Portable ZIP/exe.
 */
function defaultDeskCheckoutRoots({
  home = process.env.USERPROFILE || process.env.HOME || os.homedir(),
  envRoot = process.env.BF_SHOP_DESKTOP_ROOT,
} = {}) {
  const roots = [];
  if (envRoot && String(envRoot).trim()) roots.push(path.resolve(String(envRoot).trim()));
  if (home) roots.push(path.join(home, "shop-desktop"));
  return roots;
}

function isShopDesktopRemoteUrl(url) {
  const text = String(url || "").trim();
  if (!text) return false;
  return /(?:^|[/:])BlackForestPorsche\/shop-desktop(?:\.git)?(?:\/|$)/i.test(text);
}

/** Local-only: does this checkout have an origin that points at shop-desktop? */
function hasShopDesktopRemote(root, { remote = "origin" } = {}) {
  if (!isGitInstall(root)) return false;
  try {
    const url = runGit(root, ["remote", "get-url", remote]);
    return isShopDesktopRemoteUrl(url);
  } catch {
    return false;
  }
}

/**
 * Prefer an in-place git update root whenever one exists — even if this process is a
 * packaged/Portable binary. Portable download is only for true portable bootstrap
 * (no usable shop-desktop git remote nearby).
 */
function resolveGitUpdateRoot(
  root,
  {
    deskRoots = defaultDeskCheckoutRoots(),
    hasRemote = hasShopDesktopRemote,
  } = {},
) {
  const candidates = [];
  if (root) candidates.push(path.resolve(root));
  for (const desk of deskRoots) {
    if (!desk) continue;
    const resolved = path.resolve(desk);
    if (!candidates.includes(resolved)) candidates.push(resolved);
  }
  for (const candidate of candidates) {
    if (hasRemote(candidate)) return candidate;
  }
  return null;
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

/** NSIS installer published beside the portable exe (version is in the file name). */
function pickInstallerAsset(assets) {
  if (!Array.isArray(assets)) return null;
  return (
    assets.find(
      (asset) =>
        /packaged-installer/i.test(asset.name || "") && /\.exe$/i.test(asset.name || ""),
    ) || null
  );
}

function runNpmInstall(root, { env = cleanUpdateEnv() } = {}) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const install = spawnSync(npm, ["install"], {
    cwd: root,
    encoding: "utf8",
    timeout: 600_000,
    env,
    // Node refuses to spawn .cmd files directly on Windows (EINVAL since 20.12).
    shell: process.platform === "win32",
    windowsHide: true,
  });
  if (install.error) throw install.error;
  if (install.status !== 0) {
    const detail = (install.stderr || install.stdout || "").trim();
    throw new Error(detail || "npm install failed after pulling the update");
  }
  assertRuntimeReady(root);
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

/**
 * Finish a deferred post-update npm install (called from the Linux launcher after
 * Electron has exited so the running binary is not overwritten mid-flight).
 */
function finishPendingNpmInstall(root, { env = cleanUpdateEnv() } = {}) {
  if (!hasPendingNpmInstall(root)) {
    assertRuntimeReady(root);
    return { ran: false };
  }
  runNpmInstall(root, { env });
  clearPendingNpmInstall(root);
  return { ran: true };
}

/**
 * Never let git stop to ask for credentials in a window-less process.
 * A stale Git Credential Manager token or `gh auth setup-git` extraheader
 * makes `git fetch` fail on a public repo (the other Windows desk, with no
 * saved token, still fetches). Command-line config below clears that header.
 */
function gitEnv(env = process.env) {
  return { ...env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
}

/**
 * Config that must win over a desk's global/local git setup:
 * - safe.directory: Setup run as admin owns %USERPROFILE%\shop-desktop, and
 *   git then refuses every command ("dubious ownership").
 * - credential.helper empty: drop a saved GitHub login so a public fetch
 *   stays anonymous.
 * - extraheader empty: `gh auth setup-git` stores a Basic token that GitHub
 *   rejects after it expires, and git does not fall back to anonymous.
 */
function gitConfigArgs(root) {
  const dir = path.resolve(root || "").replace(/\\/g, "/");
  return [
    "-c",
    "safe.directory=*",
    "-c",
    `safe.directory=${dir}`,
    "-c",
    "credential.helper=",
    "-c",
    "http.https://github.com/.extraheader=",
  ];
}

/**
 * Electron started from a login shortcut often has a PATH from before Git
 * was installed. Git for Windows still lives under Program Files.
 */
function resolveGitBin({
  platform = process.platform,
  env = process.env,
  exists = fs.existsSync,
} = {}) {
  if (platform !== "win32") return "git";
  const pathValue = env.Path || env.PATH || "";
  const candidates = [];
  for (const dir of String(pathValue).split(";")) {
    if (!dir.trim()) continue;
    candidates.push(path.win32.join(dir.trim(), "git.exe"));
  }
  const programFiles = env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const localAppData = env.LOCALAPPDATA || "";
  candidates.push(path.win32.join(programFiles, "Git", "cmd", "git.exe"));
  candidates.push(path.win32.join(programFiles, "Git", "bin", "git.exe"));
  candidates.push(path.win32.join(programFilesX86, "Git", "cmd", "git.exe"));
  if (localAppData) {
    candidates.push(path.win32.join(localAppData, "Programs", "Git", "cmd", "git.exe"));
  }
  for (const candidate of candidates) {
    try {
      if (exists(candidate)) return candidate;
    } catch {
      // try the next well-known location
    }
  }
  return "git";
}

function normalizeSha(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(text) ? text : "";
}

/**
 * Async git for the background update check. A synchronous `git fetch` on Electron's
 * main thread freezes the whole window (Windows "Not responding") for as long as the
 * network or a credential prompt takes.
 */
function runGitAsync(root, args) {
  return new Promise((resolve, reject) => {
    execFile(
      resolveGitBin(),
      ["-C", root, ...gitConfigArgs(root), ...args],
      { encoding: "utf8", timeout: 60_000, windowsHide: true, env: gitEnv() },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || stdout || "").trim();
          reject(detail ? new Error(detail) : error);
          return;
        }
        resolve(String(stdout || "").trim());
      },
    );
  });
}

function runGit(root, args) {
  const result = spawnSync(resolveGitBin(), ["-C", root, ...gitConfigArgs(root), ...args], {
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
    env: gitEnv(),
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
  await runGitAsync(root, ["fetch", "--quiet", remote, branch]);
  const current = await runGitAsync(root, ["rev-parse", "HEAD"]);
  const upstream = await runGitAsync(root, ["rev-parse", `${remote}/${branch}`]);
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
    summary = await runGitAsync(root, [
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

async function checkReleaseUpdate(currentVersion, { repo = DEFAULT_REPO, preferInstaller = false } = {}) {
  const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
  const assets = release.assets || [];
  const portable = pickPortableAsset(assets);
  const installer = pickInstallerAsset(assets);
  // Tag names are windows-<run>, which is not a semver. Read the version from
  // the published exe. A packaged install should download the installer, not
  // only the portable bootstrap.
  const asset = preferInstaller && installer ? installer : portable;
  const remoteVersion =
    versionFromReleaseAssetName(portable?.name) ||
    versionFromReleaseAssetName(installer?.name) ||
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

function captureLaunchSha(root, opts) {
  const gitRoot = resolveGitUpdateRoot(root, opts);
  if (!gitRoot) return null;
  try {
    return readGitTip(gitRoot);
  } catch {
    return null;
  }
}

async function checkShellUpdate({
  root = appRootFromMain(),
  currentVersion,
  packaged = false,
  repo = DEFAULT_REPO,
  branch = DEFAULT_BRANCH,
  deskRoots,
  hasRemote,
  launchedSha = null,
  checkGit = checkGitUpdate,
  checkRelease = checkReleaseUpdate,
} = {}) {
  // Git in-place wins over packaged/Portable: Setup (Windows) and Manjaro clones
  // update via git pull. `packaged` alone must not force a Portable download.
  const resolveOpts = { deskRoots };
  if (typeof hasRemote === "function") resolveOpts.hasRemote = hasRemote;
  const gitRoot = resolveGitUpdateRoot(root, resolveOpts);
  if (gitRoot) {
    try {
      const info = await checkGit(gitRoot, { branch });
      const withRoot = { ...info, root: gitRoot };
      const launched = normalizeSha(launchedSha);
      const current = normalizeSha(info.current);
      const upstream = normalizeSha(info.upstream);
      // The 30-minute task may already have pulled. HEAD then matches GitHub
      // while this process is still the previous copy — say so, don't claim
      // the running window is current.
      if (!withRoot.available && launched && current && launched !== current && current === upstream) {
        return {
          ...withRoot,
          available: true,
          restartOnly: true,
          summary: "The Tools folder already has this update. Restart to load it.",
        };
      }
      // Packaged installer next to a checkout that is already current: the
      // running exe's version can still be older than the published release.
      if (!withRoot.available && packaged && currentVersion) {
        try {
          const release = await checkRelease(currentVersion, { repo, preferInstaller: true });
          if (release && release.available) return { ...release, root: gitRoot };
        } catch {
          // Release feed failed; the git result still stands.
        }
      }
      return withRoot;
    } catch (error) {
      // Fetch failed (bad saved token, git missing, ownership). The published
      // Windows release is still the thing this check is supposed to see.
      if (currentVersion) {
        try {
          const release = await checkRelease(currentVersion, {
            repo,
            preferInstaller: Boolean(packaged),
          });
          if (release && release.remoteVersion) {
            return {
              ...release,
              root: gitRoot,
              gitError: error instanceof Error ? error.message : String(error),
            };
          }
        } catch {
          // Keep the original git failure if the release feed is down too.
        }
      }
      throw error;
    }
  }
  // True portable / AppImage / no shop-desktop remote: offer release download.
  // (Portable asset is the bootstrap fallback; Setup desks should not land here.)
  return checkRelease(currentVersion, { repo, preferInstaller: Boolean(packaged) });
}

/**
 * Apply a git-checkout update.
 * On Linux, only pull + flag pending npm — the launcher runs npm after quit so the
 * live Electron binary is not deleted mid-download (that produced "Could not download
 * the window runtime" on relaunch). Windows still installs before relaunch.
 */
function applyGitUpdate(root, { remote = "origin", branch = DEFAULT_BRANCH } = {}) {
  runGit(root, ["pull", "--ff-only", remote, branch]);
  ensureLauncherScriptsExecutable(root);

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

/** Linux: relaunch argv so ensure-electron / pending npm run before Electron starts. */
function linuxRelaunchSpec(root) {
  const launcher = path.join(root, "scripts", "blackforest-tools.sh");
  if (!fs.existsSync(launcher)) return null;
  return {
    execPath: "/bin/bash",
    args: [launcher],
  };
}

/** Windows/macOS unpackaged: electron binary inside the git checkout. */
function checkoutElectronPath(root, platform = process.platform) {
  const dist = path.join(root, "node_modules", "electron", "dist");
  return platform === "win32"
    ? path.join(dist, "electron.exe")
    : path.join(dist, "electron");
}

/**
 * Relaunch Tools after a git update.
 * Linux always goes through blackforest-tools.sh (pending npm + ensure-electron).
 * If the update root differs from the running app (Portable → Setup checkout),
 * spawn that checkout's Electron instead of relaunching the Portable binary.
 *
 * @returns {"linux-launcher"|"checkout-electron"|"app-relaunch"}
 */
function relaunchAfterGitUpdate(
  gitRoot,
  {
    runningRoot = appRootFromMain(),
    packaged = false,
    platform = process.platform,
    relaunchApp = null,
    spawnDetached = (execPath, args, opts) => {
      const child = spawn(execPath, args, { ...opts, detached: true, stdio: "ignore" });
      child.unref();
      return child;
    },
    exists = fs.existsSync,
  } = {},
) {
  if (platform === "linux") {
    const spec = linuxRelaunchSpec(gitRoot);
    if (spec && typeof relaunchApp === "function") {
      relaunchApp({ execPath: spec.execPath, args: spec.args });
      return "linux-launcher";
    }
  }

  const sameRoot =
    path.resolve(gitRoot || "") === path.resolve(runningRoot || "") && !packaged;
  if (!sameRoot) {
    const electronBin = checkoutElectronPath(gitRoot, platform);
    if (exists(electronBin)) {
      spawnDetached(electronBin, [gitRoot], { cwd: gitRoot, windowsHide: true });
      return "checkout-electron";
    }
  }

  if (typeof relaunchApp === "function") {
    relaunchApp();
  }
  return "app-relaunch";
}

module.exports = {
  DEFAULT_REPO,
  DEFAULT_BRANCH,
  PENDING_NPM_FLAG,
  appRootFromMain,
  isGitInstall,
  defaultDeskCheckoutRoots,
  isShopDesktopRemoteUrl,
  hasShopDesktopRemote,
  resolveGitUpdateRoot,
  parseSemver,
  compareSemver,
  versionFromReleaseAssetName,
  pickPortableAsset,
  pickInstallerAsset,
  gitConfigArgs,
  resolveGitBin,
  normalizeSha,
  captureLaunchSha,
  cleanUpdateEnv,
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
  checkoutElectronPath,
  relaunchAfterGitUpdate,
};
