"use strict";

// Keeps node_modules/electron launchable. Electron's own install.js treats the
// runtime as installed when path.txt, dist/version and *a file* at the binary
// path exist, even if that file is not executable (mode 644 after an in-app
// update) or path.txt points at nothing. ensure-electron.sh then fails its -x
// check and the launcher shows "Could not download the window runtime".

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ENV_KEYS_TO_DROP = [
  "ELECTRON_SKIP_BINARY_DOWNLOAD",
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_OVERRIDE_DIST_PATH",
  "npm_config_platform",
  "npm_config_arch",
  "npm_config_target_platform",
  "npm_config_target_arch",
];

function platformBinaryName(platform = process.platform) {
  if (platform === "win32") return "electron.exe";
  if (platform === "darwin") return path.join("Electron.app", "Contents", "MacOS", "Electron");
  return "electron";
}

function electronPaths(root, platform = process.platform) {
  const pkgDir = path.join(root, "node_modules", "electron");
  const dist = path.join(pkgDir, "dist");
  return {
    pkgDir,
    dist,
    installJs: path.join(pkgDir, "install.js"),
    pathTxt: path.join(pkgDir, "path.txt"),
    versionFile: path.join(dist, "version"),
    binary: path.join(dist, platformBinaryName(platform)),
  };
}

function isExecutable(file, platform = process.platform) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0) return false;
    if (platform === "win32") return true;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readPathTxt(pathTxt) {
  try {
    return fs.readFileSync(pathTxt, "utf8").trim();
  } catch {
    return null;
  }
}

/**
 * state:
 *   missing-package   node_modules/electron/install.js is absent
 *   ok                binary exists, is runnable and metadata agrees
 *   not-executable    binary file exists but lacks the exec bit (chmod fixes it)
 *   stale-metadata    path.txt / dist/version missing or pointing elsewhere
 *   missing-binary    nothing usable at dist/<binary>
 */
function inspectElectron(root, platform = process.platform) {
  const p = electronPaths(root, platform);
  if (!fs.existsSync(p.installJs)) return { state: "missing-package", paths: p };

  const exists = fs.existsSync(p.binary);
  if (!exists) return { state: "missing-binary", paths: p };

  const recorded = readPathTxt(p.pathTxt);
  const expected = platformBinaryName(platform);
  if (!recorded || recorded !== expected || !fs.existsSync(p.versionFile)) {
    return { state: "stale-metadata", paths: p };
  }

  if (!isExecutable(p.binary, platform)) return { state: "not-executable", paths: p };
  return { state: "ok", paths: p };
}

function cleanEnv(env = process.env) {
  const next = { ...env };
  for (const key of ENV_KEYS_TO_DROP) delete next[key];
  next.npm_config_ignore_scripts = "false";
  return next;
}

function findNode() {
  if (!process.versions.electron) return { command: process.execPath, env: {} };
  // Inside Electron, process.execPath is the very binary we may be replacing.
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["node"], {
    encoding: "utf8",
  });
  const first = (which.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (first) return { command: first, env: {} };
  return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

function defaultRunInstall(root, installJs) {
  const node = findNode();
  const env = { ...cleanEnv(), ...node.env };
  const result = spawnSync(node.command, [installJs], {
    cwd: root,
    stdio: "inherit",
    env,
  });
  return result.status === 0;
}

function wipeDist(paths) {
  fs.rmSync(paths.dist, { recursive: true, force: true });
  fs.rmSync(paths.pathTxt, { force: true });
}

function chmodBinary(file) {
  try {
    fs.chmodSync(file, 0o755);
    return true;
  } catch {
    return false;
  }
}

/**
 * Make node_modules/electron/dist/<binary> runnable.
 * Returns { ok, state, action } where action is what was done:
 *   none | chmod | install | reinstall | skipped
 */
function ensureElectronBinary(root, options = {}) {
  const platform = options.platform || process.platform;
  const runInstall = options.runInstall || defaultRunInstall;
  const log = options.log || (() => {});

  let inspected = inspectElectron(root, platform);
  const { paths } = inspected;

  if (inspected.state === "ok") return { ok: true, state: "ok", action: "none" };
  if (inspected.state === "missing-package") {
    return { ok: false, state: "missing-package", action: "skipped" };
  }

  if (inspected.state === "not-executable" && platform !== "win32") {
    log("Electron binary is not executable; fixing permissions.");
    if (chmodBinary(paths.binary) && inspectElectron(root, platform).state === "ok") {
      return { ok: true, state: "ok", action: "chmod" };
    }
  }

  const hadDist = fs.existsSync(paths.dist);
  log("Downloading the Black Forest Tools window runtime...");
  wipeDist(paths);
  runInstall(root, paths.installJs);
  if (inspectElectron(root, platform).state === "not-executable" && platform !== "win32") {
    chmodBinary(paths.binary);
  }
  const after = inspectElectron(root, platform);
  if (after.state === "ok") {
    return { ok: true, state: "ok", action: hadDist ? "reinstall" : "install" };
  }

  // Cached zip can be the broken part; retry once with a fresh cache dir.
  log("Retrying the runtime download with a clean cache...");
  wipeDist(paths);
  const retryCache = fs.mkdtempSync(path.join(os.tmpdir(), "bf-electron-cache-"));
  const retryEnv = options.retryEnv || { ELECTRON_CACHE: retryCache };
  const previous = {};
  for (const [key, value] of Object.entries(retryEnv)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    runInstall(root, paths.installJs);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(retryCache, { recursive: true, force: true });
  }
  if (platform !== "win32" && inspectElectron(root, platform).state === "not-executable") {
    chmodBinary(paths.binary);
  }
  const final = inspectElectron(root, platform);
  return {
    ok: final.state === "ok",
    state: final.state,
    action: "reinstall",
  };
}

module.exports = {
  ENV_KEYS_TO_DROP,
  platformBinaryName,
  electronPaths,
  isExecutable,
  inspectElectron,
  cleanEnv,
  ensureElectronBinary,
};
