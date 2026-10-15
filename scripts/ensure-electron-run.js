"use strict";

const { ensureElectronBinary, defaultRoot } = require("./electron-binary");

const root = process.argv[2] ? require("node:path").resolve(process.argv[2]) : defaultRoot();
const result = ensureElectronBinary(root);
console.log(`Window runtime ready (${result.repaired}): ${result.path}`);
