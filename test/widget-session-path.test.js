"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  widgetSessionDir,
  widgetSessionFile,
  DIR_NAME,
  FILE_NAME,
} = require("../src/widget-session-path");

test("Windows session path uses LOCALAPPDATA/blackforest-tools", () => {
  const dir = widgetSessionDir(
    { LOCALAPPDATA: "C:\\Users\\logan\\AppData\\Local" },
    "win32",
    "C:\\Users\\logan",
  );
  assert.equal(dir, path.join("C:\\Users\\logan\\AppData\\Local", DIR_NAME));
  assert.equal(
    widgetSessionFile(
      { LOCALAPPDATA: "C:\\Users\\logan\\AppData\\Local" },
      "win32",
      "C:\\Users\\logan",
    ),
    path.join(dir, FILE_NAME),
  );
});

test("Linux session path uses XDG_DATA_HOME/blackforest-tools", () => {
  const dir = widgetSessionDir(
    { XDG_DATA_HOME: "/home/logan/.local/share" },
    "linux",
    "/home/logan",
  );
  assert.equal(dir, path.join("/home/logan/.local/share", DIR_NAME));
});

test("Linux falls back to ~/.local/share without XDG_DATA_HOME", () => {
  const dir = widgetSessionDir({}, "linux", "/home/logan");
  assert.equal(dir, path.join("/home/logan", ".local", "share", DIR_NAME));
});
