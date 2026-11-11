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
  headingForAim,
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

test("stepShipSail changes course onto up, down, left, or right", () => {
  const bounds = { minX: 0, maxX: 1400, minY: 0, maxY: 900 };
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: 0, y: 1 },
  ];
  dirs.forEach((dir, index) => {
    const ship = {
      x: 400,
      y: 450,
      vx: 36,
      vy: 0,
      facing: 1,
      speed: 36,
      turnTimer: 0,
      sinking: 0,
      aimVx: 36,
      aimVy: 0,
    };
    let calls = 0;
    const rng = () => {
      calls += 1;
      return calls === 1 ? 0.5 : (index + 0.1) / 4;
    };
    stepShipSail(ship, 1 / 60, bounds, rng);
    const ax = Math.abs(ship.aimVx);
    const ay = Math.abs(ship.aimVy);
    assert.ok((ax < 0.01 && ay > 10) || (ay < 0.01 && ax > 10), `aim not cardinal: ${ship.aimVx},${ship.aimVy}`);
    assert.equal(Math.sign(ship.aimVx), dir.x);
    assert.equal(Math.sign(ship.aimVy), dir.y);
    assert.equal(ship.heading, headingForAim(ship.aimVx, ship.aimVy));
    const moved = Math.hypot(ship.x - 400, ship.y - 450);
    assert.ok(moved < 2, `course change jumped ${moved}px`);
  });
});

test("stepShipSail changes course by easing, not by jumping across the sea", () => {
  const bounds = { minX: 0, maxX: 1400, minY: 0, maxY: 900 };
  const ship = {
    x: 400,
    y: 450,
    vx: 36,
    vy: 0,
    facing: 1,
    speed: 36,
    turnTimer: 0,
    sinking: 0,
  };
  let x = ship.x;
  let y = ship.y;
  // Always-high rng used to take the instant Y hop (about 35% of the sea).
  const rng = () => 0.99;
  stepShipSail(ship, 1 / 60, bounds, rng);
  assert.ok(Math.abs(ship.x - x) < 2, `x jumped ${ship.x - x}`);
  assert.ok(Math.abs(ship.y - y) < 2, `y jumped ${ship.y - y}`);
  for (let i = 0; i < 180; i++) {
    x = ship.x;
    y = ship.y;
    stepShipSail(ship, 1 / 60, bounds, rng);
    const step = Math.hypot(ship.x - x, ship.y - y);
    assert.ok(step < 3, `frame moved ${step}px`);
  }
  assert.ok(Math.hypot(ship.x - 400, ship.y - 450) > 20, "ship should still cross the window");
  assert.ok(ship.x >= bounds.minX && ship.x <= bounds.maxX);
  assert.ok(ship.y >= bounds.minY && ship.y <= bounds.maxY);
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
