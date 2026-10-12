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
    ...