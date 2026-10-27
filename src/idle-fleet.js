"use strict";

/** Idle between ship spawns (also time until the first ship). */
const IDLE_INTERVAL_MS = 5 * 60 * 1000;

/** Floor for BF_IDLE_MS / overrides (keeps QA usable without a hot loop). */
const MIN_IDLE_INTERVAL_MS = 1000;

/** Keep the fight fun without burning CPU. */
const MAX_SHIPS = 7;

/** Hits to list a hull before it sinks. */
const SHIP_HP = 3;

/** Damage applied per cannon hit. */
const HIT_DAMAGE = 1;

/** Lottery styles for each new ship (mixed fleets are intentional). */
const SHIP_STYLES = Object.freeze([
  "pixel",
  "silhouette",
  "ink",
  "neon",
]);

const BRAND_BLUE = "#0582ff";

/**
 * Resolve idle interval from an env/option value. Production default stays 5 minutes.
 * QA: set env `BF_IDLE_MS=10000` (ms) before launching Electron.
 * @param {unknown} [raw]
 * @param {number} [fallback]
 */
function resolveIdleIntervalMs(raw, fallback = IDLE_INTERVAL_MS) {
  if (raw == null || raw === "") return fallback;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < MIN_IDLE_INTERVAL_MS) return fallback;
  return Math.floor(n);
}

/**
 * @param {() => number} [rng] returns [0, 1)
 * @returns {"pixel"|"silhouette"|"ink"|"neon"}
 */
function pickShipStyle(rng = Math.random) {
  const index = Math.floor(rng() * SHIP_STYLES.length);
  return SHIP_STYLES[Math.min(SHIP_STYLES.length - 1, Math.max(0, index))];
}

/**
 * How many ships should exist after `idleMs` of continuous idle.
 * @param {number} idleMs
 * @param {{ intervalMs?: number, maxShips?: number }} [opts]
 */
function shipsForIdleMs(idleMs, opts = {}) {
  const intervalMs = opts.intervalMs ?? IDLE_INTERVAL_MS;
  const maxShips = opts.maxShips ?? MAX_SHIPS;
  if (!Number.isFinite(idleMs) || idleMs < intervalMs) return 0;
  return Math.min(maxShips, Math.floor(idleMs / intervalMs));
}

/**
 * Grow the fleet toward `targetCount`, lottery-picking each new hull.
 * @param {Array<{ style: string }>} fleet
 * @param {number} targetCount
 * @param {() => number} [rng]
 */
function growFleet(fleet, targetCount, rng = Math.random) {
  const next = fleet.slice();
  const cap = Math.min(MAX_SHIPS, Math.max(0, targetCount | 0));
  while (next.length < cap) {
    next.push({ style: pickShipStyle(rng) });
  }
  return next;
}

/**
 * Initial sail kinematics for a new hull.
 * @param {() => number} [rng]
 */
function pickSailMotion(rng = Math.random) {
  const facing = rng() < 0.5 ? -1 : 1;
  const speed = 22 + rng() * 38;
  return {
    facing,
    vx: facing * speed,
    vy: 0,
    aimVx: facing * speed,
    aimVy: 0,
    speed,
    turnTimer: 2.5 + rng() * 5,
  };
}

/**
 * Sail a ship across the sea. Position only moves by integrating velocity.
 * Course changes ease toward a new aim; they never assign a new x/y.
 * @param {{
 *   x: number, y: number, vx: number, vy?: number, facing: number,
 *   speed: number, turnTimer: number, sinking?: number,
 *   aimVx?: number, aimVy?: number,
 * }} ship
 * @param {number} dt seconds
 * @param {{ minX: number, maxX: number, minY: number, maxY: number }} bounds
 * @param {() => number} [rng]
 */
function stepShipSail(ship, dt, bounds, rng = Math.random) {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (ship.sinking > 0) {
    ship.y += 28 * step;
    ship.vx *= 0.92;
    ship.x += ship.vx * step;
    return ship;
  }

  const speed = Math.max(12, Math.abs(ship.speed) || 28);
  if (!Number.isFinite(ship.aimVx)) ship.aimVx = ship.facing * speed;
  if (!Number.isFinite(ship.aimVy)) ship.aimVy = 0;
  if (!Number.isFinite(ship.vy)) ship.vy = 0;
  if (!Number.isFinite(ship.vx)) ship.vx = ship.aimVx;

  ship.turnTimer -= step;
  if (ship.turnTimer <= 0) {
    ship.turnTimer = 2.8 + rng() * 6;
    if (rng() < 0.45) ship.facing *= -1;
    const climb = (rng() - 0.5) * 2;
    ship.aimVx = ship.facing * speed;
    ship.aimVy = climb * speed * 0.42;
  }

  // Ease velocity toward the aim. One frame cannot cross the sea.
  const blend = 1 - Math.exp(-1.8 * step);
  ship.vx += (ship.aimVx - ship.vx) * blend;
  ship.vy += (ship.aimVy - ship.vy) * blend;
  ship.x += ship.vx * step;
  ship.y += ship.vy * step;

  if (ship.x < bounds.minX) {
    ship.x = bounds.minX;
    ship.facing = 1;
    ship.aimVx = speed;
    if (ship.vx < 0) ship.vx = 0;
    ship.turnTimer = Math.max(ship.turnTimer, 1.6);
  } else if (ship.x > bounds.maxX) {
    ship.x = bounds.maxX;
    ship.facing = -1;
    ship.aimVx = -speed;
    if (ship.vx > 0) ship.vx = 0;
    ship.turnTimer = Math.max(ship.turnTimer, 1.6);
  }

  if (ship.y < bounds.minY) {
    ship.y = bounds.minY;
    ship.aimVy = Math.abs(ship.aimVy) || speed * 0.2;
    if (ship.vy < 0) ship.vy = 0;
  } else if (ship.y > bounds.maxY) {
    ship.y = bounds.maxY;
    ship.aimVy = -Math.abs(ship.aimVy) || -speed * 0.2;
    if (ship.vy > 0) ship.vy = 0;
  }
  return ship;
}

/**
 * Apply a cannon hit. Returns whether the hull should start sinking.
 * @param {{ hp: number, list?: number, sinking?: number }} ship
 * @param {number} [damage]
 */
function applyCannonHit(ship, damage = HIT_DAMAGE) {
  if (ship.sinking > 0) return { sunk: false, hp: ship.hp };
  ship.hp = Math.max(0, (ship.hp ?? SHIP_HP) - damage);
  ship.list = 0.85;
  if (ship.hp <= 0) {
    ship.sinking = 1.35;
    return { sunk: true, hp: 0 };
  }
  return { sunk: false, hp: ship.hp };
}

/**
 * Advance sink animation; true when the ship should be removed from the fleet.
 * @param {{ sinking?: number }} ship
 * @param {number} dt
 */
function stepShipSink(ship, dt) {
  if (!(ship.sinking > 0)) return false;
  ship.sinking -= dt;
  return ship.sinking <= 0;
}

/**
 * Whether two live ships overlap enough to ram (collision sink risk).
 * @param {{ x: number, y: number, sinking?: number, scale?: number }} a
 * @param {{ x: number, y: number, sinking?: number, scale?: number }} b
 * @param {number} [radius]
 */
function shipsCollide(a, b, radius = 42) {
  if (a.sinking > 0 || b.sinking > 0) return false;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const r = radius * ((a.scale || 1) + (b.scale || 1)) * 0.5;
  return dx * dx + dy * dy < r * r;
}

module.exports = {
  IDLE_INTERVAL_MS,
  MIN_IDLE_INTERVAL_MS,
  MAX_SHIPS,
  SHIP_HP,
  HIT_DAMAGE,
  SHIP_STYLES,
  BRAND_BLUE,
  resolveIdleIntervalMs,
  pickShipStyle,
  shipsForIdleMs,
  growFleet,
  pickSailMotion,
  stepShipSail,
  applyCannonHit,
  stepShipSink,
  shipsCollide,
};
