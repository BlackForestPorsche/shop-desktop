"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  IDLE_INTERVAL_MS,
  MAX_SHIPS,
  SHIP_STYLES,
  pickShipStyle,
  shipsForIdleMs,
  growFleet,
} = require("../src/idle-fleet");

test("shipsForIdleMs stays empty until the first interval", () => {
  assert.equal(shipsForIdleMs(0), 0);
  assert.equal(shipsForIdleMs(IDLE_INTERVAL_MS - 1), 0);
  assert.equal(shipsForIdleMs(IDLE_INTERVAL_MS), 1);
});

test("shipsForIdleMs adds one ship per extra idle interval and caps the fleet", () => {
  assert.equal(shipsForIdleMs(IDLE_INTERVAL_MS * 2), 2);
  assert.equal(shipsForIdleMs(IDLE_INTERVAL_MS * 3), 3);
  assert.equal(shipsForIdleMs(IDLE_INTERVAL_MS * 20), MAX_SHIPS);
});

test("pickShipStyle lottery stays inside the four looks", () => {
  const seen = new Set();
  let i = 0;
  const rng = () => {
    const values = [0, 0.24, 0.49, 0.74, 0.99];
    return values[i++ % values.length];
  };
  for (let n = 0; n < 5; n++) {
    const style = pickShipStyle(rng);
    assert.ok(SHIP_STYLES.includes(style));
    seen.add(style);
  }
  assert.equal(seen.size, 4);
});

test("growFleet lottery-appends until the target size", () => {
  let n = 0;
  const rng = () => {
    const values = [0.1, 0.3, 0.6, 0.9];
    return values[n++ % values.length];
  };
  const fleet = growFleet([], 4, rng);
  assert.equal(fleet.length, 4);
  assert.deepEqual(
    fleet.map((ship) => ship.style),
    ["pixel", "silhouette", "ink", "neon"],
  );
});

test("growFleet never exceeds MAX_SHIPS", () => {
  const fleet = growFleet([], 99, () => 0);
  assert.equal(fleet.length, MAX_SHIPS);
});
