"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** First installed firefox.exe from the usual Windows locations, or "". */
function findWindowsFirefox(env = process.env, exists = fs.existsSync) {
  const bases = [
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
    env.ProgramW6432,
    env.LOCALAPPDATA,
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, "Programs"),
  ].filter(Boolean);
  for (const base of bases) {
    const candidate = path.win32.join(base, "Mozilla Firefox", "firefox.exe");
    if (exists(candidate)) return candidate;
  }
  return "";
}

/**
 * How to open `url` in Firefox without creating a profile.
 * Linux: firefox on PATH, then xdg-open. Windows: firefox.exe by path, else the
 * system default browser.
 */
function firefoxLaunchPlan(url, { platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  if (platform === "win32") {
    const exe = findWindowsFirefox(env, exists);
    return exe
      ? [{ cmd: exe, args: ["--new-tab", url] }, { external: url }]
      : [{ external: url }];
  }
  return [{ cmd: "firefox", args: ["--new-tab", url] }, { cmd: "xdg-open", args: [url] }];
}

module.exports = { findWindowsFirefox, firefoxLaunchPlan };
