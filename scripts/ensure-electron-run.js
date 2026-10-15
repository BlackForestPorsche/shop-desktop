"use strict";

const path = require("node:path");
const { ensureElectronBinary } = require("./electron-binary");

const root = path.join(__dirname, "..");
const result = ensureElectronBinary(root, {
  log: (line) => console.log(line),
});

if (result.state === "missing-package") {
  console.error(`Electron is not installed. From ${root} run: npm install`);
  process.exit(1);
}

if (!result.ok) {
  console.error("Could not download Electron.");
  console.error(`From ${root} try: rm -rf node_modules/electron/dist ~/.cache/electron && npm rebuild electron`);
  process.exit(1);
}

process.exit(0);
