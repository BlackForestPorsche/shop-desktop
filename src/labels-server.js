"use strict";

/**
 * Own the Labels (LabelWriter 550) HTTP server from Black Forest Tools.
 *
 * Desk / Create RO keep calling http://127.0.0.1:8080. Tools either adopts an
 * already-running Labels process (legacy labels.service / start-labels.sh) or
 * spawns the vendored copy under labels/ with system Node.
 *
 * Not part of the pirate idle overlay — print path stays LabelWriter via CUPS
 * / PrintTo inside the Labels server.
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const DEFAULT_PORT = 8080;
const DEFAULT_HOST = "127.0.0.1";
const PROBE_TIMEOUT_MS = 1500;
const READY_WAIT_MS = 12_000;
const READY_POLL_MS = 200;

function labelsPort(env = process.env) {
  const raw = env.LABELS_PORT || env.BF_LABELS_PORT || env.PORT;
  const n = raw ? Number.parseInt(String(raw), 10) : DEFAULT_PORT;
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

/**
 * Git checkout / dev: <appRoot>/labels. Packaged Setup (asar): the NSIS build copies
 * labels/ (with node_modules) to <resources>/labels so Node can read and write it.
 */
function labelsRootFromAppRoot(appRoot, resourcesPath = process.resourcesPath, exists = fs.existsSync) {
  const bundled = /app\.asar$/i.test(String(appRoot || ""));
  if (bundled && resourcesPath) {
    const unpacked = path.join(resourcesPath, "labels");
    if (exists(path.join(unpacked, "server.mjs"))) {
      return unpacked;
    }
  }
  return path.join(appRoot, "labels");
}

function labelsServerEntry(labelsRoot) {
  return path.join(labelsRoot, "server.mjs");
}

function labelsUrl(port = DEFAULT_PORT, host = DEFAULT_HOST) {
  return `http://${host}:${port}/`;
}

function findOnPath(names, env = process.env, platform = process.platform, exists = fs.existsSync) {
  const sep = platform === "win32" ? ";" : ":";
  const join = platform === "win32" ? path.win32.join : path.join;
  for (const dir of String(env.PATH || env.Path || "").split(sep)) {
    if (!dir) continue;
    for (const name of names) {
      const full = join(dir, name);
      if (exists(full)) return full;
    }
  }
  return "";
}

/**
 * Which Node runs the Labels server. Prefers a system Node; when none exists
 * (a Setup desk that only has the Electron runtime) falls back to this Electron
 * binary in ELECTRON_RUN_AS_NODE mode so Labels still comes up.
 */
function resolveNodeRuntime(env = process.env, opts = {}) {
  const platform = opts.platform || process.platform;
  const exists = opts.exists || fs.existsSync;
  const execPath = opts.execPath || process.execPath;
  const electron = opts.electron !== undefined ? opts.electron : Boolean(process.versions && process.versions.electron);

  if (env.LABELS_NODE && exists(env.LABELS_NODE)) {
    return { bin: env.LABELS_NODE, asNode: false };
  }
  if (platform === "win32") {
    const join = path.win32.join;
    const found = findOnPath(["node.exe"], env, platform, exists);
    if (found) return { bin: found, asNode: false };
    for (const base of [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs")]) {
      if (!base) continue;
      const candidate = join(base, "nodejs", "node.exe");
      if (exists(candidate)) return { bin: candidate, asNode: false };
    }
  } else {
    for (const candidate of ["/usr/bin/node", "/usr/local/bin/node"]) {
      if (exists(candidate)) return { bin: candidate, asNode: false };
    }
    const found = findOnPath(["node"], env, platform, exists);
    if (found) return { bin: found, asNode: false };
  }
  if (electron && execPath) {
    return { bin: execPath, asNode: true };
  }
  return { bin: platform === "win32" ? "node.exe" : "node", asNode: false };
}

function resolveNodeBinary(env = process.env, opts = {}) {
  return resolveNodeRuntime(env, opts).bin;
}

function npmCommand(platform = process.platform) {
  return platform === "win32" ? { bin: "npm.cmd", shell: true } : { bin: "npm", shell: false };
}

/** %LOCALAPPDATA%\blackforest-tools\labels on Windows so print history survives updates. */
function labelsDataDir(env = process.env, platform = process.platform, homedir = require("node:os").homedir()) {
  if (env.LABELS_DATA_DIR) return env.LABELS_DATA_DIR;
  if (platform !== "win32") return "";
  const local = env.LOCALAPPDATA || path.win32.join(homedir, "AppData", "Local");
  return path.win32.join(local, "blackforest-tools", "labels");
}

function closeLogFd(fd) {
  if (typeof fd !== "number") return;
  try {
    fs.closeSync(fd);
  } catch {
    // ignore
  }
}

function probeLabels(url, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

const OWNER_FILE = "labels-server.json";

/** Folder for labels-server.log and the owner record. Same folder as tools.log. */
function labelsStateDir(env = process.env, platform = process.platform, fallback = "") {
  if (platform === "win32") {
    return path.win32.join(env.LOCALAPPDATA || env.TEMP || fallback, "blackforest-tools");
  }
  return path.join(env.XDG_STATE_HOME || path.join(env.HOME || fallback, ".local", "state"), "blackforest-tools");
}

function ownerFilePath(env = process.env, platform = process.platform) {
  const join = platform === "win32" ? path.win32.join : path.join;
  return join(labelsStateDir(env, platform, require("node:os").tmpdir()), OWNER_FILE);
}

/**
 * Tools leaves the Labels server running when it quits so Desk can still print.
 * The owner record is how the next Tools knows that server is its own and may
 * be restarted, instead of treating it as a stranger on the port.
 */
function readOwnerRecord(file = ownerFilePath()) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const pid = Number(data && data.pid);
    if (!Number.isInteger(pid) || pid <= 1) return null;
    return {
      pid,
      port: Number(data.port) || 0,
      entry: typeof data.entry === "string" ? data.entry : "",
      version: typeof data.version === "string" ? data.version : "",
    };
  } catch {
    return null;
  }
}

function writeOwnerRecord(record, file = ownerFilePath()) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        pid: record.pid,
        port: record.port,
        entry: record.entry,
        version: record.version || "",
        startedAt: new Date().toISOString(),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

function clearOwnerRecord(file = ownerFilePath()) {
  try {
    fs.unlinkSync(file);
  } catch {
    // Already gone, or the folder is read-only. The next start rewrites it.
  }
}

/** Command line of a running process, or "" when it is gone or cannot be read. */
function processCommandLine(pid, { platform = process.platform, execFileFn, readFileFn = fs.readFileSync } = {}) {
  if (platform === "linux") {
    try {
      return Promise.resolve(String(readFileFn(`/proc/${pid}/cmdline`, "utf8")).replace(/\0/g, " ").trim());
    } catch {
      return Promise.resolve("");
    }
  }
  const execFile = execFileFn || require("node:child_process").execFile;
  const [bin, args] =
    platform === "win32"
      ? [
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
          ],
        ]
      : ["ps", ["-p", String(pid), "-o", "command="]];
  return new Promise((resolve) => {
    try {
      execFile(bin, args, { encoding: "utf8", timeout: 8000, windowsHide: true }, (error, stdout) => {
        resolve(error ? "" : String(stdout || "").trim());
      });
    } catch {
      resolve("");
    }
  });
}

function comparablePath(text) {
  return String(text || "").replace(/\\/g, "/").toLowerCase();
}

/** Every running process as { pid, commandLine }. Empty when the list cannot be read. */
function listProcesses({ platform = process.platform, execFileFn } = {}) {
  if (platform === "linux") {
    const rows = [];
    let names = [];
    try {
      names = fs.readdirSync("/proc");
    } catch {
      return Promise.resolve(rows);
    }
    for (const name of names) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const commandLine = fs.readFileSync(`/proc/${name}/cmdline`, "utf8").replace(/\0/g, " ").trim();
        if (commandLine) rows.push({ pid: Number(name), commandLine });
      } catch {
        // The process ended, or belongs to another user.
      }
    }
    return Promise.resolve(rows);
  }
  const execFile = execFileFn || require("node:child_process").execFile;
  const [bin, args] =
    platform === "win32"
      ? [
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }",
          ],
        ]
      : ["ps", ["-axo", "pid=,command="]];
  return new Promise((resolve) => {
    try {
      execFile(
        bin,
        args,
        { encoding: "utf8", timeout: 8000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            resolve([]);
            return;
          }
          const rows = [];
          for (const line of String(stdout || "").split(/\r?\n/)) {
            const match = /^\s*(\d+)\s+(.+)$/.exec(line);
            if (match) rows.push({ pid: Number(match[1]), commandLine: match[2].trim() });
          }
          resolve(rows);
        },
      );
    } catch {
      resolve([]);
    }
  });
}

/**
 * The Labels server Tools started, when it is still running:
 * - the owner record, only while that process is still alive and still runs
 *   the recorded entry (a reused process id never matches);
 * - otherwise a process running this install's own Labels entry. That covers
 *   a server left by a Tools from before the record existed.
 */
async function findOwnedLabels({
  port,
  file = ownerFilePath(),
  entry = "",
  commandLineFn = processCommandLine,
  listProcessesFn = listProcesses,
} = {}) {
  const record = file ? readOwnerRecord(file) : null;
  if (record && record.entry && !(port && record.port && record.port !== port)) {
    const commandLine = comparablePath(await commandLineFn(record.pid));
    if (commandLine && commandLine.includes(comparablePath(record.entry))) return record;
  }
  if (!entry) return null;
  const wanted = comparablePath(entry);
  const rows = await listProcessesFn();
  for (const row of rows || []) {
    if (!row || row.pid === process.pid) continue;
    if (comparablePath(row.commandLine).includes(wanted)) {
      return { pid: row.pid, port: port || 0, entry, version: "" };
    }
  }
  return null;
}

function waitUntilDown(url, { timeoutMs = 6000, pollMs = READY_POLL_MS, probeFn = probeLabels } = {}) {
  const started = Date.now();
  return new Promise(async (resolve) => {
    while (Date.now() - started < timeoutMs) {
      if (!(await probeFn(url))) {
        resolve(true);
        return;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    resolve(false);
  });
}

function waitUntilReady(url, { timeoutMs = READY_WAIT_MS, pollMs = READY_POLL_MS } = {}) {
  const started = Date.now();
  return new Promise(async (resolve) => {
    while (Date.now() - started < timeoutMs) {
      if (await probeLabels(url)) {
        resolve(true);
        return;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    resolve(false);
  });
}

function ensureLabelsDeps(labelsRoot, { npmBin, spawnSyncFn, platform = process.platform } = {}) {
  const nodeModules = path.join(labelsRoot, "node_modules");
  const pdfLib = path.join(nodeModules, "pdf-lib");
  if (fs.existsSync(pdfLib)) {
    return { ok: true, installed: false };
  }
  const spawnSync = spawnSyncFn || require("node:child_process").spawnSync;
  const npm = npmCommand(platform);
  const result = spawnSync(npmBin || npm.bin, ["install", "--omit=dev"], {
    cwd: labelsRoot,
    encoding: "utf8",
    env: process.env,
    shell: npm.shell,
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = (result.error && result.error.message) || (result.stderr || result.stdout || "npm install failed").trim();
    return { ok: false, installed: false, error: detail.split("\n").slice(-3).join(" ") };
  }
  return { ok: true, installed: true };
}

const NPM_INSTALL_TIMEOUT_MS = 180_000;

/**
 * Same as ensureLabelsDeps but never blocks Tools' main thread: a synchronous
 * `npm install` at launch freezes the window ("Not responding") for minutes.
 */
function ensureLabelsDepsAsync(labelsRoot, { npmBin, spawnFn, platform = process.platform, timeoutMs = NPM_INSTALL_TIMEOUT_MS } = {}) {
  const pdfLib = path.join(labelsRoot, "node_modules", "pdf-lib");
  if (fs.existsSync(pdfLib)) {
    return Promise.resolve({ ok: true, installed: false });
  }
  const spawnImpl = spawnFn || spawn;
  const npm = npmCommand(platform);
  return new Promise((resolve) => {
    let settled = false;
    let tail = "";
    let child = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        if (child) child.kill();
      } catch {
        // ignore
      }
      finish({ ok: false, installed: false, error: `npm install timed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    try {
      child = spawnImpl(npmBin || npm.bin, ["install", "--omit=dev"], {
        cwd: labelsRoot,
        env: process.env,
        shell: npm.shell,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      finish({ ok: false, installed: false, error: String(error && error.message ? error.message : error) });
      return;
    }
    const keep = (chunk) => {
      tail = (tail + String(chunk)).slice(-600);
    };
    if (child.stdout) child.stdout.on("data", keep);
    if (child.stderr) child.stderr.on("data", keep);
    child.on("error", (error) => {
      finish({ ok: false, installed: false, error: String(error && error.message ? error.message : error) });
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish({ ok: true, installed: true });
      } else {
        finish({
          ok: false,
          installed: false,
          error: (tail.trim() || `npm install exited ${code}`).split("\n").slice(-3).join(" "),
        });
      }
    });
  });
}

/**
 * @param {{
 *   appRoot: string,
 *   env?: NodeJS.ProcessEnv,
 *   spawnFn?: typeof spawn,
 *   probeFn?: (url: string) => Promise<boolean>,
 *   waitFn?: (url: string, opts?: object) => Promise<boolean>,
 *   ensureDepsFn?: typeof ensureLabelsDeps,
 *   log?: (...args: any[]) => void,
 * }} options
 */
async function startLabelsServer(options) {
  const env = options.env || process.env;
  const port = labelsPort(env);
  const host = DEFAULT_HOST;
  const url = labelsUrl(port, host);
  const log = options.log || console.log;
  const probe = options.probeFn || probeLabels;
  const wait = options.waitFn || waitUntilReady;
  const ensureDeps = options.ensureDepsFn || ensureLabelsDepsAsync;
  const spawnFn = options.spawnFn || spawn;

  const ownerFile = options.ownerFile === undefined ? ownerFilePath(env) : options.ownerFile;

  if (await probe(url)) {
    const findOwned = options.findOwnedFn || findOwnedLabels;
    const ours = ownerFile
      ? await findOwned({
          port,
          file: ownerFile,
          entry: labelsServerEntry(labelsRootFromAppRoot(options.appRoot, options.resourcesPath)),
        })
      : null;
    return {
      ok: true,
      owned: false,
      adopted: true,
      ours,
      ownerFile,
      port,
      url,
      child: null,
      reason: ours
        ? "Labels already answering on port — adopted the server Tools started earlier."
        : "Labels already answering on port — adopted existing server.",
    };
  }

  const labelsRoot = labelsRootFromAppRoot(options.appRoot, options.resourcesPath);
  const entry = labelsServerEntry(labelsRoot);
  if (!fs.existsSync(entry)) {
    return {
      ok: false,
      owned: false,
      adopted: false,
      port,
      url,
      child: null,
      reason: `Vendored Labels server missing at ${entry}`,
    };
  }

  const deps = await ensureDeps(labelsRoot);
  if (!deps.ok) {
    return {
      ok: false,
      owned: false,
      adopted: false,
      port,
      url,
      child: null,
      reason: `Labels dependencies missing: ${deps.error || "npm install failed"}`,
    };
  }

  const runtime = (options.resolveRuntimeFn || resolveNodeRuntime)(env);
  const nodeBin = runtime.bin;
  const childEnv = {
    ...env,
    PORT: String(port),
    LABELS_PORT: String(port),
  };
  // A real Node must not inherit Electron's ELECTRON_RUN_AS_NODE; the Electron
  // fallback needs it so electron.exe behaves as plain Node for server.mjs.
  delete childEnv.ELECTRON_RUN_AS_NODE;
  if (runtime.asNode) {
    childEnv.ELECTRON_RUN_AS_NODE = "1";
  }
  const dataDir = labelsDataDir(env);
  if (dataDir) {
    childEnv.LABELS_DATA_DIR = dataDir;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch {
      // Labels creates it on first write; best-effort here.
    }
  }

  const logDir = labelsStateDir(env, process.platform, labelsRoot);
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    // best-effort
  }
  const logFile = path.join(logDir, "labels-server.log");
  let out = "ignore";
  let err = "ignore";
  try {
    const fd = fs.openSync(logFile, "a");
    out = fd;
    err = fd;
  } catch {
    // ignore
  }

  let child;
  try {
    child = spawnFn(nodeBin, [entry], {
      cwd: labelsRoot,
      env: childEnv,
      detached: true,
      stdio: ["ignore", out, err],
      windowsHide: true,
    });
  } catch (error) {
    closeLogFd(out);
    return {
      ok: false,
      owned: false,
      adopted: false,
      port,
      url,
      child: null,
      reason: `Could not start Labels with ${nodeBin}: ${error && error.message ? error.message : error} (log: ${logFile})`,
    };
  }
  // The child holds its own copy of the log handle; keep ours from leaking.
  closeLogFd(out);
  try {
    child.unref();
  } catch {
    // ignore
  }

  let earlyExit = "";
  if (typeof child.on === "function") {
    child.on("error", (error) => {
      earlyExit = String(error && error.message ? error.message : error);
      log("Labels server child error:", error);
    });
    child.on("exit", (code, signal) => {
      earlyExit = earlyExit || `exited code=${code} signal=${signal}`;
      log(`Labels server child exited code=${code} signal=${signal} (log: ${logFile})`);
    });
  }

  const ready = await wait(url);
  if (!ready) {
    try {
      child.kill();
    } catch {
      // ignore
    }
    return {
      ok: false,
      owned: false,
      adopted: false,
      port,
      url,
      child: null,
      reason: `Labels server did not become ready at ${url}${earlyExit ? ` (${earlyExit})` : ""} (log: ${logFile})`,
    };
  }

  log(`Labels server owned by Tools at ${url}`);
  if (ownerFile && child.pid) {
    writeOwnerRecord({ pid: child.pid, port, entry, version: options.version || "" }, ownerFile);
  }
  return {
    ok: true,
    owned: true,
    adopted: false,
    ownerFile,
    port,
    url,
    child,
    reason: "Started vendored Labels server.",
    logFile,
  };
}

function killLabelsProcess(pid, child) {
  if (process.platform === "win32") {
    if (child) child.kill();
    else process.kill(pid);
    return;
  }
  try {
    // Detached: the server leads its own process group.
    process.kill(-pid, "SIGTERM");
  } catch {
    if (child) child.kill("SIGTERM");
    else process.kill(pid, "SIGTERM");
  }
}

/**
 * Soft stop only when Tools started the server: this run's child, or the one an
 * earlier Tools left running (`handle.ours`). A server someone else runs
 * (labels.service) is never touched. Detached children may outlive Tools so
 * Desk can still print after quit; pass { force: true } to kill.
 */
function stopLabelsServer(handle, { force = false } = {}) {
  const child = handle && handle.owned ? handle.child : null;
  const pid = child ? child.pid : handle && handle.ours ? handle.ours.pid : 0;
  if (!child && !pid) {
    return { stopped: false };
  }
  if (!force) {
    return { stopped: false, reason: "left running for Desk print" };
  }
  try {
    killLabelsProcess(pid, child);
    if (handle.ownerFile) clearOwnerRecord(handle.ownerFile);
    return { stopped: true };
  } catch (error) {
    return { stopped: false, reason: String(error && error.message ? error.message : error) };
  }
}

module.exports = {
  DEFAULT_PORT,
  DEFAULT_HOST,
  labelsPort,
  labelsRootFromAppRoot,
  labelsServerEntry,
  labelsUrl,
  resolveNodeBinary,
  resolveNodeRuntime,
  labelsDataDir,
  npmCommand,
  findOnPath,
  probeLabels,
  waitUntilReady,
  waitUntilDown,
  labelsStateDir,
  ownerFilePath,
  readOwnerRecord,
  writeOwnerRecord,
  clearOwnerRecord,
  processCommandLine,
  findOwnedLabels,
  listProcesses,
  ensureLabelsDeps,
  ensureLabelsDepsAsync,
  startLabelsServer,
  stopLabelsServer,
};
