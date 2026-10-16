"use strict";

/** Canvas drawing for the pirate idle overlay (ships, flags, FX, water). */

const { BRAND_BLUE } = require("./idle-fleet");
const { FLAG_ICONS } = require("./idle-combat");

const SINK_SECONDS = 1.35;

function drawPixelShip(c) {
  c.fillStyle = "#3a2416";
  c.fillRect(-40, -6, 80, 22);
  c.fillStyle = "#6b3e22";
  c.fillRect(-36, -2, 72, 12);
  c.fillStyle = "#f2e6c8";
  c.fillRect(-6, -48, 8, 44);
  c.fillRect(-22, -40, 6, 34);
  c.fillRect(14, -36, 6, 30);
  // striped sails
  for (let i = 0; i < 5; i++) {
    c.fillStyle = i % 2 ? "#f4efe4" : "#c0392b";
    c.fillRect(-30 + i * 6, -44, 6, 28);
  }
  for (let i = 0; i < 4; i++) {
    c.fillStyle = i % 2 ? "#f4efe4" : "#c0392b";
    c.fillRect(10 + i * 5, -34, 5, 22);
  }
  c.fillStyle = "#111";
  c.fillRect(-4, -56, 14, 8);
  c.fillStyle = "#eee";
  c.fillRect(-1, -54, 3, 3);
  c.fillRect(4, -53, 5, 2);
  c.fillStyle = "#222";
  c.fillRect(28, 0, 14, 6);
  c.fillStyle = "#f5a623";
  c.fillRect(40, -2, 6, 6);
}

function drawSilhouetteShip(c) {
  c.fillStyle = "#0a0c10";
  c.beginPath();
  c.moveTo(-46, 4);
  c.quadraticCurveTo(-20, 18, 44, 6);
  c.lineTo(36, -4);
  c.lineTo(-40, -2);
  c.closePath();
  c.fill();
  c.fillRect(-4, -50, 3, 50);
  c.fillRect(-18, -40, 2, 38);
  c.fillRect(12, -36, 2, 34);
  c.fillStyle = BRAND_BLUE;
  c.beginPath();
  c.moveTo(-4, -48);
  c.lineTo(22, -36);
  c.lineTo(-4, -20);
  c.closePath();
  c.fill();
  c.globalAlpha = 0.85;
  c.beginPath();
  c.moveTo(-18, -38);
  c.lineTo(-2, -30);
  c.lineTo(-18, -18);
  c.closePath();
  c.fill();
  c.globalAlpha = 1;
  c.fillStyle = "#0a0c10";
  c.beginPath();
  c.moveTo(12, -34);
  c.lineTo(28, -26);
  c.lineTo(12, -16);
  c.closePath();
  c.fill();
}

function drawInkShip(c) {
  c.strokeStyle = "#1a140f";
  c.fillStyle = "#8a623d";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(-42, 2);
  c.quadraticCurveTo(0, 20, 42, 2);
  c.lineTo(34, -8);
  c.lineTo(-34, -6);
  c.closePath();
  c.fill();
  c.stroke();
  // hatch
  c.strokeStyle = "rgba(30,20,12,0.35)";
  c.lineWidth = 1;
  for (let i = -30; i < 30; i += 6) {
    c.beginPath();
    c.moveTo(i, -4);
    c.lineTo(i + 8, 10);
    c.stroke();
  }
  c.strokeStyle = "#1a140f";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(-2, -8);
  c.lineTo(-2, -52);
  c.stroke();
  c.fillStyle = "#efe6d2";
  c.beginPath();
  c.moveTo(-2, -50);
  c.quadraticCurveTo(18, -40, 20, -28);
  c.quadraticCurveTo(8, -24, -2, -22);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = "#111";
  c.beginPath();
  c.moveTo(-2, -52);
  c.lineTo(12, -58);
  c.lineTo(12, -50);
  c.closePath();
  c.fill();
  c.fillStyle = "#c0392b";
  c.beginPath();
  c.arc(-10, -18, 4, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#222";
  c.fillRect(24, -4, 16, 5);
}

function drawNeonShip(c, id) {
  const glow = id % 2 === 0 ? "#2ef3ff" : "#ff3fd6";
  c.shadowColor = glow;
  c.shadowBlur = 12;
  c.strokeStyle = glow;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(-44, 2);
  c.quadraticCurveTo(0, 18, 44, 2);
  c.lineTo(34, -8);
  c.lineTo(-34, -6);
  c.closePath();
  c.stroke();
  c.beginPath();
  c.moveTo(-2, -6);
  c.lineTo(-2, -50);
  c.moveTo(-16, -4);
  c.lineTo(-16, -38);
  c.moveTo(14, -4);
  c.lineTo(14, -34);
  c.stroke();
  c.beginPath();
  c.moveTo(-2, -48);
  c.lineTo(20, -34);
  c.lineTo(-2, -20);
  c.moveTo(-16, -36);
  c.lineTo(-2, -28);
  c.lineTo(-16, -18);
  c.moveTo(14, -32);
  c.lineTo(28, -24);
  c.lineTo(14, -16);
  c.stroke();
  c.shadowBlur = 0;
}


function drawShipSprite(c, ship) {
  switch (ship.style) {
    case "pixel":
      drawPixelShip(c);
      break;
    case "silhouette":
      drawSilhouetteShip(c);
      break;
    case "ink":
      drawInkShip(c);
      break;
    case "neon":
    default:
      drawNeonShip(c, ship.id);
      break;
  }
}

function drawFlag(c, ship, t) {
  const player = ship.role === "player";
  const wave = Math.sin(t * 0.006 + ship.id) * 1.3;
  c.save();
  c.translate(-2, -48);
  c.scale(1.4, 1.4);
  c.translate(2, 48);
  c.strokeStyle = "#16120e";
  c.lineWidth = 1.6;
  c.beginPath();
  c.moveTo(-2, -48);
  c.lineTo(-2, -69);
  c.stroke();
  c.beginPath();
  c.moveTo(-2, -69);
  c.lineTo(-19, -68 + wave);
  c.lineTo(-19, -57 + wave);
  c.lineTo(-2, -58);
  c.closePath();
  c.fillStyle = player ? BRAND_BLUE : "#0d1117";
  c.fill();
  c.strokeStyle = player ? "#ffffff" : "rgba(255,255,255,0.35)";
  c.lineWidth = 0.8;
  c.stroke();

  c.fillStyle = "#ffffff";
  const kind = player ? "coupe" : ship.flag || "skull";
  const icon = FLAG_ICONS[kind];
  if (icon) {
    const cell = 1.1;
    const x0 = -10.5 - (11 * cell) / 2;
    const y0 = -63.5 + wave * 0.5 - (4 * cell) / 2;
    for (let r = 0; r < icon.length; r++) {
      for (let q = 0; q < icon[r].length; q++) {
        if (icon[r][q] === "X") c.fillRect(x0 + q * cell, y0 + r * cell, cell + 0.15, cell + 0.15);
      }
    }
  } else {
    const cx = -10.5;
    const cy = -63.5 + wave * 0.5;
    c.beginPath();
    c.arc(cx, cy - 0.6, 2.6, 0, Math.PI * 2);
    c.fill();
    c.fillRect(cx - 1.4, cy + 1, 2.8, 1.6);
    c.fillStyle = "#0d1117";
    c.fillRect(cx - 1.6, cy - 1.3, 1.1, 1.1);
    c.fillRect(cx + 0.5, cy - 1.3, 1.1, 1.1);
  }
  c.restore();
}

function drawHpBar(c, x, y, w, hp, maxHp, color) {
  const pips = Math.max(1, Math.min(maxHp, 16));
  const gap = 1.5;
  const pw = (w - gap * (pips - 1)) / pips;
  c.save();
  c.fillStyle = "rgba(6,10,16,0.7)";
  c.fillRect(x - w / 2 - 2, y - 2, w + 4, 8);
  for (let i = 0; i < pips; i++) {
    c.fillStyle = i < hp ? color : "rgba(255,255,255,0.14)";
    c.fillRect(x - w / 2 + i * (pw + gap), y, pw, 4);
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

  c.save();
  c.globalAlpha = fade * 0.28;
  c.fillStyle = "#02060c";
  c.beginPath();
  c.ellipse(ship.x, ship.y + 17, 48 * s, 7 * s, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();

  if (ship.role === "player" && !sinking) {
    c.save();
    c.globalAlpha = 0.55 + Math.sin(opts.t * 0.004) * 0.2;
    c.strokeStyle = BRAND_BLUE;
    c.shadowColor = BRAND_BLUE;
    c.shadowBlur = 10;
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(ship.x, ship.y + 15, 56 * s, 10 * s, 0, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }

  c.save();
  c.globalAlpha = fade;
  c.translate(ship.x, y);
  c.scale(ship.facing * s, s * (sinking ? 0.85 : 1));
  c.rotate(ship.hpTilt);
  if (ship.gilded && !sinking) {
    c.shadowColor = "#f5c542";
    c.shadowBlur = 16;
  } else if (ship.style === "silhouette") {
    c.shadowColor = "rgba(90,170,255,0.9)";
    c.shadowBlur = 7;
  }
  if (ship.hit > 0) c.filter = "brightness(2.4) saturate(0.6)";
  drawShipSprite(c, ship);
  c.filter = "none";
  c.shadowBlur = 0;
  drawFlag(c, ship, opts.t);
  c.restore();

  if (opts.showHp && !sinking && ship.maxHp > 0) {
    const w = Math.min(70, 14 + ship.maxHp * 6) * Math.max(0.9, s);
    drawHpBar(
      c,
      ship.x,
      ship.y + bobY - 84 * s,
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
    c.shadowBlur = 10;
  }
  if (ball.side) {
    c.globalAlpha = 0.35;
    c.strokeStyle = glow;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(ball.px ?? ball.x, ball.py ?? ball.y);
    c.lineTo(ball.x, ball.y);
    c.stroke();
    c.globalAlpha = 1;
  }
  c.fillStyle = ball.style === "ink" && !ball.side ? "#111" : glow;
  c.beginPath();
  c.arc(ball.x, ball.y, ball.side ? 4 : ball.style === "pixel" ? 3.5 : 3, 0, Math.PI * 2);
  c.fill();
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
  c.globalAlpha = 0.25 + u * 0.55;
  c.strokeStyle = "#ff5a4a";
  c.lineWidth = 1.6;
  c.setLineDash([5, 4]);
  c.beginPath();
  c.ellipse(ball.x1, ball.y1 + 14, 12 + (1 - u) * 22, 5 + (1 - u) * 9, 0, 0, Math.PI * 2);
  c.stroke();
  c.setLineDash([]);
  c.globalAlpha = 0.18 + 0.12 * Math.sin(t * 0.02);
  c.fillStyle = "#ff5a4a";
  c.beginPath();
  c.ellipse(ball.x1, ball.y1 + 14, 12, 5, 0, 0, Math.PI * 2);
  c.fill();
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
      c.fillRect(p.x - 2, p.y - 2, 4, 4);
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

function drawWater(c, w, h, t) {
  c.save();
  c.globalAlpha = 0.22;
  const g = c.createLinearGradient(0, h * 0.55, 0, h);
  g.addColorStop(0, "transparent");
  g.addColorStop(1, "#06203a");
  c.fillStyle = g;
  c.fillRect(0, h * 0.55, w, h * 0.45);
  c.globalAlpha = 0.12;
  c.strokeStyle = "#9ec9ff";
  c.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const y = h * 0.62 + i * 14;
    c.beginPath();
    for (let x = 0; x <= w; x += 24) {
      const yy = y + Math.sin(x * 0.03 + t * 0.002 + i) * 3;
      if (x === 0) c.moveTo(x, yy);
      else c.lineTo(x, yy);
    }
    c.stroke();
  }
  c.globalAlpha = 0.07;
  for (let i = 0; i < 4; i++) {
    const y = h * 0.8 + i * 18;
    c.beginPath();
    for (let x = 0; x <= w; x += 28) {
      const yy = y + Math.sin(x * 0.02 - t * 0.0016 + i * 2) * 4;
      if (x === 0) c.moveTo(x, yy);
      else c.lineTo(x, yy);
    }
    c.stroke();
  }
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
};
