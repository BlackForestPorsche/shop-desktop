"use strict";

const { app, BrowserWindow, Menu, MenuItem, clipboard, dialog, session, shell } = require("electron");
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

const ICON_PATH = path.join(__dirname, "..", "assets", "icon.png");
const OFFLINE_PATH = path.join(__dirname, "..", "assets", "offline.html");
const STATE_NAME = "window-state.json";
const UPDATE_EVERY_MS = 3 * 60 * 1000;
const SHELL_UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;
const SNOOZE_MS = 2 * 60 * 60 * 1000;
const FOCUS_CHECK_GAP_MS = 60 * 1000;
const APP_ROOT = appRootFromMain(__dirname);

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
                "This computer keeps its own unlock and display settings, the same way another browser would.",
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

function configureSession() {
  const shopSession = session.fromPartition("persist:shop");
  shopSession.setUserAgent(browserUserAgent());
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

  app.whenReady().then(() => {
    if (process.platform === "win32") {
      app.setAppUserModelId("com.blackforestautomotive.tools");
    }
    configureSession();
    Menu.setApplicationMenu(shopMenu());
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
  });

  app.on("window-all-closed", () => {
    if (updateTimer) clearInterval(updateTimer);
    if (shellUpdateTimer) clearInterval(shellUpdateTimer);
    app.quit();
  });
}
