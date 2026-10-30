"use strict";

/** Particles, floating text, and screen shake for the pirate overlay (data only). */

const MAX_PARTS = 320;
const MAX_TEXTS = 12;

function createFx() {
  return { parts: [], texts: [], shake: 0 };
}

function push(fx, p) {
  if (fx.parts.length >= MAX_PARTS) fx.parts.shift();
  fx.parts.push(p);
}

function between(rng, a, b) {
  return a + (b - a) * rng();
}

/** Planks and rigging flying out of a wounded hull. */
function splinters(fx, x, y, n, rng = Math.random, power = 1) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI * rng();
    const sp = between(rng, 60, 190) * power;
    push(fx, {
      kind: "splinter",
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 40,
      g: 420,
      life: 0,
      max: between(rng, 0.7, 1.3),
      size: between(rng, 2, 5),
      rot: rng() * Math.PI,
      vr: (rng() - 0.5) * 12,
      color: rng() < 0.7 ? "#6b3e22" : "#c9a36a",
    });
  }
}

function spray(fx, x, y, n, rng = Math.random, power = 1) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI * (0.15 + 0.7 * rng());
    const sp = between(rng, 50, 150) * power;
    push(fx, {
      kind: "spray",
      x: x + (rng() - 0.5) * 18,
      y,
      vx: Math.cos(a) * sp * 0.6,
      vy: Math.sin(a) * sp,
      g: 360,
      life: 0,
      max: between(rng, 0.5, 0.95),
      size: between(rng, 1.5, 3.2),
      rot: 0,
      vr: 0,
      color: "#dff0ff",
    });
  }
}

function smoke(fx, x, y, n, rng = Math.random, tint = "#cfd6df") {
  for (let i = 0; i < n; i++) {
    push(fx, {
      kind: "smoke",
      x: x + (rng() - 0.5) * 8,
      y: y + (rng() - 0.5) * 6,
      vx: (rng() - 0.5) * 24,
      vy: -between(rng, 10, 34),
      g: 0,
      life: 0,
      max: between(rng, 0.7, 1.4),
      size: between(rng, 5, 10),
      rot: 0,
      vr: 0,
      color: tint,
    });
  }
}

function sparks(fx, x, y, n, rng = Math.random, color = "#ffb43a") {
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const sp = between(rng, 80, 240);
    push(fx, {
      kind: "spark",
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      g: 260,
      life: 0,
      max: between(rng, 0.18, 0.4),
      size: between(rng, 1.4, 2.6),
      rot: 0,
      vr: 0,
      color,
    });
  }
}

function bubbles(fx, x, y, n, rng = Math.random) {
  for (let i = 0; i < n; i++) {
    push(fx, {
      kind: "bubble",
      x: x + (rng() - 0.5) * 50,
      y: y + (rng() - 0.5) * 10,
      vx: (rng() - 0.5) * 10,
      vy: -between(rng, 14, 46),
      g: 0,
      life: 0,
      max: between(rng, 0.7, 1.5),
      size: between(rng, 2, 4.5),
      rot: 0,
      vr: 0,
      color: "#cfe8ff",
    });
  }
}

function wake(fx, x, y, facing, color, heading) {
  let ox = -(facing || 1) * 30;
  let oy = 12;
  let vx = -(facing || 1) * 8;
  let vy = 0;
  if (Number.isFinite(heading)) {
    const fxw = -Math.sin(heading);
    const fyw = -Math.cos(heading);
    ox = -fxw * 30;
    oy = -fyw * 16;
    vx = -fxw * 8;
    vy = -fyw * 4;
  }
  const wakeColor = color === "gold" ? "#f5c542" : color === "blue" ? "#7eb6ff" : color || "#e6f2ff";
  push(fx, {
    kind: "wake",
    x: x + ox,
    y: y + oy,
    vx,
    vy,
    g: 0,
    life: 0,
    max: 1.1,
    size: 7,
    rot: 0,
    vr: 0,
    color: wakeColor,
  });
}

function ring(fx, x, y, color = "#ffb15a") {
  push(fx, {
    kind: "ring",
    x,
    y,
    vx: 0,
    vy: 0,
    g: 0,
    life: 0,
    max: 0.48,
    size: 8,
    rot: 0,
    vr: 0,
    color,
  });
}

function gust(fx, x, y, vx, vy) {
  push(fx, {
    kind: "streak",
    x,
    y,
    vx,
    vy,
    g: 0,
    life: 0,
    max: 0.4,
    size: 12,
    rot: 0,
    vr: 0,
    color: "rgba(190,220,255,0.85)",
  });
}

function coins(fx, x, y, n, rng = Math.random) {
  for (let i = 0; i < n; i++) {
    push(fx, {
      kind: "coin",
      x,
      y,
      vx: (rng() - 0.5) * 120,
      vy: -between(rng, 90, 200),
      g: 520,
      life: 0,
      max: between(rng, 0.7, 1.1),
      size: 3,
      rot: 0,
      vr: 0,
      color: "#f5c542",
    });
  }
}

function floatText(fx, x, y, text, color = "#ffffff", size = 15) {
  if (fx.texts.length >= MAX_TEXTS) fx.texts.shift();
  fx.texts.push({ x, y, text, color, size, life: 0, max: 1.15 });
}

function addShake(fx, amount) {
  fx.shake = Math.min(14, fx.shake + amount);
}

function stepFx(fx, dt) {
  const next = [];
  for (const p of fx.parts) {
    p.life += dt;
    if (p.life >= p.max) continue;
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    next.push(p);
  }
  fx.parts = next;
  const texts = [];
  for (const t of fx.texts) {
    t.life += dt;
    if (t.life >= t.max) continue;
    t.y -= 34 * dt;
    texts.push(t);
  }
  fx.texts = texts;
  fx.shake = Math.max(0, fx.shake - dt * 28);
  return fx;
}

function clearFx(fx) {
  fx.parts = [];
  fx.texts = [];
  fx.shake = 0;
}

module.exports = {
  MAX_PARTS,
  MAX_TEXTS,
  createFx,
  splinters,
  spray,
  smoke,
  sparks,
  bubbles,
  wake,
  ring,
  gust,
  coins,
  floatText,
  addShake,
  stepFx,
  clearFx,
};
