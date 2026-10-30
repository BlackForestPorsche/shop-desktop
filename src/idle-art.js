"use strict";

/** Canvas drawing for the pirate idle overlay (ships, flags, FX, water). */

const { BRAND_BLUE } = require("./idle-fleet");
const { FLAG_ICONS } = require("./idle-combat");

const SINK_SECONDS = 1.35;

function sailPalette(ship) {
  const kind = ship && ship.cosmetics && ship.cosmetics.sails;
  if (kind === "solid") return ["#f3ecdf", "#f3ecdf", "#e7dcc8"];
  if (kind === "check") return ["#f4efe4", "#1a140f", "#f4efe4"];
  if (kind === "blue") return ["#0582ff", "#d7e8ff", "#0460c4"];
  return null;
}

function hullTier(ship) {
  if (!ship) return "full";
  if (
    ship.boss ||
    ship.type === "galleon" ||
    ship.type === "manowar" ||
    ship.type === "blackgalleon" ||
    ship.type === "dreadnought"
  ) {
    return "heavy";
  }
  if (ship.type === "sloop" || ship.type === "raider") return "light";
  return "full";
}

function drawBossCrown(c) {
  c.save();
  c.translate(-36, -18);
  c.fillStyle = "#f5c542";
  c.fillRect(-8, 0, 16, 3);
  c.fillRect(-7, -6, 3, 6);
  c.fillRect(-1.5, -9, 3, 9);
  c.fillRect(4, -6, 3, 6);
  c.restore();
}

/** Chunky arcade galleon: readable gun deck, stern castle, striped sails. Nose to +x. */
function drawPixelShip(c, ship) {
  const tier = hullTier(ship);
  const light = tier === "light";
  const heavy = tier === "heavy";
  const hullW = light ? 70 : heavy ? 96 : 84;
  const hullX = light ? -32 : heavy ? -46 : -40;
  c.fillStyle = "#24160e";
  c.fillRect(hullX, 2, hullW, heavy ? 16 : 13);
  c.fillStyle = "#6b3e22";
  c.fillRect(hullX + 3, -8, hullW - 8, 12);
  c.fillStyle = "#8a5530";
  c.fillRect(hullX + 6, -10, hullW - 22, 5);
  c.fillStyle = "#140c08";
  const ports = light ? 3 : heavy ? 6 : 4;
  for (let i = 0; i < ports; i++) {
    const px = hullX + 12 + i * 11;
    c.fillRect(px, -3, 5, 4);
    if (heavy) c.fillRect(px, 3, 5, 3);
    c.fillStyle = "#e8a04a";
    c.fillRect(px + 1, -2, 2, 2);
    c.fillStyle = "#140c08";
  }
  c.fillStyle = "#3d2616";
  c.fillRect(hullX, -18, 16, 12);
  c.fillStyle = "#f5c542";
  c.fillRect(hullX + 3, -16, 4, 3);
  c.fillStyle = "#c9a36a";
  c.fillRect(hullX + hullW - 14, -8, 10, 6);
  c.strokeStyle = "#2a1a10";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(hullX + hullW - 6, -6);
  c.lineTo(hullX + hullW + 12, -12);
  c.stroke();
  const masts = light
    ? [{ x: -2, h: 40, sw: 22 }]
    : heavy
      ? [{ x: -18, h: 44, sw: 20 }, { x: 0, h: 56, sw: 24 }, { x: 18, h: 38, sw: 16 }]
      : [{ x: -14, h: 42, sw: 20 }, { x: 2, h: 52, sw: 22 }, { x: 18, h: 34, sw: 14 }];
  for (const m of masts) {
    c.fillStyle = "#1a120c";
    c.fillRect(m.x, -8 - m.h, 3, m.h);
    const stripes = 4;
    const sw = m.sw / stripes;
    const sailTop = -6 - m.h;
    const sailH = Math.round(m.h * 0.62);
    const palette = sailPalette(ship);
    for (let i = 0; i < stripes; i++) {
      c.fillStyle = palette ? palette[i % palette.length] : i % 2 ? "#f3ecdf" : "#9d2c22";
      c.fillRect(m.x + 4 + i * sw, sailTop, sw + 0.4, sailH);
    }
    c.fillStyle = "#5c3b24";
    c.fillRect(m.x - 1, -8, 5, 3);
  }
  if (ship && ship.boss) drawBossCrown(c);
}

/** Desk-black hull, brand-blue sails, gunports cut out of the sheer. Nose to +x. */
function drawSilhouetteShip(c, ship) {
  const tier = hullTier(ship);
  const light = tier === "light";
  const heavy = tier === "heavy";
  const bow = light ? 40 : heavy ? 50 : 46;
  c.fillStyle = "#07090d";
  c.beginPath();
  c.moveTo(-bow, 2);
  c.lineTo(-bow + 8, -12);
  c.lineTo(bow - 16, -8);
  c.lineTo(bow, -2);
  c.quadraticCurveTo(8, 16, -bow + 4, 8);
  c.closePath();
  c.fill();
  c.fillStyle = "#10141c";
  c.fillRect(-bow, -14, 18, 10);
  c.fillStyle = "#07090d";
  const ports = light ? 3 : heavy ? 6 : 4;
  for (let i = 0; i < ports; i++) {
    c.fillRect(-bow + 22 + i * 9, -2, 4, 3);
    if (heavy) c.fillRect(-bow + 22 + i * 9, 3, 4, 2);
  }
  c.strokeStyle = "#07090d";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(bow - 4, -6);
  c.lineTo(bow + 14, -14);
  c.stroke();
  const masts = light
    ? [{ x: -2, top: -48, sail: 18 }]
    : heavy
      ? [{ x: -16, top: -50, sail: 16 }, { x: 0, top: -62, sail: 20 }, { x: 16, top: -44, sail: 14 }]
      : [{ x: -14, top: -48, sail: 16 }, { x: 2, top: -58, sail: 18 }, { x: 16, top: -40, sail: 12 }];
  c.fillStyle = "#07090d";
  for (const m of masts) c.fillRect(m.x, m.top, 2.4, -m.top - 6);
  const blues = sailPalette(ship) || [BRAND_BLUE, "#0460c4", "#7eb6ff"];
  masts.forEach((m, i) => {
    c.fillStyle = blues[i % blues.length];
    c.beginPath();
    c.moveTo(m.x + 2, m.top + 4);
    c.lineTo(m.x + 2 + m.sail, (m.top + -6) / 2);
    c.lineTo(m.x + 2, -8);
    c.closePath();
    c.fill();
  });
  if (ship && ship.boss) drawBossCrown(c);
}

/** Pen-and-ink hull: planks, rigging, billowed sails. Nose to +x. */
function drawInkShip(c, ship) {
  const tier = hullTier(ship);
  const light = tier === "light";
  const heavy = tier === "heavy";
  const bow = light ? 38 : heavy ? 50 : 44;
  c.fillStyle = "#8d6240";
  c.strokeStyle = "#1a140f";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(-bow + 6, -10);
  c.lineTo(bow - 10, -8);
  c.lineTo(bow, 0);
  c.quadraticCurveTo(4, 18, -bow, 4);
  c.lineTo(-bow + 4, -8);
  c.closePath();
  c.fill();
  c.stroke();
  c.strokeStyle = "rgba(26,20,15,0.35)";
  c.lineWidth = 1;
  for (let x = -bow + 14; x < bow - 16; x += 7) {
    c.beginPath();
    c.moveTo(x, -6);
    c.lineTo(x + 5, 8);
    c.stroke();
  }
  c.strokeStyle = "#1a140f";
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(-bow + 10, -2);
  c.lineTo(bow - 14, -2);
  c.stroke();
  const ports = light ? 2 : heavy ? 5 : 3;
  c.fillStyle = "#1a140f";
  for (let i = 0; i < ports; i++) {
    c.beginPath();
    c.arc(-bow + 20 + i * 10, 1, 2.1, 0, Math.PI * 2);
    c.fill();
  }
  c.strokeStyle = "#1a140f";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(bow - 6, -6);
  c.lineTo(bow + 12, -13);
  c.stroke();
  const masts = light
    ? [{ x: -2, top: -50, sail: 20 }]
    : heavy
      ? [{ x: -16, top: -48, sail: 16 }, { x: 0, top: -60, sail: 22 }, { x: 18, top: -42, sail: 14 }]
      : [{ x: -14, top: -46, sail: 16 }, { x: 2, top: -56, sail: 20 }, { x: 16, top: -40, sail: 13 }];
  c.strokeStyle = "#1a140f";
  c.lineWidth = 1.6;
  for (const m of masts) {
    c.beginPath();
    c.moveTo(m.x, -8);
    c.lineTo(m.x, m.top);
    c.stroke();
  }
  const inkSails = sailPalette(ship);
  c.fillStyle = inkSails ? inkSails[0] : "#f4efe4";
  masts.forEach((m) => {
    c.beginPath();
    c.moveTo(m.x, m.top + 3);
    c.quadraticCurveTo(m.x + m.sail, m.top + 16, m.x + m.sail - 2, -12);
    c.lineTo(m.x, -10);
    c.closePath();
    c.fill();
    c.stroke();
  });
  c.strokeStyle = "rgba(26,20,15,0.45)";
  c.lineWidth = 0.8;
  if (masts.length > 1) {
    c.beginPath();
    c.moveTo(masts[0].x, masts[0].top + 2);
    c.lineTo(masts[masts.length - 1].x, masts[masts.length - 1].top + 6);
    c.stroke();
  }
  c.fillStyle = "#9d2c22";
  c.beginPath();
  c.arc(-bow + 16, -16, 3.2, 0, Math.PI * 2);
  c.fill();
  if (ship && ship.boss) drawBossCrown(c);
}

/** Night-harbor wire hull. Glow only on the flagship and bosses — hordes stay cheap. */
function drawNeonShip(c, ship) {
  const id = ship && ship.id ? ship.id : 0;
  const glow = id % 2 === 0 ? "#2ef3ff" : "#ff3fd6";
  const tier = hullTier(ship);
  const light = tier === "light";
  const heavy = tier === "heavy";
  const hot = ship && (ship.boss || ship.role === "player" || ship.gilded);
  const bow = light ? 38 : heavy ? 50 : 44;
  if (hot) {
    c.shadowColor = glow;
    c.shadowBlur = 12;
  }
  c.strokeStyle = glow;
  c.lineWidth = heavy ? 2.4 : 1.8;
  c.beginPath();
  c.moveTo(-bow + 4, -10);
  c.lineTo(bow - 12, -8);
  c.lineTo(bow, -1);
  c.quadraticCurveTo(0, 16, -bow, 3);
  c.closePath();
  c.stroke();
  c.lineWidth = 1.2;
  const ports = light ? 2 : heavy ? 5 : 3;
  for (let i = 0; i < ports; i++) {
    c.beginPath();
    c.arc(-bow + 18 + i * 11, 0, 1.7, 0, Math.PI * 2);
    c.stroke();
  }
  c.beginPath();
  c.moveTo(bow - 8, -6);
  c.lineTo(bow + 12, -13);
  c.stroke();
  const masts = light
    ? [{ x: -2, top: -48, sail: 16 }]
    : heavy
      ? [{ x: -16, top: -50, sail: 14 }, { x: 0, top: -62, sail: 18 }, { x: 16, top: -42, sail: 12 }]
      : [{ x: -14, top: -46, sail: 14 }, { x: 2, top: -56, sail: 16 }, { x: 16, top: -38, sail: 12 }];
  c.beginPath();
  for (const m of masts) {
    c.moveTo(m.x, -8);
    c.lineTo(m.x, m.top);
  }
  c.stroke();
  const neonSails = sailPalette(ship);
  c.save();
  c.globalAlpha = hot ? 0.28 : 0.4;
  c.fillStyle = neonSails ? neonSails[0] : glow;
  masts.forEach((m) => {
    const mid = (m.top + -10) / 2;
    c.beginPath();
    c.moveTo(m.x, m.top + 8);
    c.lineTo(m.x + m.sail, mid);
    c.lineTo(m.x, -12);
    c.closePath();
    c.fill();
  });
  c.restore();
  c.strokeStyle = glow;
  c.lineWidth = 1.6;
  masts.forEach((m) => {
    const mid = (m.top + -10) / 2;
    c.beginPath();
    c.moveTo(m.x, m.top + 8);
    c.lineTo(m.x + m.sail, mid);
    c.lineTo(m.x, -12);
    c.closePath();
    c.stroke();
  });
  c.shadowBlur = 0;
  if (ship && ship.boss) drawBossCrown(c);
}


function drawShipSprite(c, ship) {
  switch (ship.style) {
    case "pixel":
      drawPixelShip(c, ship);
      break;
    case "silhouette":
      drawSilhouetteShip(c, ship);
      break;
    case "ink":
      drawInkShip(c, ship);
      break;
    case "neon":
    default:
      drawNeonShip(c, ship);
      break;
  }
}

function flagTop(ship) {
  const tier = hullTier(ship);
  if (tier === "light") return -50;
  if (tier === "heavy") return -66;
  return -58;
}

function drawTrim(c, ship) {
  const trim = ship && ship.cosmetics && ship.cosmetics.trim;
  if (!trim || trim === "none") return;
  const color = trim === "gold" ? "#f5c542" : trim === "blood" ? "#9d2c22" : BRAND_BLUE;
  c.save();
  c.strokeStyle = color;
  c.globalAlpha = 0.95;
  c.lineWidth = 2.2;
  c.beginPath();
  c.moveTo(-34, 7);
  c.lineTo(30, 5);
  c.stroke();
  c.restore();
}

function drawFigurehead(c, ship) {
  const fig = ship && ship.cosmetics && ship.cosmetics.figure;
  if (!fig || fig === "none") return;
  c.save();
  c.translate(42, -4);
  if (fig === "bull") {
    c.fillStyle = "#1a140f";
    c.beginPath();
    c.moveTo(-2, 4);
    c.lineTo(16, -1);
    c.lineTo(6, 8);
    c.closePath();
    c.fill();
    c.fillRect(4, -10, 2, 7);
    c.fillRect(9, -10, 2, 7);
  } else {
    c.strokeStyle = "#7ea35a";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(4, 2, 8, 0.4, Math.PI * 1.45);
    c.stroke();
    c.beginPath();
    c.arc(8, 0, 4, 0.2, Math.PI);
    c.stroke();
  }
  c.restore();
}

function drawFlag(c, ship, t) {
  const player = ship.role === "player";
  const wave = Math.sin(t * 0.006 + ship.id) * 1.6;
  const top = flagTop(ship);
  c.save();
  c.strokeStyle = "#16120e";
  c.lineWidth = 1.6;
  c.beginPath();
  c.moveTo(0, -6);
  c.lineTo(0, top);
  c.stroke();
  c.beginPath();
  c.moveTo(0, top);
  c.lineTo(-26, top + 3 + wave);
  c.lineTo(-26, top + 18 + wave);
  c.lineTo(0, top + 15);
  c.closePath();
  c.fillStyle = player ? BRAND_BLUE : "#0d1117";
  c.fill();
  c.strokeStyle = player ? "#ffffff" : "rgba(255,255,255,0.35)";
  c.lineWidth = 0.8;
  c.stroke();

  c.fillStyle = "#ffffff";
  const pennant = ship.cosmetics && ship.cosmetics.pennant;
  const kind = pennant && pennant !== "skull" ? pennant : player ? "coupe" : ship.flag || "skull";
  const icon = FLAG_ICONS[kind];
  if (icon) {
    const cell = 1.15;
    const x0 = -20;
    const y0 = top + 4 + wave * 0.35;
    for (let r = 0; r < icon.length; r++) {
      for (let q = 0; q < icon[r].length; q++) {
        if (icon[r][q] === "X") c.fillRect(x0 + q * cell, y0 + r * cell, cell + 0.12, cell + 0.12);
      }
    }
  } else {
    const cx = -13;
    const cy = top + 9 + wave * 0.35;
    c.beginPath();
    c.arc(cx, cy - 0.8, 3.4, 0, Math.PI * 2);
    c.fill();
    c.fillRect(cx - 1.4, cy + 1, 2.8, 1.6);
    c.fillStyle = "#0d1117";
    c.fillRect(cx - 1.6, cy - 1.3, 1.1, 1.1);
    c.fillRect(cx + 0.5, cy - 1.3, 1.1, 1.1);
  }
  c.restore();
}

function drawHpBar(c, x, y, w, hp, maxHp, color) {
  c.save();
  c.fillStyle = "rgba(4, 8, 14, 0.88)";
  c.strokeStyle = "rgba(255,255,255,0.35)";
  c.lineWidth = 1;
  c.fillRect(x - w / 2 - 2, y - 3, w + 4, 10);
  c.strokeRect(x - w / 2 - 2, y - 3, w + 4, 10);
  if (maxHp > 12) {
    const p = Math.max(0, Math.min(1, maxHp > 0 ? hp / maxHp : 0));
    c.fillStyle = color;
    c.fillRect(x - w / 2, y - 1, Math.max(0, w * p), 6);
    c.restore();
    return;
  }
  const pips = Math.max(1, maxHp | 0);
  const gap = 1.5;
  const pw = (w - gap * (pips - 1)) / pips;
  for (let i = 0; i < pips; i++) {
    c.fillStyle = i < hp ? color : "rgba(255,255,255,0.2)";
    c.fillRect(x - w / 2 + i * (pw + gap), y - 1, Math.max(1, pw), 6);
  }
  c.restore();
}

/**
 * @param {CanvasRenderingContext2D} c
 * @param {object} ship
 * @param {{ t: number, showHp: boolean }} opts
 */
function drawShipFull(c, ship, opts) {
  const sinking = ship.sinking > 0;
  const sinkDrop = sinking ? (SINK_SECONDS - ship.sinking) * 26 : 0;
  let fade = sinking ? Math.max(0.15, ship.sinking / SINK_SECONDS) : 1;
  if (ship.retire > 0) fade = Math.min(fade, ship.retire);
  const bobY = Math.sin(ship.bob) * 4;
  const y = ship.y + bobY + sinkDrop;
  const s = ship.scale;

  const headed = Number.isFinite(ship.heading);
  const hullRot = headed ? Math.atan2(-Math.cos(ship.heading), -Math.sin(ship.heading)) : 0;

  c.save();
  c.globalAlpha = fade * 0.4;
  c.fillStyle = "#01040a";
  c.translate(ship.x, ship.y + 16);
  if (headed) c.rotate(hullRot);
  c.beginPath();
  c.ellipse(0, 0, 50 * s, 8 * s, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();

  if (ship.role === "player" && !sinking) {
    const fx = headed ? -Math.sin(ship.heading) : ship.facing || 1;
    const fy = headed ? -Math.cos(ship.heading) : 0;
    c.save();
    c.globalAlpha = 0.85;
    c.strokeStyle = BRAND_BLUE;
    c.shadowColor = BRAND_BLUE;
    c.shadowBlur = 12;
    c.lineWidth = 2.4;
    c.translate(ship.x, ship.y + 14);
    if (headed) c.rotate(hullRot);
    c.beginPath();
    c.ellipse(0, 0, 58 * s, 12 * s, 0, 0, Math.PI * 2);
    c.stroke();
    c.restore();
    c.save();
    c.translate(ship.x + fx * 70 * s, y + fy * 70 * s);
    c.rotate(Math.atan2(fy, fx));
    c.strokeStyle = "#d7ecff";
    c.shadowColor = BRAND_BLUE;
    c.shadowBlur = 8;
    c.lineWidth = 2.6;
    c.beginPath();
    c.moveTo(12, 0);
    c.lineTo(-7, -8);
    c.moveTo(12, 0);
    c.lineTo(-7, 8);
    c.stroke();
    c.restore();
  }

  const speed = Math.hypot(ship.vx || 0, ship.vy || 0);
  if (!sinking && Number.isFinite(ship.heading) && speed > 24) {
    const fx = -Math.sin(ship.heading);
    const fy = -Math.cos(ship.heading);
    const wake = ship.cosmetics && ship.cosmetics.wake;
    c.save();
    c.translate(ship.x - fx * 34 * s, y - fy * 16 * s);
    c.rotate(Math.atan2(fy, fx));
    c.globalAlpha = 0.4;
    c.strokeStyle = wake === "gold" ? "#f5c542" : wake === "blue" ? BRAND_BLUE : "#e7f3ff";
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(-18, -8);
    c.moveTo(0, 0);
    c.lineTo(-18, 8);
    c.stroke();
    c.restore();
  }

  c.save();
  c.globalAlpha = fade;
  c.translate(ship.x, y);
  if (Number.isFinite(ship.heading)) {
    c.rotate(Math.atan2(-Math.cos(ship.heading), -Math.sin(ship.heading)));
    c.scale(s * (sinking ? 0.85 : 1), s * (sinking ? 0.85 : 1));
  } else {
    c.scale(ship.facing * s, s * (sinking ? 0.85 : 1));
  }
  c.rotate(ship.hpTilt);
  if (ship.gilded && !sinking) {
    c.shadowColor = "#f5c542";
    c.shadowBlur = 16;
  } else if (ship.style === "silhouette" && (ship.role === "player" || ship.boss)) {
    c.shadowColor = "rgba(90,170,255,0.9)";
    c.shadowBlur = 7;
  }
  if (ship.hit > 0) c.filter = "brightness(2.4) saturate(0.6)";
  drawShipSprite(c, ship);
  c.filter = "none";
  c.shadowBlur = 0;
  drawTrim(c, ship);
  drawFigurehead(c, ship);
  drawFlag(c, ship, opts.t);
  c.restore();

  if (opts.showHp && !sinking && ship.maxHp > 0 && !ship.boss) {
    const w = Math.min(78, 14 + Math.min(ship.maxHp, 12) * 6) * Math.max(0.9, Math.min(s, 1.4));
    const barY = ship.y + bobY - 78 * Math.min(s, 1.35);
    drawHpBar(
      c,
      ship.x,
      barY,
      w,
      ship.hp,
      ship.maxHp,
      ship.role === "player" ? BRAND_BLUE : ship.gilded ? "#f5c542" : "#ff5a4a",
    );
  }
}

function ballColor(ball) {
  if (ball.side === "player") return "#ffffff";
  if (ball.side === "enemy") return "#ff8a3d";
  return (
    ball.style === "neon" ? (ball.from % 2 === 0 ? "#2ef3ff" : "#ff3fd6") :
    ball.style === "silhouette" ? BRAND_BLUE :
    ball.style === "pixel" ? "#f5a623" :
    "#1a140f"
  );
}

function drawBall(c, ball) {
  const glow = ballColor(ball);
  c.save();
  if (ball.side || ball.style === "neon" || ball.style === "silhouette") {
    c.shadowColor = ball.side === "player" ? BRAND_BLUE : glow;
    c.shadowBlur = 14;
  }
  if (ball.side) {
    const ox = ball.px ?? ball.x;
    const oy = ball.py ?? ball.y;
    c.globalAlpha = 0.55;
    c.strokeStyle = glow;
    c.lineWidth = ball.side === "enemy" ? 3.2 : 2.6;
    c.beginPath();
    c.moveTo(ox, oy);
    c.lineTo(ball.x, ball.y);
    c.stroke();
    c.globalAlpha = 0.28;
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(ox, oy);
    c.lineTo(ball.x, ball.y);
    c.stroke();
    c.globalAlpha = 1;
  }
  c.fillStyle = ball.style === "ink" && !ball.side ? "#111" : glow;
  c.beginPath();
  c.arc(ball.x, ball.y, ball.side === "enemy" ? 5.4 : ball.side ? 4.6 : ball.style === "pixel" ? 3.5 : 3, 0, Math.PI * 2);
  c.fill();
  if (ball.side) {
    c.fillStyle = "rgba(255,255,255,0.8)";
    c.beginPath();
    c.arc(ball.x - 1.1, ball.y - 1.1, 1.3, 0, Math.PI * 2);
    c.fill();
  }
  if (ball.style === "ink" && !ball.side) {
    c.strokeStyle = "rgba(255,255,255,0.25)";
    c.setLineDash([2, 4]);
    c.beginPath();
    c.moveTo(ball.x0, ball.y0);
    const mx = (ball.x0 + ball.x1) / 2;
    const my = (ball.y0 + ball.y1) / 2 - 36;
    c.quadraticCurveTo(mx, my, ball.x, ball.y);
    c.stroke();
    c.setLineDash([]);
  }
  c.restore();
}

function drawLandingMarker(c, ball, t) {
  const u = Math.min(1, ball.t / ball.dur);
  c.save();
  c.translate(ball.x1, ball.y1 + 14);
  c.globalAlpha = 0.45 + u * 0.5;
  c.strokeStyle = "#ff6a3a";
  c.lineWidth = 2.4;
  c.setLineDash([4, 3]);
  c.beginPath();
  c.ellipse(0, 0, 14 + (1 - u) * 26, 6 + (1 - u) * 10, 0, 0, Math.PI * 2);
  c.stroke();
  c.setLineDash([]);
  c.globalAlpha = 0.35 + 0.15 * Math.sin(t * 0.02);
  c.fillStyle = "#ff5a4a";
  c.beginPath();
  c.ellipse(0, 0, 14, 6, 0, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 0.9;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(-10, 0);
  c.lineTo(10, 0);
  c.moveTo(0, -6);
  c.lineTo(0, 6);
  c.stroke();
  c.restore();
}

function drawSplash(c, splash) {
  const u = splash.t / 0.7;
  c.save();
  c.translate(splash.x, splash.y);
  c.globalAlpha = 1 - u * 0.6;
  c.strokeStyle =
    splash.style === "neon" ? "rgba(46,243,255,0.7)" :
    splash.style === "silhouette" ? "rgba(5,130,255,0.55)" :
    "rgba(220,230,245,0.65)";
  c.lineWidth = splash.style === "ink" ? 1.5 : 1.2;
  c.beginPath();
  c.ellipse(0, 0, 6 + u * 22, 3 + u * 9, 0, 0, Math.PI * 2);
  c.stroke();
  if (splash.style === "ink" || splash.style === "pixel" || splash.big) {
    c.beginPath();
    c.ellipse(0, 0, 3 + u * 12, 1.5 + u * 5, 0, 0, Math.PI * 2);
    c.stroke();
  }
  c.restore();
}

function drawParticle(c, p) {
  const u = p.life / p.max;
  c.save();
  switch (p.kind) {
    case "splinter":
      c.globalAlpha = 1 - u * u;
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      c.fillStyle = p.color;
      c.fillRect(-p.size, -1, p.size * 2, 2.4);
      break;
    case "smoke":
      c.globalAlpha = 0.5 * (1 - u);
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, p.size * (0.7 + u * 1.4), 0, Math.PI * 2);
      c.fill();
      break;
    case "bubble":
      c.globalAlpha = 0.6 * (1 - u);
      c.strokeStyle = p.color;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      c.stroke();
      break;
    case "wake":
      c.globalAlpha = 0.32 * (1 - u);
      c.strokeStyle = p.color;
      c.lineWidth = 1.2;
      c.beginPath();
      c.ellipse(p.x, p.y, p.size + u * 20, (p.size + u * 20) * 0.28, 0, 0, Math.PI * 2);
      c.stroke();
      break;
    case "coin":
      c.globalAlpha = 1 - u * u;
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, p.size + 1.2, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.7)";
      c.fillRect(p.x - 0.6, p.y - 1.4, 1.2, 2.4);
      break;
    case "ring":
      c.globalAlpha = 1 - u;
      c.strokeStyle = p.color;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(p.x, p.y, p.size + u * 36, 0, Math.PI * 2);
      c.stroke();
      break;
    case "streak":
      c.globalAlpha = 0.55 * (1 - u);
      c.strokeStyle = p.color;
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05);
      c.stroke();
      break;
    case "spark":
      c.globalAlpha = 1 - u;
      c.fillStyle = p.color;
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      break;
    case "spray":
    default:
      c.globalAlpha = 0.85 * (1 - u);
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      c.fill();
      break;
  }
  c.restore();
}

function drawFloatText(c, tx) {
  const u = tx.life / tx.max;
  c.save();
  c.globalAlpha = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
  c.font = `700 ${tx.size}px "Barlow Condensed", "Oswald", "Arial Narrow", system-ui, sans-serif`;
  c.textAlign = "center";
  c.lineWidth = 3;
  c.strokeStyle = "rgba(4,8,14,0.85)";
  c.strokeText(tx.text, tx.x, tx.y);
  c.fillStyle = tx.color;
  c.fillText(tx.text, tx.x, tx.y);
  c.restore();
}

function drawPickup(c, pk, t) {
  const bob = Math.sin(t * 0.004 + pk.x) * 3;
  const fade = pk.life < 3 ? 0.4 + 0.6 * Math.abs(Math.sin(t * 0.012)) : 1;
  c.save();
  c.globalAlpha = fade;
  c.translate(pk.x, pk.y + bob);
  c.fillStyle = "rgba(2,6,12,0.3)";
  c.beginPath();
  c.ellipse(0, 12, 12, 4, 0, 0, Math.PI * 2);
  c.fill();
  if (pk.kind === "barrel") {
    c.fillStyle = "#6b3e22";
    c.fillRect(-9, -10, 18, 20);
    c.fillStyle = "#c9a36a";
    c.fillRect(-9, -5, 18, 2);
    c.fillRect(-9, 3, 18, 2);
    c.fillStyle = "#3ddc84";
    c.fillRect(-2, -8, 4, 12);
    c.fillRect(-6, -4, 12, 4);
  } else {
    c.shadowColor = "#f5c542";
    c.shadowBlur = 10;
    c.fillStyle = "#8a5a1e";
    c.fillRect(-11, -8, 22, 16);
    c.fillStyle = "#f5c542";
    c.fillRect(-11, -8, 22, 5);
    c.fillRect(-2, -4, 4, 6);
  }
  c.restore();
}

function drawReticle(c, x, y, reloadU) {
  c.save();
  c.translate(x, y);
  c.strokeStyle = "rgba(255,255,255,0.85)";
  c.lineWidth = 1.6;
  c.shadowColor = BRAND_BLUE;
  c.shadowBlur = 6;
  c.beginPath();
  c.arc(0, 0, 13, 0, Math.PI * 2);
  c.stroke();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    c.beginPath();
    c.moveTo(dx * 8, dy * 8);
    c.lineTo(dx * 19, dy * 19);
    c.stroke();
  }
  if (reloadU < 1) {
    c.strokeStyle = BRAND_BLUE;
    c.lineWidth = 3;
    c.beginPath();
    c.arc(0, 0, 17, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * reloadU);
    c.stroke();
  }
  c.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawHoverTag(c, ship, text) {
  c.save();
  c.font = '600 12px "IBM Plex Sans", "Segoe UI", system-ui, sans-serif';
  const w = c.measureText(text).width + 18;
  const x = Math.min(window.innerWidth - w / 2 - 8, Math.max(w / 2 + 8, ship.x));
  const y = ship.y - 96 * ship.scale;
  c.fillStyle = "rgba(8,12,20,0.78)";
  c.strokeStyle = BRAND_BLUE;
  c.lineWidth = 1;
  roundRect(c, x - w / 2, y - 14, w, 22, 11);
  c.fill();
  c.stroke();
  c.fillStyle = "#eef3fa";
  c.textAlign = "center";
  c.fillText(text, x, y + 1);
  c.restore();
}

function drawWater(c, w, h, t, opts = {}) {
  const dense = !!opts.dense;
  c.save();
  const g = c.createLinearGradient(0, 0, 0, h);
  if (dense) {
    g.addColorStop(0, "#12304a");
    g.addColorStop(0.42, "#0c3d52");
    g.addColorStop(1, "#062033");
  } else {
    g.addColorStop(0, "rgba(8, 18, 36, 0.05)");
    g.addColorStop(0.4, "rgba(6, 20, 40, 0.1)");
    g.addColorStop(1, "rgba(3, 12, 28, 0.32)");
  }
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  if (dense) {
    const sheen = c.createLinearGradient(0, h * 0.15, 0, h * 0.72);
    sheen.addColorStop(0, "rgba(120, 196, 214, 0)");
    sheen.addColorStop(0.5, "rgba(150, 214, 220, 0.08)");
    sheen.addColorStop(1, "rgba(120, 196, 214, 0)");
    c.fillStyle = sheen;
    c.fillRect(0, 0, w, h);
  }
  c.fillStyle = dense ? "#d5f4ff" : "#b7d7ff";
  const blobs = dense ? 7 : 3;
  for (let i = 0; i < blobs; i++) {
    const drift = t * (dense ? 0.012 : 0.00035);
    const cx = ((w * (0.08 + i * 0.14) + Math.sin(drift + i) * (dense ? 70 : 40)) % w + w) % w;
    const cy = h * (0.16 + (i % 4) * 0.18) + Math.cos(drift * 0.8 + i) * (dense ? 18 : 14);
    c.globalAlpha = dense ? 0.05 + (i % 3) * 0.02 : 0.035;
    c.beginPath();
    c.ellipse(cx, cy, dense ? 110 : 78, dense ? 16 : 14, 0.12 + i * 0.04, 0, Math.PI * 2);
    c.fill();
  }
  const rows = dense ? 16 : 8;
  c.strokeStyle = dense ? "#c5ecff" : "#9ec9ff";
  c.lineWidth = dense ? 1.35 : 1;
  for (let i = 0; i < rows; i++) {
    const y = (h / (rows + 1)) * (i + 1);
    const crest = dense && i % 3 === 0;
    c.globalAlpha = dense ? (crest ? 0.28 : 0.12) + (i / rows) * 0.08 : 0.05 + (i / rows) * 0.07;
    c.lineWidth = crest ? 1.8 : dense ? 1.15 : 1;
    c.beginPath();
    const step = dense ? 22 : 28;
    for (let x = 0; x <= w; x += step) {
      const swell = Math.sin(x * 0.012 + t * 0.0011 + i * 0.65) * (dense ? 5.5 : 2.2);
      const chop = Math.sin(x * 0.041 - t * 0.0018 + i) * (dense ? 1.6 : 0);
      const yy = y + swell + chop + (i % 3);
      if (x === 0) c.moveTo(x, yy);
      else c.lineTo(x, yy);
    }
    c.stroke();
  }
  if (dense) {
    c.fillStyle = "#f4fbff";
    for (let i = 0; i < 28; i++) {
      const fx = ((i * 97 + t * 0.02) % w + w) % w;
      const fy = ((i * 53 + Math.sin(t * 0.001 + i) * 24) % h + h) % h;
      c.globalAlpha = 0.12 + (i % 5) * 0.03;
      c.fillRect(fx, fy, i % 4 === 0 ? 7 : 3, 1.4);
    }
  }
  c.restore();
}

function fadeAlpha(h) {
  const u = h.max > 0 ? h.life / h.max : 1;
  if (u < 0.12) return u / 0.12;
  if (u > 0.82) return Math.max(0, (1 - u) / 0.18);
  return 1;
}

function drawSinkhole(c, h, t) {
  c.save();
  c.translate(h.x, h.y);
  c.rotate((h.phase || 0) * 0.6);
  c.globalAlpha = 0.95 * fadeAlpha(h);
  const rx = h.r * 1.05;
  const ry = h.r * 0.46;
  c.fillStyle = "rgba(3, 8, 16, 0.78)";
  c.beginPath();
  c.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "rgba(170, 214, 235, 0.82)";
  c.lineWidth = 1.6;
  for (let i = 1; i <= 3; i++) {
    c.beginPath();
    c.ellipse(0, 0, rx * (0.28 + i * 0.22), ry * (0.28 + i * 0.22), 0, 0, Math.PI * 2);
    c.stroke();
  }
  c.strokeStyle = "rgba(230, 244, 255, 0.7)";
  c.lineWidth = 1.3;
  c.beginPath();
  c.ellipse(0, 0, rx * 0.62, ry * 0.62, 0.4, 0.15, Math.PI * 1.05);
  c.stroke();
  c.fillStyle = "rgba(1, 4, 10, 0.95)";
  c.beginPath();
  c.ellipse(0, 0, rx * 0.16, ry * 0.16, 0, 0, Math.PI * 2);
  c.fill();
  void t;
  c.restore();
}

function drawMegalodon(c, h) {
  const dir = h.vx >= 0 ? 1 : -1;
  c.save();
  c.translate(h.x, h.y);
  c.globalAlpha = 0.92 * fadeAlpha(h);
  c.scale(dir, 1);
  c.fillStyle = "rgba(8, 24, 40, 0.45)";
  c.beginPath();
  c.ellipse(0, 8, 54, 16, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#16324a";
  c.beginPath();
  c.ellipse(-4, 4, 46, 14, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#0e2436";
  c.beginPath();
  c.moveTo(-36, 4);
  c.lineTo(-62, -6);
  c.lineTo(-62, 14);
  c.closePath();
  c.fill();
  c.fillStyle = "#d7e6f2";
  c.beginPath();
  c.moveTo(8, -8);
  c.lineTo(18, -34);
  c.lineTo(24, -6);
  c.closePath();
  c.fill();
  c.fillStyle = "#e8eef4";
  c.beginPath();
  c.moveTo(20, 6);
  c.lineTo(46, 2);
  c.lineTo(20, 12);
  c.closePath();
  c.fill();
  c.fillStyle = "#9fd0ff";
  c.beginPath();
  c.arc(24, 2, 2.2, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function drawReef(c, h) {
  c.save();
  c.translate(h.x, h.y);
  c.globalAlpha = 0.9 * fadeAlpha(h);
  c.fillStyle = "#3e4650";
  c.strokeStyle = "rgba(220, 230, 240, 0.45)";
  c.lineWidth = 1.2;
  const r = h.r;
  c.beginPath();
  c.moveTo(-r * 0.8, 6);
  c.lineTo(-r * 0.4, -r * 0.45);
  c.lineTo(-r * 0.05, 4);
  c.lineTo(r * 0.25, -r * 0.7);
  c.lineTo(r * 0.55, 2);
  c.lineTo(r * 0.85, -r * 0.25);
  c.lineTo(r * 0.7, 10);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();
}

function drawMine(c, h, t) {
  const blink = h.max - h.life < 4 ? 0.45 + 0.55 * Math.abs(Math.sin(t * 0.01)) : 1;
  c.save();
  c.translate(h.x, h.y + Math.sin((h.phase || 0) * 2) * 2);
  c.globalAlpha = blink * fadeAlpha(h);
  c.strokeStyle = "#8d97a3";
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(0, -16);
  c.lineTo(0, -8);
  c.stroke();
  c.fillStyle = "#2a313a";
  c.beginPath();
  c.arc(0, 0, 9, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "#d0d6de";
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    c.beginPath();
    c.moveTo(Math.cos(a) * 8, Math.sin(a) * 8);
    c.lineTo(Math.cos(a) * 14, Math.sin(a) * 14);
    c.stroke();
  }
  c.fillStyle = "#ff5a4a";
  c.beginPath();
  c.arc(0, 0, 2.4, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function drawEvent(c, ev, t) {
  if (!ev) return;
  if (ev.kind === "fog") {
    c.save();
    c.translate(ev.x, ev.y);
    const a = 0.22 * (ev.max ? Math.min(1, ev.life / 0.4) : 1);
    const g = c.createRadialGradient(0, 0, ev.r * 0.2, 0, 0, ev.r);
    g.addColorStop(0, `rgba(214, 224, 232, ${a + 0.12})`);
    g.addColorStop(1, "rgba(214, 224, 232, 0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, ev.r, 0, Math.PI * 2);
    c.fill();
    c.restore();
    return;
  }
  if (ev.kind === "squall") {
    c.save();
    c.strokeStyle = "rgba(190, 220, 255, 0.45)";
    c.lineWidth = 1.2;
    const ang = Math.atan2(ev.vy || 0, ev.vx || 1);
    for (let i = 0; i < 14; i++) {
      const px = (ev.x || 0) + Math.cos(ang + 1.2) * (i * 28) + Math.sin(t * 0.004 + i) * 10;
      const py = (ev.y || 0) + Math.sin(ang + 1.2) * (i * 18);
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(px + Math.cos(ang) * 22, py + Math.sin(ang) * 10);
      c.stroke();
    }
    c.restore();
    return;
  }
  if (ev.kind === "barrage") {
    for (const shot of ev.shots || []) {
      const u = shot.boom ? 1 : Math.max(0, Math.min(1, ev.life / shot.arm));
      c.save();
      c.translate(shot.x, shot.y);
      c.globalAlpha = shot.boom ? 0.35 : 0.3 + u * 0.5;
      c.strokeStyle = shot.boom ? "#ffb15a" : "#ff5a4a";
      c.lineWidth = shot.boom ? 3 : 1.5;
      c.beginPath();
      c.arc(0, 0, shot.boom ? 18 : 10 + (1 - u) * 16, 0, Math.PI * 2);
      c.stroke();
      if (!shot.boom) {
        c.beginPath();
        c.moveTo(-6, 0);
        c.lineTo(6, 0);
        c.moveTo(0, -6);
        c.lineTo(0, 6);
        c.stroke();
      }
      c.restore();
    }
    return;
  }
  if (ev.kind === "kraken") {
    c.save();
    c.translate(ev.x, ev.y);
    c.strokeStyle = "#6e8f52";
    c.lineWidth = 5;
    c.lineCap = "round";
    c.globalAlpha = ev.slammed ? 0.45 : 0.9;
    c.beginPath();
    c.moveTo(-50, 30);
    c.quadraticCurveTo(-10, ev.slammed ? 8 : -28, 18, ev.slammed ? 6 : -6);
    c.stroke();
    c.fillStyle = "#24361c";
    c.beginPath();
    c.arc(18, ev.slammed ? 6 : -6, ev.slammed ? 16 : 8, 0, Math.PI * 2);
    c.fill();
    c.restore();
    return;
  }
  if (ev.kind === "supply") {
    const bob = Math.sin((t || 0) * 0.004 + (ev.x || 0)) * 3;
    c.save();
    c.translate(ev.x, ev.y + bob);
    c.fillStyle = "#6b3e22";
    c.fillRect(-12, -10, 24, 18);
    c.fillStyle = "#c9a36a";
    c.fillRect(-12, -10, 24, 4);
    c.strokeStyle = "#1a140f";
    c.strokeRect(-12, -10, 24, 18);
    c.fillStyle = "#f5c542";
    c.fillRect(-3, -6, 6, 8);
    c.restore();
  }
  void t;
}

function drawHazard(c, h, t) {
  switch (h.kind) {
    case "sinkhole":
      drawSinkhole(c, h, t);
      break;
    case "megalodon":
      drawMegalodon(c, h);
      break;
    case "reef":
      drawReef(c, h);
      break;
    default:
      drawMine(c, h, t);
      break;
  }
}

function drawBossPlate(c, width, height, label, hp, maxHp) {
  const bw = Math.min(460, Math.max(220, width * 0.42));
  const x = (width - bw) / 2;
  const y = Math.max(108, (height || 0) - 108);
  const p = Math.max(0, Math.min(1, maxHp > 0 ? hp / maxHp : 0));
  c.save();
  c.fillStyle = "rgba(8, 12, 18, 0.82)";
  c.fillRect(x, y, bw, 28);
  c.fillStyle = "#f5c542";
  c.fillRect(x, y, bw, 2);
  c.font = '700 13px "Barlow Condensed", "Oswald", "Arial Narrow", system-ui, sans-serif';
  c.fillStyle = "#f5c542";
  c.textAlign = "left";
  c.fillText(label || "Boss", x + 10, y + 18);
  c.fillStyle = "rgba(255,255,255,0.12)";
  c.fillRect(x + 10, y + 22, bw - 20, 4);
  c.fillStyle = p < 0.28 ? "#ff5a4a" : "#f5c542";
  c.fillRect(x + 10, y + 22, (bw - 20) * p, 4);
  c.restore();
}

module.exports = {
  SINK_SECONDS,
  drawShipFull,
  drawBall,
  drawLandingMarker,
  drawSplash,
  drawParticle,
  drawFloatText,
  drawPickup,
  drawReticle,
  drawHoverTag,
  drawWater,
  drawHazard,
  drawEvent,
  drawBossPlate,
};
