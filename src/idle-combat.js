"use strict";

/**
 * Pure rules for the optional pirate combat mode (no DOM, no canvas).
 * The idle overlay stays an ambient screensaver until the user takes a helm.
 */

const SAVE_KEY = "bf-tools-pirate-v1";

const PLAYER_BASE = Object.freeze({
  maxHp: 10,
  speed: 176,
  reload: 0.92,
  damage: 1,
  shots: 1,
  range: 1100,
});

const PLAYER_CAPS = Object.freeze({
  maxHp: 36,
  speed: 360,
  reload: 0.28,
  damage: 7,
  shots: 6,
});

const ENEMY_TYPES = Object.freeze({
  sloop: Object.freeze({
    id: "sloop",
    label: "Sloop",
    hp: 2,
    speed: 96,
    reload: 2.9,
    damage: 1,
    scale: 0.95,
    score: 100,
    range: 300,
    cost: 1,
  }),
  brig: Object.freeze({
    id: "brig",
    label: "Brig",
    hp: 3,
    speed: 72,
    reload: 2.4,
    damage: 1,
    scale: 1.15,
    score: 200,
    range: 340,
    cost: 2,
  }),
  galleon: Object.freeze({
    id: "galleon",
    label: "Galleon",
    hp: 6,
    speed: 50,
    reload: 3.3,
    damage: 2,
    scale: 1.5,
    score: 450,
    range: 400,
    cost: 4,
  }),
  raider: Object.freeze({
    id: "raider",
    label: "Raider",
    hp: 2,
    speed: 138,
    reload: 2.05,
    damage: 1,
    scale: 0.86,
    score: 140,
    range: 250,
    cost: 1,
  }),
  frigate: Object.freeze({
    id: "frigate",
    label: "Frigate",
    hp: 5,
    speed: 68,
    reload: 2.15,
    damage: 1,
    scale: 1.28,
    score: 320,
    range: 370,
    cost: 3,
  }),
  manowar: Object.freeze({
    id: "manowar",
    label: "Man-o'-war",
    hp: 30,
    speed: 46,
    reload: 1.45,
    damage: 2,
    scale: 2.2,
    score: 2200,
    range: 440,
    cost: 12,
    boss: true,
    shots: 3,
  }),
  blackgalleon: Object.freeze({
    id: "blackgalleon",
    label: "Black Galleon",
    hp: 46,
    speed: 40,
    reload: 1.2,
    damage: 2,
    scale: 2.45,
    score: 4000,
    range: 480,
    cost: 16,
    boss: true,
    shots: 4,
  }),
  dreadnought: Object.freeze({
    id: "dreadnought",
    label: "Dreadnought",
    hp: 68,
    speed: 34,
    reload: 1.05,
    damage: 3,
    scale: 2.7,
    score: 6500,
    range: 520,
    cost: 20,
    boss: true,
    shots: 5,
  }),
  fireship: Object.freeze({
    id: "fireship",
    label: "Fireship",
    hp: 2,
    speed: 154,
    reload: 4.4,
    damage: 1,
    scale: 0.9,
    score: 180,
    range: 70,
    cost: 2,
    behavior: "charge",
    blast: 88,
    blastDamage: 3,
  }),
  privateer: Object.freeze({
    id: "privateer",
    label: "Privateer",
    hp: 4,
    speed: 90,
    reload: 1.85,
    damage: 1,
    scale: 1.06,
    score: 260,
    range: 300,
    cost: 3,
    behavior: "flank",
    shots: 2,
  }),
  prize: Object.freeze({
    id: "prize",
    label: "Prize ship",
    hp: 3,
    speed: 128,
    reload: 2.7,
    damage: 1,
    scale: 1.08,
    score: 700,
    range: 540,
    cost: 3,
    behavior: "flee",
    prize: true,
  }),
  wraith: Object.freeze({
    id: "wraith",
    label: "Wraith",
    hp: 4,
    speed: 78,
    reload: 2.15,
    damage: 1,
    scale: 1.02,
    score: 340,
    range: 280,
    cost: 3,
    behavior: "phase",
    phase: true,
  }),
});

const UPGRADES = Object.freeze([
  { id: "hull", title: "Tarred hull", blurb: "+2 max hull, patch 2" },
  { id: "reload", title: "Oiled carriages", blurb: "Reload 15% faster" },
  { id: "heavy", title: "Heavy shot", blurb: "+1 cannon damage" },
  { id: "sails", title: "Fair winds", blurb: "+14% sailing speed" },
  { id: "twin", title: "Twin guns", blurb: "One more ball per volley" },
  { id: "carpenter", title: "Carpenter aboard", blurb: "Repair to full" },
]);

/** Fiction names with a little Stuttgart / Bavaria / Italy flavour. No official badges. */
const SHIP_NAMES = Object.freeze([
  "Carrera's Revenge",
  "The Cayenne Corsair",
  "Macan Marauder",
  "Boxster Bounty",
  "Taycan Tide",
  "Panamera Pearl",
  "Stuttgart Kraken",
  "Zuffenhausen Queen",
  "Black Forest Fury",
  "Nurburg Raider",
  "Weissach Wraith",
  "Ingolstadt Privateer",
  "Munich Buccaneer",
  "Bavarian Bounty",
  "Gullwing Gale",
  "Sant'Agata Bull",
  "Maranello Rose",
  "Prancing Gull",
]);

/** Pennant emblems: mostly skulls, sometimes tiny generic pixel car silhouettes. */
const FLAG_KINDS = Object.freeze(["skull", "coupe", "suv", "wedge", "sedan"]);

const FLAG_ICONS = Object.freeze({
  coupe: ["...XXXXX...", "..XXXXXXXX.", "XXXXXXXXXXX", ".XX.....XX."],
  suv: ["..XXXXXXXX.", ".XXXXXXXXXX", "XXXXXXXXXXX", ".XX.....XX."],
  wedge: ["......XX...", "..XXXXXXXX.", "XXXXXXXXXXX", ".XX.....XX."],
  sedan: ["...XXXXX...", ".XXXXXXXXX.", "XXXXXXXXXXX", ".XX.....XX."],
  raven: ["..XXXXXXX..", ".XX.XXX.XX.", "XXXXX.XXXXX", ".XX.XXX.XX."],
  sun: ["....XXX....", "..XXXXXXX..", "XXXXXXXXXXX", "..XXXXXXX.."],
});

/** Bigger ships. Tier 0 matches PLAYER_BASE so a fresh desk sails the sloop. */
const HULLS = Object.freeze([
  Object.freeze({
    id: "sloop",
    title: "Sloop",
    maxHp: 10,
    speed: 176,
    reload: 0.92,
    damage: 1,
    shots: 1,
    range: 1100,
    scale: 1.36,
  }),
  Object.freeze({
    id: "brig",
    title: "Brig",
    maxHp: 12,
    speed: 190,
    reload: 0.84,
    damage: 1,
    shots: 1,
    range: 1160,
    scale: 1.4,
  }),
  Object.freeze({
    id: "frigate",
    title: "Frigate",
    maxHp: 14,
    speed: 198,
    reload: 0.78,
    damage: 2,
    shots: 1,
    range: 1200,
    scale: 1.52,
  }),
  Object.freeze({
    id: "galleon",
    title: "Galleon",
    maxHp: 16,
    speed: 188,
    reload: 0.72,
    damage: 2,
    shots: 2,
    range: 1240,
    scale: 1.64,
  }),
  Object.freeze({
    id: "line",
    title: "Ship of the line",
    maxHp: 18,
    speed: 180,
    reload: 0.66,
    damage: 2,
    shots: 2,
    range: 1300,
    scale: 1.76,
  }),
]);

const PRESTIGE_COSTS = Object.freeze([800, 2000, 4500, 8000]);

const PERM_UPGRADES = Object.freeze([
  Object.freeze({ id: "ribs", title: "Oak ribs", blurb: "+1 base hull", cost: 30, max: 8 }),
  Object.freeze({ id: "silk", title: "Silk sails", blurb: "+8 base speed", cost: 36, max: 6 }),
  Object.freeze({ id: "powder", title: "Fine powder", blurb: "Base reload a touch faster", cost: 40, max: 6 }),
  Object.freeze({ id: "shot", title: "Iron shot", blurb: "+1 base damage", cost: 70, max: 2 }),
  Object.freeze({ id: "nest", title: "Crow's nest", blurb: "+40 range", cost: 28, max: 5 }),
]);

const COSMETICS = Object.freeze([
  Object.freeze({ id: "trim-gold", slot: "trim", title: "Gold trim", cost: 24, value: "gold" }),
  Object.freeze({ id: "trim-blood", slot: "trim", title: "Blood trim", cost: 24, value: "blood" }),
  Object.freeze({ id: "trim-blue", slot: "trim", title: "Brand trim", cost: 20, value: "blue" }),
  Object.freeze({ id: "sail-solid", slot: "sails", title: "Plain sails", cost: 16, value: "solid" }),
  Object.freeze({ id: "sail-check", slot: "sails", title: "Checkered sails", cost: 22, value: "check" }),
  Object.freeze({ id: "sail-blue", slot: "sails", title: "Blue sails", cost: 22, value: "blue" }),
  Object.freeze({ id: "pen-raven", slot: "pennant", title: "Raven pennant", cost: 18, value: "raven" }),
  Object.freeze({ id: "pen-sun", slot: "pennant", title: "Sun pennant", cost: 18, value: "sun" }),
  Object.freeze({ id: "wake-gold", slot: "wake", title: "Gold wake", cost: 16, value: "gold" }),
  Object.freeze({ id: "wake-blue", slot: "wake", title: "Blue wake", cost: 16, value: "blue" }),
  Object.freeze({ id: "fig-bull", slot: "figure", title: "Bull figurehead", cost: 30, value: "bull" }),
  Object.freeze({ id: "fig-kraken", slot: "figure", title: "Kraken figurehead", cost: 34, value: "kraken" }),
]);

const DEFAULT_COSMETICS = Object.freeze({
  trim: "none",
  sails: "stripe",
  pennant: "skull",
  wake: "foam",
  figure: "none",
});

/** Sea events. These are not extra hulls in the wave plan. */
const EVENT_KINDS = Object.freeze(["fog", "squall", "barrage", "kraken", "supply", "boarding"]);

const EVENT_LABELS = Object.freeze({
  fog: "Fog bank",
  squall: "Squall",
  barrage: "Broadside",
  kraken: "Kraken",
  supply: "Supply drift",
  boarding: "Boarding party",
});

const MAX_ALIVE_CAP = 28;
const COMBO_WINDOW_S = 8;
const GILDED_CHANCE = 0.06;
const GILDED_SCORE_MULT = 3;

function pickFrom(list, rng = Math.random) {
  const i = Math.floor(rng() * list.length);
  return list[Math.min(list.length - 1, Math.max(0, i))];
}

function pickShipName(rng = Math.random) {
  return pickFrom(SHIP_NAMES, rng);
}

function pickFlagKind(rng = Math.random) {
  const r = rng();
  if (r < 0.58) return "skull";
  return FLAG_KINDS[1 + Math.min(3, Math.floor(((r - 0.58) / 0.42) * 4))];
}

function emptyPerms() {
  return { ribs: 0, silk: 0, powder: 0, shot: 0, nest: 0 };
}

function hullByTier(tier) {
  const i = Math.max(0, Math.min(HULLS.length - 1, tier | 0));
  return HULLS[i];
}

/**
 * Base stats for a desk save. No argument (or a fresh save) is the sloop.
 * In-run refits stack on top of this in the shell.
 * @param {ReturnType<typeof emptySave> | null | undefined} [save]
 */
function createPlayerStats(save) {
  const hull = hullByTier(save && save.hull);
  const perms = (save && save.perms) || emptyPerms();
  const powder = Math.max(0, perms.powder | 0);
  return {
    maxHp: hull.maxHp + Math.max(0, perms.ribs | 0),
    speed: hull.speed + Math.max(0, perms.silk | 0) * 8,
    reload: Math.max(PLAYER_CAPS.reload, +(hull.reload * Math.pow(0.96, powder)).toFixed(3)),
    damage: hull.damage + Math.max(0, perms.shot | 0),
    shots: hull.shots,
    range: hull.range + Math.max(0, perms.nest | 0) * 40,
  };
}

/** Nose direction for a heading. 0 faces screen-up. Positive heading turns left. */
function headingForward(heading) {
  const h = Number(heading) || 0;
  return { x: -Math.sin(h), y: -Math.cos(h) };
}

function isUpgradeAvailable(stats, id) {
  switch (id) {
    case "hull":
      return stats.maxHp < PLAYER_CAPS.maxHp;
    case "reload":
      return stats.reload > PLAYER_CAPS.reload + 1e-6;
    case "heavy":
      return stats.damage < PLAYER_CAPS.damage;
    case "sails":
      return stats.speed < PLAYER_CAPS.speed;
    case "twin":
      return stats.shots < PLAYER_CAPS.shots;
    case "carpenter":
      return true;
    default:
      return false;
  }
}

/**
 * @param {ReturnType<typeof createPlayerStats>} stats
 * @param {() => number} [rng]
 * @param {number} [count]
 */
function rollUpgrades(stats, rng = Math.random, count = 3) {
  const pool = UPGRADES.filter((u) => isUpgradeAvailable(stats, u.id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/**
 * @returns {{ stats: ReturnType<typeof createPlayerStats>, heal: number }}
 */
function applyUpgrade(stats, id) {
  const next = { ...stats };
  let heal = 0;
  switch (id) {
    case "hull":
      next.maxHp = Math.min(PLAYER_CAPS.maxHp, next.maxHp + 2);
      heal = 2;
      break;
    case "reload":
      next.reload = Math.max(PLAYER_CAPS.reload, +(next.reload * 0.85).toFixed(3));
      break;
    case "heavy":
      next.damage = Math.min(PLAYER_CAPS.damage, next.damage + 1);
      break;
    case "sails":
      next.speed = Math.min(PLAYER_CAPS.speed, Math.round(next.speed * 1.14));
      break;
    case "twin":
      next.shots = Math.min(PLAYER_CAPS.shots, next.shots + 1);
      break;
    case "carpenter":
      heal = Infinity;
      break;
    default:
      break;
  }
  return { stats: next, heal };
}

/** Enemy hull budget for wave `n` (1-based). Grows so later waves are a horde, not a skirmish. */
function waveBudget(n) {
  const w = Math.max(1, n | 0);
  return Math.min(72, 5 + w * 3);
}

function maxAliveForWave(n) {
  const w = Math.max(1, n | 0);
  return Math.min(MAX_ALIVE_CAP, 6 + Math.floor(w * 1.6));
}

/** Seconds between spawn batches. Shrinks as the wave climbs. */
function spawnGap(n) {
  const w = Math.max(1, n | 0);
  return Math.max(0.34, 1.12 - w * 0.055);
}

/** How many hulls arrive together once the sea is hot. */
function spawnBatch(n) {
  const w = Math.max(1, n | 0);
  return Math.min(4, 1 + Math.floor((w - 1) / 3));
}

/** Boss id on every 5th wave, otherwise null. Bosses are not part of planWave. */
function bossForWave(n) {
  const w = n | 0;
  if (w < 5 || w % 5 !== 0) return null;
  if (w >= 15) return "dreadnought";
  if (w >= 10) return "blackgalleon";
  return "manowar";
}

/**
 * Hull, guns, and speed for wave `n`. Wave 1 matches the type card.
 * @returns {{ hp: number, damage: number, speed: number }}
 */
function scaleEnemy(typeId, wave) {
  const type = ENEMY_TYPES[typeId] || ENEMY_TYPES.sloop;
  const w = Math.max(1, wave | 0);
  const grow = type.boss ? 1 + (w - 1) * 0.1 : 1 + (w - 1) * 0.18;
  return {
    hp: Math.max(type.hp, Math.round(type.hp * grow)),
    damage: type.damage + (w >= 9 ? 1 : 0) + (w >= 15 ? 1 : 0),
    speed: Math.round(type.speed * (1 + Math.min(0.28, (w - 1) * 0.012))),
  };
}

/**
 * Compose a wave from cheap hulls first, with heavier hulls unlocking over time.
 * @returns {Array<keyof typeof ENEMY_TYPES>}
 */
function planWave(n, rng = Math.random) {
  let budget = waveBudget(n);
  const out = [];
  while (budget > 0 && out.length < 56) {
    const options = [{ id: "sloop", w: 6 }];
    if (n >= 2 && budget >= ENEMY_TYPES.brig.cost) options.push({ id: "brig", w: 4 });
    if (n >= 3 && budget >= ENEMY_TYPES.galleon.cost) {
      options.push({ id: "galleon", w: n >= 5 ? 3 : 1 });
    }
    if (n >= 3 && budget >= ENEMY_TYPES.fireship.cost) options.push({ id: "fireship", w: 2 });
    if (n >= 4 && budget >= ENEMY_TYPES.raider.cost) options.push({ id: "raider", w: 4 });
    if (n >= 5 && budget >= ENEMY_TYPES.privateer.cost) options.push({ id: "privateer", w: 2 });
    if (n >= 6 && budget >= ENEMY_TYPES.frigate.cost) options.push({ id: "frigate", w: 3 });
    if (n >= 6 && budget >= ENEMY_TYPES.prize.cost) options.push({ id: "prize", w: 1 });
    if (n >= 7 && budget >= ENEMY_TYPES.wraith.cost) options.push({ id: "wraith", w: 2 });
    const total = options.reduce((s, o) => s + o.w, 0);
    let roll = rng() * total;
    let pick = options[0];
    for (const o of options) {
      roll -= o.w;
      if (roll < 0) {
        pick = o;
        break;
      }
    }
    out.push(pick.id);
    budget -= ENEMY_TYPES[pick.id].cost;
  }
  return out;
}

function comboMultiplier(combo) {
  return Math.min(4, Math.max(1, combo | 0));
}

function scoreForSink(typeId, opts = {}) {
  const type = ENEMY_TYPES[typeId] || ENEMY_TYPES.sloop;
  const gilded = opts.gilded ? GILDED_SCORE_MULT : 1;
  return Math.round(type.score * gilded * comboMultiplier(opts.combo ?? 1));
}

function waveClearBonus(n) {
  return 100 * Math.max(1, n | 0);
}

/** Cannonball time in the air; used by both sides so shots are readable and dodgeable. */
function flightTime(dist) {
  return Math.min(1.25, Math.max(0.38, 0.32 + dist / 640));
}

function shipCenter(ship) {
  return { x: ship.x, y: ship.y - 16 };
}

/**
 * Where to land a ball so it meets a moving ship (two refinement passes).
 * @param {{ x: number, y: number }} from
 * @param {{ x: number, y: number, vx?: number, vy?: number }} target (ship origin)
 */
function leadPoint(from, target) {
  const c = shipCenter(target);
  let t = flightTime(Math.hypot(c.x - from.x, c.y - from.y));
  let px = c.x;
  let py = c.y;
  for (let i = 0; i < 2; i++) {
    px = c.x + (target.vx || 0) * t;
    py = c.y + (target.vy || 0) * t;
    t = flightTime(Math.hypot(px - from.x, py - from.y));
  }
  return { x: px, y: py, dur: t };
}

/** Landing error radius in px for enemy gunnery on wave `n`. */
function enemyAimError(n) {
  return Math.max(26, 96 - n * 6);
}

function enemyAim(from, player, wave, rng = Math.random) {
  const lead = leadPoint(from, player);
  const err = enemyAimError(wave);
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * err;
  return { x: lead.x + Math.cos(a) * r, y: lead.y + Math.sin(a) * r * 0.6, dur: lead.dur };
}

/** Elliptical hit test around the hull centre. */
function ballHitsShip(point, ship, pad = 0) {
  const c = shipCenter(ship);
  const s = ship.scale || 1;
  const a = 50 * s + pad;
  const b = 34 * s + pad;
  const dx = (point.x - c.x) / a;
  const dy = (point.y - c.y) / b;
  return dx * dx + dy * dy <= 1;
}

/**
 * Snap a click to a nearby live enemy (with lead), or fire at the raw point.
 * @returns {{ x: number, y: number, dur: number, target: object | null }}
 */
function resolvePlayerAim(from, click, enemies, snap = 76) {
  let best = null;
  let bestD = snap;
  for (const e of enemies) {
    if (e.sinking > 0 || e.retire > 0) continue;
    const c = shipCenter(e);
    const d = Math.hypot(c.x - click.x, c.y - click.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (best) {
    const lead = leadPoint(from, best);
    return { x: lead.x, y: lead.y, dur: lead.dur, target: best };
  }
  const dist = Math.hypot(click.x - from.x, click.y - from.y);
  return { x: click.x, y: click.y, dur: flightTime(dist), target: null };
}

function nearestEnemy(from, enemies) {
  let best = null;
  let bestD = Infinity;
  for (const e of enemies) {
    if (e.sinking > 0 || e.retire > 0) continue;
    const d = Math.hypot(e.x - from.x, e.y - from.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** Spread extra balls of a volley across the aim point. */
function volleyOffsets(shots) {
  const n = Math.max(1, shots | 0);
  if (n === 1) return [{ dx: 0, dy: 0 }];
  if (n === 2) return [{ dx: -22, dy: -6 }, { dx: 22, dy: 6 }];
  if (n === 3) return [{ dx: -34, dy: -8 }, { dx: 0, dy: 0 }, { dx: 34, dy: 8 }];
  const span = 26 * (n - 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1) - 0.5;
    out.push({ dx: u * span, dy: i % 2 ? 9 : -7 });
  }
  return out;
}

/**
 * Playable sea for a viewport. The whole overlay is water — a thin pad keeps
 * hull sprites on the glass, it is not a lower band.
 * @param {number} width
 * @param {number} height
 */
function seaBounds(width, height) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const pad = 18;
  return {
    minX: pad,
    maxX: Math.max(pad + 48, w - pad),
    minY: pad,
    maxY: Math.max(pad + 48, h - pad),
  };
}

function clampToBounds(ship, bounds) {
  let hit = false;
  if (ship.x < bounds.minX) {
    ship.x = bounds.minX;
    if (ship.vx < 0) ship.vx = 0;
    hit = true;
  } else if (ship.x > bounds.maxX) {
    ship.x = bounds.maxX;
    if (ship.vx > 0) ship.vx = 0;
    hit = true;
  }
  if (ship.y < bounds.minY) {
    ship.y = bounds.minY;
    if (ship.vy < 0) ship.vy = 0;
    hit = true;
  } else if (ship.y > bounds.maxY) {
    ship.y = bounds.maxY;
    if (ship.vy > 0) ship.vy = 0;
    hit = true;
  }
  return hit;
}

/**
 * Ship helm. Heading 0 noses screen-up. A / left increases heading so the
 * nose turns screen-left. D decreases it (screen-right). W thrusts along the
 * nose, S astern. Yaw is a rate, not a strafe. The keel dumps sideways speed
 * quickly so the hull follows the bow instead of sliding the old way.
 * @param {{ x:number,y:number,vx:number,vy:number,facing:number,heading?:number }} ship
 * @param {{ left?:boolean, right?:boolean, up?:boolean, down?:boolean }} input
 */
function steerPlayer(ship, input, dt, bounds, stats) {
  if (!Number.isFinite(ship.heading)) {
    ship.heading = ship.facing < 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  const turn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const turnRate = stats && stats.turn ? stats.turn : 4.4;
  ship.heading += turn * turnRate * dt;
  const thrust = (input.up ? 1 : 0) - (input.down ? 0.55 : 0);
  const forward = headingForward(ship.heading);
  const along = ship.vx * forward.x + ship.vy * forward.y;
  const target = thrust * stats.speed;
  const blend = Math.min(1, (thrust !== 0 ? 12 : 5.5) * dt);
  const nextAlong = along + (target - along) * blend;
  const latX = ship.vx - forward.x * along;
  const latY = ship.vy - forward.y * along;
  const latDamp = Math.max(0, 1 - 16 * dt);
  ship.vx = forward.x * nextAlong + latX * latDamp;
  ship.vy = forward.y * nextAlong + latY * latDamp;
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  clampToBounds(ship, bounds);
  if (Math.abs(forward.x) > 0.25) ship.facing = forward.x > 0 ? 1 : -1;
  return ship;
}

/**
 * Enemy captains close to their preferred range, then circle and shell the player.
 * Ships spawned off-screen sail in first (`entering`).
 */
function stepEnemyAI(e, player, dt, bounds, rng = Math.random) {
  const type = ENEMY_TYPES[e.type] || ENEMY_TYPES.sloop;
  const speed = e.moveSpeed || type.speed;
  e.phase = (e.phase || 0) + dt * 0.9;

  if (e.entering) {
    e.vx = e.enterDir * speed;
    e.vy = 0;
    e.x += e.vx * dt;
    e.facing = e.enterDir;
    if (e.x >= bounds.minX && e.x <= bounds.maxX) e.entering = false;
    return e;
  }

  const dx = player.x - e.x;
  const dy = player.y - e.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const behavior = e.behavior || type.behavior;
  let tx = 0;
  let ty = 0;
  let pace = speed;
  if (behavior === "charge") {
    tx = dx / dist;
    ty = dy / dist;
    pace = speed * 1.18;
  } else if (behavior === "flee") {
    if (dist < type.range) {
      tx = -dx / dist;
      ty = -dy / dist;
      pace = speed * 1.08;
    } else {
      tx = Math.cos(e.phase * 0.6);
      ty = Math.sin(e.phase) * 0.35;
    }
  } else if (behavior === "flank") {
    const side = Math.cos(e.phase) >= 0 ? 1 : -1;
    tx = -dy / dist * side * 0.85 + (dx / dist) * 0.25;
    ty = dx / dist * side * 0.85 + (dy / dist) * 0.25;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
  } else if (dist > type.range * 1.12) {
    tx = dx / dist;
    ty = dy / dist;
  } else if (dist < type.range * 0.62) {
    tx = -dx / dist;
    ty = -dy / dist;
  } else {
    ty = Math.sin(e.phase) * 0.9;
    tx = Math.cos(e.phase * 0.7) * 0.25;
  }
  const blend = Math.min(1, 1.8 * dt);
  e.vx += (tx * pace - e.vx) * blend;
  e.vy += (ty * pace * 0.72 - e.vy) * blend;
  e.x += e.vx * dt;
  e.y += e.vy * dt;
  clampToBounds(e, bounds);
  if (Math.abs(e.vx) > 12) e.facing = e.vx > 0 ? 1 : -1;
  else e.facing = dx >= 0 ? 1 : -1;
  void rng;
  return e;
}

/** Push escorts off a boss hull so the flagship stays readable in a horde. */
function giveBossRoom(ships, pad = 86) {
  const bosses = ships.filter((s) => s.boss && !(s.sinking > 0));
  if (!bosses.length) return;
  for (const b of bosses) {
    const need = pad * Math.max(1, (b.scale || 2) / 2);
    for (const e of ships) {
      if (e === b || e.sinking > 0) continue;
      const dx = e.x - b.x;
      const dy = e.y - b.y;
      const d = Math.hypot(dx, dy);
      if (!d || d >= need) continue;
      const k = ((need - d) / need) * 36;
      e.x += (dx / d) * k;
      e.y += (dy / d) * k;
    }
  }
}

/** Nudge overlapping hostile hulls apart so waves don't stack into one blob. */
function separate(ships, minDist = 70, push = 40, dt = 0.016) {
  for (let i = 0; i < ships.length; i++) {
    for (let j = i + 1; j < ships.length; j++) {
      const a = ships[i];
      const b = ships[j];
      if (a.entering || b.entering) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d >= minDist || d === 0) continue;
      const k = ((minDist - d) / minDist) * push * dt;
      const nx = dx / d;
      const ny = dy / d;
      a.x += nx * k;
      a.y += ny * k;
      b.x -= nx * k;
      b.y -= ny * k;
    }
  }
}

const HAZARD_KINDS = Object.freeze(["sinkhole", "megalodon", "reef", "mine"]);

/** Seconds between map hazards. Later waves roll them faster. */
function hazardInterval(n) {
  const w = Math.max(1, n | 0);
  return Math.max(5.2, 17 - w * 0.62);
}

function pickHazardKind(wave, rng = Math.random) {
  const roll = rng();
  const bossWave = (wave | 0) >= 5 && (wave | 0) % 5 === 0;
  if (bossWave) {
    if (roll < 0.42) return "megalodon";
    if (roll < 0.78) return "sinkhole";
    return roll < 0.9 ? "reef" : "mine";
  }
  if (roll < 0.32) return "sinkhole";
  if (roll < 0.58) return "megalodon";
  if (roll < 0.8) return "reef";
  return "mine";
}

/**
 * @param {string} kind
 * @param {{ minX:number, maxX:number, minY:number, maxY:number }} bounds
 */
function createHazard(kind, bounds, rng = Math.random, wave = 1) {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const x = bounds.minX + rng() * spanX;
  const y = bounds.minY + rng() * spanY;
  const w = Math.max(1, wave | 0);
  if (kind === "megalodon") {
    const fromLeft = rng() < 0.5;
    return {
      kind,
      x: fromLeft ? bounds.minX - 90 : bounds.maxX + 90,
      y: bounds.minY + rng() * spanY,
      vx: (fromLeft ? 1 : -1) * (210 + Math.min(90, w * 6)),
      vy: (rng() - 0.5) * 36,
      life: 0,
      max: 9,
      biteR: 52 + Math.min(18, w),
      damage: w >= 10 ? 3 : 2,
      phase: rng() * Math.PI * 2,
      bitten: {},
    };
  }
  if (kind === "sinkhole") {
    const maxR = 70 + Math.min(36, w * 2);
    return {
      kind,
      x,
      y,
      r: maxR * 0.35,
      maxR,
      life: 0,
      max: 8 + rng() * 4,
      pull: 120 + w * 4,
      dps: 1.35 + w * 0.06,
      phase: rng() * Math.PI * 2,
    };
  }
  if (kind === "reef") {
    return {
      kind,
      x,
      y,
      r: 40 + rng() * 18,
      life: 0,
      max: 12 + rng() * 6,
      damage: 1,
      tick: {},
      phase: rng() * Math.PI * 2,
    };
  }
  return {
    kind: "mine",
    x,
    y,
    r: 18,
    blast: 78,
    life: 0,
    max: 14 + rng() * 5,
    damage: 3,
    phase: rng() * Math.PI * 2,
    exploded: false,
  };
}

/** Advance a hazard. False when it should leave the sea. */
function stepHazard(h, dt, bounds) {
  h.life += dt;
  h.phase = (h.phase || 0) + dt;
  if (h.kind === "sinkhole") {
    const u = Math.min(1, h.life / 1.6);
    h.r = h.maxR * (0.35 + 0.65 * u);
  } else if (h.kind === "megalodon") {
    h.x += h.vx * dt;
    h.y += Math.sin(h.phase * 1.7) * 28 * dt;
    if (bounds) {
      if (h.y < bounds.minY) h.y = bounds.minY;
      if (h.y > bounds.maxY) h.y = bounds.maxY;
    }
  }
  return h.life < h.max && !h.exploded;
}

/**
 * One hazard's effect on one hull this frame. May stamp bite/tick cooldowns.
 * `damage` is hull points (mines report explode instead, then mineBlastHits).
 * @returns {{ dx:number, dy:number, damage:number, explode:boolean }}
 */
function hazardInfluence(h, ship, dt) {
  const none = { dx: 0, dy: 0, damage: 0, explode: false };
  if (!h || !ship || ship.sinking > 0 || h.exploded) return none;
  const dx = h.x - ship.x;
  const dy = h.y - ship.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  if (h.kind === "sinkhole") {
    const reach = h.r * 2.7;
    if (dist > reach) return none;
    const resist = ship.boss ? 0.38 : 1;
    const pull = (1 - dist / reach) * h.pull * dt * resist;
    const damage = dist < h.r * 0.7 ? h.dps * dt * (ship.boss ? 0.55 : 1) : 0;
    return { dx: (dx / dist) * pull, dy: (dy / dist) * pull, damage, explode: false };
  }
  if (h.kind === "megalodon") {
    if (dist > h.biteR) return none;
    const id = ship.id;
    if (h.bitten[id] != null && h.life - h.bitten[id] <= 1.15) return none;
    h.bitten[id] = h.life;
    return { dx: 0, dy: 0, damage: h.damage, explode: false };
  }
  if (h.kind === "reef") {
    if (dist > h.r) return none;
    const id = ship.id;
    if (h.tick[id] != null && h.life - h.tick[id] < 0.85) return none;
    h.tick[id] = h.life;
    return { dx: 0, dy: 0, damage: h.damage, explode: false };
  }
  if (dist > h.r + 10) return none;
  h.exploded = true;
  return { dx: 0, dy: 0, damage: 0, explode: true };
}

function mineBlastHits(h, ship) {
  if (!h || !ship || ship.sinking > 0) return false;
  return Math.hypot(ship.x - h.x, ship.y - h.y) <= (h.blast || 78);
}

function emptySave() {
  return {
    best: 0,
    bestWave: 0,
    sunk: 0,
    runs: 0,
    doubloons: 0,
    hull: 0,
    perms: emptyPerms(),
    cosmetics: { ...DEFAULT_COSMETICS },
    owned: [],
    board: [],
  };
}

function normalizePerms(raw) {
  const base = emptyPerms();
  if (!raw || typeof raw !== "object") return base;
  for (const key of Object.keys(base)) {
    base[key] = Math.max(0, Math.floor(Number(raw[key]) || 0));
  }
  return base;
}

function normalizeCosmetics(raw) {
  const next = { ...DEFAULT_COSMETICS };
  if (!raw || typeof raw !== "object") return next;
  for (const slot of Object.keys(DEFAULT_COSMETICS)) {
    if (typeof raw[slot] === "string" && raw[slot]) next[slot] = raw[slot];
  }
  return next;
}

function normalizeSave(raw) {
  const base = emptySave();
  if (!raw || typeof raw !== "object") return base;
  base.best = Math.max(0, Number(raw.best) || 0);
  base.bestWave = Math.max(0, Number(raw.bestWave) || 0);
  base.sunk = Math.max(0, Number(raw.sunk) || 0);
  base.runs = Math.max(0, Number(raw.runs) || 0);
  base.doubloons = Math.max(0, Math.floor(Number(raw.doubloons) || 0));
  base.hull = Math.max(0, Math.min(HULLS.length - 1, Math.floor(Number(raw.hull) || 0)));
  base.perms = normalizePerms(raw.perms);
  base.cosmetics = normalizeCosmetics(raw.cosmetics);
  base.owned = Array.isArray(raw.owned) ? raw.owned.filter((id) => typeof id === "string") : [];
  base.board = Array.isArray(raw.board) ? raw.board.filter((row) => row && typeof row === "object") : [];
  return base;
}

function readSave(storage) {
  try {
    const raw = storage && storage.getItem(SAVE_KEY);
    if (!raw) return emptySave();
    return normalizeSave(JSON.parse(raw));
  } catch {
    return emptySave();
  }
}

function writeSave(storage, save) {
  try {
    if (storage) storage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Storage can be blocked or full; progression is a nice-to-have.
  }
}

/** @returns {{ save: ReturnType<typeof emptySave>, newBest: boolean }} */
function recordRun(save, run) {
  const base = normalizeSave(save);
  const spent = !!(run && run.spent);
  const score = Math.max(0, run && run.score | 0);
  const newBest = !spent && score > base.best;
  return {
    save: {
      ...base,
      best: spent ? base.best : Math.max(base.best, score),
      bestWave: spent ? base.bestWave : Math.max(base.bestWave, run.wave | 0),
      sunk: base.sunk + Math.max(0, run && run.sunk | 0),
      runs: base.runs + (score > 0 || (run && run.sunk > 0) ? 1 : 0),
    },
    newBest: newBest && score > 0,
  };
}

function bankDoubloons(save, amount) {
  const next = normalizeSave(save);
  next.doubloons = Math.max(0, next.doubloons + Math.floor(Number(amount) || 0));
  return next;
}

function doubloonsForSink(typeId, opts = {}) {
  const type = ENEMY_TYPES[typeId] || ENEMY_TYPES.sloop;
  let n = type.boss ? 14 : type.prize ? 18 : Math.max(1, Math.round(type.score / 120));
  if (opts.gilded) n *= 2;
  if ((opts.combo | 0) >= 3) n += 1;
  return n;
}

function chestDoubloons() {
  return 10;
}

function supplyDoubloons(wave) {
  return 6 + Math.min(10, Math.max(1, wave | 0));
}

function waveDoubloons(n) {
  return 2 + Math.max(1, n | 0);
}

function buyPerm(save, id) {
  const next = normalizeSave(save);
  const spec = PERM_UPGRADES.find((row) => row.id === id);
  if (!spec) return { save: next, ok: false, reason: "unknown" };
  if ((next.perms[id] || 0) >= spec.max) return { save: next, ok: false, reason: "max" };
  if (next.doubloons < spec.cost) return { save: next, ok: false, reason: "poor" };
  next.doubloons -= spec.cost;
  next.perms = { ...next.perms, [id]: (next.perms[id] || 0) + 1 };
  return { save: next, ok: true, rank: next.perms[id] };
}

function buyCosmetic(save, id) {
  const next = normalizeSave(save);
  const spec = COSMETICS.find((row) => row.id === id);
  if (!spec) return { save: next, ok: false, reason: "unknown" };
  if (!next.owned.includes(spec.id)) {
    if (next.doubloons < spec.cost) return { save: next, ok: false, reason: "poor" };
    next.doubloons -= spec.cost;
    next.owned = next.owned.concat(spec.id);
  }
  next.cosmetics = { ...next.cosmetics, [spec.slot]: spec.value };
  return { save: next, ok: true };
}

function prestigeCost(tier) {
  const i = tier | 0;
  if (i < 0 || i >= PRESTIGE_COSTS.length) return null;
  return PRESTIGE_COSTS[i];
}

/**
 * Spend this run's score to commission the next hull. The caller must not
 * post that score — the progress is the price.
 */
function spendRunOnPrestige(save, run) {
  const next = normalizeSave(save);
  const cost = prestigeCost(next.hull);
  const score = Math.max(0, run && run.score | 0);
  if (cost == null) return { save: next, ok: false, reason: "max" };
  if (score < cost) return { save: next, ok: false, reason: "short", cost };
  next.hull += 1;
  return { save: next, ok: true, cost, hull: HULLS[next.hull] };
}

function mitigateDamage(ship, dmg) {
  const amount = Math.max(0, Math.floor(Number(dmg) || 0));
  if (!ship || !ship.phase || amount <= 0) return amount;
  ship.phaseTick = (ship.phaseTick || 0) + 1;
  return ship.phaseTick % 2 === 0 ? 0 : amount;
}

/** Event the flagship calls when she arrives, or null. */
function bossOpening(typeId) {
  if (typeId === "manowar") return "barrage";
  if (typeId === "blackgalleon") return "fog";
  if (typeId === "dreadnought") return "squall";
  return null;
}

function eventInterval(n) {
  const w = Math.max(1, n | 0);
  return Math.max(6.4, 15.5 - w * 0.42);
}

function pickEventKind(wave, rng = Math.random) {
  const w = Math.max(1, wave | 0);
  const pool = ["fog", "supply"];
  if (w >= 2) pool.push("squall", "boarding");
  if (w >= 3) pool.push("barrage");
  if (w >= 4) pool.push("kraken");
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

function createEvent(kind, bounds, rng = Math.random, wave = 1) {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const x = bounds.minX + rng() * spanX;
  const y = bounds.minY + rng() * spanY;
  const w = Math.max(1, wave | 0);
  if (kind === "fog") {
    return { kind, x, y, r: 128 + Math.min(48, w * 4), life: 0, max: 8.5, phase: rng() * 6 };
  }
  if (kind === "squall") {
    const a = rng() * Math.PI * 2;
    return {
      kind,
      x,
      y,
      vx: Math.cos(a),
      vy: Math.sin(a) * 0.65,
      life: 0,
      max: 5.4,
      force: 96 + w * 5,
      phase: 0,
    };
  }
  if (kind === "barrage") {
    const n = 4 + Math.min(3, Math.floor(w / 3));
    const shots = [];
    for (let i = 0; i < n; i++) {
      shots.push({
        x: bounds.minX + rng() * spanX,
        y: bounds.minY + rng() * spanY,
        arm: 0.65 + i * 0.26,
        boom: false,
        hit: {},
      });
    }
    return { kind, life: 0, max: 1.15 + n * 0.26, shots, damage: w >= 8 ? 3 : 2, r: 48, phase: 0 };
  }
  if (kind === "kraken") {
    return {
      kind,
      x,
      y,
      r: 40 + Math.min(16, w),
      life: 0,
      max: 4.4,
      slam: 1.15,
      slammed: false,
      damage: w >= 10 ? 4 : 3,
      hit: {},
      phase: rng() * 6,
    };
  }
  if (kind === "supply") {
    return { kind, x, y, vx: (rng() - 0.5) * 28, vy: (rng() - 0.5) * 18, life: 0, max: 12, taken: false, phase: 0 };
  }
  return { kind: "boarding", life: 0, max: 6.2, slow: 0.42, dps: 0.55, range: 84, phase: 0 };
}

function stepEvent(ev, dt, bounds) {
  ev.life += dt;
  ev.phase = (ev.phase || 0) + dt;
  if (ev.kind === "barrage") {
    for (const shot of ev.shots) {
      if (ev.life >= shot.arm) shot.boom = true;
    }
  } else if (ev.kind === "kraken") {
    if (ev.life >= ev.slam) ev.slammed = true;
  } else if (ev.kind === "supply") {
    ev.x += (ev.vx || 0) * dt;
    ev.y += (ev.vy || 0) * dt;
    if (bounds) {
      if (ev.x < bounds.minX || ev.x > bounds.maxX) ev.vx = -(ev.vx || 0);
      if (ev.y < bounds.minY || ev.y > bounds.maxY) ev.vy = -(ev.vy || 0);
    }
  }
  if (ev.kind === "supply" && ev.taken) return false;
  return ev.life < ev.max;
}

function eventInfluence(ev, ship, dt) {
  const none = { dx: 0, dy: 0, damage: 0, pickup: false };
  if (!ev || !ship || ship.sinking > 0) return none;
  if (ev.kind === "squall") {
    const resist = ship.boss ? 0.5 : ship.role === "player" ? 0.82 : 1;
    return {
      dx: ev.vx * ev.force * dt * resist,
      dy: ev.vy * ev.force * dt * resist,
      damage: 0,
      pickup: false,
    };
  }
  if (ev.kind === "barrage") {
    let damage = 0;
    for (const shot of ev.shots) {
      if (!shot.boom || (shot.hit && shot.hit[ship.id])) continue;
      if (Math.hypot(ship.x - shot.x, ship.y - shot.y) > ev.r) continue;
      shot.hit[ship.id] = true;
      damage += ev.damage;
    }
    return { dx: 0, dy: 0, damage, pickup: false };
  }
  if (ev.kind === "kraken") {
    const dx = ev.x - ship.x;
    const dy = ev.y - ship.y;
    const dist = Math.hypot(dx, dy) || 0.0001;
    if (!ev.slammed && dist < 240) {
      const resist = ship.boss ? 0.4 : 1;
      const pull = (1 - dist / 240) * 86 * dt * resist;
      return { dx: (dx / dist) * pull, dy: (dy / dist) * pull, damage: 0, pickup: false };
    }
    if (ev.slammed && !(ev.hit && ev.hit[ship.id]) && dist < ev.r * 2.3) {
      ev.hit[ship.id] = true;
      return { dx: 0, dy: 0, damage: ship.boss ? ev.damage * 0.6 : ev.damage, pickup: false };
    }
    return none;
  }
  if (ev.kind === "supply") {
    if (ship.role !== "player" || ev.taken) return none;
    if (Math.hypot(ship.x - ev.x, ship.y - ev.y) > 42) return none;
    ev.taken = true;
    return { dx: 0, dy: 0, damage: 0, pickup: true };
  }
  return none;
}

function fogBlocksAim(events, from, target) {
  if (!events || !from || !target) return false;
  for (const ev of events) {
    if (!ev || ev.kind !== "fog") continue;
    const td = Math.hypot(target.x - ev.x, target.y - ev.y);
    if (td > ev.r) continue;
    const fd = Math.hypot(from.x - ev.x, from.y - ev.y);
    if (fd > ev.r * 0.85) return true;
  }
  return false;
}

function boardingPressure(ev, player, enemies, dt) {
  if (!ev || ev.kind !== "boarding" || !player) return null;
  let close = false;
  for (const enemy of enemies || []) {
    if (!enemy || enemy.sinking > 0 || enemy.entering) continue;
    if (Math.hypot(enemy.x - player.x, enemy.y - player.y) <= ev.range) {
      close = true;
      break;
    }
  }
  if (!close) return null;
  return { slow: ev.slow, damage: ev.dps * dt };
}

function localDayKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function localMonthKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}`;
}

function localWeekKey(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - weekday);
  return localDayKey(copy);
}

function recordDeskScore(save, row, now = new Date()) {
  const next = normalizeSave(save);
  const person = String((row && row.person) || "").trim().toLowerCase();
  const score = Math.max(0, Math.floor(Number(row && row.score) || 0));
  if (!person || score <= 0) return next;
  const at = now instanceof Date ? now : new Date(now);
  next.board = next.board
    .concat({
      person,
      name: (row && row.name) || person,
      score,
      wave: Math.max(0, Math.floor(Number(row && row.wave) || 0)),
      sunk: Math.max(0, Math.floor(Number(row && row.sunk) || 0)),
      at: at.toISOString(),
      revision: String((row && row.revision) || ""),
    })
    .slice(-240);
  return next;
}

function bestRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const prev = map.get(row.person);
    if (!prev || row.score > prev.score) map.set(row.person, row);
  }
  return [...map.values()].sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
}

/**
 * Desk-local today / week / month / revision boards.
 * Rows stay tied to the shop person id that was signed in when the run counted.
 */
function deskBoards(save, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const revision = String(opts.revision || "");
  const rows = (normalizeSave(save).board || [])
    .map((row) => {
      const at = new Date(row.at);
      if (Number.isNaN(at.getTime())) return null;
      return { ...row, atDate: at };
    })
    .filter(Boolean);
  const day = localDayKey(now);
  const week = localWeekKey(now);
  const month = localMonthKey(now);
  const shape = (id, label, list) => ({
    id,
    label,
    rows: bestRows(list).map((row) => ({
      person: row.person,
      name: row.name,
      score: row.score,
      wave: row.wave,
      sunk: row.sunk,
    })),
  });
  return {
    day: shape("day", "Today", rows.filter((row) => localDayKey(row.atDate) === day)),
    week: shape("week", "This week", rows.filter((row) => localWeekKey(row.atDate) === week)),
    month: shape("month", "This month", rows.filter((row) => localMonthKey(row.atDate) === month)),
    revision: shape(
      "revision",
      revision ? `This revision (${revision})` : "This revision",
      rows.filter((row) => row.revision === revision),
    ),
  };
}

module.exports = {
  SAVE_KEY,
  PLAYER_BASE,
  PLAYER_CAPS,
  ENEMY_TYPES,
  UPGRADES,
  SHIP_NAMES,
  FLAG_KINDS,
  FLAG_ICONS,
  HULLS,
  PRESTIGE_COSTS,
  PERM_UPGRADES,
  COSMETICS,
  DEFAULT_COSMETICS,
  EVENT_KINDS,
  EVENT_LABELS,
  COMBO_WINDOW_S,
  GILDED_CHANCE,
  pickShipName,
  pickFlagKind,
  createPlayerStats,
  headingForward,
  hullByTier,
  isUpgradeAvailable,
  rollUpgrades,
  applyUpgrade,
  waveBudget,
  maxAliveForWave,
  spawnGap,
  spawnBatch,
  bossForWave,
  bossOpening,
  scaleEnemy,
  planWave,
  comboMultiplier,
  scoreForSink,
  waveClearBonus,
  flightTime,
  shipCenter,
  leadPoint,
  enemyAimError,
  enemyAim,
  ballHitsShip,
  resolvePlayerAim,
  nearestEnemy,
  volleyOffsets,
  seaBounds,
  clampToBounds,
  steerPlayer,
  stepEnemyAI,
  giveBossRoom,
  separate,
  HAZARD_KINDS,
  hazardInterval,
  pickHazardKind,
  createHazard,
  stepHazard,
  hazardInfluence,
  mineBlastHits,
  mitigateDamage,
  eventInterval,
  pickEventKind,
  createEvent,
  stepEvent,
  eventInfluence,
  fogBlocksAim,
  boardingPressure,
  emptySave,
  normalizeSave,
  readSave,
  writeSave,
  recordRun,
  bankDoubloons,
  doubloonsForSink,
  chestDoubloons,
  supplyDoubloons,
  waveDoubloons,
  buyPerm,
  buyCosmetic,
  prestigeCost,
  spendRunOnPrestige,
  recordDeskScore,
  deskBoards,
};
