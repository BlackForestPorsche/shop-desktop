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
  maxHp: 22,
  speed: 280,
  reload: 0.4,
  damage: 4,
  shots: 4,
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

function createPlayerStats() {
  return { ...PLAYER_BASE };
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
    if (n >= 4 && budget >= ENEMY_TYPES.raider.cost) options.push({ id: "raider", w: 4 });
    if (n >= 6 && budget >= ENEMY_TYPES.frigate.cost) options.push({ id: "frigate", w: 3 });
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
 * Keyboard helm. A / left is screen-left, D / right is screen-right.
 * Not a rotated wheel and not inverted: A never turns right.
 * Vertical speed is close to horizontal so the full-height sea is sailable.
 * @param {{ x:number,y:number,vx:number,vy:number,facing:number }} ship
 * @param {{ left?:boolean, right?:boolean, up?:boolean, down?:boolean }} input
 */
function steerPlayer(ship, input, dt, bounds, stats) {
  let ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let iy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const len = Math.hypot(ix, iy);
  if (len > 0) {
    ix /= len;
    iy /= len;
  }
  const blend = Math.min(1, (len > 0 ? 3.6 : 2.4) * dt);
  ship.vx += (ix * stats.speed - ship.vx) * blend;
  ship.vy += (iy * stats.speed * 0.86 - ship.vy) * blend;
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  clampToBounds(ship, bounds);
  if (Math.abs(ship.vx) > 14) ship.facing = ship.vx > 0 ? 1 : -1;
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
  let tx = 0;
  let ty = 0;
  if (dist > type.range * 1.12) {
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
  e.vx += (tx * speed - e.vx) * blend;
  e.vy += (ty * speed * 0.72 - e.vy) * blend;
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
  return { best: 0, bestWave: 0, sunk: 0, runs: 0 };
}

function readSave(storage) {
  try {
    const raw = storage && storage.getItem(SAVE_KEY);
    if (!raw) return emptySave();
    const d = JSON.parse(raw);
    return {
      best: Math.max(0, Number(d.best) || 0),
      bestWave: Math.max(0, Number(d.bestWave) || 0),
      sunk: Math.max(0, Number(d.sunk) || 0),
      runs: Math.max(0, Number(d.runs) || 0),
    };
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
  const score = Math.max(0, run.score | 0);
  const newBest = score > save.best;
  return {
    save: {
      best: Math.max(save.best, score),
      bestWave: Math.max(save.bestWave, run.wave | 0),
      sunk: save.sunk + Math.max(0, run.sunk | 0),
      runs: save.runs + (score > 0 || run.sunk > 0 ? 1 : 0),
    },
    newBest: newBest && score > 0,
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
  COMBO_WINDOW_S,
  GILDED_CHANCE,
  pickShipName,
  pickFlagKind,
  createPlayerStats,
  isUpgradeAvailable,
  rollUpgrades,
  applyUpgrade,
  waveBudget,
  maxAliveForWave,
  spawnGap,
  spawnBatch,
  bossForWave,
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
  emptySave,
  readSave,
  writeSave,
  recordRun,
};
