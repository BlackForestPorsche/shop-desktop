"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  IDLE_INTERVAL_MS,
  MIN_IDLE_INTERVAL_MS,
  MAX_SHIPS,
  SHIP_HP,
  SHIP_STYLES,
  resolveIdleIntervalMs,
  pickShipStyle,
  shipsForIdleMs,
  growFleet,
  pickSailMotion,
  stepShipSail,
  applyCannonHit,
  stepShipSink,
  shipsCollide,
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

test("resolveIdleIntervalMs keeps the 5-minute default unless BF_IDLE_MS is valid", () => {
  assert.equal(resolveIdleIntervalMs(undefined), IDLE_INTERVAL_MS);
  assert.equal(resolveIdleIntervalMs(""), IDLE_INTERVAL_MS);
  assert.equal(resolveIdleIntervalMs("nope"), IDLE_INTERVAL_MS);
  assert.equal(resolveIdleIntervalMs(500), IDLE_INTERVAL_MS);
  assert.equal(resolveIdleIntervalMs(MIN_IDLE_INTERVAL_MS - 1), IDLE_INTERVAL_MS);
  assert.equal(resolveIdleIntervalMs("10000"), 10000);
  assert.equal(resolveIdleIntervalMs(10000), 10000);
});

test("pickSailMotion gives real horizontal velocity", () => {
  const motion = pickSailMotion(() => 0.1);
  assert.ok(motion.speed > 0);
  assert.ok(Math.abs(motion.vx) > 0);
  assert.equal(Math.sign(motion.vx), motion.facing);
});

test("stepShipSail translates the hull over time", () => {
  const ship = {
    x: 200,
    y: 300,
    vx: 40,
    facing: 1,
    speed: 40,
    turnTimer: 99,
    sinking: 0,
  };
  const before = ship.x;
  stepShipSail(ship, 0.5, { minX: 50, maxX: 800, minY: 200, maxY: 500 }, () => 0.5);
  assert.ok(ship.x > before, "ship should sail forward");
});

test("applyCannonHit sinks after enough hits", () => {
  const ship = { hp: SHIP_HP, list: 0, sinking: 0 };
  for (let i = 0; i < SHIP_HP - 1; i++) {
    const result = applyCannonHit(ship);
    assert.equal(result.sunk, false);
  }
  const last = applyCannonHit(ship);
  assert.equal(last.sunk, true);
  assert.ok(ship.sinking > 0);
});

test("stepShipSink removes the hull when the animation ends", () => {
  const ship = { sinking: 0.05 };
  assert.equal(stepShipSink(ship, 0.1), true);
});

test("shipsCollide detects overlapping live hulls", () => {
  assert.equal(shipsCollide({ x: 0, y: 0 }, { x: 10, y: 0 }), true);
  assert.equal(shipsCollide({ x: 0, y: 0 }, { x: 200, y: 0 }), false);
  assert.equal(shipsCollide({ x: 0, y: 0, sinking: 1 }, { x: 10, y: 0 }), false);
});
