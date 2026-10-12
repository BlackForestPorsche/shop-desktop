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
const { DEFAULT_WIDTH, DEFAULT_HEIGHT, MIN_WIDTH, MIN_HEIGHT, boundsAreUsable } = require("./window-state");
const {
  sessionFilePath,
  readSession,
  writeSession,
  clearSession,
  sessionFingerprint,
  extractPersonPin,
  extractUnlockWidgetSession,
  mintWidgetSession,
  revokeWidgetSession,
  exchangeWidgetSession,
  requestFirefoxHandoff,
} = require("./shared-session");

const ICON_PATH = path.join(__dirname, "..", "assets", "icon.png");
const OFFLINE_PATH = path.join(__dirname, "..", "assets", "offline.html");
const PRELOAD_PATH = path.join(__dirname, "preload-shop.js");
const STATE_NAME = "window-state.json";
const UPDATE_EVERY_MS = 3 * 60 * 1000;
const SHELL_UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;
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

  return Menu.buildFromTemplate([
    {
      label: "Shop",
      submenu: [
        { label: "Shop home", accelerator: "Alt+Home", click: () => send("home") },
        { label: "Back", accelerator: "Alt+Left", click: () => send("back") },
        { label: "Forward", accelerator: "Alt+Right", click: () => send("forward") },
        { type: "separator" },
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => send("reload") },
        {
          label: "Reload and pick up site updates",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => send("hard"),
        },
        { type: "separator" },
        { label: "Check for site updates", click: () => checkForSiteUpdate({ interactive: true }) },
        {
          label: "Check for desktop app updates",
          click: () => checkForShellUpdate({ interactive: true }),
        },
        { type: "separator" },
        {
          label: "Lock shop (widgets + this window)",
          click: () => {
            lockSharedSurfaces({ revokeRemote: true }).catch((error) => {
              console.error(error);
            });
          },
        },
        {
          label: "Open in Firefox signed in",
          click: () => {
            openFirefoxSignedIn({ interactive: true }).catch((error) => {
              console.error(error);
            });
          },
        },
        { type: "separator" },
        { label: "Quit", accelerator: "CmdOrCtrl+Q", role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Open this page in the browser",
          click: () => {
            const current = mainWindow?.webContents.getURL();
            const decision = classifyUrl(current || "");
            openOutside(decision.kind === "shop" ? decision.href : SHOP_HOME);
          },
        },
        {
          label: "About Black Forest Tools",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
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
                "Unlock is shared with the Plasma shop widgets via ~/.local/share/blackforest-tools.",
                "Lock from the widget or Shop → Lock shop clears the shared file, Electron cookies, and revokes the widget Bearer.",
                "Firefox keeps its own bf_shop_gate — lock there separately (or wait for expiry). Shop → Open in Firefox signed in mints a one-time handoff URL.",
              ].join("\n"),
            });
          },
        },
      ],
    },
  ]);
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
    autoHideMenuBar: true,
    icon: ICON_PATH,
    webPreferences: {
      partition: "persist:shop",
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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
    const creds = extractPersonPin(Buffer.from(part.bytes));
    if (creds) {
      pendingUnlockCreds = creds;
      pendingUnlockUntil = Date.now() + 30_000;
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

async function mintSharedSessionFromPending() {
  if (mintingWidgetSession) {
    return;
  }
  // Desk unlock JSON may already have written widgetToken via preload.
  if (readSession()) {
    pendingUnlockCreds = null;
    pendingUnlockUntil = 0;
    return;
  }
  if (!pendingUnlockCreds || Date.now() > pendingUnlockUntil) {
    return;
  }
  const creds = pendingUnlockCreds;
  pendingUnlockCreds = null;
  pendingUnlockUntil = 0;
  mintingWidgetSession = true;
  try {
    const next = await mintWidgetSession(creds.person, creds.pin);
    lastSharedFingerprint = sessionFingerprint(next);
  } catch (error) {
    console.error("Could not mint shared widget session from desktop unlock.");
  } finally {
    mintingWidgetSession = false;
  }
}

async function shopGateCookiesPresent() {
  try {
    const cookies = await shopPartition().cookies.get({
      domain: "shop.blackforestautomotive.com",
      name: GATE_COOKIE,
    });
    return cookies.some((cookie) => cookie && cookie.value);
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
 * When a widget session file exists, mint bf_shop_gate into the Electron cookie jar
 * via POST /api/widget/session/exchange (shop beta 0.1.25+). Reload when still on /unlock.
 */
async function exchangeSharedSessionToGate({ force = false, reload = true } = {}) {
  if (exchangingGate || applyingRemoteLock) {
    return { ok: false, reason: "busy" };
  }
  const existing = readSession();
  if (!existing || !existing.token) {
    return { ok: false, reason: "no_session" };
  }
  if (!force && (await shopGateCookiesPresent())) {
    return { ok: true, reason: "already" };
  }
  exchangingGate = true;
  try {
    const result = await exchangeWidgetSession(existing.token, partitionFetch);
    if (reload && mainWindow && !mainWindow.isDestroyed()) {
      const current = mainWindow.webContents.getURL();
      if (!current || current.includes("/unlock") || classifyUrl(current).kind !== "shop") {
        await mainWindow.loadURL(SHOP_HOME);
      } else {
        mainWindow.webContents.reload();
      }
    }
    return { ok: true, reason: "exchanged", ...result };
  } catch (error) {
    if (error && error.code === "unauthorized") {
      console.error("Shared widget session rejected during exchange; clearing local file.");
      clearSession();
      lastSharedFingerprint = "";
      return { ok: false, reason: "unauthorized" };
    }
    console.error("Could not exchange widget session for shop gate cookie:", error);
    return { ok: false, reason: "failed", status: error && error.status };
  } finally {
    exchangingGate = false;
  }
}

function launchFirefox(url) {
  return new Promise((resolve, reject) => {
    const tryOpen = (cmd) => {
      const child = spawn(cmd, [url], {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", (error) => {
        if (cmd === "firefox" && error && error.code === "ENOENT") {
          tryOpen("xdg-open");
          return;
        }
        reject(error);
      });
      child.on("spawn", () => {
        child.unref();
        resolve(cmd);
      });
    };
    tryOpen("firefox");
  });
}

async function openFirefoxSignedIn({ interactive = true } = {}) {
  const existing = readSession();
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
    const cookies = await shopSession.cookies.get({
      domain: "shop.blackforestautomotive.com",
    });
    await Promise.all(
      cookies
        .filter((cookie) => cookie.name === GATE_COOKIE || cookie.name.startsWith(`${GATE_COOKIE}`))
        .map((cookie) =>
          shopSession.cookies.remove(
            `https://shop.blackforestautomotive.com${cookie.path || "/"}`,
            cookie.name,
          ),
        ),
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
  try {
    const existing = readSession();
    if (revokeRemote && existing && existing.token) {
      await revokeWidgetSession(existing.token);
    } else {
      clearSession();
    }
    lastSharedFingerprint = "";
    await clearShopGateCookies();
    if (mainWindow && !mainWindow.isDestroyed()) {
      const current = mainWindow.webContents.getURL();
      if (!current.includes("/unlock")) {
        await mainWindow.loadURL("https://shop.blackforestautomotive.com/unlock");
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
    const had = Boolean(lastSharedFingerprint);
    lastSharedFingerprint = fp;
    if (!fp && had) {
      // Widget (or another surface) signed out — clear Electron without a Plasma restart.
      lockSharedSurfaces({ revokeRemote: false }).catch((error) => {
        console.error(error);
      });
      return;
    }
    if (fp && !had) {
      // Widget unlocked — mint SPA cookie in this window when exchange is live.
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
      // Site lock clears bf_shop_gate only — do not revoke the widget Bearer.
      return;
    }
    mintSharedSessionFromPending().catch((error) => {
      console.error(error);
    });
  });
  ipcMain.on("shop-unlock-json", (_event, text) => {
    try {
      if (applyUnlockWidgetSession(text)) {
        // Cookie may already be set by unlock; exchange fills the jar when it is not.
        exchangeSharedSessionToGate({ force: false, reload: true }).catch((error) => {
          console.error(error);
        });
      }
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

  app.whenReady().then(async () => {
    if (process.platform === "win32") {
      app.setAppUserModelId("com.blackforestautomotive.tools");
    }
    configureSession();
    watchSharedSessionFile();
    Menu.setApplicationMenu(shopMenu());
    // If Plasma (or a prior unlock) already left a widget session, set the SPA cookie first.
    await exchangeSharedSessionToGate({ force: false, reload: false });
    createWindow(shopUrlFromArgv(process.argv) || SHOP_HOME);
    updateTimer = setInterval(() => {
      checkForSiteUpdate({ interactive: false });
    }, UPDATE_EVERY_MS);
    shellUpdateTimer = setInterval(() => {
      checkForShellUpdate({ interactive: false });
    }, SHELL_UPDATE_EVERY_MS);
    setTimeout(() => {
      checkForShellUpdate({ interactive: false });
    }, 20_000);
    setTimeout(() => {
      exchangeSharedSessionToGate({ force: false, reload: true }).catch((error) => {
        console.error(error);
      });
    }, 2_500);
  });

  app.on("window-all-closed", () => {
    if (updateTimer) clearInterval(updateTimer);
    if (shellUpdateTimer) clearInterval(shellUpdateTimer);
    try {
      if (sharedSessionWatcher) sharedSessionWatcher.close();
    } catch {
      // ignore
    }
    app.quit();
  });
}
