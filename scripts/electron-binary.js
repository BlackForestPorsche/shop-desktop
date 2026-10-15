"use strict";

/**
 * Ensure the platform Electron binary is present and executable.
 *
 * electron/install.js soft-skips when path.txt + dist/version + a file at the
 * binary path exist — it does NOT require +x. After Settings → Update
 * (npm install while Electron is live), dist/electron can be mode 644 so
 * ensure-electron.sh fails with "Could not download the window runtime".
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function defaultRoot() {
  return path.join(__dirname, "..");
}

function electronDir(root) {
  return path.join(root, "node_modules", "electron");
}

function binaryName(platform = process.platform) {
  return platform === "win32" ? "electron.exe" : "electron";
}

function binaryPath(root, platform = process.platform) {
  return path.join(electronDir(root), "dist", binaryName(platform));
}

function installScript(root) {
  return path.join(electronDir(root), "install.js");
}

function pathTxt(root) {
  return path.join(electronDir(root), "path.txt");
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function looksLikeElf(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
  } catch {
    return false;
  }
}

function cleanEnv(base = process.env) {
  const env = { ...base };
  for (const key of [
    "ELECTRON_SKIP_BINARY_DOWNLOAD",
    "ELECTRON_RUN_AS_NODE",
    "ELECTRON_OVERRIDE_DIST_PATH",
    "npm_config_platform",
    "npm_config_arch",
    "npm_config_target_platform",
    "npm_config_target_arch",
  ]) {
    delete env[key];
  }
  env.npm_config_ignore_scripts = "false";
  return env;
}

function systemNode(env = process.env) {
  if (env.BF_SYSTEM_NODE && fs.existsSync(env.BF_SYSTEM_NODE)) return env.BF_SYSTEM_NODE;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["node"], {
    encoding: "utf8",
    env,
  });
  const first = (which.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (first && fs.existsSync(first)) return first;
  if (process.versions.electron) {
    throw new Error("Need system Node on PATH to download the window runtime.");
  }
  return process.execPath;
}

function wipeDist(root) {
  const dir = path.join(electronDir(root), "dist");
  fs.rmSync(dir, { recursive: true, force: true });
  try {
    fs.unlinkSync(pathTxt(root));
  } catch (error) {
    if (error && error.code !== "ENOENT") throw error;
  }
}

function runInstallJs(root, { env = cleanEnv(), clearCache = false } = {}) {
  const script = installScript(root);
  if (!fs.existsSync(script)) {
    throw new Error(`Electron package missing under ${root}. Run: npm install`);
  }
  if (clearCache) {
    const cache = path.join(os.homedir(), ".cache", "electron");
    fs.rmSync(cache, { recursive: true, force: true });
  }
  wipeDist(root);
  const result = spawnSync(systemNode(env), [script], {
    cwd: root,
    encoding: "utf8",
    timeout: 600_000,
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || "electron/install.js failed");
  }
}

function ensureElectronBinary(root = defaultRoot(), options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || cleanEnv();
  const bin = binaryPath(root, platform);

  if (fs.existsSync(bin)) {
    const usable = platform === "win32" || looksLikeElf(bin);
    if (usable && isExecutable(bin)) {
      return { ok: true, path: bin, repaired: "none" };
    }
    if (usable && !isExecutable(bin)) {
      try {
        fs.chmodSync(bin, 0o755);
      } catch {
        // fall through to re-download
      }
      if (isExecutable(bin)) {
        return { ok: true, path: bin, repaired: "chmod" };
      }
    }
  }

  const winBin = binaryPath(root, "win32");
  if (platform !== "win32" && fs.existsSync(winBin) && !fs.existsSync(bin)) {
    wipeDist(root);
  }

  runInstallJs(root, { env, clearCache: false });
  if (fs.existsSync(bin) && !isExecutable(bin)) {
    fs.chmodSync(bin, 0o755);
  }
  if (!fs.existsSync(bin) || !isExecutable(bin)) {
    runInstallJs(root, { env, clearCache: true });
    if (fs.existsSync(bin) && !isExecutable(bin)) {
      fs.chmodSync(bin, 0o755);
    }
  }

  if (!fs.existsSync(bin) || !isExecutable(bin)) {
    throw new Error(
      `Could not download the window runtime (missing or non-executable ${bin}).`,
    );
  }
  return { ok: true, path: bin, repaired: "download" };
}

function main() {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : defaultRoot();
  try {
    const result = ensureElectronBinary(root);
    console.log(`Window runtime ready (${result.repaired}): ${result.path}`);
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  defaultRoot,
  binaryPath,
  binaryName,
  isExecutable,
  looksLikeElf,
  cleanEnv,
  wipeDist,
  ensureElectronBinary,
};
