"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const c = require("../src/idle-combat");
const fx = require("../src/idle-fx");

function seq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test("planWave starts with sloops only and stays inside the hull budget", () => {
  for (const id of c.planWave(1, seq([0.1, 0.9, 0.5]))) assert.equal(id, "sloop");
  for (let n = 1; n <= 12; n++) {
    const plan = c.planWave(n, Math.random);
    const cost = plan.reduce((s, id) => s + c.ENEMY_TYPES[id].cost, 0);
    assert.ok(plan.length > 0);
    assert.ok(cost <= c.waveBudget(n), `wave ${n} cost ${cost}`);
  }
});

test("heavier hulls unlock with later waves", () => {
  const rng = () => 0.999;
  assert.ok(!c.planWave(2, rng).includes("galleon"));
  const late = new Set();
  for (let k = 0; k < 40; k++) for (const id of c.planWave(8)) late.add(id);
  assert.ok(late.has("galleon") && late.has("brig") && late.has("sloop"));
});

test("combo multiplier caps at x4 and scales sink score", () => {
  assert.equal(c.comboMultiplier(0), 1);
  assert.equal(c.comboMultiplier(3), 3);
  assert.equal(c.comboMultiplier(9), 4);
  assert.equal(c.scoreForSink("sloop", { combo: 1 }), 100);
  assert.equal(c.scoreForSink("brig", { combo: 2 }), 400);
  assert.equal(c.scoreForSink("sloop", { combo: 1, gilded: true }), 300);
});

test("upgrades respect caps and never offer a capped refit", () => {
  let stats = c.createPlayerStats();
  for (let i = 0; i < 6; i++) stats = c.applyUpgrade(stats, "heavy").stats;
  assert.equal(stats.damage, c.PLAYER_CAPS.damage);
  assert.equal(c.isUpgradeAvailable(stats, "heavy"), false);
  const offered = c.rollUpgrades(stats, Math.random, 6).map((u) => u.id);
  assert.ok(!offered.includes("heavy"));
  assert.equal(new Set(offered).size, offered.length);
  const hull = c.applyUpgrade(c.createPlayerStats(), "hull");
  assert.equal(hull.stats.maxHp, c.PLAYER_BASE.maxHp + 2);
  assert.equal(hull.heal, 2);
  assert.equal(c.applyUpgrade(c.createPlayerStats(), "carpenter").heal, Infinity);
  assert.equal(c.applyUpgrade(c.createPlayerStats(), "twin").stats.shots, 2);
});

test("steerPlayer: A sails screen-left, D screen-right, W up, S down", () => {
  const bounds = { minX: 0, maxX: 2000, minY: 0, maxY: 2000 };
  const stats = c.createPlayerStats();
  const mk = () => ({ x: 1000, y: 1000, vx: 0, vy: 0, facing: 1 });
  const left = mk();
  for (let i = 0; i < 20; i++) c.steerPlayer(left, { left: true }, 0.05, bounds, stats);
  assert.ok(left.x < 1000 && left.vx < 0);
  assert.equal(left.facing, -1);
  const right = mk();
  for (let i = 0; i < 20; i++) c.steerPlayer(right, { right: true }, 0.05, bounds, stats);
  assert.ok(right.x > 1000 && right.facing === 1);
  const up = mk();
  for (let i = 0; i < 20; i++) c.steerPlayer(up, { up: true }, 0.05, bounds, stats);
  assert.ok(up.y < 1000);
  const down = mk();
  for (let i = 0; i < 20; i++) c.steerPlayer(down, { down: true }, 0.05, bounds, stats);
  assert.ok(down.y > 1000);
});

test("steerPlayer stays inside the water band", () => {
  const bounds = { minX: 100, maxX: 200, minY: 100, maxY: 200 };
  const ship = { x: 150, y: 150, vx: 0, vy: 0, facing: 1 };
  for (let i = 0; i < 200; i++) c.steerPlayer(ship, { right: true, down: true }, 0.05, bounds, c.createPlayerStats());
  assert.ok(ship.x <= 200 && ship.y <= 200);
});

test("leadPoint leads a moving target and ballHitsShip is an ellipse", () => {
  const from = { x: 0, y: 0 };
  const still = { x: 400, y: 100, vx: 0, vy: 0, scale: 1 };
  const moving = { ...still, vx: 100 };
  assert.ok(c.leadPoint(from, moving).x > c.leadPoint(from, still).x + 20);
  assert.equal(c.ballHitsShip(c.shipCenter(still), still), true);
  assert.equal(c.ballHitsShip({ x: still.x + 200, y: still.y }, still), false);
});

test("resolvePlayerAim snaps a near click to a live enemy and ignores sinking hulls", () => {
  const live = { x: 400, y: 300, vx: 0, vy: 0, scale: 1, sinking: 0 };
  const dead = { x: 410, y: 300, vx: 0, vy: 0, scale: 1, sinking: 1 };
  const aim = c.resolvePlayerAim({ x: 100, y: 300 }, { x: 430, y: 290 }, [dead, live]);
  assert.equal(aim.target, live);
  const far = c.resolvePlayerAim({ x: 100, y: 300 }, { x: 900, y: 500 }, [live]);
  assert.equal(far.target, null);
  assert.equal(far.x, 900);
});

test("volleyOffsets matches shot count", () => {
  assert.equal(c.volleyOffsets(1).length, 1);
  assert.equal(c.volleyOffsets(2).length, 2);
  assert.equal(c.volleyOffsets(3).length, 3);
});

test("enemy captains close in, then circle at their range and sail in from off-screen", () => {
  const bounds = { minX: 70, maxX: 1200, minY: 300, maxY: 700 };
  const p = { x: 600, y: 500, vx: 0, vy: 0 };
  const e = { type: "brig", x: 100, y: 500, vx: 0, vy: 0, facing: 1, phase: 0 };
  const before = Math.hypot(p.x - e.x, p.y - e.y);
  for (let i = 0; i < 40; i++) c.stepEnemyAI(e, p, 0.05, bounds);
  assert.ok(Math.hypot(p.x - e.x, p.y - e.y) < before);

  const spawn = { type: "sloop", x: -40, y: 400, vx: 0, vy: 0, entering: true, enterDir: 1, phase: 0 };
  for (let i = 0; i < 80 && spawn.entering; i++) c.stepEnemyAI(spawn, p, 0.05, bounds);
  assert.equal(spawn.entering, false);
  assert.ok(spawn.x >= bounds.minX);
});

test("waves escalate: more budget, more hulls on the sea, faster batches", () => {
  assert.ok(c.waveBudget(8) > c.waveBudget(1));
  assert.ok(c.waveBudget(1) >= 8);
  assert.ok(c.maxAliveForWave(1) >= 6);
  assert.ok(c.maxAliveForWave(10) > 7);
  assert.ok(c.maxAliveForWave(10) <= 28);
  assert.equal(c.spawnBatch(1), 1);
  assert.ok(c.spawnBatch(10) >= 3);
  assert.ok(c.spawnGap(10) < c.spawnGap(1));
});

test("bosses arrive every fifth wave and stay out of the horde plan", () => {
  assert.equal(c.bossForWave(1), null);
  assert.equal(c.bossForWave(4), null);
  assert.equal(c.bossForWave(5), "manowar");
  assert.equal(c.bossForWave(10), "blackgalleon");
  assert.equal(c.bossForWave(15), "dreadnought");
  assert.equal(c.bossForWave(20), "dreadnought");
  for (const id of c.planWave(10, Math.random)) {
    assert.equal(c.ENEMY_TYPES[id].boss, undefined);
  }
});

test("enemy hulls scale up after wave 1 and the sea is the whole viewport", () => {
  const early = c.scaleEnemy("sloop", 1);
  const late = c.scaleEnemy("sloop", 8);
  assert.equal(early.hp, c.ENEMY_TYPES.sloop.hp);
  assert.ok(late.hp > early.hp);
  const boss = c.scaleEnemy("manowar", 5);
  assert.ok(boss.hp > c.ENEMY_TYPES.manowar.hp);
  const sea = c.seaBounds(1280, 800);
  assert.equal(sea.minY, 18);
  assert.ok(sea.maxY > 700);
  assert.ok(sea.minY < 800 * 0.2);
  assert.ok(sea.maxX > 1200);
  assert.equal(c.volleyOffsets(5).length, 5);
});

test("sinkhole pulls inward, megalodon crosses, mine blast reaches nearby hulls", () => {
  const bounds = { minX: 0, maxX: 800, minY: 0, maxY: 600 };
  const hole = c.createHazard("sinkhole", bounds, () => 0.5, 3);
  hole.x = 400;
  hole.y = 300;
  hole.r = 80;
  hole.maxR = 80;
  hole.pull = 200;
  hole.dps = 2;
  const ship = { id: 1, x: 440, y: 300, sinking: 0, boss: false };
  const inf = c.hazardInfluence(hole, ship, 0.5);
  assert.ok(inf.dx < 0);
  assert.ok(inf.damage > 0);

  const mega = c.createHazard("megalodon", bounds, () => 0, 1);
  const x0 = mega.x;
  assert.equal(c.stepHazard(mega, 0.5, bounds), true);
  assert.ok(mega.x > x0);

  const mine = c.createHazard("mine", bounds, () => 0.2, 2);
  const near = { id: 2, x: mine.x + 10, y: mine.y, sinking: 0 };
  const far = { id: 3, x: mine.x + 400, y: mine.y, sinking: 0 };
  const hit = c.hazardInfluence(mine, near, 0.016);
  assert.equal(hit.explode, true);
  assert.equal(c.mineBlastHits(mine, near), true);
  assert.equal(c.mineBlastHits(mine, far), false);
  assert.ok(c.HAZARD_KINDS.includes(c.pickHazardKind(1, () => 0)));
  assert.ok(c.hazardInterval(8) < c.hazardInterval(1));
});

test("enemy aim error shrinks with waves but never reaches zero", () => {
  assert.ok(c.enemyAimError(1) > c.enemyAimError(6));
  assert.ok(c.enemyAimError(99) >= 26);
});

test("flag + names stay generic: no official brand marks, only pixel silhouettes", () => {
  assert.ok(c.FLAG_KINDS.includes(c.pickFlagKind(() => 0)));
  assert.equal(c.pickFlagKind(() => 0), "skull");
  for (const kind of Object.keys(c.FLAG_ICONS)) {
    for (const row of c.FLAG_ICONS[kind]) assert.match(row, /^[X.]{11}$/);
  }
  assert.ok(c.SHIP_NAMES.length >= 12);
});

test("save round-trips, survives bad data, and tracks the best run", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(c.readSave(storage), c.emptySave());
  const first = c.recordRun(c.emptySave(), { score: 900, wave: 3, sunk: 7 });
  assert.equal(first.newBest, true);
  c.writeSave(storage, first.save);
  const again = c.recordRun(c.readSave(storage), { score: 400, wave: 2, sunk: 3 });
  assert.equal(again.newBest, false);
  assert.equal(again.save.best, 900);
  assert.equal(again.save.bestWave, 3);
  assert.equal(again.save.sunk, 10);
  store.set(c.SAVE_KEY, "{not json");
  assert.deepEqual(c.readSave(storage), c.emptySave());
  assert.deepEqual(c.readSave(null), c.emptySave());
  assert.doesNotThrow(() => c.writeSave({ setItem() { throw new Error("full"); } }, first.save));
  assert.equal(c.recordRun(c.emptySave(), { score: 0, wave: 1, sunk: 0 }).newBest, false);
});

test("fx particles expire, stay capped, and shake decays", () => {
  const f = fx.createFx();
  for (let i = 0; i < 50; i++) fx.splinters(f, 0, 0, 20);
  assert.ok(f.parts.length <= fx.MAX_PARTS);
  fx.addShake(f, 100);
  assert.ok(f.shake <= 14);
  for (let i = 0; i < 100; i++) fx.stepFx(f, 0.05);
  assert.equal(f.parts.length, 0);
  assert.equal(f.shake, 0);
  for (let i = 0; i < 30; i++) fx.floatText(f, 0, 0, "x");
  assert.ok(f.texts.length <= fx.MAX_TEXTS);
});
