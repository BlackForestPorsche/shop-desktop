"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { boundsAreUsable } = require("../src/window-state");

const laptop = [{ x: 0, y: 0, width: 1920, height: 1080 }];

test("a normal shop window on the display is kept", () => {
  assert.equal(
    boundsAreUsable({ x: 120, y: 80, width: 1280, height: 860 }, laptop),
    true,
  );
});

test("a window parked off the display is discarded", () => {
  assert.equal(
    boundsAreUsable({ x: 4000, y: 80, width: 1280, height: 860 }, laptop),
    false,
  );
});

test("a tiny or broken saved size is discarded", () => {
  assert.equal(boundsAreUsable({ x: 0, y: 0, width: 200, height: 200 }, laptop), false);
  assert.equal(boundsAreUsable({ x: 0, y: 0, width: Number.NaN, height: 800 }, laptop), false);
  assert.equal(boundsAreUsable(null, laptop), false);
  assert.equal(boundsAreUsable({ x: 0, y: 0, width: 1280, height: 860 }, []), false);
});
