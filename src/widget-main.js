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
} = require("./widget-helpers");
const {
  readSession,
  writeSession,
  clearSession,
  widgetSessionFile,
} = require("./widget-session");
const Api = require("./widget-api");
const {
  appRootFromMain,
  applyGitUpdate,
  checkShellUpdate,
  isGitInstall,
} = require("./shell-update");

const ICON_PATH = path.join(__dirname, "..", "assets", "icon.png");
const WIDGET_HTML = path.join(__dirname, "..", "assets", "widget.html");
const STATE_NAME = "widget-window-state.json";
const APP_ROOT = appRootFromMain(__dirname);
const DEFAULT_POLL_MS = 60_000;
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
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(payload));
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
    return "Unknown view. Pick lot, book-t";
  }
}
