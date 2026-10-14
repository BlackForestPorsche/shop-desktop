"use strict";

const { app, BrowserWindow, Menu, MenuItem, clipboard, dialog, ipcMain, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { SHOP_HOME, classifyUrl } = require("./policy");
const { fetchShopStamp, stampFromHtml } = require("./updates");
const {
  appRootFromMain,
  applyGitUpdate,
  checkShellUpdate,
} = require("./shell-update");
const { buildAppMenuTemplate } = require("./app-menu");
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
  revokeWidgetSession,
  exchangeWidgetSession,
  requestFirefoxHandoff,
  parseGateSetCookie,
  SHOP_BASE,
} = require("./shared-session");
const { startDeskSessionBridge } = require("./desk-session-bridge");
const {
  labelsUrl,
  probeLabels,
  startLabelsServer,
  stopLabelsServer,
} = require("./labels-server");
const {
  shouldHandleGateCookieSet,
  unlockAutoExchangeAction,
} = require("./session-sync-guards");

const ICON_PATH = path.join(__dirname, "..", "assets", "icon.png");
const OFFLINE_PATH = path.join(__dirname, "..", "assets", "offline.html");
const PRELOAD_PATH = path.join(__dirname, "preload.js");
const STATE_NAME = "window-state.json";
const UPDATE_EVERY_MS = 3 * 60 * 1000;
const SHELL_UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;
/** Re-mint widget-session.json from shop gate when SPA still unlocked but Bearer expired. */
const SESSION_REFRESH_EVERY_MS = 5 * 60 * 1000;
const SNOOZE_MS = 2 * 60 * 60 * 1000;
const FOCUS_CHECK_GAP_MS = 60 * 1000;
const APP_ROOT = appRootFromMain(__dirname);
const GATE_COOKIE = "bf_shop_gate";

app.setName("Black Forest Tools");
app.commandLine.appendSwitch("ozone-platform-hint", "auto");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another copy already owns the shop window. Bring that one forward, then leave.
  console.error("Black Forest Tools is already open.");
  app.exit(0);
}

let mainWindow = null;
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
let lastSharedFingerprint = "";
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
const LOCAL_LOCK_COOLDOWN_MS = 45_000;
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
  if (!win || win.isDestroyed()) return;
  const maximized = win.isMaximized();
  const bounds = maximized ? win.getNormalBounds() : win.getBounds();
  const payload = { ...bounds, maximized };
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(payload));
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
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(decision.href);
      const owner = BrowserWindow.fromWebContents(contents);
      if (owner && owner !== mainWindow) owner.close();
      return;
    }
    if (decision.href !== rawUrl) {
      event.preventDefault();
      contents.loadURL(decision.href);
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
      mainWindow.loadURL(decision.href);
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
          if (decision.kind === "shop" || decision.kind === "auth") contents.loadURL(decision.href);
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
    });

    if (!info.available) {
      if (interactive) {
        await dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "Desktop app",
          message: "This desktop app is up to date.",
          detail:
            info.mode === "git"
              ? "Your Manjaro install already matches the latest shop-desktop on GitHub."
              : `You are on version ${app.getVersion()}.`,
        });
      }
      return;
    }

    const key = shellUpdateKey(info);
    if (!interactive && key === snoozedShellKey && Date.now() < shellSnoozeUntil) return;
    if (shellPromptOpen) return;
    shellPromptOpen = true;

    if (info.mode === "git") {
      const choice = await dialog.showMessageBox(mainWindow, {
        type: "info",
        buttons: ["Update and restart", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Desktop app update",
        message: "A newer desktop app is available.",
        detail: [
          "This updates the window itself (menus, shortcuts, offline page) — not the shop site.",
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
        applyGitUpdate(APP_ROOT);
      } catch (error) {
        await dialog.showMessageBox(mainWindow, {
          type: "warning",
          title: "Desktop app update",
          message: "Couldn't apply the desktop app update.",
          detail: [
            error instanceof Error ? error.message : "The update failed.",
            "",
            "You can update by hand:",
            "cd ~/shop-desktop",
            "git pull",
            "npm install",
          ].join("\n"),
        });
        return;
      }

      app.relaunch();
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
        "This is the Windows desktop window, not the shop site.",
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
          "On Manjaro, confirm Node is installed and Labels deps are present (bash scripts/ensure-labels.sh).",
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

function shopMenu() {
  const send = (channel) => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;
    if (channel === "home") win.loadURL(SHOP_HOME);
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
            "On Manjaro, the app can pull those and restart. On Windows, it offers the new portable download.",
            "",
            "Check for desktop updates from Settings → Check for updates.",
            "",
            (labelsServerHandle && labelsServerHandle.ok
              ? `Labels service: ${labelsServerHandle.url} (${labelsServerHandle.owned ? "owned by Tools" : "adopted existing"})`
              : "Labels service: starts with Tools (Labels → status / restart)"),
            "LabelWriter print UX belongs on the shop site; Tools owns localhost :8080.",
            "",
            "Unlock is shared with Plasma widgets and Black Forest Desk via ~/.local/share/blackforest-tools.",
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
  });
  win.webContents.on("did-navigate", (_event, url) => {
    maybeExchangeWhileOnUnlock(url);
  });

  win.loadURL(startUrl, {
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
  lastSharedFingerprint = sessionFingerprint(next);
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
    const next = await mintWidgetSession(creds.person, creds.pin);
    lastSharedFingerprint = sessionFingerprint(next);
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
    lastSharedFingerprint = sessionFingerprint(next);
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

function partitionFetch(url, init) {
  const shopSession = shopPartition();
  if (typeof shopSession.fetch === "function") {
    return shopSession.fetch(url, init);
  }
  return fetch(url, init);
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
      sameSite: "lax",
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
  await mainWindow.loadURL(SHOP_HOME);
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
  if (hadGate && !onUnlock) {
    // Jar already good and SPA not on unlock — do not force-exchange/reload (flash).
    return { ok: true, reason: "already" };
  }
  if (
    !onUnlock &&
    hadGate === false &&
    lastGateExchangeAt &&
    Date.now() - lastGateExchangeAt < GATE_EXCHANGE_COOLDOWN_MS
  ) {
    return { ok: true, reason: "cooldown" };
  }
  if (!force && hadGate) {
    return { ok: true, reason: "already" };
  }
  exchangingGate = true;
  try {
    const result = await exchangeWidgetSession(existing.token, partitionFetch);
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
      lastSharedFingerprint = "";
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
  await mainWindow.loadURL(SHOP_HOME);
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
  return new Promise((resolve, reject) => {
    const tryOpen = (cmd, args) => {
      const child = spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", (error) => {
        if (cmd === "firefox" && error && error.code === "ENOENT") {
          tryOpen("xdg-open", [url]);
          return;
        }
        reject(error);
      });
      child.on("spawn", () => {
        child.unref();
        resolve(cmd);
      });
    };
    // --new-tab keeps Logan's default Firefox profile (never create a new one).
    tryOpen("firefox", ["--new-tab", url]);
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
          "Sign in with a Plasma widget or this window so ~/.local/share/blackforest-tools/widget-session.json exists, then try again.",
      });
    }
    return { ok: false, reason: "no_session" };
  }

  try {
    // Keep Tools SPA jar in sync before minting the Firefox ticket.
    await exchangeSharedSessionToGate({ force: true, reload: false });
    const { url } = await requestFirefoxHandoff(existing.token, fetch);
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
  localLockUntil = Date.now() + LOCAL_LOCK_COOLDOWN_MS;
  exchangedGateThisSession = false;
  try {
    const existing = readSession();
    if (revokeRemote && existing && existing.token) {
      await revokeWidgetSession(existing.token);
    } else {
      clearSession();
    }
    lastSharedFingerprint = "";
    await clearShopGateCookies();
    // Desk :8788 reads the same file — after clear, /health hasSession:false so
    // "Use Tools session" / Sync Tools no longer offers a live unlock.
    if (mainWindow && !mainWindow.isDestroyed()) {
      const current = mainWindow.webContents.getURL();
      if (!current.includes("/unlock")) {
        await mainWindow.loadURL(`${SHOP_BASE}/unlock`);
      }
    }
  } finally {
    applyingRemoteLock = false;
  }
}

function watchSharedSessionFile() {
  const file = sessionFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  lastSharedFingerprint = sessionFingerprint(readSession());

  const onChange = () => {
    if (applyingRemoteLock || mintingWidgetSession || exchangingGate) {
      return;
    }
    const next = readSession();
    const fp = sessionFingerprint(next);
    if (fp === lastSharedFingerprint) {
      return;
    }
    const previous = lastSharedFingerprint;
    const had = Boolean(previous);
    lastSharedFingerprint = fp;
    if (!fp && had) {
      lockSharedSurfaces({ revokeRemote: false }).catch((error) => {
        console.error(error);
      });
      return;
    }
    // Any new/changed shared Bearer (Desk, Plasma, unlock) must unlock the Tools SPA.
    // Clear localLockUntil here too — website unlock may write the file before
    // bridge onPublished runs (fs.watch race); do not leave exchange blocked.
    if (fp && fp !== previous) {
      localLockUntil = 0;
      exchangeSharedSessionToGate({ force: true, reload: true }).catch((error) => {
        console.error(error);
      });
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
  } catch (error) {
    console.error("Could not watch shared session file:", error);
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
  shopSession.cookies.on("changed", (_event, cookie, _cause, removed) => {
    if (!cookie || cookie.name !== GATE_COOKIE) {
      return;
    }
    if (removed) {
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
        localLockUntil = 0;
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
      localLockUntil = 0;
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
    if (url && mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(url);
    showWindow();
  });

  ipcMain.handle("shell:check-updates", async () => {
    await checkForShellUpdate({ interactive: true });
    return { ok: true };
  });

  app.whenReady().then(async () => {
    if (process.platform === "win32") {
      app.setAppUserModelId("com.blackforestautomotive.tools");
    }
    configureSession();
    watchSharedSessionFile();
    try {
      deskSessionBridge = startDeskSessionBridge({
        onPublished: (session) => {
          // Desk/website unlock published a Bearer — leave local lock cooldown.
          localLockUntil = 0;
          lastSharedFingerprint = sessionFingerprint(session);
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
    Menu.setApplicationMenu(shopMenu());
    // Own Labels (:8080); adopt Manjaro labels.service when already healthy.
    ensureLabelsRunning({ interactive: false }).catch((error) => {
      console.error(error);
    });
    // Gate cookie can persist in Electron while widget-session.json is gone/expired.
    // Also: shared Bearer can exist while SPA jar is empty — force exchange on boot.
    await ensureSharedSessionFromGate();
    await exchangeSharedSessionToGate({ force: true, reload: false });
    createWindow(shopUrlFromArgv(process.argv) || SHOP_HOME);
    updateTimer = setInterval(() => {
      checkForSiteUpdate({ interactive: false });
    }, UPDATE_EVERY_MS);
    shellUpdateTimer = setInterval(() => {
      checkForShellUpdate({ interactive: false });
    }, SHELL_UPDATE_EVERY_MS);
    sessionRefreshTimer = setInterval(() => {
      ensureSharedSessionFromGate().catch((error) => {
        console.error(error);
      });
    }, SESSION_REFRESH_EVERY_MS);
    setTimeout(() => {
      checkForShellUpdate({ interactive: false });
    }, 20_000);
    setTimeout(() => {
      ensureSharedSessionFromGate()
        .then(() => exchangeSharedSessionToGate({ force: true, reload: true }))
        .catch((error) => {
          console.error(error);
        });
    }, 2_500);
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
    if (deskSessionBridge) {
      deskSessionBridge.close().catch(() => {});
      deskSessionBridge = null;
    }
    stopLabelsServer(labelsServerHandle, { force: false });
    app.quit();
  });
}
