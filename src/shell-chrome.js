"use strict";

/**
 * Electron-shell chrome injected into the BrowserWindow (not the hosted shop site).
 * - Obvious "Check for updates" button → same shell updater path as the Shop menu
 * - Pirate idle overlay after 5 minutes without input; more ships every +5 minutes
 */

const {
  IDLE_INTERVAL_MS,
  MAX_SHIPS,
  BRAND_BLUE,
  shipsForIdleMs,
  growFleet,
} = require("./idle-fleet");

const ROOT_ID = "bf-tools-shell-root";

/**
 * @param {{
 *   checkForUpdates: () => Promise<unknown>,
 *   idleIntervalMs?: number,
 *   maxShips?: number,
 *   now?: () => number,
 * }} options
 */
function mountShellChrome(options) {
  const checkForUpdates = options.checkForUpdates;
  const idleIntervalMs = options.idleIntervalMs ?? IDLE_INTERVAL_MS;
  const maxShips = options.maxShips ?? MAX_SHIPS;
  const now = options.now ?? Date.now;

  if (typeof document === "undefined") {
    return { dispose() {} };
  }

  const existing = document.getElementById(ROOT_ID);
  if (existing) existing.remove();

  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.setAttribute("data-bf-tools-shell", "1");
  Object.assign(host.style, {
    all: "initial",
    position: "fixed",
    inset: "0",
    width: "0",
    height: "0",
    overflow: "visible",
    zIndex: "2147483646",
    pointerEvents: "none",
  });

  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .bar {
        position: fixed;
        top: 10px;
        right: 12px;
        z-index: 2147483646;
        pointer-events: auto;
        display: flex;
        gap: 8px;
        font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
      }
      .btn {
        appearance: none;
        border: 1px solid rgba(5, 130, 255, 0.55);
        background: rgba(12, 18, 28, 0.88);
        color: #f4f7fb;
        font: 650 12px/1 "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
        letter-spacing: 0.04em;
        padding: 8px 12px;
        border-radius: 6px;
        cursor: pointer;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
        backdrop-filter: blur(6px);
      }
      .btn:hover { background: ${BRAND_BLUE}; border-color: ${BRAND_BLUE}; }
      .btn:active { transform: translateY(1px); }
      .btn:disabled { opacity: 0.65; cursor: wait; }
      .btn:focus-visible {
        outline: 2px solid ${BRAND_BLUE};
        outline-offset: 2px;
      }
      .overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483645;
        pointer-events: auto;
        display: none;
        background:
          radial-gradient(ellipse 120% 60% at 50% 100%, rgba(8, 18, 36, 0.55), transparent 70%),
          linear-gradient(180deg, rgba(4, 8, 16, 0.15), rgba(4, 8, 16, 0.45));
        cursor: default;
      }
      .overlay.on { display: block; }
      canvas {
        width: 100%;
        height: 100%;
        display: block;
      }
      .hint {
        position: absolute;
        left: 50%;
        bottom: 18px;
        transform: translateX(-50%);
        margin: 0;
        padding: 6px 12px;
        border-radius: 999px;
        background: rgba(8, 12, 20, 0.55);
        color: rgba(235, 240, 248, 0.85);
        font: 500 12px/1.3 "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
        letter-spacing: 0.02em;
        pointer-events: none;
        white-space: nowrap;
      }
    </style>
    <div class="bar">
      <button type="button" class="btn" part="updates" title="Check for desktop app updates">
        Check for updates
      </button>
    </div>
    <div class="overlay" aria-hidden="true">
      <canvas></canvas>
      <p class="hint">Move the mouse or press a key to return to the shop</p>
    </div>
  `;

  const updateBtn = shadow.querySelector(".btn");
  const overlay = shadow.querySelector(".overlay");
  const canvas = shadow.querySelector("canvas");
  const ctx = canvas.getContext("2d", { alpha: true });

  /** @type {Array<Ship>} */
  let fleet = [];
  /** @type {Array<Ball>} */
  let balls = [];
  /** @type {Array<Splash>} */
  let splashes = [];
  let lastActivity = now();
  let appActive = typeof document === "undefined" ? true : !document.hidden;
  let windowFocused = true;
  let raf = 0;
  let tickTimer = 0;
  let lastFrame = 0;
  let fireCooldown = 0;
  let disposed = false;
  let checkingUpdates = false;

  /**
   * @typedef {{
   *   id: number,
   *   style: string,
   *   x: number,
   *   y: number,
   *   facing: number,
   *   bob: number,
   *   bobSpeed: number,
   *   list: number,
   *   hpTilt: number,
   *   scale: number,
   * }} Ship
   * @typedef {{
   *   x: number, y: number,
   *   x0: number, y0: number, x1: number, y1: number,
   *   t: number, dur: number,
   *   from: number, to: number,
   *   hit: boolean,
   *   style: string,
   * }} Ball
   * @typedef {{ x: number, y: number, t: number, style: string }} Splash
   */

  let nextShipId = 1;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function idleRunning() {
    return appActive && windowFocused;
  }

  function resetIdle(dismiss) {
    lastActivity = now();
    if (dismiss && fleet.length) {
      fleet = [];
      balls = [];
      splashes = [];
      overlay.classList.remove("on");
      overlay.setAttribute("aria-hidden", "true");
      stopLoop();
    }
  }

  function placeShip(style, index, total) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const bandTop = h * 0.42;
    const bandH = h * 0.38;
    const col = index % 4;
    const row = Math.floor(index / 4);
    const x = w * (0.14 + col * 0.22) + (index % 2 ? 18 : -12);
    const y = bandTop + row * (bandH * 0.35) + (index * 17) % 40;
    const facing = x < w * 0.5 ? 1 : -1;
    return {
      id: nextShipId++,
      style,
      x: Math.min(w - 80, Math.max(80, x)),
      y: Math.min(h - 70, Math.max(bandTop, y)),
      facing,
      bob: Math.random() * Math.PI * 2,
      bobSpeed: 1.1 + Math.random() * 0.8,
      list: 0,
      hpTilt: 0,
      scale: 0.85 + Math.random() * 0.25,
    };
  }

  function syncFleet() {
    if (!idleRunning()) return;
    const idleMs = now() - lastActivity;
    const target = shipsForIdleMs(idleMs, { intervalMs: idleIntervalMs, maxShips });
    if (target <= fleet.length) return;

    const before = fleet.length;
    const grown = growFleet(
      fleet.map((s) => ({ style: s.style })),
      target,
    );
    for (let i = before; i < grown.length; i++) {
      fleet.push(placeShip(grown[i].style, i, grown.length));
    }
    if (fleet.length && !overlay.classList.contains("on")) {
      overlay.classList.add("on");
      overlay.setAttribute("aria-hidden", "false");
      resize();
      startLoop();
    }
  }

  function stopLoop() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    lastFrame = 0;
  }

  function startLoop() {
    if (raf || disposed || !fleet.length || !idleRunning()) return;
    lastFrame = 0;
    const frame = (ts) => {
      raf = 0;
      if (disposed || !fleet.length) return;
      if (!idleRunning()) return;
      const t = typeof ts === "number" ? ts : now();
      const dt = Math.min(0.05, lastFrame ? (t - lastFrame) / 1000 : 0.016);
      lastFrame = t;
      step(dt);
      draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  function step(dt) {
    fireCooldown -= dt;
    for (const ship of fleet) {
      ship.bob += ship.bobSpeed * dt;
      if (ship.list > 0) {
        ship.list = Math.max(0, ship.list - dt);
        ship.hpTilt = Math.sin(ship.list * 14) * 0.22 * (ship.list > 0.15 ? 1 : ship.list / 0.15);
      } else {
        ship.hpTilt *= 0.9;
      }
    }

    if (fleet.length >= 2 && fireCooldown <= 0) {
      fireCooldown = 1.1 + Math.random() * 1.4;
      maybeFire();
    }

    const nextBalls = [];
    for (const ball of balls) {
      ball.t += dt;
      const u = Math.min(1, ball.t / ball.dur);
      const arc = Math.sin(u * Math.PI) * (40 + Math.abs(ball.x1 - ball.x0) * 0.12);
      ball.x = ball.x0 + (ball.x1 - ball.x0) * u;
      ball.y = ball.y0 + (ball.y1 - ball.y0) * u - arc;
      if (u < 1) {
        nextBalls.push(ball);
        continue;
      }
      if (ball.hit) {
        const target = fleet.find((s) => s.id === ball.to);
        if (target) {
          target.list = 0.85 + Math.random() * 0.4;
        }
      } else {
        splashes.push({ x: ball.x1, y: ball.y1 + 10, t: 0, style: ball.style });
      }
    }
    balls = nextBalls;

    const nextSplash = [];
    for (const splash of splashes) {
      splash.t += dt;
      if (splash.t < 0.7) nextSplash.push(splash);
    }
    splashes = nextSplash;
  }

  function maybeFire() {
    if (fleet.length < 2) return;
    let a = (Math.random() * fleet.length) | 0;
    let b = (Math.random() * fleet.length) | 0;
    if (a === b) b = (b + 1) % fleet.length;
    const from = fleet[a];
    const to = fleet[b];
    const hit = Math.random() < 0.38;
    const x0 = from.x + from.facing * 36;
    const y0 = from.y - 8;
    const x1 = hit ? to.x - to.facing * 10 : to.x + (Math.random() - 0.5) * 90;
    const y1 = hit ? to.y : to.y + 28 + Math.random() * 24;
    balls.push({
      x: x0,
      y: y0,
      x0,
      y0,
      x1,
      y1,
      t: 0,
      dur: 0.75 + Math.random() * 0.35,
      from: from.id,
      to: to.id,
      hit,
      style: from.style,
    });
  }

  function drawShip(ship) {
    const y = ship.y + Math.sin(ship.bob) * 4;
    ctx.save();
    ctx.translate(ship.x, y);
    ctx.scale(ship.facing * ship.scale, ship.scale);
    ctx.rotate(ship.hpTilt);

    switch (ship.style) {
      case "pixel":
        drawPixelShip(ctx);
        break;
      case "silhouette":
        drawSilhouetteShip(ctx);
        break;
      case "ink":
        drawInkShip(ctx);
        break;
      case "neon":
      default:
        drawNeonShip(ctx, ship.id);
        break;
    }
    ctx.restore();
  }

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

  function drawBall(ball) {
    const glow =
      ball.style === "neon" ? (ball.from % 2 === 0 ? "#2ef3ff" : "#ff3fd6") :
      ball.style === "silhouette" ? BRAND_BLUE :
      ball.style === "pixel" ? "#f5a623" :
      "#1a140f";
    ctx.save();
    if (ball.style === "neon" || ball.style === "silhouette") {
      ctx.shadowColor = glow;
      ctx.shadowBlur = 10;
    }
    ctx.fillStyle = ball.style === "ink" ? "#111" : glow;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.style === "pixel" ? 3.5 : 3, 0, Math.PI * 2);
    ctx.fill();
    if (ball.style === "ink") {
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(ball.x0, ball.y0);
      const mx = (ball.x0 + ball.x1) / 2;
      const my = (ball.y0 + ball.y1) / 2 - 36;
      ctx.quadraticCurveTo(mx, my, ball.x, ball.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawSplash(splash) {
    const u = splash.t / 0.7;
    ctx.save();
    ctx.translate(splash.x, splash.y);
    ctx.strokeStyle =
      splash.style === "neon" ? "rgba(46,243,255,0.7)" :
      splash.style === "silhouette" ? "rgba(5,130,255,0.55)" :
      "rgba(220,230,245,0.65)";
    ctx.lineWidth = splash.style === "ink" ? 1.5 : 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 6 + u * 16, 0, Math.PI * 2);
    ctx.stroke();
    if (splash.style === "ink" || splash.style === "pixel") {
      ctx.beginPath();
      ctx.arc(0, 0, 3 + u * 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWaterHint() {
    const h = window.innerHeight;
    const w = window.innerWidth;
    ctx.save();
    ctx.globalAlpha = 0.22;
    const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
    g.addColorStop(0, "transparent");
    g.addColorStop(1, "#06203a");
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "#9ec9ff";
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const y = h * 0.62 + i * 14;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 24) {
        const yy = y + Math.sin(x * 0.03 + now() * 0.002 + i) * 3;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    drawWaterHint();
    for (const ship of fleet) drawShip(ship);
    for (const ball of balls) drawBall(ball);
    for (const splash of splashes) drawSplash(splash);
  }

  function onActivity() {
    resetIdle(true);
  }

  function onVisibility() {
    appActive = !document.hidden;
    if (!appActive) {
      stopLoop();
      return;
    }
    if (fleet.length) startLoop();
  }

  function onFocus() {
    windowFocused = true;
    if (fleet.length) startLoop();
  }

  function onBlur() {
    windowFocused = false;
    stopLoop();
  }

  async function onUpdateClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (checkingUpdates) return;
    checkingUpdates = true;
    updateBtn.disabled = true;
    try {
      await checkForUpdates();
    } finally {
      checkingUpdates = false;
      updateBtn.disabled = false;
    }
  }

  const activityEvents = [
    "mousemove",
    "mousedown",
    "mouseup",
    "wheel",
    "keydown",
    "keyup",
    "pointerdown",
    "pointermove",
    "touchstart",
    "touchmove",
    "scroll",
  ];

  for (const name of activityEvents) {
    window.addEventListener(name, onActivity, { passive: true, capture: true });
  }
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  window.addEventListener("resize", resize);
  updateBtn.addEventListener("click", onUpdateClick);
  // Clicks on the overlay also count as activity (dismiss).
  overlay.addEventListener("pointerdown", onActivity, { capture: true });

  // Button clicks should not count as "idle dismiss only" before invoke — but they
  // are real user input, so resetting idle is correct.
  updateBtn.addEventListener(
    "pointerdown",
    (event) => {
      event.stopPropagation();
      resetIdle(true);
    },
    true,
  );

  const parent = document.documentElement || document.body;
  parent.appendChild(host);

  let pauseStarted = 0;
  tickTimer = window.setInterval(() => {
    if (disposed) return;
    if (!idleRunning()) {
      if (!pauseStarted) pauseStarted = now();
      return;
    }
    if (pauseStarted) {
      lastActivity += now() - pauseStarted;
      pauseStarted = 0;
    }
    syncFleet();
  }, 1000);

  resize();

  return {
    dispose() {
      disposed = true;
      window.clearInterval(tickTimer);
      stopLoop();
      for (const name of activityEvents) {
        window.removeEventListener(name, onActivity, { capture: true });
      }
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", resize);
      updateBtn.removeEventListener("click", onUpdateClick);
      host.remove();
    },
    /** @internal test helpers */
    _test: {
      syncFleet,
      get fleet() {
        return fleet;
      },
      setLastActivity(ts) {
        lastActivity = ts;
      },
      get overlayOn() {
        return overlay.classList.contains("on");
      },
    },
  };
}

module.exports = {
  mountShellChrome,
  ROOT_ID,
};
