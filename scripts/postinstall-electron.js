"use strict";

const path = require("node:path");
const { ensureElectronBinary, ensureLauncherScriptsExecutable } = require("./electron-binary");

const root = path.join(__dirname, "..");
ensureLauncherScriptsExecutable(root);
const result = ensureElectronBinary(root, { log: (line) => console.log(line) });

// npm is still installing electron; its own install script runs next.
if (result.state === "missing-package") process.exit(0);

process.exit(result.ok ? 0 : 1);
