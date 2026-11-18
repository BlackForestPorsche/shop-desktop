"use strict";

/**
 * Black Forest Shop Widget — Electron windows for Windows (and any desktop).
 * Same widget API views as the Plasma plasmoid: lot / book-today / notes.
 * Multiple instances OK (no single-instance lock). Shared session file with
 * other widget windows (and Tools when it writes the same path).
 */

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  shell,
  ipcMain,
  nativeImage,
} = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { SHOP_HOME } = require("./policy");
const {
  shouldRefreshToken,
  classifyWidgetHttpError,
  DEFAULT_DESK_PEOPLE,
  canCreateNotes,
  sharedSessionChange,
} = require("./widget-helpers");
const {
  readSession,
  writeSession,
  clearSession,
  widgetSessionFile,
} = require("./widget-session");
const Api = require("./widget-api");
const { electronLaunchSpec } = require("./widget-launch");
const {
  appRootFromMain,
  applyGitUpdate,
  captureLaunchSha,
  checkShellUpdate,
  isGitInstall,
  resolveGitUpdateRoot,
  relaunchAfterGitUpdate,
} = require("./shell-update");
const { openUpdateProgress } = require("./update-progress");
const {
  upToDateDetail,
  gitUpdateDetail,
  updateFailedDetail,
  releaseUpdateDetail,
} = require("./dialog-copy");

const { resolveAppIconPath } = require("./app-icon");
const ICON_PATH = resolveAppIconPath(path.join(__dirname, ".."));
const WIDGET_HTML = path.join(__dirname, "..", "assets", "widget.html");
const STATE_NAME = "widget-window-state.json";
const APP_ROOT = appRootFromMain(__dirname);
const LAUNCH_SHA = captureLaunchSha(APP_ROOT);
const DEFAULT_POLL_MS = 60_000;
const SESSION_FOLLOW_MS = 3_000;
const SHELL_UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;
const VIEW_IDS = new Set(Api.WIDGET_VIEWS.map((v) => v.id));

app.setName("Black Forest Shop Widget");
app.commandLine.appendSwitch("ozone-platform-hint", "auto");

// Multiple widget windows / processes are intentional.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

// Distinct userData so Tools and widgets don't fight over window-state.json.
// Session file is shared via widget-session-path (LOCALAPPDATA / XDG).
app.setPath(
  "userData",
  process.platform === "win32"
    ? path.join(os.homedir(), "AppData", "Roaming", "Black Forest Shop Widget")
    : path.join(os.homedir(), ".config", "Black Forest Shop Widget"),
);

let win = null;
let tray = null;
let session = null;
let viewId = "lot";
let viewPayload = null;
let deskPeople = [...DEFAULT_DESK_PEOPLE];
let errorText = "";
let noteStatus = "";
let busy = false;
let alwaysOnTop = true;
let pollTimer = null;
let sessionFollowTimer = null;
let shellUpdateTimer = null;
let shellChecking = false;

function viewFromArgv(argv) {
  for (const arg of argv) {
    if (arg.startsWith("--view=")) {
      const id = arg.slice("--view=".length);
      if (VIEW_IDS.has(id)) return id;
    }
  }
  const eq = argv.findIndex((a) => a === "--view");
  if (eq >= 0 && argv[eq + 1] && VIEW_IDS.has(argv[eq + 1])) {
    return argv[eq + 1];
  }
  return null;
}

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

function writeWindowState() {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const payload = {
    ...bounds,
    viewId,
    alwaysOnTop,
  };
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(payload));
  } catch (error) {
    // Losing the remembered size and place must never stop the window closing.
    console.error("Could not save the widget window state:", error && error.message ? error.message : error);
  }
}

function publicState() {
  return {
    views: Api.WIDGET_VIEWS,
    unlockPeople: Api.UNLOCK_PEOPLE,
    viewId,
    alwaysOnTop,
    busy,
    errorText,
    noteStatus,
    session: session
      ? {
          person: session.person || "",
          role: session.role || "",
          expiresAt: session.expiresAt || "",
        }
      : null,
    canCreateNotes: canCreateNotes(session?.role),
    deskPeople,
    viewPayload,
    sessionPath: widgetSessionFile(),
    gitInstall: isGitInstall(APP_ROOT),
    version: app.getVersion(),
  };
}

function pushState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("widget:state", publicState());
}

function setError(text) {
  errorText = text || "";
  pushState();
}

function applySession(next) {
  session = next;
  if (next) {
    loadDeskPeople();
    refreshView();
  } else {
    viewPayload = null;
  }
  pushState();
}

function loadSessionFromDisk() {
  const next = readSession();
  if (next) {
    session = next;
    loadDeskPeople();
    refreshView();
  }
  pushState();
}

/**
 * Every widget window and Tools share one session file. Locking or unlocking
 * in one of them shows here within a few seconds, not at the next view refresh.
 */
function followSharedSession() {
  if (busy) return;
  const onDisk = readSession();
  const change = sharedSessionChange(session, onDisk);
  if (change === "same") return;
  if (change === "locked") {
    session = null;
    viewPayload = null;
    noteStatus = "";
    errorText = "";
    pushState();
    return;
  }
  errorText = "";
  noteStatus = "";
  applySession(onDisk);
}

function authErrorMessage(res) {
  if (!res) return "Couldn't reach the shop.";
  const classified = classifyWidgetHttpError(
    res.status,
    res.body,
    res.retryAfter,
  );
  if (classified.code === "unauthorized") {
    return "Session expired. Unlock again.";
  }
  if (classified.code === "pin_change_required") {
    return "This person must set a PIN on the shop site first.";
  }
  if (classified.code === "forbidden") {
    return "This view isn't available for your role.";
  }
  if (classified.code === "rate_limited") {
    const wait = classified.retryAfter
      ? ` Try again in ${classified.retryAfter} seconds.`
      : "";
    return `Too many tries.${wait}`;
  }
  if (classified.code === "not_found") {
    return "The shop site does not have this view. Pick another one.";
  }
  return `The shop site had a problem (${res.status}). Try Refresh in a moment.`;
}

function noteErrorMessage(res) {
  if (!res) return "Couldn't reach the shop.";
  const code = res.body && res.body.error ? res.body.error : "";
  if (res.status === 401) return "Session expired. Unlock again.";
  if (res.status === 403 && code === "pin_change_required") {
    return "This person must set a PIN on the shop site first.";
  }
  if (res.status === 403) return "Your role can't leave notes.";
  if (res.status === 400 && code === "bad_text") {
    return "Note text is empty or too long (max 2000 characters).";
  }
  if (res.status === 400 && code === "bad_recipient") {
    return "Pick a desk person to leave the note for.";
  }
  if (res.status === 429) {
    const wait = res.retryAfter || "60";
    return `Too many notes. Try again in ${wait} seconds.`;
  }
  return `Couldn't send the note (${res.status}).`;
}

async function maybeRefreshToken() {
  if (!session || !shouldRefreshToken(session)) return false;
  try {
    const res = await Api.refresh(session.token);
    if (res.status !== 200 || !res.body || !res.body.token) {
      if (res.status === 401) {
        clearSession();
        session = null;
        viewPayload = null;
      }
      return false;
    }
    const next = {
      token: res.body.token,
      expiresAt: res.body.expiresAt,
      person: res.body.person || session.person,
      role: res.body.role || session.role,
      loginAt: session.loginAt || new Date().toISOString(),
    };
    session = next;
    writeSession(next);
    return true;
  } catch {
    return false;
  }
}

async function loadDeskPeople() {
  if (!session?.token) return;
  try {
    const res = await Api.listPeople(session.token);
    if (res.status !== 200 || !res.body) return;
    let list = null;
    if (Array.isArray(res.body)) list = res.body;
    else if (Array.isArray(res.body.people)) list = res.body.people;
    else if (Array.isArray(res.body.items)) list = res.body.items;
    if (!list?.length) return;
    const ids = [];
    for (const row of list) {
      const raw =
        typeof row === "string" ? row : row && (row.id || row.person || row.name);
      const id = String(raw || "")
        .trim()
        .toLowerCase();
      if (id && !ids.includes(id)) ids.push(id);
    }
    if (ids.length) {
      deskPeople = ids;
      pushState();
    }
  } catch {
    // Keep DEFAULT_DESK_PEOPLE.
  }
}

async function refreshView() {
  if (!session?.token) {
    pushState();
    return;
  }
  busy = true;
  errorText = "";
  pushState();
  try {
    await maybeRefreshToken();
    if (!session?.token) {
      busy = false;
      setError("Session expired. Unlock again.");
      return;
    }
    const res = await Api.fetchView(session.token, viewId);
    busy = false;
    if (res.status !== 200 || !res.body) {
      if (res.status === 401) {
        clearSession();
        session = null;
        viewPayload = null;
      }
      setError(authErrorMessage(res));
      return;
    }
    viewPayload = res.body;
    pushState();
  } catch (error) {
    busy = false;
    console.error("Widget view failed:", error instanceof Error ? error.message : error);
    setError("Couldn't reach the shop. Check that this computer is online, then Refresh.");
  }
}

async function doLogin(person, pin) {
  if (busy) return { ok: false, error: "Busy" };
  // An empty form is never sent to the shop: it would only count as a wrong PIN.
  if (!String(person || "").trim() || !String(pin || "")) {
    setError("Pick your name and enter your PIN.");
    return { ok: false };
  }
  busy = true;
  errorText = "";
  noteStatus = "";
  pushState();
  try {
    const res = await Api.login(person, pin);
    busy = false;
    if (res.status !== 200 || !res.body?.token) {
      if (res.status === 401) {
        setError("Wrong name or PIN.");
        return { ok: false };
      }
      setError(authErrorMessage(res));
      return { ok: false };
    }
    const next = {
      token: res.body.token,
      expiresAt: res.body.expiresAt,
      person: res.body.person,
      role: res.body.role,
      loginAt: new Date().toISOString(),
    };
    writeSession(next);
    applySession(next);
    return { ok: true };
  } catch (error) {
    busy = false;
    console.error("Widget unlock failed:", error instanceof Error ? error.message : error);
    setError("Couldn't reach the shop. Check that this computer is online, then try again.");
    return { ok: false };
  }
}

async function doLogout() {
  const token = session?.token;
  busy = true;
  pushState();
  try {
    if (token) await Api.logout(token);
  } catch {
    // Clear local anyway.
  }
  clearSession();
  session = null;
  viewPayload = null;
  noteStatus = "";
  errorText = "";
  busy = false;
  pushState();
}

async function doSendNote(recipient, text) {
  if (!session?.token) return { ok: false };
  if (!canCreateNotes(session.role)) {
    setError("Your role can't leave notes.");
    return { ok: false };
  }
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    setError("Write a short note first.");
    return { ok: false };
  }
  busy = true;
  noteStatus = "";
  errorText = "";
  pushState();
  try {
    await maybeRefreshToken();
    if (!session?.token) {
      busy = false;
      setError("Session expired. Unlock again.");
      return { ok: false };
    }
    const res = await Api.createNote(session.token, recipient, trimmed);
    busy = false;
    if (res.status !== 200 && res.status !== 201) {
      if (res.status === 401) {
        clearSession();
        session = null;
        viewPayload = null;
      }
      setError(noteErrorMessage(res));
      return { ok: false };
    }
    noteStatus = `Left a note for ${res.body?.recipient || recipient}.`;
    await refreshView();
    return { ok: true };
  } catch (error) {
    busy = false;
    console.error("Widget note failed:", error instanceof Error ? error.message : error);
    setError("Couldn't reach the shop, so the note was not sent. Try again.");
    return { ok: false };
  }
}

function spawnElectron(options) {
  const spec = electronLaunchSpec({
    execPath: process.execPath,
    appRoot: APP_ROOT,
    packaged: app.isPackaged,
    ...options,
  });
  try {
    const child = spawn(spec.command, spec.args, spec.options);
    child.on("error", (error) => console.error("Could not launch Electron:", error));
    child.unref();
    return true;
  } catch (error) {
    console.error("Could not launch Electron:", error);
    return false;
  }
}

function openTools() {
  if (!spawnElectron({ widget: false })) {
    shell.openExternal(SHOP_HOME).catch(() => {});
  }
}

async function checkForShellUpdate({ interactive }) {
  if (shellChecking) return;
  shellChecking = true;
  try {
    const info = await checkShellUpdate({
      root: APP_ROOT,
      currentVersion: app.getVersion(),
      packaged: app.isPackaged,
      launchedSha: LAUNCH_SHA,
    });

    if (!info.available) {
      if (interactive && win && !win.isDestroyed()) {
        await dialog.showMessageBox(win, {
          type: "info",
          title: "Black Forest Shop Widget",
          message: "Black Forest Tools is up to date",
          detail: upToDateDetail(info.mode, app.getVersion(), process.platform),
        });
      }
      return;
    }

    if (info.mode !== "git") {
      if (interactive && win && !win.isDestroyed()) {
        const choice = await dialog.showMessageBox(win, {
          type: "info",
          buttons: ["Download update", "Later"],
          defaultId: 0,
          cancelId: 1,
          title: "Black Forest Shop Widget",
          message: `Black Forest Tools ${info.remoteVersion} is available`,
          detail: releaseUpdateDetail({ ...info, currentVersion: info.currentVersion || app.getVersion() }),
        });
        if (choice.response === 0 && info.downloadUrl) {
          shell.openExternal(info.downloadUrl).catch(() => {});
        }
      }
      return;
    }

    if (!win || win.isDestroyed()) return;
    const gitRoot = info.root || APP_ROOT;
    const restartOnly = info.restartOnly === true;
    const choice = await dialog.showMessageBox(win, {
      type: "info",
      buttons: [restartOnly ? "Restart" : "Update and restart", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Black Forest Shop Widget",
      message: restartOnly
        ? "Restart the widget to finish updating"
        : "An update for Black Forest Tools is ready",
      detail: gitUpdateDetail(info, { restartOnly, what: "The widget" }),
    });
    if (choice.response !== 0) return;

    try {
      if (!restartOnly) {
        const progress = openUpdateProgress(win, { BrowserWindow });
        try {
          await applyGitUpdate(gitRoot);
        } finally {
          progress.close();
        }
      }
    } catch (error) {
      await dialog.showMessageBox(win, {
        type: "warning",
        title: "Black Forest Shop Widget",
        message: "The update did not finish",
        detail: updateFailedDetail(error, process.platform),
      });
      return;
    }

    relaunchAfterGitUpdate(gitRoot, {
      runningRoot: APP_ROOT,
      packaged: app.isPackaged,
      relaunchApp: (opts) => {
        if (opts && opts.execPath) {
          app.relaunch({ ...opts });
        } else {
          app.relaunch({ args: process.argv.slice(1) });
        }
      },
    });
    app.exit(0);
  } catch (error) {
    if (interactive && win && !win.isDestroyed()) {
      await dialog.showMessageBox(win, {
        type: "warning",
        title: "Black Forest Shop Widget",
        message: "Could not check for updates",
        detail: [
          "Check that this computer is online, then try again.",
          "",
          error instanceof Error ? error.message : "The check failed.",
        ].join("\n"),
      });
    }
  } finally {
    shellChecking = false;
  }
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: "Widget",
      submenu: [
        {
          label: "Refresh",
          accelerator: "CmdOrCtrl+R",
          click: () => refreshView(),
        },
        {
          label: "Always on top",
          type: "checkbox",
          checked: alwaysOnTop,
          click: (item) => {
            alwaysOnTop = item.checked;
            if (win && !win.isDestroyed()) win.setAlwaysOnTop(alwaysOnTop);
            writeWindowState();
            pushState();
          },
        },
        { type: "separator" },
        {
          label: "Check for desktop updates",
          click: () => checkForShellUpdate({ interactive: true }),
        },
        {
          label: "Open Black Forest Tools",
          click: () => openTools(),
        },
        { type: "separator" },
        {
          label: "New widget window",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            spawnElectron({ widget: true, view: viewId });
          },
        },
        { type: "separator" },
        { label: "Quit", accelerator: "CmdOrCtrl+Q", role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: Api.WIDGET_VIEWS.map((view) => ({
        label: view.label,
        type: "radio",
        checked: viewId === view.id,
        click: () => {
          viewId = view.id;
          writeWindowState();
          refreshView();
          buildAndSetMenu();
        },
      })),
    },
  ]);
}

function buildAndSetMenu() {
  Menu.setApplicationMenu(buildMenu());
}

function createWindow() {
  const saved = readWindowState();
  if (saved?.viewId && VIEW_IDS.has(saved.viewId) && !viewFromArgv(process.argv)) {
    viewId = saved.viewId;
  }
  if (typeof saved?.alwaysOnTop === "boolean") {
    alwaysOnTop = saved.alwaysOnTop;
  }

  win = new BrowserWindow({
    width: saved?.width || 380,
    height: saved?.height || 520,
    x: Number.isFinite(saved?.x) ? saved.x : undefined,
    y: Number.isFinite(saved?.y) ? saved.y : undefined,
    minWidth: 300,
    minHeight: 360,
    show: false,
    title: "Black Forest Shop",
    backgroundColor: "#efe9dc",
    alwaysOnTop,
    autoHideMenuBar: true,
    frame: true,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "widget-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.once("ready-to-show", () => {
    if (!win || win.isDestroyed()) return;
    win.show();
  });
  win.on("close", () => writeWindowState());
  win.on("closed", () => {
    win = null;
  });

  win.loadFile(WIDGET_HTML);
  return win;
}

function setupTray() {
  if (process.platform !== "win32" && process.platform !== "linux") return;
  try {
    const image = nativeImage.createFromPath(ICON_PATH);
    if (image.isEmpty()) return;
    tray = new Tray(image.resize({ width: 16, height: 16 }));
    tray.setToolTip("Black Forest Shop Widget");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Show",
          click: () => {
            if (win && !win.isDestroyed()) {
              win.show();
              win.focus();
            }
          },
        },
        {
          label: "Refresh",
          click: () => refreshView(),
        },
        {
          label: "New widget window",
          click: () => {
            spawnElectron({ widget: true });
          },
        },
        { type: "separator" },
        { label: "Quit", role: "quit" },
      ]),
    );
    tray.on("click", () => {
      if (win && !win.isDestroyed()) {
        if (win.isVisible()) win.focus();
        else win.show();
      }
    });
  } catch (error) {
    console.error("Tray unavailable:", error instanceof Error ? error.message : error);
  }
}

function registerIpc() {
  ipcMain.handle("widget:get-state", () => publicState());
  ipcMain.handle("widget:set-view", (_e, nextId) => {
    if (!VIEW_IDS.has(nextId)) return publicState();
    viewId = nextId;
    writeWindowState();
    buildAndSetMenu();
    refreshView();
    return publicState();
  });
  ipcMain.handle("widget:set-always-on-top", (_e, enabled) => {
    alwaysOnTop = !!enabled;
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(alwaysOnTop);
    writeWindowState();
    pushState();
    return publicState();
  });
  ipcMain.handle("widget:login", (_e, { person, pin }) => doLogin(person, pin));
  ipcMain.handle("widget:logout", () => doLogout());
  ipcMain.handle("widget:refresh", () => refreshView());
  ipcMain.handle("widget:send-note", (_e, { recipient, text }) =>
    doSendNote(recipient, text),
  );
  ipcMain.handle("widget:open-tools", () => {
    openTools();
    return true;
  });
  ipcMain.handle("widget:check-update", () =>
    checkForShellUpdate({ interactive: true }),
  );
}

const fromArgv = viewFromArgv(process.argv);
if (fromArgv) viewId = fromArgv;

app.whenReady().then(() => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.blackforestautomotive.shop-widget");
  }

  registerIpc();
  buildAndSetMenu();
  createWindow();
  setupTray();
  loadSessionFromDisk();

  pollTimer = setInterval(() => {
    if (session) refreshView();
    else loadSessionFromDisk();
  }, DEFAULT_POLL_MS);
  sessionFollowTimer = setInterval(followSharedSession, SESSION_FOLLOW_MS);

  const canGitUpdate = () => !!(resolveGitUpdateRoot(APP_ROOT) || isGitInstall(APP_ROOT));
  shellUpdateTimer = setInterval(() => {
    if (canGitUpdate()) {
      checkForShellUpdate({ interactive: false });
    }
  }, SHELL_UPDATE_EVERY_MS);
  setTimeout(() => {
    if (canGitUpdate()) {
      checkForShellUpdate({ interactive: false });
    }
  }, 25_000);
});

app.on("window-all-closed", () => {
  if (pollTimer) clearInterval(pollTimer);
  if (sessionFollowTimer) clearInterval(sessionFollowTimer);
  if (shellUpdateTimer) clearInterval(shellUpdateTimer);
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
});
