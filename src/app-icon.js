"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Brand window / tray / shortcut icon for Black Forest Tools.
 * Windows prefers .ico (taskbar + frame); PNG is the Linux / fallback asset.
 */
function resolveAppIconPath(appRoot = path.join(__dirname, ".."), platform = process.platform) {
  const ico = path.join(appRoot, "assets", "icon.ico");
  const png = path.join(appRoot, "assets", "icon.png");
  if (platform === "win32" && fs.existsSync(ico)) return ico;
  if (fs.existsSync(png)) return png;
  if (fs.existsSync(ico)) return ico;
  return png;
}

module.exports = { resolveAppIconPath };
