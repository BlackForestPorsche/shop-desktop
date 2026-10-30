"use strict";

const {
  app,
  BrowserWindow,
  BrowserView,
  WebContentsView,
  Menu,
  MenuItem,
  clipboard,
  dialog,
  ipcMain,
  session,
  shell,
} = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { SHOP_HOME, classifyUrl } = require("./policy");
const { fetchShopStamp, stampFromHtml } = require("./updates");
const {
  appRootFromMain,
  applyGitUpdate,
  captureLaunchSha,
  checkShellUpdate,
  relaunchAfterGitUpdate,
} = require("./shell-update");
const { buildAppMenuTemplate } = require("./app-menu");
const { formatLeaderboardDetail } = require("./pirate-board");
const { pirateBoardFromDesk } = require("./pirate-board-sync");
const {
  attachPirateShellOverlay,
  detachPirateShellOverlay,
  syncPirateShellOverlayBounds,
  openPirateGameWindow,
} = require("./pirate-window");
const { DEFAULT_WIDTH, DEFAULT_HEIGHT, MIN_WIDTH, MIN_HEIGHT, boundsAreUsable } = require("./window-state");
const {
  sessionFilePath,
  readSession,
  writeSession,
  clearSession,
  purgeExpiredSession,
  sessionFingerprint,
  extractPersonPin,
  extractUnlockWidgetSession,
  mintWidgetSession,
  mintWidgetSessionFromGate,
  refreshWidgetSession,
  revokeWidgetSession,
  exchangeWidgetSession,
  requestFirefoxHandoff,
  parseGateSetCookie,
  gateCookieHeader,
  SHOP_BASE,
} = require("./shared-session");
const { startDeskSessionBridge } = require("./desk-session-bridge");
const { firefoxLaunchPlan } = require("./firefox-launch");
const {
  readLatch,
  setLatch,
  clearLatch,
  sessionId,
  acceptsPublish,
} = require("./lock-latch");
const {
  labelsUrl,
  probeLabels,
  startLabelsServer,
  stopLabelsServer,
} = require("./labels-server");
const {
  shouldHandleGateCookieSet,
  shouldMintAfterLeavingUnlock,
  unlockAutoExchangeAction,
  shouldClearLocalLockOnSharedPublish,
  shouldPollSharedSession,
} = require("./session-sync-guards");
const {
  SESSION_VANISH_SETTLE_MS,
  classifySessionVanish,
  classifyGateRemoval,
  sessionTimerAction,
} = require("./session-lifecycle");

const { resolveAppIconPath } = require("./app-icon");
const OFFLINE_PATH = path.join(__dirname, "..", "assets", "offline.html");
const PRELOAD_PATH = path.join(__dirname, "preload.js");
const STATE_NAME = "window-state.json";
const UPDATE_EVERY_MS = 3 * 60 * 1000;
const SHELL_UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;
/** Re-mint widget-session.json from shop gate when SPA still unlocked but Bearer expired. */
const SESSION_REFRESH_EVERY_MS = 5 * 60 * 1000;
const SNOOZE_MS = 2 * 60 * 60 * 1000;
/** Cap on the pre-window network sync so a dead network at logon cannot hide the window. */
const BOOT_SYNC_TIMEOUT_MS = 8_000;
const FETCH_TIMEOUT_MS = 20_000;
const FOCUS_CHECK_GAP_MS = 60 * 1000;
const APP_ROOT = appRootFromMain(__dirname);
// SHA this process started on. A later git pull (scheduled task) moves HEAD
// without reloading this window; Check for updates compares against this.
const LAUNCH_SHA = captureLaunchSha(APP_ROOT);
const ICON_PATH = resolveAppIconPath(path.join(__dirname, ".."));
const GATE_COOKIE = "bf_shop_gate";

app.setName("Black Forest Tools");
app.commandLine.appendSwitch("ozone-platform-hint", "auto");
// Windows flicker: CalculateNativeWinOcclusion is disabled in crash-guard (early).
// Keep backgroundColor opaque and backgroundThrottling off so DWM does not flash.

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another copy already owns the shop window. Bring that one forward, then leave.
  console.error("Black Forest Tools is already open.");
  app.exit(0);
}

let mainWindow = null;
/** Dedicated pirate BrowserWindow (Settings launch fallback). */
/** @type {{ kind: string, view: object, webContents: import("electron").WebContents } | null} */
let pirateOverlay = null;
let pirateOverlayResizeHooked = false;
/** Last-resort separate BrowserWindow (only if shell overlay cannot attach). */
let pirateWindow = null;
let runningStamp = "";
let snoozedStamp = "";
let snoozeUntil = 0;
let updateTimer = null;
let shellUpdateTimer = null;
let sessionRefreshTimer = null;
let lastFocusCheck = 0;
let promptOpen = false;
let checking = false;
let shellChecking = false;
let shellPromptOpen = false;
let snoozedShellKey = "";
let shellSnoozeUntil = 0;
let pendingUnlockCreds = null;
let pendingUnlockUntil = 0;
let sharedSessionWatcher = null;
let sharedSessionPoll = null;
const SESSION_POLL_MS = 5_000;
let lastSharedFingerprint = "";
let lastSharedSession = null;
let sessionVanishTimer = null;
function trackShared(session) {
  lastSharedSession = session && session.token ? session : null;
  lastSharedFingerprint = sessionFingerprint(lastSharedSession);
}
let applyingRemoteLock = false;
let mintingWidgetSession = false;
let exchangingGate = false;
let deskSessionBridge = null;
let labelsServerHandle = null;
/** Avoid tight reload loops when /unlock keeps loading while exchange fails. */
let unlockExchangeAttemptAt = 0;
const UNLOCK_EXCHANGE_GAP_MS = 4_000;
/** After an intentional Tools/SPA lock, do not auto-exchange back onto /unlock. */
let localLockUntil = 0;
/**
 * Intentional lock is sticky: no timer ends it. Only an intentional unlock
 * (unlockLatch) does. Persisted in lock-latch.json so a restart keeps it.
 */
let lockLatched = false;
let lockLatchedAt = 0;
function isLockLatched() {
  return lockLatched;
}
function engageLockLatch({ source = "lock", revokedSessionId = "" } = {}) {
  lockLatched = true;
  if (!lockLatchedAt) {
    lockLatchedAt = Date.now();
  }
  localLockUntil = Infinity;
  setLatch({ source, revokedSessionId });
}
function unlockLatch() {
  lockLatched = false;
  lockLatchedAt = 0;
  localLockUntil = 0;
  clearLatch();
}
function loadPersistedLatch() {
  const latch = readLatch();
  if (latch) {
    const live = readSession();
    if (live && acceptsPublish(latch, live)) {
      // Unlocked elsewhere (Plasma widget) while Tools was closed.
      clearLatch();
      return;
    }
    if (live) {
      try {
        clearSession();
      } catch {
        // ignore
      }
    }
    lockLatched = true;
    lockLatchedAt = latch.at || Date.now();
    localLockUntil = Infinity;
  }
}
/** After exchange/mint, ignore cookie-SET sync briefly (events can fire after flags clear). */
let gateSyncQuietUntil = 0;
const GATE_SYNC_QUIET_MS = 2_500;
/** Debounce gate-cookie removal so Set-Cookie replace during exchange is not a lock. */
let gateRemovalTimer = null;
const GATE_REMOVAL_DEBOUNCE_MS = 600;

const GATE_EXCHANGE_COOLDOWN_MS = 12_000;
const SPA_NAV_AFTER_EXCHANGE_COOLDOWN_MS = 8_000;
let lastGateExchangeAt = 0;
let lastSpaNavAfterExchangeAt = 0;
/**
 * True after a successful Bearer→gate exchange this app session.
 * gatePresent alone can be stale; leave home only after we have exchanged once.
 */
let exchangedGateThisSession = false;

function stateFile() {
  return path.join(app.getPath("userData"), STATE_NAME);
}

function readWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return null;
  }
}

function writeWindowState(win) {
  // Runs inside the window "close" event: a locked or read-only profile folder
  // must never turn closing the window into an uncaught exception.
  try {
    if (!win || win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const bounds = maximized ? win.getNormalBounds() : win.getBounds();
    const payload = { ...bounds, maximized };
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(payload));
  } catch (error) {
    console.error("Could not save window position:", error);
  }
}

/** loadURL rejects on any failed navigation (offline, aborted redirect); never let that go unhandled. */
function loadUrlSafe(contents, href, options) {
  try {
    const result = contents.loadURL(href, options);
    if (result && typeof result.catch === "function") {
      return result.catch((error) => {
        if (error && (error.code === "ERR_ABORTED" || error.errno === -3)) return;
        console.error("Navigation failed:", href, error && error.message ? error.message : error);
      });
    }
    return result;
  } catch (error) {
    console.error("Navigation threw:", href, error);
    return Promise.resolve();
  }
}

/** Run one startup step; a failure is logged and startup carries on to the window. */
async function startupStep(name, fn, timeoutMs = 0) {
  let timer = null;
  try {
    const work = Promise.resolve().then(fn);
    if (!timeoutMs) return await work;
    return await Promise.race([
      work,
      new Promise((resolve) => {
        timer = setTimeout(() => {
          console.error(`Startup step "${name}" still running after ${timeoutMs}ms; opening the window anyway.`);
          resolve(undefined);
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    console.error(`Startup step "${name}" failed:`, error);
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function openLogsFolder() {
  const { logDir } = require("./crash-log");
  const dir = logDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // shell.openPath reports the failure below
  }
  shell.openPath(dir).then((problem) => {
    if (problem) console.error("Could not open the logs folder:", problem);
  });
}

function browserUserAgent() {
  const chrome = process.versions.chrome;
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

function shopUrlFromArgv(argv) {
  for (const arg of argv) {
    const decision = classifyUrl(arg);
    if (decision.kind === "shop") return decision.href;
  }
  return null;
}

function openOutside(href) {
  shell.openExternal(href).catch((error) => {
    console.error("Could not open outside the shop window:", error);
  });
}

function handleNavigation(event, rawUrl, contents) {
  if (typeof rawUrl === "string" && rawUrl.startsWith("file:") && rawUrl.includes("offline.html")) {
    return;
  }

  const decision = classifyUrl(rawUrl);
  if (decision.kind === "shop" || decision.kind === "auth") {
    if (decision.kind === "shop" && contents !== mainWindow?.webContents) {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) loadUrlSafe(mainWindow, decision.href);
      const owner = BrowserWindow.fromWebContents(contents);
      if (owner && owner !== mainWindow) owner.close();
      return;
    }
    if (decision.href !== rawUrl) {
      event.preventDefault();
      loadUrlSafe(contents, decision.href);
    }
    return;
  }

  event.preventDefault();
  if (decision.kind === "external") openOutside(decision.href);
}

function attachNavigation(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    const decision = classifyUrl(url);
    if (decision.kind === "auth") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          parent: mainWindow ?? undefined,
          modal: false,
          width: 520,
          height: 760,
          autoHideMenuBar: true,
          backgroundColor: "#efe9dc",
          icon: ICON_PATH,
        },
      };
    }
    if (decision.kind === "shop" && mainWindow && !mainWindow.isDestroyed()) {
      loadUrlSafe(mainWindow, decision.href);
    } else if (decision.kind === "external") {
      openOutside(decision.href);
    }
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => handleNavigation(event, url, contents));
  contents.on("will-redirect", (event, url) => handleNavigation(event, url, contents));

  contents.on("context-menu", (_event, params) => {
    const menu = new Menu();
    if (params.isEditable) {
      menu.append(new MenuItem({ label: "Cut", role: "cut", enabled: params.editFlags.canCut }));
      menu.append(new MenuItem({ label: "Copy", role: "copy", enabled: params.editFlags.canCopy }));
      menu.append(new MenuItem({ label: "Paste", role: "paste", enabled: params.editFlags.canPaste }));
      menu.append(new MenuItem({ type: "separator" }));
      menu.append(new MenuItem({ label: "Select all", role: "selectAll" }));
    } else if (params.selectionText) {
      menu.append(new MenuItem({ label: "Copy", role: "copy" }));
    }
    if (params.linkURL) {
      if (menu.items.length > 0) menu.append(new MenuItem({ type: "separator" }));
      menu.append(new MenuItem({
        label: "Open link",
        click: () => {
          const decision = classifyUrl(params.linkURL);
          if (decision.kind === "shop" || decision.kind === "auth") loadUrlSafe(contents, decision.href);
          else if (decision.kind === "external") openOutside(decision.href);
        },
      }));
      menu.append(new MenuItem({
        label: "Copy link",
        click: () => clipboard.writeText(params.linkURL),
      }));
    }
    if (menu.items.length > 0) menu.popup();
  });
}

async function readLoadedStamp(contents) {
  if (classifyUrl(contents.getURL()).kind !== "shop") return "";
  try {
    const listing = await contents.executeJavaScript(
      `[...document.querySelectorAll('script[src],link[href]')].map((el) => el.src || el.href).join('\\n')`,
    );
    return stampFromHtml(listing);
  } catch {
    return "";
  }
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function shellUpdateKey(info) {
  if (!info) return "";
  if (info.mode === "git") return `git:${info.upstream || ""}`;
  return `release:${info.remoteVersion || ""}`;
}

async function checkForShellUpdate({ interactive }) {
  if (!mainWindow || mainWindow.isDestroyed() || shellChecking) return;
  shellChecking = true;
  try {
    const info = await checkShellUpdate({
      root: APP_ROOT,
      currentVersion: app.getVersion(),
      packaged: app.isPackaged,
      launchedSha: LAUNCH_SHA,
    });

    if (!info.available) {
      if (interactive) {
        await dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "Desktop app",
          message: "This desktop app is up to date.",
          detail:
            info.mode === "git"
              ? `Your ${process.platform === "win32" ? "Windows Setup" : "Manjaro"} install already matches the latest shop-desktop on GitHub.`
              : `You are on version ${app.getVersion()}. Portable builds only download a new .exe when there is no shop-desktop git checkout.`,
        });
      }
      return;
    }

    const key = shellUpdateKey(info);
    if (!interactive && key === snoozedShellKey && Date.now() < shellSnoozeUntil) return;
    if (shellPromptOpen) return;
    shellPromptOpen = true;

    if (info.mode === "git") {
      const gitRoot = info.root || APP_ROOT;
      const restartOnly = info.restartOnly === true;
      const choice = await dialog.showMessageBox(mainWindow, {
        type: "info",
        buttons: [restartOnly ? "Restart" : "Update and restart", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Desktop app update",
        message: restartOnly
          ? "Restart to finish the desktop update."
          : "A newer desktop app is available.",
        detail: restartOnly
          ? "The Tools folder already matches GitHub. This window is still the previous copy."
          : [
              "This updates the window in place (git pull) — not a Portable download.",
              info.shortCurrent && info.shortUpstream
                ? `Current ${info.shortCurrent} → ${info.shortUpstream}`
                : "",
              info.summary ? `\n${info.summary.split("\n").slice(0, 8).join("\n")}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
      });
      shellPromptOpen = false;
      if (choice.response !== 0) {
        snoozedShellKey = key;
        shellSnoozeUntil = Date.now() + SNOOZE_MS;
        return;
      }

      try {
        if (!restartOnly) applyGitUpdate(gitRoot);
      } catch (error) {
        await dialog.showMessageBox(mainWindow, {
          type: "warning",
          title: "Desktop app update",
          message: "Couldn't apply the desktop app update.",
          detail: [
            error instanceof Error ? error.message : "The update failed.",
            "",
            "You can update by hand:",
            process.platform === "win32" ? "cd %USERPROFILE%\\shop-desktop" : "cd ~/shop-desktop",
            "git pull",
            "npm install",
            process.platform === "linux" ? "bash scripts/ensure-electron.sh" : "",
          ]
            .filter(Boolean)
            .join("\n"),
        });
        return;
      }

      // Linux: menu launcher runs pending npm + ensure-electron after quit.
      // If this process was Portable but a Setup checkout exists, spawn that checkout.
      relaunchAfterGitUpdate(gitRoot, {
        runningRoot: APP_ROOT,
        packaged: app.isPackaged,
        relaunchApp: (opts) => {
          if (opts && opts.execPath) app.relaunch(opts);
          else app.relaunch();
        },
      });
      app.exit(0);
      return;
    }

    const choice = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Download update", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Desktop app update",
      message: `Version ${info.remoteVersion} is available.`,
      detail: [
        `You are on ${info.currentVersion}.`,
        info.gitError
          ? "Git on this PC could not reach GitHub, so this is the published Windows release."
          : "This install has no shop-desktop git checkout, so the update is a Portable download (bootstrap only).",
        "Prefer Windows Setup / a git clone for in-place updates.",
        info.assetName ? `File: ${info.assetName}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    shellPromptOpen = false;
    if (choice.response === 0 && info.downloadUrl) {
      openOutside(info.downloadUrl);
    } else {
      snoozedShellKey = key;
      shellSnoozeUntil = Date.now() + SNOOZE_MS;
    }
  } catch (error) {
    shellPromptOpen = false;
    if (interactive) {
      await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Desktop app",
        message: "Couldn't check for desktop app updates.",
        detail: error instanceof Error ? error.message : "The check failed.",
      });
    }
  } finally {
    shellChecking = false;
  }
}

async function checkForSiteUpdate({ interactive }) {
  if (!mainWindow || mainWindow.isDestroyed() || checking) return;
  checking = true;
  try {
    const live = await fetchShopStamp();
    if (!live || !runningStamp) {
      if (interactive) {
        await dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "Shop site",
          message: runningStamp
            ? "The shop site didn't say which version it is."
            : "The window is still opening the shop site.",
          detail: "Reload in a moment. If the unlock screen is up, you are on the site.",
        });
      }
      return;
    }

    if (live === runningStamp) {
      if (interactive) {
        await dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "Shop site",
          message: "This window is on the current shop site.",
          detail: "Publishing the site is what updates this app. There is no separate copy to install.",
        });
      }
      return;
    }

    if (!interactive && live === snoozedStamp && Date.now() < snoozeUntil) return;
    if (promptOpen) return;
    promptOpen = true;
    const choice = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Reload now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Shop site updated",
      message: "The shop site has a new version.",
      detail: "Reload this window to pick it up. The book, the lot, and the rest of the shop stay on the site.",
    });
    promptOpen = false;
    if (choice.response === 0) {
      snoozedStamp = "";
      mainWindow.webContents.reloadIgnoringCache();
    } else {
      snoozedStamp = live;
      snoozeUntil = Date.now() + SNOOZE_MS;
    }
  } catch (error) {
    promptOpen = false;
    if (interactive) {
      await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Shop site",
        message: "Couldn't check the shop site.",
        detail: error instanceof Error ? error.message : "The check failed.",
      });
    }
  } finally {
    checking = false;
  }
}


async function ensureLabelsRunning({ interactive = false } = {}) {
  const url = (labelsServerHandle && labelsServerHandle.url) || labelsUrl(8080);
  if (labelsServerHandle && labelsServerHandle.ok && (await probeLabels(url))) {
    return labelsServerHandle;
  }
  try {
    labelsServerHandle = await startLabelsServer({ appRoot: APP_ROOT });
  } catch (error) {
    labelsServerHandle = {
      ok: false,
      reason: String(error && error.message ? error.message : error),
      url: labelsUrl(8080),
    };
  }
  if (!labelsServerHandle.ok) {
    console.error("Labels server failed:", labelsServerHandle.reason);
    if (interactive && mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, {
        type: "warning",
        buttons: ["OK"],
        defaultId: 0,
        title: "Labels service",
        message: "Labels service could not start",
        detail: [
          labelsServerHandle.reason || "Unknown error",
          "",
          "Desk Create RO still needs http://127.0.0.1:8080.",
          process.platform === "win32"
            ? "On Windows, confirm Node.js is installed and re-run Setup (it installs the Labels dependencies), then use Labels → restart."
            : "On Manjaro, confirm Node is installed and Labels deps are present (bash scripts/ensure-labels.sh).",
        ].join("\n"),
      });
    }
  } else {
    console.log(labelsServerHandle.reason || `Labels at ${labelsServerHandle.url}`);
  }
  return labelsServerHandle;
}

async function showLabelsStatus() {
  await ensureLabelsRunning({ interactive: false });
  const url = (labelsServerHandle && labelsServerHandle.url) || labelsUrl(8080);
  const up = await probeLabels(url);
  const owned = Boolean(labelsServerHandle && labelsServerHandle.owned);
  const adopted = Boolean(labelsServerHandle && labelsServerHandle.adopted);
  const lines = [
    up ? `Listening at ${url}` : `Not reachable at ${url}`,
    owned ? "Owned by Black Forest Tools (vendored server)." : adopted
      ? "Adopted an existing process (legacy labels.service or start-labels)."
      : labelsServerHandle && labelsServerHandle.reason
        ? labelsServerHandle.reason
        : "Not started.",
    "",
    "Print controls and Labels settings belong on the shop site.",
    "Desk Create RO keeps POSTing to this localhost API.",
    "This menu only shows status / restart — not a second Labels app.",
  ];
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await dialog.showMessageBox(mainWindow, {
    type: up ? "info" : "warning",
    buttons: ["OK"],
    defaultId: 0,
    title: "Labels service",
    message: up ? "Labels service is up" : "Labels service is down",
    detail: lines.join("\n"),
  });
}

async function restartLabelsService() {
  if (labelsServerHandle && labelsServerHandle.owned) {
    stopLabelsServer(labelsServerHandle, { force: true });
  }
  labelsServerHandle = null;
  const handle = await ensureLabelsRunning({ interactive: true });
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (handle && handle.ok) {
    await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["OK"],
      defaultId: 0,
      title: "Labels service",
      message: "Labels service ready",
      detail: [
        handle.url,
        handle.owned ? "Restarted the Tools-owned server." : "Re-adopted the process already on :8080.",
        "",
        "Desk Create RO can print again when the LabelWriter is online.",
      ].join("\n"),
    });
  }
}

const PIRATE_LAUNCH_ABORT_REASONS = new Set([
  "canvas-2d-unavailable",
  "chrome-not-mounted",
  "launchGame-missing",
  "overlay-not-shown",
  "overlay-not-visible",
  "no-flagship",
  "take-command-failed",
  "disposed",
  "no-document",
  "no-renderer-ack",
  "no-main-window",
  "dedicated-window-failed",
  "send-failed",
]);

function pirateAbortDetail(reason) {
  const r = String(reason || "unknown");
  if (r === "canvas-2d-unavailable" || r.startsWith("draw-failed")) {
    return [
      `Reason: ${r}`,
      "",
      "Canvas 2D is unavailable on this PC (GPU / driver / hardware acceleration).",
      "Check %LOCALAPPDATA%\\blackforest-tools\\tools.log for pirate: lines.",
      "If gpu-fallback.json exists, try deleting it or set BF_TOOLS_ENABLE_GPU=1 and restart.",
    ].join("\n");
  }
  if (
    r === "chrome-not-mounted" ||
    r === "no-renderer-ack" ||
    r === "overlay-not-visible" ||
    r === "overlay-not-shown" ||
    r === "no-overlay-view-api" ||
    r === "shell-overlay-failed"
  ) {
    return [
      `Reason: ${r}`,
      "",
      "The pirate overlay could not show on the shop window (page still loading, clipped, or shell view failed).",
      "Tools tries in-page overlay, then a same-window shell overlay, then a separate window only as last resort.",
      "Check tools.log for pirate: lines (Help → Open logs folder).",
    ].join("\n");
  }
  return [
    `Reason: ${r}`,
    "",
    "Check %LOCALAPPDATA%\\blackforest-tools\\tools.log (Help → Open logs folder).",
  ].join("\n");
}

/**
 * Ask the shop BrowserWindow to launch the in-page overlay. Resolves with
 * { ok, reason }. Always logs; never throws.
 */
function tryInPagePirateLaunch(win, timeoutMs = 2500) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) {
      resolve({ ok: false, reason: "no-main-window" });
      return;
    }
    const wc = win.webContents;
    let settled = false;
    const done = (ok, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ipcMain.removeListener("shell:pirate-status", onStatus);
      } catch {
        // ignore
      }
      resolve({ ok: !!ok, reason: String(reason || "") });
    };
    const onStatus = (event, payload) => {
      try {
        if (!event || event.sender !== wc) return;
      } catch {
        return;
      }
      const ev = payload && typeof payload.event === "string" ? payload.event : "";
      const reason = payload && typeof payload.reason === "string" ? payload.reason : "";
      if (ev === "launch-ok") done(true, reason || "ok");
      else if (ev === "launch-aborted") done(false, reason || "unknown");
    };
    const timer = setTimeout(() => done(false, "no-renderer-ack"), timeoutMs);
    ipcMain.on("shell:pirate-status", onStatus);
    try {
      wc.send("shell:launch-pirate");
    } catch (error) {
      console.error("pirate: send failed", error);
      done(false, "send-failed");
    }
  });
}

function closePirateShellOverlay(reason) {
  const handle = pirateOverlay;
  pirateOverlay = null;
  if (!handle) return;
  console.log(`pirate: shell-overlay-close ${reason || "closed"}`);
  try {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    detachPirateShellOverlay(win, handle);
  } catch (error) {
    console.warn("pirate: shell-overlay detach failed", error);
  }
}

function ensurePirateOverlayResizeHook(win) {
  if (!win || win.isDestroyed() || pirateOverlayResizeHooked) return;
  pirateOverlayResizeHooked = true;
  const sync = () => {
    if (!pirateOverlay) return;
    syncPirateShellOverlayBounds(win, pirateOverlay);
  };
  win.on("resize", sync);
  win.on("maximize", sync);
  win.on("unmaximize", sync);
  win.on("enter-full-screen", sync);
  win.on("leave-full-screen", sync);
}

/**
 * Same-window shell overlay (WebContentsView / BrowserView on the shop window).
 * Covers the shop content without opening a second OS window.
 */
function tryPirateShellOverlay(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    if (!win) {
      resolve({ ok: false, reason: "no-main-window" });
      return;
    }

    let settled = false;
    let wc = pirateOverlay && pirateOverlay.webContents ? pirateOverlay.webContents : null;
    const done = (ok, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ipcMain.removeListener("shell:pirate-status", onStatus);
      } catch {
        // ignore
      }
      if (!ok) {
        // Failed boot — do not leave a blank view covering the shop.
        closePirateShellOverlay(reason || "overlay-failed");
      }
      resolve({ ok: !!ok, reason: String(reason || "") });
    };
    const onStatus = (event, payload) => {
      try {
        if (!wc || !event || event.sender !== wc) return;
      } catch {
        return;
      }
      const ev = payload && typeof payload.event === "string" ? payload.event : "";
      const reason = payload && typeof payload.reason === "string" ? payload.reason : "";
      if (ev === "launch-ok") done(true, reason || "shell-overlay");
      else if (ev === "launch-aborted") done(false, reason || "shell-overlay-failed");
    };
    const timer = setTimeout(() => done(false, "no-renderer-ack"), timeoutMs);
    ipcMain.on("shell:pirate-status", onStatus);

    const attached = attachPirateShellOverlay({
      parent: win,
      WebContentsView,
      BrowserView,
      existing: pirateOverlay,
    });
    if (!attached.ok || !attached.handle) {
      done(false, attached.reason || "shell-overlay-failed");
      return;
    }
    pirateOverlay = attached.handle;
    wc = pirateOverlay.webContents;
    ensurePirateOverlayResizeHook(win);
  });
}

/**
 * Last-resort dedicated BrowserWindow — only if in-page and shell overlay both fail.
 */
function tryDedicatedPirateWindow(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const existing = pirateWindow && !pirateWindow.isDestroyed() ? pirateWindow : null;
    let settled = false;
    let wc = existing ? existing.webContents : null;
    const done = (ok, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ipcMain.removeListener("shell:pirate-status", onStatus);
      } catch {
        // ignore
      }
      resolve({ ok: !!ok, reason: String(reason || "") });
    };
    const onStatus = (event, payload) => {
      try {
        if (!wc || !event || event.sender !== wc) return;
      } catch {
        return;
      }
      const ev = payload && typeof payload.event === "string" ? payload.event : "";
      const reason = payload && typeof payload.reason === "string" ? payload.reason : "";
      if (ev === "launch-ok") done(true, reason || "dedicated-window");
      else if (ev === "launch-aborted") done(false, reason || "dedicated-window-failed");
    };
    const timer = setTimeout(() => done(false, "no-renderer-ack"), timeoutMs);
    ipcMain.on("shell:pirate-status", onStatus);

    const opened = openPirateGameWindow({
      BrowserWindow,
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
      existing,
    });
    if (!opened.ok || !opened.window) {
      done(false, opened.reason || "dedicated-window-failed");
      return;
    }
    pirateWindow = opened.window;
    wc = pirateWindow.webContents;
    pirateWindow.on("closed", () => {
      if (pirateWindow === opened.window) pirateWindow = null;
    });
  });
}

async function showPirateAbortDialog(reason) {
  const win =
    (mainWindow && !mainWindow.isDestroyed() && mainWindow) ||
    (pirateWindow && !pirateWindow.isDestroyed() && pirateWindow) ||
    null;
  try {
    await dialog.showMessageBox(win || undefined, {
      type: "warning",
      buttons: ["OK"],
      defaultId: 0,
      title: "Pirate game",
      message: "Could not open the pirate game",
      detail: pirateAbortDetail(reason),
    });
  } catch (error) {
    console.error("pirate abort dialog failed:", error);
  }
}

/**
 * Settings → Launch pirate game.
 * 1) Log immediately (console.log → tools.log).
 * 2) Try in-page overlay on the shop page (default — same as idle).
 * 3) On failure, attach a same-window shell overlay (WebContentsView).
 * 4) Only if that also fails, open a separate Pirate BrowserWindow (last resort).
 * 5) If all fail, show a dialog. Never a silent no-op.
 */
async function launchPirateFromSettings() {
  // console.log (not info): teeConsole always writes log/warn/error to tools.log;
  // info was missing before 1.5.23 so Logan's log had zero pirate: lines.
  console.log("pirate: launch-requested from-settings");

  const win = mainWindow;
  if (win && !win.isDestroyed()) {
    try {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.focus();
    } catch (error) {
      console.warn("pirate: could not focus window", error);
    }
  }

  // In-page can take an extra frame for the visibility probe (preload afterPaint).
  const inPage = await tryInPagePirateLaunch(win, 3500);
  if (inPage.ok) {
    console.log(`pirate: launch-ok in-page ${inPage.reason || "ok"}`);
    return;
  }
  console.warn(
    `pirate: in-page-failed ${inPage.reason || "unknown"}; opening same-window shell overlay`,
  );

  const overlay = await tryPirateShellOverlay();
  if (overlay.ok) {
    console.log(`pirate: launch-ok shell-overlay ${overlay.reason || "ok"}`);
    return;
  }
  console.warn(
    `pirate: shell-overlay-failed ${overlay.reason || "unknown"}; last-resort dedicated window`,
  );

  const dedicated = await tryDedicatedPirateWindow();
  if (dedicated.ok) {
    console.log(`pirate: launch-ok dedicated-window ${dedicated.reason || "ok"}`);
    return;
  }

  const why = dedicated.reason || overlay.reason || inPage.reason || "dedicated-window-failed";
  console.warn(`pirate: launch-aborted ${why}`);
  await showPirateAbortDialog(why);
}

async function showPirateLeaderboard() {
  const board = await pirateBoardFromDesk(null, { version: app.getVersion() });
  if (!board.ok) console.warn(`pirate: board ${board.error || "unavailable"}`);
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  await dialog.showMessageBox(win, {
    type: board.ok ? "info" : "warning",
    buttons: ["OK"],
    defaultId: 0,
    title: "Pirate leaderboard",
    message: `Pirate leaderboard · Tools ${app.getVersion()}`,
    detail: formatLeaderboardDetail(board),
  });
}

function shopMenu() {
  const send = (channel) => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;
    if (channel === "home") loadUrlSafe(win, SHOP_HOME);
    if (channel === "reload") win.webContents.reload();
    if (channel === "hard") win.webContents.reloadIgnoringCache();
    if (channel === "back" && win.webContents.canGoBack()) win.webContents.goBack();
    if (channel === "forward" && win.webContents.canGoForward()) win.webContents.goForward();
  };

  return Menu.buildFromTemplate(
    buildAppMenuTemplate({
      onShopHome: () => send("home"),
      onBack: () => send("back"),
      onForward: () => send("forward"),
      onReload: () => send("reload"),
      onHardReload: () => send("hard"),
      onCheckSiteUpdates: () => checkForSiteUpdate({ interactive: true }),
      onCheckAppUpdates: () => checkForShellUpdate({ interactive: true }),
      onLaunchPirateGame: () => {
        // Log synchronously in the click handler so a hung async path still
        // leaves a tools.log breadcrumb (proves the menu item fired).
        console.log("pirate: menu-click");
        launchPirateFromSettings().catch((error) => {
          console.error("pirate launch handler failed:", error);
        });
      },
      onPirateLeaderboard: () => {
        showPirateLeaderboard().catch((error) => {
          console.error("pirate leaderboard failed:", error);
        });
      },
      onLabelsStatus: () => {
        showLabelsStatus().catch((error) => {
          console.error(error);
        });
      },
      onRestartLabels: () => {
        restartLabelsService().catch((error) => {
          console.error(error);
        });
      },
      onOpenFirefoxSignedIn: () => {
        openFirefoxSignedIn({ interactive: true }).catch((error) => {
          console.error(error);
        });
      },
      onLockShop: () => {
        lockSharedSurfaces({ revokeRemote: true }).catch((error) => {
          console.error(error);
        });
      },
      onOpenInBrowser: () => {
        openFirefoxSignedIn({ interactive: true }).catch((error) => {
          console.error(error);
        });
      },
      onOpenLogs: openLogsFolder,
      onAbout: async () => {
        const choice = await dialog.showMessageBox(mainWindow, {
          type: "info",
          buttons: ["OK", "Check for updates"],
          defaultId: 0,
          cancelId: 0,
          title: "About Black Forest Tools",
          message: "Black Forest Tools",
          detail: [
            `Version ${app.getVersion()}`,
            "",
            "This is a window onto shop.blackforestautomotive.com.",
            "The book, the lot, notes, parts, crew, and Google calendar are the live shop site.",
            "Publishing the site updates this window. Shop data is not a separate copy.",
            "",
            "Desktop-app changes (menus, shortcuts, this updater) come from the shop-desktop project.",
            "A git install (Manjaro, or Windows Setup) pulls those in place and restarts. Portable download is only when there is no shop-desktop git checkout (bootstrap).",
            "",
            "Check for desktop updates from Settings → Check for updates.",
            "",
            (labelsServerHandle && labelsServerHandle.ok
              ? `Labels service: ${labelsServerHandle.url} (${labelsServerHandle.owned ? "owned by Tools" : "adopted existing"})`
              : "Labels service: starts with Tools (Labels → status / restart)"),
            "LabelWriter print UX belongs on the shop site; Tools owns localhost :8080.",
            "",
            `Unlock is shared with the shop widgets and Black Forest Desk via ${path.dirname(sessionFilePath())}.`,
            "Shop → Open in Firefox signed in mints a one-time shop handoff URL (keeps your default Firefox profile).",
            "While Tools is open, Desk can import the same session from http://127.0.0.1:8788 without re-typing the PIN.",
            "Lock shop (menu or SPA Lock) clears the shared file, revokes the widget Bearer, and this window — Desk Sync Tools then has nothing to import. Firefox’s own shop cookie may still need Lock or expiry.",
          ].join("\n"),
        });
        if (choice.response === 1) {
          checkForShellUpdate({ interactive: true });
        }
      },
    }),
  );
}

function createWindow(startUrl) {
  const { screen } = require("electron");
  const saved = readWindowState();
  const areas = screen.getAllDisplays().map((display) => display.workArea);
  const usable = boundsAreUsable(saved, areas);

  const win = new BrowserWindow({
    width: usable ? saved.width : DEFAULT_WIDTH,
    height: usable ? saved.height : DEFAULT_HEIGHT,
    x: usable ? saved.x : undefined,
    y: usable ? saved.y : undefined,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    title: "Black Forest Tools",
    backgroundColor: "#efe9dc",
    // Keep the native Shop / Settings / Help menu bar visible (not Alt-only).
    autoHideMenuBar: false,
    icon: ICON_PATH,
    webPreferences: {
      // sandbox off so preload can require local shell modules (chrome + idle fleet).
      // contextIsolation stays on; page JS still cannot reach Node.
      preload: PRELOAD_PATH,
      partition: "persist:shop",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });

  mainWindow = win;
  if (usable && saved.maximized) win.maximize();

  win.once("ready-to-show", showWindow);
  // Never leave a window hidden forever if ready-to-show does not fire (GPU trouble).
  setTimeout(() => {
    try {
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    } catch {
      // ignore
    }
  }, 8_000);
  win.on("close", () => writeWindowState(win));
  win.on("focus", () => {
    const now = Date.now();
    if (now - lastFocusCheck < FOCUS_CHECK_GAP_MS) return;
    lastFocusCheck = now;
    checkForSiteUpdate({ interactive: false });
  });

  attachNavigation(win.webContents);
  win.webContents.on("did-fail-load", (_event, errorCode, _description, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    if (typeof validatedURL === "string" && validatedURL.startsWith("file:")) return;
    win.loadFile(OFFLINE_PATH).then(showWindow).catch((error) => {
      console.error(error);
      showWindow();
    });
  });
  win.webContents.on("did-finish-load", () => {
    readLoadedStamp(win.webContents).then((stamp) => {
      if (stamp) runningStamp = stamp;
    });
    // Shared Bearer present but SPA still on /unlock (TanStack Set-Cookie miss) → exchange.
    maybeExchangeWhileOnUnlock(win.webContents.getURL());
    maybeMintAfterLeavingUnlock(win.webContents.getURL());
  });
  win.webContents.on("did-navigate", (_event, url) => {
    maybeExchangeWhileOnUnlock(url);
    maybeMintAfterLeavingUnlock(url);
  });

  loadUrlSafe(win, startUrl, {
    extraHeaders: "pragma: no-cache\ncache-control: no-cache\n",
  });

  return win;
}

function shopPartition() {
  return session.fromPartition("persist:shop");
}

function rememberUnlockAttempt(details) {
  if (!details || !details.uploadData || !details.uploadData.length) {
    return;
  }
  for (const part of details.uploadData) {
    if (!part || !part.bytes) {
      continue;
    }
    if (rememberUnlockCredsRaw(Buffer.from(part.bytes))) {
      return;
    }
  }
}

function applyUnlockWidgetSession(raw) {
  const next = extractUnlockWidgetSession(raw);
  if (!next) {
    return null;
  }
  writeSession(next);
  trackShared(next);
  pendingUnlockCreds = null;
  pendingUnlockUntil = 0;
  return next;
}

async function mintSharedSessionFromPending({ force = false } = {}) {
  if (mintingWidgetSession) {
    return { ok: false, reason: "busy" };
  }
  if (!force && readSession()) {
    pendingUnlockCreds = null;
    pendingUnlockUntil = 0;
    return { ok: true, reason: "already" };
  }
  if (!pendingUnlockCreds || Date.now() > pendingUnlockUntil) {
    return { ok: false, reason: "no_creds" };
  }
  const creds = pendingUnlockCreds;
  pendingUnlockCreds = null;
  pendingUnlockUntil = 0;
  mintingWidgetSession = true;
  try {
    const next = await mintWidgetSession(creds.person, creds.pin, timedFetch);
    trackShared(next);
    return { ok: true, reason: "minted", person: next.person || "" };
  } catch {
    console.error("Could not mint shared widget session from desktop unlock.");
    return { ok: false, reason: "mint_failed" };
  } finally {
    mintingWidgetSession = false;
  }
}

/**
 * Tools can look unlocked (persist:shop bf_shop_gate) while widget-session.json
 * is missing/expired — Desk then gets 404 from :8788. Recover via from-gate.
 * force=true remints on every unlock so Desk always gets a fresh Bearer.
 */
async function ensureSharedSessionFromGate({ force = false } = {}) {
  if (mintingWidgetSession) {
    return { ok: false, reason: "busy" };
  }
  if (lockLatched) {
    return { ok: false, reason: "locked" };
  }
  // Website/Desk lock sets localLockUntil — never remint Bearer from a jar we are clearing.
  if (!force && Date.now() < localLockUntil) {
    return { ok: false, reason: "local_lock" };
  }
  // Tools SPA on /unlock means intentional lock — Desk probes / onSessionMiss must
  // not from-gate remint a leftover jar cookie (locked-site refresh remint).
  if (!force && spaIsOnUnlock()) {
    return { ok: false, reason: "spa_on_unlock" };
  }
  if (!force && readSession()) {
    return { ok: true, reason: "already" };
  }
  // Stale file on disk (Manjaro: expiresAt yesterday, SPA still unlocked).
  try {
    purgeExpiredSession();
  } catch {
    // ignore
  }
  if (!(await shopGateCookiesPresent())) {
    return { ok: false, reason: "no_gate" };
  }
  mintingWidgetSession = true;
  try {
    const next = await mintWidgetSessionFromGate(partitionFetch);
    trackShared(next);
    return { ok: true, reason: "from_gate", person: next.person || "" };
  } catch (error) {
    console.error("Could not mint shared widget session from shop gate cookie:", error);
    return {
      ok: false,
      reason: error && error.code ? error.code : "failed",
      status: error && error.status,
    };
  } finally {
    gateSyncQuietUntil = Date.now() + GATE_SYNC_QUIET_MS;
    mintingWidgetSession = false;
  }
}

/** Every Tools unlock must refresh widget-session.json for Desk :8788. */
async function syncSharedSessionAfterUnlock({ force = false } = {}) {
  await mintSharedSessionFromPending({ force });
  if (force || !readSession()) {
    await ensureSharedSessionFromGate({ force: force || !readSession() });
  }
}

function rememberUnlockCredsRaw(raw) {
  const creds = extractPersonPin(raw);
  if (!creds) {
    return false;
  }
  pendingUnlockCreds = creds;
  pendingUnlockUntil = Date.now() + 60_000;
  return true;
}

async function shopGateCookiesPresent() {
  try {
    // Prefer url= so host-only cookies (no Domain attr) are found. domain= alone
    // can miss the jar entry Electron stores from Set-Cookie Path=/ responses.
    const byUrl = await shopPartition().cookies.get({
      url: `${SHOP_BASE}/`,
      name: GATE_COOKIE,
    });
    if (byUrl.some((cookie) => cookie && cookie.value)) {
      return true;
    }
    const byDomain = await shopPartition().cookies.get({
      domain: "shop.blackforestautomotive.com",
      name: GATE_COOKIE,
    });
    return byDomain.some((cookie) => cookie && cookie.value);
  } catch {
    return false;
  }
}

/** A hung request would leave busy flags (minting / exchanging) set forever; always bound it. */
function withFetchTimeout(init) {
  const base = init || {};
  return base.signal ? base : { ...base, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) };
}

function timedFetch(url, init) {
  return fetch(url, withFetchTimeout(init));
}

async function partitionFetch(url, init) {
  const shopSession = shopPartition();
  const base = init || {};
  const headers = { ...(base.headers || {}) };
  const hasCookie = Object.keys(headers).some((key) => String(key).toLowerCase() === "cookie");
  // session.fetch on Linux omits the gate on this cross-site POST (SameSite).
  // Send the jar value explicitly so from-gate can mint the shared Bearer.
  if (!hasCookie) {
    try {
      const found = await shopSession.cookies.get({
        url: `${SHOP_BASE}/`,
        name: GATE_COOKIE,
      });
      const gate = found.find((cookie) => cookie && cookie.value);
      const header = gate ? gateCookieHeader(gate.value, GATE_COOKIE) : "";
      if (header) {
        headers.Cookie = header;
      }
    } catch {
      // Jar unreadable — fetch still runs; from-gate may 401.
    }
  }
  const next = withFetchTimeout({ ...base, headers, credentials: "include" });
  if (typeof shopSession.fetch === "function") {
    return shopSession.fetch(url, next);
  }
  return timedFetch(url, next);
}

/**
 * Inject bf_shop_gate into Electron persist:shop.
 * Prefer exchange JSON gateToken (shop beta 0.1.36+) — Set-Cookie is often
 * invisible to session.fetch / extensions. Fall back to parsed Set-Cookie headers.
 */
async function injectGateCookieFromExchange(result) {
  const shopSession = shopPartition();
  const gateToken = result && result.gateToken ? String(result.gateToken) : "";
  if (gateToken) {
    const details = {
      url: `${SHOP_BASE}/`,
      name: GATE_COOKIE,
      value: gateToken,
      path: "/",
      secure: true,
      httpOnly: true,
      // Match the shop gate (SameSite=None). "lax" is not sent on from-gate POST.
      sameSite: "no_restriction",
    };
    const parsed = result.expiresAt ? Date.parse(result.expiresAt) : NaN;
    if (Number.isFinite(parsed)) {
      details.expirationDate = Math.floor(parsed / 1000);
    }
    try {
      await shopSession.cookies.set(details);
      return true;
    } catch (error) {
      console.error("Could not inject shop gate cookie from gateToken:", error);
    }
  }
  const headers = Array.isArray(result && result.setCookie) ? result.setCookie : [];
  for (const header of headers) {
    const details = parseGateSetCookie(header, GATE_COOKIE);
    if (!details) {
      continue;
    }
    try {
      await shopSession.cookies.set(details);
      return true;
    } catch (error) {
      console.error("Could not inject shop gate cookie from Set-Cookie:", error);
    }
  }
  return false;
}

async function reloadSpaAfterGateExchange() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { navigated: false, reason: "no_window" };
  }
  const current = mainWindow.webContents.getURL();
  const stuckOnUnlock =
    !current || current.includes("/unlock") || classifyUrl(current).kind !== "shop";
  if (!stuckOnUnlock) {
    return { navigated: false, reason: "already_shop" };
  }
  const now = Date.now();
  if (now - lastSpaNavAfterExchangeAt < SPA_NAV_AFTER_EXCHANGE_COOLDOWN_MS) {
    return { navigated: false, reason: "nav_cooldown" };
  }
  lastSpaNavAfterExchangeAt = now;
  await loadUrlSafe(mainWindow, SHOP_HOME);
  return { navigated: true, reason: "left_unlock" };
}

/**
 * When a widget session file exists, mint bf_shop_gate into the Electron cookie jar
 * via POST /api/widget/session/exchange (shop beta 0.1.25+). Reload when still on /unlock.
 * force=true after every Tools unlock so TanStack RPC Set-Cookie misses cannot leave
 * the SPA on /unlock while Desk already has a fresh Bearer.
 */
function spaIsOnUnlock() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  return String(mainWindow.webContents.getURL() || "").includes("/unlock");
}

async function exchangeSharedSessionToGate({
  force = false,
  reload = true,
  fromGateRetry = false,
  renew = false,
} = {}) {
  if (exchangingGate || applyingRemoteLock) {
    return { ok: false, reason: "busy" };
  }
  if (Date.now() < localLockUntil) {
    return { ok: false, reason: "local_lock" };
  }
  const existing = readSession();
  if (!existing || !existing.token) {
    return { ok: false, reason: "no_session" };
  }
  const hadGate = await shopGateCookiesPresent();
  const onUnlock = spaIsOnUnlock();
  if (hadGate && !onUnlock && !renew) {
    // Jar already good and SPA not on unlock — do not force-exchange/reload (flash).
    return { ok: true, reason: "already" };
  }
  if (
    !renew &&
    !onUnlock &&
    hadGate === false &&
    lastGateExchangeAt &&
    Date.now() - lastGateExchangeAt < GATE_EXCHANGE_COOLDOWN_MS
  ) {
    return { ok: true, reason: "cooldown" };
  }
  if (!force && !renew && hadGate) {
    return { ok: true, reason: "already" };
  }
  exchangingGate = true;
  try {
    const result = await exchangeWidgetSession(existing.token, partitionFetch);
    if (lockLatched) {
      await clearShopGateCookies();
      return { ok: false, reason: "locked" };
    }
    // Always apply gateToken when present — do not assume Set-Cookie landed in the jar.
    if (result && result.gateToken) {
      await injectGateCookieFromExchange(result);
    } else if (!(await shopGateCookiesPresent())) {
      await injectGateCookieFromExchange(result);
    }
    if (!(await shopGateCookiesPresent())) {
      console.error(
        "Exchange succeeded but bf_shop_gate is still missing from the Electron jar (no usable gateToken/Set-Cookie).",
      );
      return { ok: false, reason: "cookie_missing", ...result };
    }
    lastGateExchangeAt = Date.now();
    exchangedGateThisSession = true;
    let nav = { navigated: false, reason: "skipped" };
    // Leave /unlock once the jar has bf_shop_gate (gateToken path or Set-Cookie).
    if (reload && (onUnlock || spaIsOnUnlock())) {
      nav = await reloadSpaAfterGateExchange();
    }
    return { ok: true, reason: "exchanged", navigated: nav.navigated, ...result };
  } catch (error) {
    if (error && error.code === "unauthorized") {
      console.error("Shared widget session rejected during exchange; clearing local file.");
      clearSession();
      trackShared(null);
      exchangingGate = false;
      // Gate cookie may still be valid — recover Bearer for Desk bridge instead of
      // leaving Tools "unlocked" with an empty widget-session.json (Desk 404).
      if (!fromGateRetry) {
        const recovered = await ensureSharedSessionFromGate();
        if (recovered.ok && recovered.reason === "from_gate") {
          return exchangeSharedSessionToGate({ force: true, reload, fromGateRetry: true });
        }
      }
      return { ok: false, reason: "unauthorized" };
    }
    console.error("Could not exchange widget session for shop gate cookie:", error);
    return { ok: false, reason: "failed", status: error && error.status };
  } finally {
    exchangingGate = false;
  }
}

/** Unlock PIN / widgetToken → refresh Bearer, then force SPA gate cookie into Tools. */
async function syncToolsSpaAfterUnlock() {
  await syncSharedSessionAfterUnlock({ force: true });
  return exchangeSharedSessionToGate({ force: true, reload: true });
}

/** Leave /unlock when the jar already has bf_shop_gate (no force-exchange). */
async function leaveUnlockScreen() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const current = mainWindow.webContents.getURL();
  if (!current || !current.includes("/unlock")) {
    return;
  }
  await loadUrlSafe(mainWindow, SHOP_HOME);
}

/** PIN unlock in the Tools window: leaving /unlock with a gate cookie but no Bearer → mint for Desk. */
async function maybeMintAfterLeavingUnlock(url) {
  try {
    if (
      !shouldMintAfterLeavingUnlock({
        url,
        isShopUrl: classifyUrl(String(url || "")).kind === "shop",
        exchangingGate,
        mintingWidgetSession,
        applyingRemoteLock,
        hasSession: Boolean(readSession()),
        gatePresent: await shopGateCookiesPresent(),
      })
    ) {
      return;
    }
    unlockLatch();
    await ensureSharedSessionFromGate({ force: true });
  } catch (error) {
    console.error(error);
  }
}

/** Shared session exists but SPA is still on /unlock — exchange once (debounced). */
async function maybeExchangeWhileOnUnlock(url) {
  const now = Date.now();
  const action = unlockAutoExchangeAction({
    url,
    exchangingGate,
    mintingWidgetSession,
    applyingRemoteLock,
    localLockUntil,
    now,
    hasSession: Boolean(readSession()),
    gatePresent: await shopGateCookiesPresent(),
    exchangedThisSession: exchangedGateThisSession,
  });
  if (action === "skip") {
    return;
  }
  if (action === "leave") {
    // Gate healed this session — navigate home without another force-exchange.
    if (now - unlockExchangeAttemptAt < UNLOCK_EXCHANGE_GAP_MS) {
      return;
    }
    unlockExchangeAttemptAt = now;
    try {
      await leaveUnlockScreen();
    } catch (error) {
      console.error(error);
    }
    return;
  }
  if (now - unlockExchangeAttemptAt < UNLOCK_EXCHANGE_GAP_MS) {
    return;
  }
  unlockExchangeAttemptAt = now;
  try {
    // Missing gate, or gatePresent but not yet exchanged this session (stale probe).
    await exchangeSharedSessionToGate({ force: true, reload: true });
  } catch (error) {
    console.error(error);
  }
}

function launchFirefox(url) {
  const plan = firefoxLaunchPlan(url);
  return new Promise((resolve, reject) => {
    const attempt = (index) => {
      const step = plan[index];
      if (!step) {
        reject(new Error("Could not open a browser for the Firefox handoff."));
        return;
      }
      if (step.external) {
        shell.openExternal(step.external).then(() => resolve("default-browser"), reject);
        return;
      }
      const child = spawn(step.cmd, step.args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.on("error", (error) => {
        if (error && error.code === "ENOENT" && index + 1 < plan.length) {
          attempt(index + 1);
          return;
        }
        reject(error);
      });
      child.on("spawn", () => {
        child.unref();
        resolve(step.cmd);
      });
    };
    // --new-tab keeps Logan's default Firefox profile (never create a new one).
    attempt(0);
  });
}

async function openFirefoxSignedIn({ interactive = true } = {}) {
  // Prefer a live shared Bearer; recover from Electron gate cookie if file is stale.
  let existing = readSession();
  if (!existing || !existing.token) {
    await ensureSharedSessionFromGate({ force: true });
    existing = readSession();
  }
  if (!existing || !existing.token) {
    if (interactive && mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Open in Firefox",
        message: "Unlock the shop first.",
        detail:
          `Sign in with a shop widget or this window so ${sessionFilePath()} exists, then try again.`,
      });
    }
    return { ok: false, reason: "no_session" };
  }

  try {
    // Keep Tools SPA jar in sync before minting the Firefox ticket.
    await exchangeSharedSessionToGate({ force: true, reload: false });
    const { url } = await requestFirefoxHandoff(existing.token, timedFetch);
    await launchFirefox(url);
    return { ok: true, url };
  } catch (error) {
    if (interactive && mainWindow && !mainWindow.isDestroyed()) {
      const detail =
        error && error.code === "rate_limited"
          ? "Handoff is rate-limited (10/min). Wait a minute and try again."
          : error instanceof Error
            ? error.message
            : "Handoff failed.";
      await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Open in Firefox",
        message: "Could not open Firefox signed in.",
        detail,
      });
    }
    console.error("Firefox handoff failed:", error);
    return { ok: false, reason: error && error.code ? error.code : "failed" };
  }
}

async function clearShopGateCookies() {
  const shopSession = shopPartition();
  try {
    const seen = new Set();
    const batches = await Promise.all([
      shopSession.cookies.get({ url: `${SHOP_BASE}/` }),
      shopSession.cookies.get({ domain: "shop.blackforestautomotive.com" }),
    ]);
    const cookies = batches.flat();
    await Promise.all(
      cookies
        .filter((cookie) => cookie.name === GATE_COOKIE || cookie.name.startsWith(`${GATE_COOKIE}`))
        .map((cookie) => {
          const key = `${cookie.name}|${cookie.path || "/"}|${cookie.domain || ""}`;
          if (seen.has(key)) {
            return Promise.resolve();
          }
          seen.add(key);
          return shopSession.cookies.remove(
            `https://shop.blackforestautomotive.com${cookie.path || "/"}`,
            cookie.name,
          );
        }),
    );
  } catch (error) {
    console.error("Could not clear shop gate cookies:", error);
  }
}

async function lockSharedSurfaces({ revokeRemote = true } = {}) {
  if (applyingRemoteLock) {
    return;
  }
  applyingRemoteLock = true;
  exchangedGateThisSession = false;
  try {
    const existing = readSession();
    engageLockLatch({
      source: revokeRemote ? "lock" : "session-file-cleared",
      revokedSessionId: sessionId(existing),
    });
    if (revokeRemote && existing && existing.token) {
      await revokeWidgetSession(existing.token);
    } else {
      clearSession();
    }
    trackShared(null);
    await clearShopGateCookies();
    // Desk :8788 reads the same file — after clear, /health hasSession:false so
    // "Use Tools session" / Sync Tools no longer offers a live unlock.
    if (mainWindow && !mainWindow.isDestroyed()) {
      const current = mainWindow.webContents.getURL();
      if (!current.includes("/unlock")) {
        await loadUrlSafe(mainWindow, `${SHOP_BASE}/unlock`);
      }
    }
  } finally {
    applyingRemoteLock = false;
  }
}

/**
 * widget-session.json went away. Running out of time is not a lock: renew from the
 * shop gate while the site is still signed in. Anything else (Plasma Lock, manual rm)
 * latches after a short settle so a non-atomic rewrite by another writer is not a lock.
 */
function handleSharedSessionVanished(previousSession) {
  if (classifySessionVanish(previousSession) === "expired") {
    renewExpiredSharedSession().catch((error) => {
      console.error(error);
    });
    return;
  }
  if (sessionVanishTimer) {
    clearTimeout(sessionVanishTimer);
  }
  sessionVanishTimer = setTimeout(() => {
    sessionVanishTimer = null;
    if (lockLatched || applyingRemoteLock || mintingWidgetSession || exchangingGate) {
      return;
    }
    if (readSession()) {
      return;
    }
    lockSharedSurfaces({ revokeRemote: false }).catch((error) => {
      console.error(error);
    });
  }, SESSION_VANISH_SETTLE_MS);
}

/** Bearer expired but the SPA gate cookie is still good: mint a fresh one, no lock. */
async function renewExpiredSharedSession() {
  if (lockLatched || spaIsOnUnlock()) {
    return { ok: false, reason: "locked_or_unlock" };
  }
  const minted = await ensureSharedSessionFromGate({ force: true });
  if (minted.ok && minted.reason === "from_gate") {
    return exchangeSharedSessionToGate({ force: true, reload: false, renew: true });
  }
  return minted;
}

/**
 * Rotate a Bearer that is about to expire and push the new expiry into the gate cookie,
 * so Tools and the Firefox site both stay signed in without a lock or a PIN.
 */
let renewingSession = false;
async function renewSharedSessionIfDue() {
  const live = readSession();
  const action = sessionTimerAction({
    session: live,
    locked: lockLatched,
    busy: renewingSession || mintingWidgetSession || exchangingGate || applyingRemoteLock,
  });
  if (action !== "renew") {
    return { ok: true, reason: "not_due" };
  }
  renewingSession = true;
  try {
    let next = null;
    try {
      next = await refreshWidgetSession(live, partitionFetch);
    } catch (error) {
      if (error && error.code === "unauthorized") {
        // Server dropped the Bearer (restart, revoke). The gate cookie may still be good.
        if (!lockLatched && !spaIsOnUnlock() && (await shopGateCookiesPresent())) {
          return await ensureSharedSessionFromGate({ force: true });
        }
      }
      console.error("Could not renew shared widget session:", error);
      return { ok: false, reason: error && error.code ? error.code : "failed" };
    }
    // A lock or a different unlock that raced the refresh wins.
    const now = readSession();
    if (lockLatched || applyingRemoteLock || !now || now.token !== live.token) {
      return { ok: false, reason: "raced" };
    }
    writeSession(next);
    trackShared(next);
    return await exchangeSharedSessionToGate({ force: true, reload: false, renew: true });
  } finally {
    renewingSession = false;
  }
}

function watchSharedSessionFile() {
  const file = sessionFilePath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  } catch (error) {
    console.error("Could not create the shared session folder:", error);
  }
  trackShared(readSession());

  const onChange = () => {
    try {
      handleSessionFileChange();
    } catch (error) {
      console.error("Shared session watcher handler failed:", error);
    }
  };

  const handleSessionFileChange = () => {
    if (applyingRemoteLock || mintingWidgetSession || exchangingGate) {
      return;
    }
    const next = readSession();
    const fp = sessionFingerprint(next);
    if (fp === lastSharedFingerprint) {
      return;
    }
    const previous = lastSharedFingerprint;
    const previousSession = lastSharedSession;
    const had = Boolean(previous);
    trackShared(next);
    if (fp && sessionVanishTimer) {
      clearTimeout(sessionVanishTimer);
      sessionVanishTimer = null;
    }
    if (!fp && had) {
      handleSharedSessionVanished(previousSession);
      return;
    }
    // Any new/changed shared Bearer (Desk, Plasma, unlock) must unlock the Tools SPA.
    // Clear local_lock first — website unlock publish must not stay stuck behind cooldown
    // if the file watcher races ahead of (or instead of) bridge onPublished.
    if (lockLatched && !acceptsPublish(readLatch(), next)) {
      // A revoked Bearer came back (stale copy). Drop it; the lock stays.
      try {
        clearSession();
      } catch {
        // ignore
      }
      trackShared(null);
      return;
    }
    if (shouldClearLocalLockOnSharedPublish({ previousFingerprint: previous, nextFingerprint: fp })) {
      unlockLatch();
      exchangeSharedSessionToGate({ force: true, reload: true }).catch((error) => {
        console.error(error);
      });
    }
  };

  const ensureSessionPoll = () => {
    if (!sharedSessionPoll) {
      sharedSessionPoll = setInterval(onChange, SESSION_POLL_MS);
    }
  };

  try {
    if (sharedSessionWatcher) {
      sharedSessionWatcher.close();
    }
  } catch {
    // ignore
  }

  try {
    sharedSessionWatcher = fs.watch(path.dirname(file), { persistent: false }, (_event, filename) => {
      if (filename && filename !== path.basename(file) && filename !== `${path.basename(file)}.tmp`) {
        return;
      }
      onChange();
    });
    // Windows raises EPERM here when the watched folder is renamed/removed (an update,
    // cleanup or antivirus pass). Unhandled, that is a main-process crash.
    sharedSessionWatcher.on("error", (error) => {
      console.error("Shared session watcher error; falling back to polling:", error);
      try {
        sharedSessionWatcher.close();
      } catch {
        // ignore
      }
      sharedSessionWatcher = null;
      ensureSessionPoll();
    });
  } catch (error) {
    console.error("Could not watch shared session file:", error);
    ensureSessionPoll();
  }

  // Linux: Plasma's `mv widget-session.json.tmp` often never notifies inotify.
  if (shouldPollSharedSession({ platform: process.platform })) {
    ensureSessionPoll();
  }
}

function configureSession() {
  const shopSession = shopPartition();
  shopSession.setUserAgent(browserUserAgent());
  shopSession.webRequest.onBeforeRequest(
    { urls: ["https://shop.blackforestautomotive.com/*"] },
    (details, callback) => {
      if (details.method === "POST") {
        rememberUnlockAttempt(details);
      }
      callback({});
    },
  );
  shopSession.webRequest.onBeforeSendHeaders(
    { urls: ["https://shop.blackforestautomotive.com/*"] },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      if (details.resourceType === "mainFrame") {
        requestHeaders["Cache-Control"] = "no-cache";
        requestHeaders.Pragma = "no-cache";
      }
      callback({ requestHeaders });
    },
  );
  shopSession.cookies.on("changed", (_event, cookie, cause, removed) => {
    if (!cookie || cookie.name !== GATE_COOKIE) {
      return;
    }
    if (removed) {
      const removal = classifyGateRemoval(cause, cookie.expirationDate);
      // Cookie replace during exchange often fires removed→set. Wait; if the jar
      // stays empty, treat it as SPA Lock and clear Desk's shared Bearer too.
      if (applyingRemoteLock || exchangingGate || mintingWidgetSession) {
        return;
      }
      if (gateRemovalTimer) {
        clearTimeout(gateRemovalTimer);
      }
      gateRemovalTimer = setTimeout(() => {
        gateRemovalTimer = null;
        if (applyingRemoteLock || exchangingGate || mintingWidgetSession) {
          return;
        }
        shopGateCookiesPresent()
          .then((present) => {
            if (present) {
              return null;
            }
            // The cookie only ran out and the Bearer is still good: renew, never latch.
            if (removal === "expired" && readSession() && !lockLatched) {
              return exchangeSharedSessionToGate({ force: true, reload: false, renew: true });
            }
            return lockSharedSurfaces({ revokeRemote: true });
          })
          .catch((error) => {
            console.error(error);
          });
      }, GATE_REMOVAL_DEBOUNCE_MS);
      return;
    }
    if (gateRemovalTimer) {
      clearTimeout(gateRemovalTimer);
      gateRemovalTimer = null;
    }
    // While locked, Tools never writes this cookie itself (exchange is blocked), so a
    // Set-Cookie here is the PIN unlock in this window. Unlock now and mint the Bearer
    // so Desk sees hasSession on :8788 without waiting for the page to leave /unlock.
    if (lockLatched && !exchangingGate && !mintingWidgetSession && !applyingRemoteLock) {
      unlockLatch();
      ensureSharedSessionFromGate({ force: true }).catch((error) => {
        console.error(error);
      });
      return;
    }
    // Exchange/mint Set-Cookie must not re-enter syncToolsSpaAfterUnlock
    // (force from-gate + force exchange + reload) — that flashes the SPA and 429s.
    const now = Date.now();
    if (
      now < gateSyncQuietUntil ||
      !shouldHandleGateCookieSet({
        exchangingGate,
        mintingWidgetSession,
        applyingRemoteLock,
        localLockUntil,
        now,
      })
    ) {
      return;
    }
    // Cookie already landed in the jar — only ensure Desk Bearer.
    // Do NOT force-exchange here (flash/429 loop). SPA leave is handled by
    // maybeExchangeWhileOnUnlock: gatePresent → exchange-once-this-session, then leave.
    gateSyncQuietUntil = now + GATE_SYNC_QUIET_MS;
    ensureSharedSessionFromGate({ force: false }).catch((error) => {
      console.error(error);
    });
  });
  ipcMain.on("shop-lock", () => {
    // SPA Lock button / lockShop server fn — clear Bearer + jar immediately.
    lockSharedSurfaces({ revokeRemote: true }).catch((error) => {
      console.error(error);
    });
  });
  ipcMain.on("shop-unlock-creds", (_event, text) => {
    try {
      if (rememberUnlockCredsRaw(text)) {
        unlockLatch();
        // PIN seen in preload fetch — mint + force SPA exchange (Desk + Tools window).
        syncToolsSpaAfterUnlock().catch((error) => {
          console.error(error);
        });
      }
    } catch (error) {
      console.error("Could not capture unlock person/PIN:", error);
    }
  });
  ipcMain.on("shop-unlock-json", (_event, text) => {
    try {
      unlockLatch();
      if (applyUnlockWidgetSession(text)) {
        // Always force exchange after unlock JSON — do not trust a pre-existing jar entry.
        exchangeSharedSessionToGate({ force: true, reload: true }).catch((error) => {
          console.error(error);
        });
        return;
      }
      // No widgetToken in JSON (or viewer-shaped / unlock-ok only): PIN/from-gate + exchange.
      syncToolsSpaAfterUnlock().catch((error) => {
        console.error(error);
      });
    } catch (error) {
      console.error("Could not apply unlock widgetToken:", error);
    }
  });
  shopSession.setPermissionRequestHandler((_contents, permission, callback) => {
    const allowed = new Set([
      "notifications",
      "clipboard-read",
      "clipboard-sanitized-write",
      "fullscreen",
    ]);
    callback(allowed.has(permission));
  });
  try {
    shopSession.setSpellCheckerLanguages(["en-US"]);
  } catch {
    // The dictionary download is optional. Notes still work without the underline.
  }
}

if (gotLock) {
  app.on("second-instance", (_event, argv) => {
    const url = shopUrlFromArgv(argv);
    try {
      if (url && mainWindow && !mainWindow.isDestroyed()) loadUrlSafe(mainWindow, url);
      showWindow();
    } catch (error) {
      console.error("second-instance handler failed:", error);
    }
  });

  ipcMain.on("shell:renderer-error", (_event, payload) => {
    const where = payload && typeof payload.where === "string" ? payload.where.slice(0, 80) : "renderer";
    const text = payload && typeof payload.text === "string" ? payload.text.slice(0, 4000) : "";
    console.error(`Renderer error (${where}):`, text);
  });

  // Pirate idle / Settings launch status (also handled transiently by launch helpers).
  ipcMain.on("shell:pirate-status", (_event, payload) => {
    const ev = payload && typeof payload.event === "string" ? payload.event.slice(0, 80) : "status";
    const reason = payload && typeof payload.reason === "string" ? payload.reason.slice(0, 200) : "";
    if (ev.includes("abort") || ev.includes("fail") || ev.includes("deferred")) {
      console.warn(`pirate: ${ev}${reason ? ` ${reason}` : ""}`);
    } else {
      console.log(`pirate: ${ev}${reason ? ` ${reason}` : ""}`);
    }
  });

  // Shell overlay (WebContentsView) asked to close — stand down / water click / failed boot.
  ipcMain.on("shell:pirate-overlay-close", (_event, payload) => {
    const reason =
      payload && typeof payload.reason === "string" ? payload.reason.slice(0, 200) : "ipc-close";
    closePirateShellOverlay(reason);
  });

  ipcMain.handle("shell:check-updates", async () => {
    await checkForShellUpdate({ interactive: true });
    return { ok: true };
  });

  ipcMain.handle("shell:pirate-board", async (_event, payload) => {
    const board = await pirateBoardFromDesk(payload, { version: app.getVersion() });
    if (!board.ok) console.warn(`pirate: board ${board.error || "unavailable"}`);
    return board;
  });

  app.whenReady().then(async () => {
    if (process.platform === "win32") {
      app.setAppUserModelId("com.blackforestautomotive.tools");
    }
    await startupStep("latch", loadPersistedLatch);
    await startupStep("session", configureSession);
    await startupStep("session-watch", watchSharedSessionFile);
    try {
      deskSessionBridge = startDeskSessionBridge({
        acceptPublish: (next) => !lockLatched || acceptsPublish(readLatch(), next),
        lockInfo: () => ({ locked: lockLatched, lockedAt: lockLatchedAt }),
        onPublished: (session) => {
          // Desk/website unlock published a Bearer — leave local lock cooldown immediately
          // so exchange cannot return local_lock (1.5.12 race fix).
          unlockLatch();
          exchangedGateThisSession = false;
          trackShared(session);
          exchangeSharedSessionToGate({ force: true, reload: true }).catch((error) => {
            console.error(error);
          });
        },
        // Desk probe while SPA unlocked + expired file → refresh Bearer before 404.
        // Must NOT remint during localLockUntil or while SPA shows /unlock
        // (locked-site refresh must not auto-log-in Tools).
        onSessionMiss: async () => {
          if (spaIsOnUnlock()) {
            return { ok: false, reason: "spa_on_unlock" };
          }
          await ensureSharedSessionFromGate();
        },
        // DELETE /v1/widget-session or POST /v1/lock from Desk (Firefox website lock).
        onLock: async () => {
          await lockSharedSurfaces({ revokeRemote: true });
        },
      });
      deskSessionBridge.server.on("listening", () => {
        console.log(
          `Desk session bridge on http://${deskSessionBridge.host}:${deskSessionBridge.port}/v1/widget-session`,
        );
      });
      deskSessionBridge.server.on("error", (error) => {
        console.error("Desk session bridge failed to bind (Desk session share unavailable):", error);
        deskSessionBridge = null;
      });
    } catch (error) {
      console.error("Desk session bridge failed to start:", error);
      deskSessionBridge = null;
    }
    await startupStep("menu", () => Menu.setApplicationMenu(shopMenu()));
    // Own Labels (:8080); adopt Manjaro labels.service when already healthy.
    // Fire and forget: a Labels failure must never hold up or take down the window.
    ensureLabelsRunning({ interactive: false }).catch((error) => {
      console.error("Labels startup failed:", error);
    });
    // Gate cookie can persist in Electron while widget-session.json is gone/expired.
    // Also: shared Bearer can exist while SPA jar is empty — force exchange on boot.
    // Bounded: no network at logon (autostart) must not leave the app without a window.
    await startupStep("gate-session", () => ensureSharedSessionFromGate(), BOOT_SYNC_TIMEOUT_MS);
    await startupStep("gate-exchange", () => exchangeSharedSessionToGate({ force: true, reload: false }), BOOT_SYNC_TIMEOUT_MS);
    try {
      createWindow(shopUrlFromArgv(process.argv) || SHOP_HOME);
    } catch (error) {
      console.error("Could not create the main window:", error);
      await dialog
        .showMessageBox({
          type: "error",
          title: "Black Forest Tools",
          message: "The shop window could not open.",
          detail: `${error && error.message ? error.message : error}\n\nDetails are in ${path.join(require("./crash-log").logDir(), "tools.log")}`,
        })
        .catch(() => {});
      app.quit();
      return;
    }
    updateTimer = setInterval(() => {
      checkForSiteUpdate({ interactive: false }).catch((error) => console.error(error));
    }, UPDATE_EVERY_MS);
    shellUpdateTimer = setInterval(() => {
      checkForShellUpdate({ interactive: false }).catch((error) => console.error(error));
    }, SHELL_UPDATE_EVERY_MS);
    sessionRefreshTimer = setInterval(() => {
      ensureSharedSessionFromGate()
        .then(() => renewSharedSessionIfDue())
        .catch((error) => {
          console.error(error);
        });
    }, SESSION_REFRESH_EVERY_MS);
    setTimeout(() => {
      checkForShellUpdate({ interactive: false }).catch((error) => console.error(error));
    }, 20_000);
    setTimeout(() => {
      ensureSharedSessionFromGate()
        .then(() => exchangeSharedSessionToGate({ force: true, reload: true }))
        .catch((error) => {
          console.error(error);
        });
    }, 2_500);
  }).catch((error) => {
    console.error("Startup failed:", error);
  });

  app.on("window-all-closed", () => {
    if (updateTimer) clearInterval(updateTimer);
    if (shellUpdateTimer) clearInterval(shellUpdateTimer);
    if (sessionRefreshTimer) clearInterval(sessionRefreshTimer);
    try {
      if (sharedSessionWatcher) sharedSessionWatcher.close();
    } catch {
      // ignore
    }
    if (sharedSessionPoll) clearInterval(sharedSessionPoll);
    if (deskSessionBridge) {
      deskSessionBridge.close().catch(() => {});
      deskSessionBridge = null;
    }
    stopLabelsServer(labelsServerHandle, { force: false });
    app.quit();
  });
}
