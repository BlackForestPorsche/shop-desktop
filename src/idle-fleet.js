"use strict";

/** Idle between ship spawns (also time until the first ship). */
const IDLE_INTERVAL_MS = 5 * 60 * 1000;

/** Keep the fight fun without burning CPU. */
const MAX_SHIPS = 7;

/** Lottery styles for each new ship (mixed fleets are intentional). */
const SHIP_STYLES = Object.freeze([
  "pixel",
  "silhouette",
  "ink",
  "neon",
]);

const BRAND_BLUE = "#0582ff";

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

module.exports = {
  IDLE_INTERVAL_MS,
  MAX_SHIPS,
  SHIP_STYLES,
  BRAND_BLUE,
  pickShipStyle,
  shipsForIdleMs,
  growFleet,
};
