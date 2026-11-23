"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

async function loadDetect() {
  const file = path.join(__dirname, "..", "labels", "shared", "detect.mjs");
  return import(pathToFileURL(file).href);
}

async function loadPrint() {
  const file = path.join(__dirname, "..", "labels", "shared", "print.mjs");
  return import(pathToFileURL(file).href);
}

test("lpstat -a names include hyphenated LabelWriter queues", async () => {
  const { parseCupsQueueNames } = await loadDetect();
  const names = parseCupsQueueNames(
    ["HP9130e accepting requests since Mon 23 Nov 2026 10:00:00 AM PST", "LabelWriter-550 accepting requests since Fri 20 Nov 2026 05:32:47 PM PST", ""].join(
      "\n",
    ),
  );
  assert.deepEqual(names, ["HP9130e", "LabelWriter-550"]);
});

test("cupsQueue adopts LabelWriter-550 when LabelWriter550 is gone", async () => {
  const { cupsQueue } = await loadDetect();
  const calls = [];
  const runFn = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === "lpstat" && args[0] === "-a") {
      return {
        code: 0,
        stdout: "HP9130e accepting requests since …\nLabelWriter-550 accepting requests since …\n",
        stderr: "",
      };
    }
    if (cmd === "lpstat" && args[0] === "-p" && args[1] === "LabelWriter-550") {
      return { code: 0, stdout: "printer LabelWriter-550 is idle.  enabled since …\n", stderr: "" };
    }
    if (cmd === "lpstat" && args[0] === "-v" && args[1] === "LabelWriter-550") {
      return {
        code: 0,
        stdout: "device for LabelWriter-550: usb://DYMO/LabelWriter%20550?serial=04445046063903\n",
        stderr: "",
      };
    }
    return { code: 1, stdout: "", stderr: "unexpected" };
  };
  const queue = await cupsQueue(runFn, {});
  assert.equal(queue.present, true);
  assert.equal(queue.state, "idle");
  assert.equal(queue.name, "LabelWriter-550");
  assert.match(queue.message, /LabelWriter-550/);
  assert.equal(calls[0][0], "lpstat");
});

test("cupsQueue honors LABELS_PRINTER override", async () => {
  const { cupsQueue } = await loadDetect();
  const runFn = async (cmd, args) => {
    if (cmd === "lpstat" && args[0] === "-a") {
      return { code: 0, stdout: "LabelWriter-550 accepting requests since …\n", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "nope" };
  };
  const missing = await cupsQueue(runFn, { LABELS_PRINTER: "FrontDesk" });
  assert.equal(missing.present, false);
  assert.match(missing.message, /LABELS_PRINTER/);
});

test("printArgs can target the hyphenated CUPS queue", async () => {
  const { printArgs } = await loadPrint();
  const args = printArgs("w79h252", "/tmp/label.pdf", "LabelWriter-550");
  assert.deepEqual(args.slice(0, 4), ["-d", "LabelWriter-550", "-o", "PageSize=w79h252"]);
  assert.equal(args.at(-1), "/tmp/label.pdf");
  // Always pass -d so the shop HP system default is never used for labels.
  assert.equal(args[0], "-d");
  assert.ok(!args.includes("-d") || args[1] !== "HP9130e");
});

test("cupsQueue picks LabelWriter even when HP is the CUPS default name listed first", async () => {
  const { cupsQueue } = await loadDetect();
  const runFn = async (cmd, args) => {
    if (cmd === "lpstat" && args[0] === "-a") {
      return {
        code: 0,
        stdout: "HP9130e accepting requests since …\nLabelWriter-550 accepting requests since …\n",
        stderr: "",
      };
    }
    if (cmd === "lpstat" && args[1] === "LabelWriter-550") {
      if (args[0] === "-p") return { code: 0, stdout: "printer LabelWriter-550 is idle.\n", stderr: "" };
      if (args[0] === "-v") return { code: 0, stdout: "device for LabelWriter-550: usb://DYMO/LabelWriter%20550\n", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "unexpected" };
  };
  const queue = await cupsQueue(runFn, {});
  assert.equal(queue.name, "LabelWriter-550");
  assert.notEqual(queue.name, "HP9130e");
});
