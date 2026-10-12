"use strict";

const os = require("node:os");
const path = require("node:path");

const DIR_NAME = "blackforest-tools";
const FILE_NAME = "widget-session.json";

/**
 * Shared widget session directory (same shape Linux Plasma uses).
 * Linux:  $XDG_DATA_HOME/blackforest-tools  (default ~/.local/share/…)
 * Windows: %LOCALAPPDATA%\blackforest-tools
 */
function widgetSessionDir(env = process.env, platform = process.platform, homedir = os.homedir()) {
  if (platform === "win32") {
    const local =
      env.LOCALAPPDATA ||
      path.join(homedir, "AppData", "Local");
    return path.join(local, DIR_NAME);
  }
  const dataHome = env.XDG_DATA_HOME || path.join(homedir, ".local", "share");
  return path.join(dataHome, DIR_NAME);
}

function widgetSessionFile(env = process.env, platform = process.platform, homedir = os.homedir()) {
  return path.join(widgetSessionDir(env, platform, homedir), FILE_NAME);
}

module.exports = {
  DIR_NAME,
  FILE_NAME,
  widgetSessionDir,
  widgetSessionFile,
};
