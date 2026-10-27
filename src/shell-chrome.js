"use strict";

/**
 * Electron-shell chrome injected into the BrowserWindow (not the hosted shop site).
 * - Pirate idle overlay after 5 minutes without input; more ships every +5 minutes
 * - Ships sail, fire, collide, and sink; sunk hulls respawn toward the idle target.
 *   Idle-only people get this forever: no prompts, no pressure to play.
 * - Pirate combat (opt-in): click a ship to take the helm. WASD sails the whole
 *   window (A is screen-left), click fires. Waves escalate, bosses every 5th
 *   wave, random hazards (sinkhole, megalodon, reef, mine).
 *   Overlay dismisses on a click on empty water only (never hover, never keys).
 * - Settings menu launcher (launchGame) opens the overlay and takes the helm at once.
 * - A sunk run posts to the shop pirate boards (day, week, month, and this
 *   Tools revision) for the signed-in desk person. The death screen shows them.
 * Desktop updates live in the native Settings menu (not an in-page header button).
 *
 * Idle accumulates while the page is visible (not document.hidden). Window blur/focus
 * must not freeze the clock - desk Tools often sits on a second monitor unfocused, and
 * the always-visible menu bar can blur webContents without the user noticing.
 */

const {
  IDLE_INTERVAL_MS,
  MAX_SHIPS,
  SHIP_HP,
  BRAND_BLUE,
  pickShipStyle,
  shipsForIdleMs,
  growFleet,
  pickSailMotion,
  stepShipSail,
  applyCannonHit,
  stepShipSink,
  shipsCollide,
} = require("./idle-fleet");
const combat = require("./idle-combat");
const fxlib = require("./idle-fx");
const art = require("./idle-art");
const pirateBoard = require("./pirate-board");

const ROOT_ID = "bf-tools-shell-root";

/** Hulls on the water when the game is launched from Settings (one yours, the rest hostile). */
const LAUNCH_FLEET = 3;

const MAX_CANVAS_PIXELS = 8_500_000;

const HINT_AMBIENT = "Click to return to the shop";
const HINT_PLAY = "WASD sails the whole sea · A is left · Click to fire · Space nearest · Esc stands down";

/** Screen-space helm. A / ArrowLeft moves left. Never inverted. */
const KEY_MAP = Object.freeze({
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
});

/**
 * @param {{
 *   idleIntervalMs?: number,
 *   maxShips?: number,
 *   now?: () => number,
 *   storage?: Storage | null,
 *   onError?: (error: unknown) => void,
 *   onStatus?: (info: { event: string, reason?: string }) => void,
 *   launchOnly?: boolean,
 *   submitPirateScore?: (run: { score: number, wave: number, sunk: number }) => Promise<unknown>,
 * }} [options]
 */
function mountShellChrome(options = {}) {
  const onError = typeof options.onError === "function" ? options.onError : null;
  const onStatus = typeof options.onStatus === "function" ? options.onStatus : null;
  /** When true (shell overlay / dedicated window), dismiss + stand-down close the session. */
  const launchOnly = !!options.launchOnly;
  function reportIdleError(error) {
    try {
      if (onError) onError(error);
    } catch {
      // reporting must never throw
    }
  }
  function reportStatus(event, reason) {
    try {
      if (onStatus) onStatus({ event, reason: reason || "" });
    } catch {
      // reporting must never throw
    }
  }
  const idleIntervalMs = options.idleIntervalMs ?? IDLE_INTERVAL_MS;
  const maxShips = options.maxShips ?? MAX_SHIPS;
  const now = options.now ?? Date.now;

  if (typeof document === "undefined") {
    return {
      launchGame() {
        return { ok: false, reason: "no-document" };
      },
      dispose() {},
      disabled: true,
      _test: {},
    };
  }

  let storage = options.storage;
  if (storage === undefined) {
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
  }

  const existing = document.getElementById(ROOT_ID);
  if (existing) existing.remove();

  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.setAttribute("data-bf-tools-shell", "1");
  // Full viewport host pinned in CSS pixels (not % / inset alone): shop-page
  // transform/filter can make position:fixed use a non-viewport containing
  // block. Pixel sizing + documentElement attachment keep the overlay covering
  // the window; shell-level WebContentsView is the fallback if this still clips.
  Object.assign(host.style, {
    all: "initial",
    display: "block",
    position: "fixed",
    left: "0px",
    top: "0px",
    right: "auto",
    bottom: "auto",
    width: "100vw",
    height: "100vh",
    margin: "0",
    padding: "0",
    border: "0",
    overflow: "visible",
    zIndex: "2147483646",
    pointerEvents: "none",
    isolation: "isolate",
    contain: "layout style",
  });

  /** Keep the host a direct child of <html> (outside typical SPA body transforms). */
  function ensureHostAttached() {
    const root = document.documentElement;
    if (!root) return false;
    if (host.parentNode !== root) root.appendChild(host);
    else if (root.lastElementChild !== host) root.appendChild(host);
    return true;
  }

  /** Pin host box to the visual viewport in CSS pixels (survives % containing blocks). */
  function pinHostToViewport() {
    const w = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const h = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    host.style.left = "0px";
    host.style.top = "0px";
    host.style.width = `${w}px`;
    host.style.height = `${h}px`;
    return { w, h };
  }

  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      .overlay {
        --ink: #0b0f14;
        --blue: ${BRAND_BLUE};
        --line: rgba(255, 255, 255, 0.14);
        position: fixed;
        inset: 0;
        z-index: 2147483645;
        pointer-events: auto;
        display: none;
        background:
          radial-gradient(ellipse 120% 60% at 50% 100%, rgba(8, 18, 36, 0.55), transparent 70%),
          linear-gradient(180deg, rgba(4, 8, 16, 0.15), rgba(4, 8, 16, 0.45));
        cursor: default;
        font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
        color: #eef3fa;
        user-select: none;
        -webkit-user-select: none;
      }
      .overlay.on {
        display: block;
        /* Own compositor layer: avoids Windows DWM tearing when the shop page
           underneath repaints through a translucent fullscreen overlay. */
        transform: translateZ(0);
        backface-visibility: hidden;
      }
      .overlay.play {
        background:
          radial-gradient(ellipse 120% 60% at 50% 100%, rgba(8, 18, 36, 0.7), transparent 70%),
          linear-gradient(180deg, rgba(4, 8, 16, 0.3), rgba(4, 8, 16, 0.6));
      }
      .overlay.play canvas.live { cursor: none; }
      canvas { width: 100%; height: 100%; display: block; }
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
      .hud { position: absolute; inset: 0; pointer-events: none; }
      .panel {
        position: absolute;
        top: 16px;
        padding: 10px 14px;
        background: rgba(11, 15, 20, 0.78);
        border: 1px solid var(--line);
        border-top: 2px solid var(--blue);
        border-radius: 4px;
      }
      .panel.left { left: 16px; width: 230px; }
      .panel.mid { left: 50%; transform: translateX(-50%); text-align: center; min-width: 190px; }
      .cond {
        font-family: "Barlow Condensed", "Oswald", "Arial Narrow", system-ui, sans-serif;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .ship-name { font-size: 17px; font-weight: 700; margin-bottom: 8px; }
      .bar {
        position: relative;
        height: 10px;
        background: rgba(255, 255, 255, 0.12);
        border-radius: 2px;
        overflow: hidden;
      }
      .bar + .bar { margin-top: 6px; height: 5px; }
      .bar i { display: block; height: 100%; background: var(--blue); width: 0; transition: width 0.12s linear; }
      .bar.low i { background: #ff5a4a; }
      .bar.reload i { background: #cfe3ff; transition: none; }
      .bar-label { margin-top: 5px; font-size: 11px; color: rgba(235, 240, 248, 0.7); }
      .wave { font-size: 13px; letter-spacing: 0.16em; color: rgba(235, 240, 248, 0.7); }
      .score { font-size: 32px; font-weight: 700; line-height: 1.05; }
      .combo { font-size: 15px; min-height: 18px; color: #f5c542; font-weight: 700; }
      .best { font-size: 11px; letter-spacing: 0.12em; color: rgba(235, 240, 248, 0.55); }
      button {
        pointer-events: auto;
        font: inherit;
        color: inherit;
        cursor: pointer;
      }
      .stand {
        position: absolute;
        top: 16px;
        right: 16px;
        padding: 9px 14px;
        background: rgba(11, 15, 20, 0.78);
        border: 1px solid var(--line);
        border-radius: 4px;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .stand:hover, .stand:focus-visible { border-color: var(--blue); outline: none; }
      kbd {
        font: 600 11px/1 "IBM Plex Sans", system-ui, sans-serif;
        padding: 2px 5px;
        margin-left: 6px;
        border: 1px solid var(--line);
        border-radius: 3px;
        color: rgba(235, 240, 248, 0.7);
      }
      .banner {
        position: absolute;
        top: 24%;
        left: 0;
        right: 0;
        text-align: center;
        pointer-events: none;
        opacity: 0;
      }
      .banner b { display: block; font-size: 64px; line-height: 1; text-shadow: 0 2px 18px rgba(0,0,0,0.6); }
      .banner.boss b { color: #ffb15a; }
      .banner span { display: block; margin-top: 6px; font-size: 18px; color: rgba(235,240,248,0.8); letter-spacing: 0.14em; }
      .banner.show { animation: bannerIn 2.2s ease-out forwards; }
      @keyframes bannerIn {
        0% { opacity: 0; transform: translateY(10px) scale(0.96); }
        12% { opacity: 1; transform: none; }
        72% { opacity: 1; }
        100% { opacity: 0; transform: translateY(-6px); }
      }
      .cards {
        position: absolute;
        left: 50%;
        bottom: 64px;
        transform: translateX(-50%);
        display: flex;
        gap: 12px;
        pointer-events: none;
      }
      .card {
        pointer-events: auto;
        width: 190px;
        padding: 14px 14px 16px;
        text-align: left;
        background: rgba(11, 15, 20, 0.88);
        border: 1px solid var(--line);
        border-top: 2px solid var(--blue);
        border-radius: 4px;
        transition: transform 0.12s ease, border-color 0.12s ease;
      }
      .card:hover, .card:focus-visible { transform: translateY(-3px); border-color: var(--blue); outline: none; }
      .card b { display: block; font-size: 20px; margin-bottom: 4px; }
      .card span { font-size: 13px; color: rgba(235, 240, 248, 0.75); }
      .cards-title {
        position: absolute;
        left: 0; right: 0;
        bottom: 200px;
        text-align: center;
        font-size: 15px;
        letter-spacing: 0.18em;
        color: rgba(235,240,248,0.8);
        pointer-events: none;
      }
      .wreck {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        min-width: min(860px, calc(100vw - 36px));
        max-width: calc(100vw - 36px);
        padding: 26px 30px 24px;
        text-align: center;
        background: rgba(11, 15, 20, 0.9);
        border: 1px solid var(--line);
        border-top: 3px solid var(--blue);
        border-radius: 4px;
        pointer-events: auto;
      }
      .wreck h2 { margin: 0 0 4px; font-size: 44px; line-height: 1; }
      .wreck .big { font-size: 38px; font-weight: 700; margin: 10px 0 2px; }
      .wreck .meta { font-size: 14px; color: rgba(235,240,248,0.7); margin-bottom: 4px; }
      .wreck .new { color: #f5c542; font-weight: 700; min-height: 20px; }
      .wreck .row { display: flex; gap: 10px; justify-content: center; margin-top: 18px; }
      .wreck-boards { margin-top: 12px; }
      .board-note {
        margin: 0 0 8px;
        font-size: 13px;
        color: rgba(235,240,248,0.8);
      }
      .board-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        text-align: left;
      }
      .board {
        padding: 8px 8px 10px;
        background: rgba(255,255,255,0.04);
        border: 1px solid var(--line);
        border-radius: 4px;
        min-height: 92px;
      }
      .board h3 {
        margin: 0 0 6px;
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: rgba(235,240,248,0.65);
      }
      .board ol { margin: 0; padding: 0; list-style: none; }
      .board li {
        font-size: 12px;
        line-height: 1.35;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .board li.you { color: #f5c542; font-weight: 700; }
      .board p { margin: 0; font-size: 12px; color: rgba(235,240,248,0.55); }
      .btn {
        padding: 10px 18px;
        border-radius: 4px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.06);
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .btn.primary { background: var(--blue); border-color: var(--blue); }
      .btn:hover, .btn:focus-visible { filter: brightness(1.15); outline: none; }
      @media (max-width: 760px) {
        .panel.left { width: 170px; }
        .board-grid { grid-template-columns: 1fr 1fr; }
        .cards { flex-direction: column; bottom: 56px; }
        .card { width: 240px; }
        .cards-title { display: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .banner.show { animation-duration: 0.01s; }
      }
    </style>
    <div class="overlay" aria-hidden="true">
      <canvas></canvas>
      <div class="hud" hidden>
        <div class="panel left">
          <div class="ship-name cond"></div>
          <div class="bar hull"><i></i></div>
          <div class="bar reload"><i></i></div>
          <div class="bar-label hull-txt"></div>
        </div>
        <div class="panel mid cond">
          <div class="wave"></div>
          <div class="score"></div>
          <div class="combo"></div>
          <div class="best"></div>
        </div>
        <button class="stand cond" type="button">Stand down <kbd>Esc</kbd></button>
        <div class="banner cond"><b></b><span></span></div>
        <div class="cards-title cond" hidden>Pick a refit</div>
        <div class="cards cond" hidden></div>
        <div class="wreck" hidden>
          <h2 class="cond">Sunk</h2>
          <div class="meta wreck-ship"></div>
          <div class="big cond wreck-score"></div>
          <div class="meta wreck-meta"></div>
          <div class="new cond wreck-new"></div>
          <div class="wreck-boards"></div>
          <div class="row">
            <button class="btn primary cond again" type="button">Sail again</button>
            <button class="btn cond sea" type="button">Back to the sea</button>
          </div>
        </div>
      </div>
      <p class="hint">${HINT_AMBIENT}</p>
    </div>
  `;

  const overlay = shadow.querySelector(".overlay");
  const canvas = shadow.querySelector("canvas");
  let ctx = null;
  /** @returns {boolean} */
  function ensureCtx() {
    if (ctx) return true;
    try {
      ctx = canvas.getContext("2d", { alpha: true });
    } catch (error) {
      reportIdleError(error);
      ctx = null;
    }
    return !!ctx;
  }
  if (!ensureCtx()) {
    // GPU/driver quirks can withhold 2D at first paint; keep the host mounted and
    // retry on Settings → Launch pirate / the next idle tick instead of a silent stub.
    reportStatus("overlay-deferred", "canvas-2d-unavailable");
    reportIdleError(new Error("canvas-2d-unavailable at mount"));
  }
  const hint = shadow.querySelector(".hint");
  const hud = shadow.querySelector(".hud");
  const el = {
    name: shadow.querySelector(".ship-name"),
    hullBar: shadow.querySelector(".bar.hull"),
    hullFill: shadow.querySelector(".bar.hull i"),
    reloadFill: shadow.querySelector(".bar.reload i"),
    hullTxt: shadow.querySelector(".hull-txt"),
    wave: shadow.querySelector(".wave"),
    score: shadow.querySelector(".score"),
    combo: shadow.querySelector(".combo"),
    best: shadow.querySelector(".best"),
    stand: shadow.querySelector(".stand"),
    banner: shadow.querySelector(".banner"),
    bannerTitle: shadow.querySelector(".banner b"),
    bannerSub: shadow.querySelector(".banner span"),
    cards: shadow.querySelector(".cards"),
    cardsTitle: shadow.querySelector(".cards-title"),
    wreck: shadow.querySelector(".wreck"),
    wreckShip: shadow.querySelector(".wreck-ship"),
    wreckScore: shadow.querySelector(".wreck-score"),
    wreckMeta: shadow.querySelector(".wreck-meta"),
    wreckNew: shadow.querySelector(".wreck-new"),
    wreckBoards: shadow.querySelector(".wreck-boards"),
    again: shadow.querySelector(".again"),
    sea: shadow.querySelector(".sea"),
  };
  canvas.classList.add("live");

  /** @type {Array<any>} */
  let fleet = [];
  /** @type {Array<any>} */
  let balls = [];
  /** @type {Array<any>} */
  let splashes = [];
  /** @type {Array<any>} */
  let pickups = [];
  /** @type {Array<any>} */
  let hazards = [];
  const fx = fxlib.createFx();
  let lastActivity = now();
  let appActive = !document.hidden;
  let raf = 0;
  let tickTimer = 0;
  let lastFrame = 0;
  let fireCooldown = 0;
  let disposed = false;
  let failed = false;
  let nextShipId = 1;

  /** "ambient" = screensaver. "play" = optional pirate combat. */
  let mode = "ambient";
  let run = null;
  let save = combat.readSave(storage);
  let lastPlayerStyle = null;
  let lastPlayerName = null;
  let hudKey = "";

  const keys = { left: false, right: false, up: false, down: false };
  const pointer = { x: 0, y: 0, inside: false, down: false };
  let hoverId = 0;

  function resize() {
    ensureHostAttached();
    const pinned = pinHostToViewport();
    if (!ensureCtx()) return;
    const w = pinned.w;
    const h = pinned.h;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    // A 4K display at 2x is a ~33M-pixel canvas: enough to lose the GPU on weak Windows drivers.
    const area = w * h;
    if (area * dpr * dpr > MAX_CANVAS_PIXELS) dpr = Math.max(1, Math.sqrt(MAX_CANVAS_PIXELS / area));
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Re-pin + layout flush; used before visibility probes (Windows often reports 0×0 pre-paint). */
  function refreshLayout() {
    ensureHostAttached();
    pinHostToViewport();
    resize();
    try {
      void host.offsetWidth;
      void canvas.offsetWidth;
    } catch {
      // ignore
    }
  }

  /**
   * Clock + spawn. Do not require window focus (second-monitor desk Tools).
   * While the overlay is up, ignore document.hidden flaps — Windows DWM occlusion
   * / multi-monitor can mark the page "hidden" without the user leaving Tools.
   */
  function idleRunning() {
    if (failed) return false;
    if (overlay.classList.contains("on")) return true;
    return appActive;
  }

  /**
   * The pirate overlay is optional. If drawing/stepping ever throws, drop the overlay
   * and stop the loop so the shop underneath keeps working. Settings → Launch pirate
   * may recover (clears `failed` and retries the canvas).
   */
  function failIdle(error) {
    if (failed) return;
    failed = true;
    const message = error && error.message ? error.message : String(error || "unknown");
    reportStatus("overlay-aborted", `draw-failed:${message}`.slice(0, 200));
    reportIdleError(error);
    try {
      stopLoop();
      fleet = [];
      balls = [];
      splashes = [];
      pickups = [];
      mode = "ambient";
      run = null;
      overlay.classList.remove("on", "play");
      overlay.setAttribute("aria-hidden", "true");
      hud.hidden = true;
      // Drop a dead context so the next launch retries getContext.
      ctx = null;
    } catch {
      // best effort
    }
  }

  function resetIdle(dismiss) {
    lastActivity = now();
    if (dismiss && (fleet.length || overlay.classList.contains("on"))) {
      hoverId = 0;
      leavePlayState();
      fleet = [];
      balls = [];
      splashes = [];
      pickups = [];
      hazards = [];
      fxlib.clearFx(fx);
      overlay.classList.remove("on");
      overlay.setAttribute("aria-hidden", "true");
      stopLoop();
      reportStatus("overlay-dismissed", launchOnly ? "launch-only" : "idle");
    }
  }

  function waterBounds() {
    // Whole overlay is the sea — not a lower band.
    return combat.seaBounds(window.innerWidth, window.innerHeight);
  }

  function baseShip(style) {
    const motion = pickSailMotion();
    return {
      id: nextShipId++,
      style,
      role: "ambient",
      type: null,
      name: combat.pickShipName(),
      flag: combat.pickFlagKind(),
      gilded: false,
      x: 0,
      y: 0,
      facing: motion.facing,
      vx: motion.vx,
      vy: motion.vy || 0,
      aimVx: motion.aimVx,
      aimVy: motion.aimVy || 0,
      speed: motion.speed,
      turnTimer: motion.turnTimer,
      bob: Math.random() * Math.PI * 2,
      bobSpeed: 1.1 + Math.random() * 0.8,
      list: 0,
      hpTilt: 0,
      hp: SHIP_HP,
      maxHp: 0,
      sinking: 0,
      scale: 0.85 + Math.random() * 0.25,
      ramCool: 0,
      hit: 0,
      retire: 0,
      wakeT: 0,
      reloadT: 0,
      phase: Math.random() * 6,
      entering: false,
      enterDir: 1,
    };
  }

  function placeShip(style, index) {
    const bounds = waterBounds();
    const col = index % 4;
    const row = Math.floor(index / 4);
    const x = bounds.minX + (bounds.maxX - bounds.minX) * (0.12 + col * 0.22);
    const ySpan = Math.max(1, bounds.maxY - bounds.minY);
    const y = bounds.minY + ySpan * (0.16 + row * 0.2) + (index * 17) % 36;
    const ship = baseShip(style);
    ship.x = Math.min(bounds.maxX, Math.max(bounds.minX, x + (index % 2 ? 18 : -12)));
    ship.y = Math.min(bounds.maxY, Math.max(bounds.minY, y));
    return ship;
  }

  function showOverlay() {
    if (!fleet.length) return false;
    if (!ensureCtx()) {
      reportStatus("overlay-aborted", "canvas-2d-unavailable");
      return false;
    }
    ensureHostAttached();
    pinHostToViewport();
    if (!overlay.classList.contains("on")) {
      overlay.classList.add("on");
      overlay.setAttribute("aria-hidden", "false");
      // Overlay is up: treat as active even if Page Visibility says hidden.
      appActive = true;
      resize();
      startLoop();
      reportStatus("overlay-shown", mode);
    } else if (!raf) {
      startLoop();
    }
    return overlay.classList.contains("on");
  }

  function syncFleet() {
    if (!appActive && !overlay.classList.contains("on")) return;
    if (mode !== "ambient") return;
    const idleMs = now() - lastActivity;
    const target = shipsForIdleMs(idleMs, { intervalMs: idleIntervalMs, maxShips });
    if (target <= fleet.length) return;

    // Same recovery path as Settings → Launch pirate: a prior draw fault must not
    // permanently kill idle spawn on this page.
    if (failed) {
      ctx = null;
      if (!ensureCtx()) {
        reportStatus("idle-spawn-aborted", "canvas-2d-unavailable");
        return;
      }
      failed = false;
      reportStatus("idle-recovered", "cleared-failed-latch");
    } else if (!ensureCtx()) {
      reportStatus("idle-spawn-aborted", "canvas-2d-unavailable");
      return;
    }

    const before = fleet.length;
    const grown = growFleet(
      fleet.map((s) => ({ style: s.style })),
      target,
    );
    for (let i = before; i < grown.length; i++) {
      fleet.push(placeShip(grown[i].style, i));
    }
    if (!showOverlay()) {
      // Roll back ships if the overlay could not surface — avoid invisible fleet.
      fleet = fleet.slice(0, before);
      reportStatus("idle-spawn-aborted", "overlay-not-shown");
    } else if (before === 0) {
      reportStatus("idle-spawn", `ships=${fleet.length}`);
    }
  }

  function stopLoop() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    lastFrame = 0;
  }

  // Ambient screensaver does not need 60fps; capping cuts GPU/compositor load on
  // Windows (large translucent canvas over the shop page) and reduces flicker.
  const AMBIENT_FRAME_MS = 1000 / 30;

  function startLoop() {
    if (raf || disposed || !fleet.length || failed) return;
    if (!ensureCtx()) return;
    // Overlay-on always runs; otherwise respect Page Visibility.
    if (!idleRunning()) return;
    lastFrame = 0;
    const frame = (ts) => {
      raf = 0;
      if (disposed || !fleet.length || failed) return;
      if (!idleRunning()) return;
      if (!ensureCtx()) {
        failIdle(new Error("canvas-2d-lost"));
        return;
      }
      const t = typeof ts === "number" ? ts : now();
      if (mode === "ambient" && lastFrame && t - lastFrame < AMBIENT_FRAME_MS) {
        raf = requestAnimationFrame(frame);
        return;
      }
      const dt = Math.min(0.05, lastFrame ? (t - lastFrame) / 1000 : 0.016);
      lastFrame = t;
      try {
        step(dt);
        draw();
      } catch (error) {
        failIdle(error);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  function player() {
    return fleet.find((s) => s.role === "player") || null;
  }

  function liveEnemies() {
    return fleet.filter((s) => s.role === "enemy" && !(s.sinking > 0));
  }

  function inPlay() {
    return mode === "play" && run;
  }

  /* ---------------------------------------------------------------- damage / sinking */

  function sinkBurst(ship) {
    const cx = ship.x;
    const cy = ship.y - 8;
    const heavy = ship.boss ? 1.7 : 1;
    fxlib.splinters(fx, cx, cy, ship.boss ? 36 : 22, Math.random, 1.1 * heavy);
    fxlib.spray(fx, cx, ship.y + 12, ship.boss ? 22 : 14, Math.random, 1.2);
    fxlib.smoke(fx, cx, cy - 10, ship.boss ? 12 : 6, Math.random, "#8b95a3");
    fxlib.bubbles(fx, cx, ship.y + 14, ship.boss ? 16 : 10);
    if (ship.boss) fxlib.sparks(fx, cx, cy, 18, Math.random, "#f5c542");
    splashes.push({ x: cx, y: ship.y + 14, t: 0, style: ship.style, big: true });
  }

  function damageShip(ship, dmg, by) {
    if (ship.sinking > 0) return false;
    const result = applyCannonHit(ship, dmg);
    ship.hit = 0.14;
    fxlib.splinters(fx, ship.x, ship.y - 14, result.sunk ? 8 : 5, Math.random, 0.8);
    fxlib.sparks(fx, ship.x, ship.y - 14, 5);
    if (inPlay()) {
      fxlib.addShake(fx, ship.role === "player" ? 5 : 1.6);
      if (ship.role === "player") run.flash = 0.35;
    }
    if (result.sunk) {
      sinkBurst(ship);
      onSunk(ship, by);
    }
    return result.sunk;
  }

  function onSunk(ship, by) {
    if (!inPlay()) return;
    if (ship.role === "player") {
      run.phase = "wrecked";
      run.wreckT = 1.5;
      balls = balls.filter((b) => b.side !== "enemy");
      fxlib.addShake(fx, 9);
      finishRun();
      for (const s of fleet) if (s.role === "enemy") toAmbient(s);
      return;
    }
    if (ship.role !== "enemy") return;
    run.combo = run.comboT > 0 ? run.combo + 1 : 1;
    run.comboT = combat.COMBO_WINDOW_S;
    const pts = combat.scoreForSink(ship.type, { gilded: ship.gilded, combo: run.combo });
    run.score += pts;
    run.sunk += 1;
    fxlib.floatText(fx, ship.x, ship.y - 70, `+${pts}`, ship.gilded ? "#f5c542" : "#ffffff", 20);
    if (run.combo > 1) {
      fxlib.floatText(fx, ship.x, ship.y - 48, `x${combat.comboMultiplier(run.combo)} combo`, "#f5c542", 14);
    }
    fxlib.addShake(fx, ship.boss ? 10 : 4);
    if (ship.boss) showBanner("Boss sunk", combat.ENEMY_TYPES[ship.type]?.label || "The flagship goes down", true);
    if (ship.boss || ship.gilded || ship.type === "galleon") {
      pickups.push({ x: ship.x, y: ship.y, kind: "chest", life: 14 });
      fxlib.coins(fx, ship.x, ship.y - 20, ship.boss ? 18 : 10);
    } else if (Math.random() < 0.32) {
      pickups.push({ x: ship.x, y: ship.y, kind: "barrel", life: 14 });
    }
    void by;
  }

  /* ---------------------------------------------------------------- run lifecycle */

  function toAmbient(ship) {
    ship.role = "ambient";
    ship.type = null;
    ship.boss = false;
    ship.enraged = false;
    ship.moveSpeed = 0;
    ship.fireDamage = 0;
    ship.maxHp = 0;
    ship.hp = SHIP_HP;
    ship.gilded = false;
    ship.entering = false;
    ship.retire = 0;
    const motion = pickSailMotion();
    ship.speed = motion.speed;
    ship.facing = ship.facing || motion.facing;
    ship.vx = ship.facing * ship.speed;
    ship.vy = 0;
    ship.aimVx = ship.vx;
    ship.aimVy = 0;
    ship.turnTimer = motion.turnTimer;
    ship.scale = 0.85 + Math.random() * 0.25;
  }

  function makeEnemy(ship, typeId) {
    const type = combat.ENEMY_TYPES[typeId] || combat.ENEMY_TYPES.sloop;
    const scaled = combat.scaleEnemy(typeId, run ? run.wave : 1);
    ship.role = "enemy";
    ship.type = typeId;
    ship.boss = !!type.boss;
    ship.enraged = false;
    ship.gilded = !ship.boss && Math.random() < combat.GILDED_CHANCE;
    ship.maxHp = scaled.hp + (ship.gilded ? 2 : 0);
    ship.hp = ship.maxHp;
    ship.scale = type.scale * (ship.boss ? 1 : 0.94 + Math.random() * 0.12);
    ship.moveSpeed = scaled.speed;
    ship.fireDamage = scaled.damage;
    ship.reloadT = 0.7 + Math.random() * type.reload;
    ship.vx = 0;
    ship.vy = 0;
    ship.sinking = 0;
    ship.list = 0;
    ship.retire = 0;
    return ship;
  }

  function spawnEnemy(typeId) {
    const bounds = waterBounds();
    const ship = baseShip(pickShipStyle());
    const type = combat.ENEMY_TYPES[typeId];
    const side = Math.random() < 0.5 ? -1 : 1;
    const p = player();
    ship.x = side < 0 ? bounds.minX - 120 : bounds.maxX + 120;
    if (type && type.boss && p) {
      ship.y = Math.min(bounds.maxY, Math.max(bounds.minY, p.y + (Math.random() - 0.5) * 140));
    } else {
      ship.y = bounds.minY + Math.random() * Math.max(1, bounds.maxY - bounds.minY);
    }
    makeEnemy(ship, typeId);
    ship.entering = true;
    ship.enterDir = -side;
    ship.facing = -side;
    fleet.push(ship);
    return ship;
  }

  function beginWave() {
    run.queue = combat.planWave(run.wave);
    run.bossKind = combat.bossForWave(run.wave);
    run.bossSpawned = !run.bossKind;
    run.bossArm = 0;
    run.spawnT = 0.4;
    run.hazardT = combat.hazardInterval(run.wave) * 0.4;
    run.phase = "fight";
    if (run.bossKind) {
      const label = combat.ENEMY_TYPES[run.bossKind].label;
      showBanner(label, `Boss wave ${run.wave}`, true);
    } else {
      showBanner(`Wave ${run.wave}`, run.wave === 1 ? "The sea fills with sails" : "More hulls on the horizon");
    }
  }

  function startRun(flagship) {
    mode = "play";
    balls = [];
    pickups = [];
    lastPlayerStyle = flagship.style;
    lastPlayerName = flagship.name;
    const stats = combat.createPlayerStats();
    run = {
      wave: 1,
      score: 0,
      sunk: 0,
      combo: 0,
      comboT: 0,
      stats,
      reload: 0,
      phase: "fight",
      queue: [],
      spawnT: 0.6,
      upgrades: [],
      wreckT: 0,
      flash: 0,
      recorded: false,
      newBest: false,
      shipName: flagship.name,
      bossKind: null,
      bossSpawned: true,
      bossArm: 0,
      hazardT: 7.5,
    };

    flagship.role = "player";
    flagship.type = "flagship";
    flagship.boss = false;
    flagship.maxHp = stats.maxHp;
    flagship.hp = stats.maxHp;
    flagship.scale = 1.38;
    flagship.vx = 0;
    flagship.vy = 0;
    flagship.sinking = 0;
    flagship.list = 0;

    const others = fleet
      .filter((s) => s !== flagship && !(s.sinking > 0))
      .sort((a, b) => Math.hypot(a.x - flagship.x, a.y - flagship.y) - Math.hypot(b.x - flagship.x, b.y - flagship.y));
    const plan = combat.planWave(1);
    const room = Math.max(0, combat.maxAliveForWave(1) - 1);
    const keep = others.slice(0, Math.min(plan.length, room));
    keep.forEach((s, i) => makeEnemy(s, plan[i]));
    for (const s of others.slice(keep.length)) s.retire = 1;
    run.queue = plan.slice(keep.length);
    hazards = [];

    overlay.classList.add("play");
    hud.hidden = false;
    hint.textContent = HINT_PLAY;
    el.cards.hidden = true;
    el.cardsTitle.hidden = true;
    el.wreck.hidden = true;
    hudKey = "";
    showBanner("Wave 1", "The sea fills with sails");
    updateHud(true);
  }

  /**
   * Settings menu launcher: show the overlay now and start combat, skipping
   * the idle wait. Idle behavior is untouched when this is never called.
   * Never silently no-ops: returns `{ ok, reason }` so preload/main can log
   * and surface a dialog when the game truly cannot start.
   * @returns {{ ok: boolean, reason: string }}
   */
  function launchGame() {
    reportStatus("launch-requested", mode);
    if (disposed) {
      reportStatus("launch-aborted", "disposed");
      return { ok: false, reason: "disposed" };
    }
    // Settings asked again — clear a prior canvas fault and retry getContext.
    if (failed) {
      ctx = null;
      if (!ensureCtx()) {
        reportStatus("launch-aborted", "canvas-2d-unavailable");
        return { ok: false, reason: "canvas-2d-unavailable" };
      }
      failed = false;
      reportStatus("launch-recovered", "cleared-failed-latch");
    }
    if (!ensureCtx()) {
      reportStatus("launch-aborted", "canvas-2d-unavailable");
      return { ok: false, reason: "canvas-2d-unavailable" };
    }
    // Force wake: document.hidden must not block an explicit menu launch.
    appActive = true;
    if (mode === "play") {
      if (!overlay.classList.contains("on")) showOverlay();
      else if (!raf) startLoop();
      refreshLayout();
      // Visibility is confirmed by preload after paint (avoids Windows 0×0 false negatives).
      return { ok: true, reason: "already-playing" };
    }
    const live = () => fleet.filter((s) => !(s.sinking > 0) && !(s.retire > 0));
    const wanted = Math.min(maxShips, LAUNCH_FLEET);
    if (live().length < wanted) {
      const grown = growFleet(
        fleet.map((s) => ({ style: s.style })),
        fleet.length + (wanted - live().length),
      );
      for (let i = fleet.length; i < grown.length; i++) {
        fleet.push(placeShip(grown[i].style, i));
      }
    }
    if (!live().length) fleet.push(placeShip(pickShipStyle(), fleet.length));
    lastActivity = now();
    if (!showOverlay()) {
      reportStatus("launch-aborted", "overlay-not-shown");
      return { ok: false, reason: "overlay-not-shown" };
    }
    const flagship = live()[0];
    if (!flagship) {
      reportStatus("launch-aborted", "no-flagship");
      return { ok: false, reason: "no-flagship" };
    }
    takeCommand(flagship);
    if (mode !== "play") {
      reportStatus("launch-aborted", "take-command-failed");
      return { ok: false, reason: "take-command-failed" };
    }
    if (!raf) startLoop();
    refreshLayout();
    // Do not report launch-ok here — preload confirms isOverlayVisible after paint,
    // then sends launch-ok / launch-aborted. Sync probes false-negative on Windows.
    return { ok: true, reason: "started" };
  }

  /**
   * True when the overlay is on and the canvas has a real on-screen box.
   * Catches “launch-ok but invisible” (clipped 0×0 host / failed paint).
   * Call refreshLayout() first when probing right after show (Windows layout lag).
   */
  function isOverlayVisible() {
    try {
      if (!overlay.classList.contains("on")) return false;
      if (!ctx) return false;
      if (!document.documentElement || !document.documentElement.contains(host)) return false;
      // Force layout so getBoundingClientRect is not stale/zero before first paint.
      void host.offsetWidth;
      void canvas.offsetWidth;
      const hostRect = host.getBoundingClientRect();
      if (hostRect.width < 32 || hostRect.height < 32) return false;
      const canvasRect = canvas.getBoundingClientRect();
      if (canvasRect.width < 32 || canvasRect.height < 32) return false;
      // Clipped to a tiny containing block while canvas style claims full viewport.
      const styleW = parseFloat(canvas.style.width) || 0;
      const styleH = parseFloat(canvas.style.height) || 0;
      if (styleW >= 64 && canvasRect.width < styleW * 0.25) return false;
      if (styleH >= 64 && canvasRect.height < styleH * 0.25) return false;
      return true;
    } catch {
      return false;
    }
  }

  function takeCommand(ship) {
    if (!ship || ship.sinking > 0 || mode !== "ambient") return;
    hoverId = 0;
    startRun(ship);
  }

  function sailAgain() {
    if (mode !== "play" || !run || run.phase !== "wrecked") return;
    const bounds = waterBounds();
    const ship = baseShip(lastPlayerStyle || pickShipStyle());
    if (lastPlayerName) ship.name = lastPlayerName;
    ship.x = (bounds.minX + bounds.maxX) / 2;
    ship.y = (bounds.minY + bounds.maxY) / 2;
    fleet.push(ship);
    startRun(ship);
  }

  function finishRun() {
    if (!run || run.recorded) return;
    run.recorded = true;
    if (run.score > 0 || run.sunk > 0) {
      const res = combat.recordRun(save, { score: run.score, wave: run.wave, sunk: run.sunk });
      save = res.save;
      run.newBest = res.newBest;
      combat.writeSave(storage, save);
    }
    // Shop boards, not the local best. Person is the signed-in desk session.
    const snapshot = { score: run.score | 0, wave: run.wave | 0, sunk: run.sunk | 0 };
    run.boardPromise = requestShopBoard(snapshot);
  }

  function requestShopBoard(snapshot) {
    if (typeof options.submitPirateScore !== "function") {
      return Promise.resolve(
        pirateBoard.lockedBoard(
          "Sign in on this desk. A score posts only while that person is signed in.",
        ),
      );
    }
    return Promise.resolve()
      .then(() => options.submitPirateScore(snapshot))
      .then((result) => result || pirateBoard.unavailableBoard("Could not reach the shop board."))
      .catch(() => pirateBoard.unavailableBoard("Could not reach the shop board. This run was not posted."));
  }

  function paintShopBoards(board) {
    const host = el.wreckBoards;
    host.replaceChildren();
    if (board && board.message) {
      const note = document.createElement("p");
      note.className = "board-note";
      note.textContent = board.message;
      host.appendChild(note);
    }
    if (!board || !board.ok) return;
    const grid = document.createElement("div");
    grid.className = "board-grid";
    for (const id of pirateBoard.BOARD_IDS) {
      const column = board.boards[id];
      const card = document.createElement("section");
      card.className = "board";
      const title = document.createElement("h3");
      title.textContent = column.label;
      card.appendChild(title);
      const rows = column.rows.slice(0, 5);
      if (!rows.length) {
        const empty = document.createElement("p");
        empty.textContent = "No scores yet";
        card.appendChild(empty);
      } else {
        const list = document.createElement("ol");
        for (const row of rows) {
          const li = document.createElement("li");
          if (row.person && row.person === board.you) li.className = "you";
          li.textContent = `${row.name}  ${pirateBoard.formatScore(row.score)}`;
          list.appendChild(li);
        }
        card.appendChild(list);
      }
      grid.appendChild(card);
    }
    host.appendChild(grid);
  }

  /** Leave combat state without touching the fleet (used by dismiss / dispose). */
  function leavePlayState() {
    if (mode === "play") finishRun();
    mode = "ambient";
    run = null;
    hazards = [];
    pointer.down = false;
    keys.left = keys.right = keys.up = keys.down = false;
    overlay.classList.remove("play");
    hud.hidden = true;
    el.cards.hidden = true;
    el.cardsTitle.hidden = true;
    el.wreck.hidden = true;
    hint.textContent = HINT_AMBIENT;
  }

  /** Esc / Stand down / Back to the sea: back to the screensaver, fleet stays afloat. */
  function standDown() {
    if (mode !== "play") return;
    // Shell overlay / dedicated launch: stand down means return to the shop.
    if (launchOnly) {
      resetIdle(true);
      return;
    }
    leavePlayState();
    balls = [];
    pickups = [];
    for (const s of fleet) {
      if (s.role !== "ambient") toAmbient(s);
      s.retire = 0;
    }
    const minShips = Math.min(maxShips, 2);
    while (fleet.filter((s) => !(s.sinking > 0)).length < minShips) {
      fleet.push(placeShip(pickShipStyle(), fleet.length));
    }
    lastActivity = now() - idleIntervalMs * Math.min(maxShips, Math.max(1, fleet.length));
  }

  function showBanner(title, sub, boss) {
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub || "";
    el.banner.classList.toggle("boss", !!boss);
    el.banner.classList.remove("show");
    void el.banner.offsetWidth;
    el.banner.classList.add("show");
  }

  function waveCleared() {
    run.phase = "intermission";
    hazards = [];
    const bonus = combat.waveClearBonus(run.wave);
    run.score += bonus;
    const p = player();
    if (p) {
      p.hp = Math.min(p.maxHp, p.hp + 1);
      fxlib.floatText(fx, p.x, p.y - 80, `Wave clear +${bonus}`, "#ffffff", 20);
    }
    run.upgrades = combat.rollUpgrades(run.stats);
    showBanner(`Wave ${run.wave} cleared`, "Pick a refit");
    el.cards.textContent = "";
    run.upgrades.forEach((u, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "card";
      b.dataset.id = u.id;
      const kbd = document.createElement("kbd");
      kbd.textContent = String(i + 1);
      const title = document.createElement("b");
      title.textContent = u.title;
      title.appendChild(kbd);
      const blurb = document.createElement("span");
      blurb.textContent = u.blurb;
      b.append(title, blurb);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        pickUpgrade(u.id);
      });
      el.cards.appendChild(b);
    });
    el.cards.hidden = false;
    el.cardsTitle.hidden = false;
  }

  function pickUpgrade(id) {
    if (!inPlay() || run.phase !== "intermission") return;
    const res = combat.applyUpgrade(run.stats, id);
    run.stats = res.stats;
    const p = player();
    if (p) {
      p.maxHp = run.stats.maxHp;
      p.hp = Math.min(p.maxHp, p.hp + res.heal);
      fxlib.floatText(fx, p.x, p.y - 80, combat.UPGRADES.find((u) => u.id === id).title, BRAND_BLUE, 16);
    }
    el.cards.hidden = true;
    el.cardsTitle.hidden = true;
    run.wave += 1;
    beginWave();
  }

  /* ---------------------------------------------------------------- firing */

  function launch(from, x1, y1, dur, side, damage, extra = {}) {
    const x0 = from.x + (extra.muzzleSide ?? from.facing) * 34 * from.scale;
    const y0 = from.y - 12;
    balls.push({
      x: x0,
      y: y0,
      px: x0,
      py: y0,
      x0,
      y0,
      x1,
      y1,
      t: 0,
      dur,
      from: from.id,
      to: 0,
      hit: false,
      style: from.style,
      side,
      damage,
    });
    fxlib.smoke(fx, x0, y0, 3, Math.random, "#dfe5ee");
    fxlib.sparks(fx, x0, y0, 4, Math.random, "#ffd27a");
  }

  function playerFire(px, py) {
    const p = player();
    if (!p || !inPlay() || run.reload > 0 || p.sinking > 0) return;
    if (run.phase !== "fight" && run.phase !== "intermission") return;
    const from = { x: p.x, y: p.y - 16 };
    const aim = combat.resolvePlayerAim(from, { x: px, y: py }, liveEnemies());
    let ax = aim.x;
    let ay = aim.y;
    const dist = Math.hypot(ax - from.x, ay - from.y);
    if (dist > run.stats.range) {
      ax = from.x + ((ax - from.x) / dist) * run.stats.range;
      ay = from.y + ((ay - from.y) / dist) * run.stats.range;
    }
    const side = ax >= p.x ? 1 : -1;
    const offsets = combat.volleyOffsets(run.stats.shots);
    offsets.forEach((off, i) => {
      launch(p, ax + off.dx, ay + off.dy, aim.dur + i * 0.04, "player", run.stats.damage, { muzzleSide: side });
    });
    run.reload = run.stats.reload;
    p.vx -= side * 26;
    fxlib.addShake(fx, 1.2);
  }

  function enemyFire(e, p) {
    const type = combat.ENEMY_TYPES[e.type] || combat.ENEMY_TYPES.sloop;
    const shots = type.boss ? type.shots || 3 : 1;
    const aim = combat.enemyAim({ x: e.x, y: e.y - 16 }, p, run.wave);
    const side = aim.x >= e.x ? 1 : -1;
    const offsets = combat.volleyOffsets(shots);
    offsets.forEach((off, i) => {
      launch(
        e,
        aim.x + off.dx,
        aim.y + off.dy,
        Math.max(0.85, aim.dur * 1.15) + i * 0.03,
        "enemy",
        e.fireDamage || type.damage,
        { muzzleSide: side },
      );
    });
  }

  function maybeFire(liveFleet) {
    const pool = liveFleet || fleet.filter((s) => !(s.sinking > 0));
    if (pool.length < 2) return;
    let a = (Math.random() * pool.length) | 0;
    let b = (Math.random() * pool.length) | 0;
    if (a === b) b = (b + 1) % pool.length;
    const from = pool[a];
    const to = pool[b];
    const hit = Math.random() < 0.42;
    const x0 = from.x + from.facing * 36;
    const y0 = from.y - 8;
    const x1 = hit ? to.x - to.facing * 10 : to.x + (Math.random() - 0.5) * 90;
    const y1 = hit ? to.y : to.y + 28 + Math.random() * 24;
    balls.push({
      x: x0,
      y: y0,
      px: x0,
      py: y0,
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
      side: null,
      damage: 1,
    });
    fxlib.smoke(fx, x0, y0, 2, Math.random, "#dfe5ee");
  }

  /* ---------------------------------------------------------------- simulation */

  function stepShips(dt, bounds) {
    const survivors = [];
    const p = player();
    const live = [];
    for (const ship of fleet) {
      ship.bob += ship.bobSpeed * dt;
      ship.ramCool = Math.max(0, ship.ramCool - dt);
      ship.hit = Math.max(0, ship.hit - dt);
      if (ship.retire > 0) {
        ship.retire -= dt;
        if (ship.retire <= 0) continue;
      }

      const px = ship.x;
      const py = ship.y;
      if (ship.sinking > 0 || ship.role === "ambient") {
        stepShipSail(ship, dt, bounds);
      } else if (ship.role === "player") {
        combat.steerPlayer(ship, keys, dt, bounds, run.stats);
      } else if (ship.role === "enemy" && p && p.sinking <= 0) {
        combat.stepEnemyAI(ship, p, dt, bounds);
        ship.reloadT -= dt;
        if (!ship.entering && ship.reloadT <= 0 && run.phase === "fight") {
          const type = combat.ENEMY_TYPES[ship.type];
          const dist = Math.hypot(p.x - ship.x, p.y - ship.y);
          if (dist < type.range * 1.45) {
            enemyFire(ship, p);
            ship.reloadT = type.reload * (0.85 + Math.random() * 0.3);
          } else {
            ship.reloadT = 0.3;
          }
        }
      }

      if (ship.list > 0) {
        ship.list = Math.max(0, ship.list - dt);
        ship.hpTilt = Math.sin(ship.list * 14) * 0.22 * (ship.list > 0.15 ? 1 : ship.list / 0.15);
      } else if (ship.sinking > 0) {
        ship.hpTilt = Math.min(1.1, ship.hpTilt + dt * 0.9);
      } else if (ship.role === "player" || ship.role === "enemy") {
        const lean = Math.max(-1, Math.min(1, ship.vx / 140)) * 0.07;
        ship.hpTilt = ship.hpTilt * 0.88 + lean * 0.12;
      } else {
        ship.hpTilt *= 0.9;
      }

      ship.wakeT -= dt;
      const moved = Math.hypot(ship.x - px, ship.y - py) / Math.max(dt, 0.001);
      if (ship.wakeT <= 0 && moved > 18 && !(ship.sinking > 0)) {
        fxlib.wake(fx, ship.x, ship.y, ship.facing);
        ship.wakeT = moved > 80 ? 0.1 : 0.17;
      }

      if (stepShipSink(ship, dt)) {
        splashes.push({ x: ship.x, y: ship.y + 12, t: 0, style: ship.style });
        continue;
      }
      survivors.push(ship);
      if (!(ship.sinking > 0)) live.push(ship);
    }
    fleet = survivors;
    return live;
  }

  function stepBalls(dt) {
    const next = [];
    for (const ball of balls) {
      ball.px = ball.x;
      ball.py = ball.y;
      ball.t += dt;
      const u = Math.min(1, ball.t / ball.dur);
      const arc = Math.sin(u * Math.PI) * (40 + Math.abs(ball.x1 - ball.x0) * 0.12);
      ball.x = ball.x0 + (ball.x1 - ball.x0) * u;
      ball.y = ball.y0 + (ball.y1 - ball.y0) * u - arc;
      if (u < 1) {
        next.push(ball);
        continue;
      }
      landBall(ball);
    }
    balls = next;
  }

  function landBall(ball) {
    const point = { x: ball.x1, y: ball.y1 };
    if (ball.side === "player") {
      const target = liveEnemies().find((e) => combat.ballHitsShip(point, e, 8));
      if (target) {
        damageShip(target, ball.damage, "player");
        return;
      }
      missSplash(ball);
      return;
    }
    if (ball.side === "enemy") {
      const p = player();
      if (p && p.sinking <= 0 && combat.ballHitsShip(point, p, 4)) {
        damageShip(p, ball.damage, "enemy");
        return;
      }
      missSplash(ball);
      return;
    }
    if (ball.hit) {
      const target = fleet.find((s) => s.id === ball.to);
      if (target) damageShip(target, 1, "ball");
      return;
    }
    missSplash(ball);
  }

  function missSplash(ball) {
    splashes.push({ x: ball.x1, y: ball.y1 + (ball.side ? 16 : 10), t: 0, style: ball.style });
    fxlib.spray(fx, ball.x1, ball.y1 + 14, 7);
  }

  function stepRun(dt, bounds, live) {
    run.reload = Math.max(0, run.reload - dt);
    run.flash = Math.max(0, run.flash - dt);
    if (run.comboT > 0) {
      run.comboT -= dt;
      if (run.comboT <= 0) run.combo = 0;
    }
    const p = player();

    if (run.phase === "wrecked") {
      run.wreckT -= dt;
      if (run.wreckT <= 0 && el.wreck.hidden) showWreck();
      return;
    }

    if (p && p.sinking <= 0) {
      if (pointer.down && run.reload <= 0) playerFire(pointer.x, pointer.y);

      for (let i = pickups.length - 1; i >= 0; i--) {
        const pk = pickups[i];
        pk.life -= dt;
        if (pk.life <= 0) {
          pickups.splice(i, 1);
          continue;
        }
        if (Math.hypot(pk.x - p.x, pk.y - (p.y - 8)) < 52) {
          pickups.splice(i, 1);
          if (pk.kind === "barrel") {
            const gain = Math.min(2, p.maxHp - p.hp);
            p.hp += gain;
            fxlib.floatText(fx, p.x, p.y - 82, gain > 0 ? `+${gain} hull` : "Hull full", "#3ddc84", 16);
          } else {
            run.score += 250;
            fxlib.floatText(fx, p.x, p.y - 82, "+250 doubloons", "#f5c542", 16);
            fxlib.coins(fx, p.x, p.y - 20, 8);
          }
        }
      }

      // Ramming trades a hit with the flagship.
      for (const e of live) {
        if (e.role !== "enemy" || e.entering || p.ramCool > 0 || e.ramCool > 0) continue;
        if (!shipsCollide(p, e, 40)) continue;
        p.ramCool = 1.6;
        e.ramCool = 1.6;
        damageShip(e, 1, "ram");
        damageShip(p, 1, "ram");
        const dir = p.x <= e.x ? -1 : 1;
        p.vx = dir * 120;
        e.vx = -dir * 90;
      }
    }

    if (run.phase === "fight") {
      stepHazards(dt, bounds);
      if (run.phase !== "fight") return;
      const enemies = liveEnemies();
      combat.separate(enemies.filter((e) => !e.boss), 72, 48, dt);
      combat.giveBossRoom(enemies);
      for (const e of enemies) combat.clampToBounds(e, bounds);
      if (p) combat.clampToBounds(p, bounds);

      for (const e of enemies) {
        if (!e.boss || e.enraged || e.entering) continue;
        if (e.hp > e.maxHp * 0.5) continue;
        e.enraged = true;
        const escorts = e.type === "dreadnought" ? 4 : 3;
        for (let i = 0; i < escorts; i++) run.queue.push("raider");
        fxlib.floatText(fx, e.x, e.y - 90, "Escorts", "#ffb15a", 18);
      }

      if (!run.bossSpawned && run.bossKind) {
        run.bossArm = (run.bossArm || 0) + dt;
        if (run.bossArm > 1.15) {
          spawnEnemy(run.bossKind);
          run.bossSpawned = true;
        }
      }

      run.spawnT -= dt;
      const cap = combat.maxAliveForWave(run.wave);
      if (run.queue.length && run.spawnT <= 0 && liveEnemies().length < cap) {
        const batch = combat.spawnBatch(run.wave);
        let spawned = 0;
        while (run.queue.length && liveEnemies().length < cap && spawned < batch) {
          spawnEnemy(run.queue.shift());
          spawned += 1;
        }
        const thin = liveEnemies().length < Math.min(cap, 3 + Math.floor(run.wave / 2));
        run.spawnT = combat.spawnGap(run.wave) * (thin ? 0.55 : 1);
      }

      run.hazardT -= dt;
      if (run.hazardT <= 0 && hazards.length < 4) {
        const kind = combat.pickHazardKind(run.wave);
        const h = combat.createHazard(kind, bounds, Math.random, run.wave);
        if (p && kind !== "megalodon" && Math.hypot(h.x - p.x, h.y - p.y) < 170) {
          const push = h.x < p.x ? -1 : 1;
          h.x = Math.min(bounds.maxX, Math.max(bounds.minX, h.x + push * 200));
        }
        hazards.push(h);
        const label = kind === "megalodon" ? "Megalodon" : kind === "sinkhole" ? "Sinkhole" : kind === "reef" ? "Reef" : "Drift mine";
        const tx = kind === "megalodon" ? (h.vx > 0 ? bounds.minX + 90 : bounds.maxX - 90) : h.x;
        const ty = kind === "megalodon" ? h.y : h.y - 24;
        fxlib.floatText(fx, tx, ty, label, "#9fd0ff", 16);
        run.hazardT = combat.hazardInterval(run.wave);
      }

      const still = liveEnemies();
      if (!run.queue.length && still.length === 0 && run.bossSpawned && p && p.sinking <= 0) waveCleared();
    }
  }

  function absorbHazardDamage(ship, amount, kind) {
    ship.hazardAcc = (ship.hazardAcc || 0) + amount;
    if (ship.hazardAcc < 1) return;
    const dmg = Math.floor(ship.hazardAcc);
    ship.hazardAcc -= dmg;
    damageShip(ship, dmg, kind);
  }

  function detonateMine(h) {
    fxlib.addShake(fx, 6);
    fxlib.sparks(fx, h.x, h.y, 16, Math.random, "#ffb15a");
    fxlib.spray(fx, h.x, h.y, 12, Math.random, 1.3);
    splashes.push({ x: h.x, y: h.y, t: 0, style: "pixel", big: true });
    for (const ship of fleet) {
      if (ship.sinking > 0 || ship.retire > 0) continue;
      if (!combat.mineBlastHits(h, ship)) continue;
      damageShip(ship, h.damage || 3, "mine");
    }
  }

  function stepHazards(dt, bounds) {
    const ships = fleet.filter((s) => !(s.sinking > 0) && !(s.retire > 0));
    const next = [];
    for (const h of hazards) {
      const alive = combat.stepHazard(h, dt, bounds);
      let boom = false;
      for (const ship of ships) {
        const inf = combat.hazardInfluence(h, ship, dt);
        if (inf.dx || inf.dy) {
          ship.x += inf.dx;
          ship.y += inf.dy;
        }
        if (inf.damage > 0) absorbHazardDamage(ship, inf.damage, h.kind);
        if (inf.explode) boom = true;
      }
      if (boom) detonateMine(h);
      if (h.kind === "megalodon" && alive && Math.random() < dt * 6) {
        fxlib.spray(fx, h.x - Math.sign(h.vx || 1) * 20, h.y + 6, 2, Math.random, 0.45);
      }
      if (alive && !h.exploded) next.push(h);
    }
    hazards = next;
  }

  function showWreck() {
    el.wreckShip.textContent = run.shipName || "";
    el.wreckScore.textContent = run.score.toLocaleString();
    el.wreckMeta.textContent = `Wave ${run.wave} · ${run.sunk} ship${run.sunk === 1 ? "" : "s"} sunk · Best ${save.best.toLocaleString()}`;
    el.wreckNew.textContent = run.newBest ? "New best" : "";
    el.wreckBoards.replaceChildren();
    const pending = document.createElement("p");
    pending.className = "board-note";
    pending.textContent = "Loading the shop board…";
    el.wreckBoards.appendChild(pending);
    el.wreck.hidden = false;
    const token = (showWreck.token = (showWreck.token || 0) + 1);
    const promise = run.boardPromise || requestShopBoard({ score: run.score | 0, wave: run.wave | 0, sunk: run.sunk | 0 });
    promise.then((board) => {
      if (token !== showWreck.token || !run || run.phase !== "wrecked") return;
      paintShopBoards(board);
    });
    el.again.focus({ preventScroll: true });
  }

  function step(dt) {
    fireCooldown -= dt;
    const bounds = waterBounds();
    const live = stepShips(dt, bounds);

    if (mode === "play" && run) {
      if (!run.shipName) {
        const p = player();
        if (p) run.shipName = p.name;
      }
      stepRun(dt, bounds, live);
    } else {
      // Ambient: overlapping live hulls trade a hit (can sink).
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i];
          const b = live[j];
          if (a.sinking > 0 || b.sinking > 0) continue;
          if (a.ramCool > 0 || b.ramCool > 0) continue;
          if (!shipsCollide(a, b)) continue;
          a.ramCool = 1.8;
          b.ramCool = 1.8;
          damageShip(a, 1, "ram");
          damageShip(b, 1, "ram");
          if (a.x <= b.x) {
            a.facing = -1;
            a.vx = -a.speed;
            b.facing = 1;
            b.vx = b.speed;
          } else {
            a.facing = 1;
            a.vx = a.speed;
            b.facing = -1;
            b.vx = -b.speed;
          }
          a.aimVx = a.vx;
          b.aimVx = b.vx;
        }
      }
      const ready = fleet.filter((s) => !(s.sinking > 0));
      if (ready.length >= 2 && fireCooldown <= 0) {
        fireCooldown = 1.1 + Math.random() * 1.4;
        maybeFire(ready);
      }
    }

    stepBalls(dt);

    const nextSplash = [];
    for (const splash of splashes) {
      splash.t += dt;
      if (splash.t < 0.7) nextSplash.push(splash);
    }
    splashes = nextSplash;

    fxlib.stepFx(fx, dt);

    if (!fleet.length && mode === "ambient") {
      stopLoop();
      // Idle target still applies — refill so the scene stays alive until click.
      syncFleet();
    }
  }

  /* ---------------------------------------------------------------- HUD */

  function updateHud(force) {
    if (!inPlay()) return;
    const p = player();
    const sails = liveEnemies().length;
    const bossUp = fleet.some((s) => s.boss && !(s.sinking > 0));
    const key = [
      run.phase,
      run.wave,
      run.score,
      run.combo > 0 && run.comboT > 0 ? combat.comboMultiplier(run.combo) : 0,
      p ? p.hp : 0,
      p ? p.maxHp : 0,
      save.best,
      sails,
      bossUp ? 1 : 0,
    ].join("|");
    if (force || key !== hudKey) {
      hudKey = key;
      el.name.textContent = p ? p.name : run.shipName || "";
      const hp = p ? p.hp : 0;
      const max = p ? p.maxHp : 1;
      el.hullFill.style.width = `${Math.max(0, (hp / max) * 100)}%`;
      el.hullBar.classList.toggle("low", hp / max <= 0.25);
      el.hullTxt.textContent = `Hull ${hp}/${max}`;
      el.wave.textContent = bossUp ? `Boss · Wave ${run.wave} · ${sails}` : `Wave ${run.wave} · ${sails} sails`;
      el.score.textContent = run.score.toLocaleString();
      const mult = run.combo > 0 && run.comboT > 0 ? combat.comboMultiplier(run.combo) : 0;
      el.combo.textContent = mult > 1 ? `Combo x${mult}` : "";
      el.best.textContent = save.best ? `Best ${save.best.toLocaleString()}` : "";
    }
    const u = run.stats.reload > 0 ? 1 - Math.min(1, run.reload / run.stats.reload) : 1;
    el.reloadFill.style.width = `${u * 100}%`;
  }

  /* ---------------------------------------------------------------- drawing */

  function draw() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const t = now();
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    if (fx.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
    }
    art.drawWater(ctx, w, h, t, { dense: mode === "play" });

    for (const hz of hazards) {
      if (hz.kind !== "megalodon") art.drawHazard(ctx, hz, t);
    }

    for (const p of fx.parts) {
      if (p.kind === "wake" || p.kind === "bubble") art.drawParticle(ctx, p);
    }
    for (const pk of pickups) art.drawPickup(ctx, pk, t);
    for (const hz of hazards) {
      if (hz.kind === "megalodon") art.drawHazard(ctx, hz, t);
    }

    const showHp = mode === "play";
    const sorted = fleet.slice().sort((a, b) => a.y - b.y);
    for (const ship of sorted) art.drawShipFull(ctx, ship, { t, showHp: showHp && ship.role !== "ambient" });

    for (const ball of balls) {
      if (ball.side === "enemy") art.drawLandingMarker(ctx, ball, t);
    }
    for (const ball of balls) art.drawBall(ctx, ball);
    for (const splash of splashes) art.drawSplash(ctx, splash);
    for (const p of fx.parts) {
      if (p.kind !== "wake" && p.kind !== "bubble") art.drawParticle(ctx, p);
    }
    for (const tx of fx.texts) art.drawFloatText(ctx, tx);

    if (mode === "ambient" && hoverId) {
      const ship = fleet.find((s) => s.id === hoverId);
      if (ship && !(ship.sinking > 0)) art.drawHoverTag(ctx, ship, `Take the helm · ${ship.name}`);
    }
    if (inPlay()) {
      const boss = fleet.find((s) => s.boss && !(s.sinking > 0) && s.maxHp > 0);
      if (boss) {
        const label = (combat.ENEMY_TYPES[boss.type] && combat.ENEMY_TYPES[boss.type].label) || "Boss";
        art.drawBossPlate(ctx, w, h, label, boss.hp, boss.maxHp);
      }
    }
    ctx.restore();

    if (inPlay()) {
      if (run.flash > 0) {
        const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
        g.addColorStop(0, "rgba(255,60,40,0)");
        g.addColorStop(1, `rgba(255,60,40,${Math.min(0.5, run.flash * 1.4)})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      if (pointer.inside && (run.phase === "fight" || run.phase === "intermission")) {
        const u = run.stats.reload > 0 ? 1 - Math.min(1, run.reload / run.stats.reload) : 1;
        art.drawReticle(ctx, pointer.x, pointer.y, u);
      }
      updateHud(false);
    }
  }

  /* ---------------------------------------------------------------- input */

  /**
   * Soft activity (mouse move / keys / scroll): resets the idle clock only while
   * the battle overlay is off. Never dismisses an active fleet — click only.
   */
  function onSoftActivity() {
    if (fleet.length) return;
    resetIdle(false);
  }

  /** Click / tap on empty water dismisses the overlay and clears the fleet. */
  function onDismissClick() {
    resetIdle(true);
  }

  function isUiTarget(e) {
    const t = e.target;
    return !!(t && typeof t.closest === "function" && t.closest("button"));
  }

  function shipAt(x, y) {
    const ordered = fleet.slice().sort((a, b) => b.y - a.y);
    for (const s of ordered) {
      if (s.sinking > 0 || s.retire > 0) continue;
      const dx = (x - s.x) / (62 * s.scale);
      const dy = (y - (s.y - 22)) / (46 * s.scale);
      if (dx * dx + dy * dy <= 1) return s;
    }
    return null;
  }

  function onOverlayClick(e) {
    if (isUiTarget(e)) return;
    if (mode === "play") return;
    const ship = e.type === "click" && e.button === 0 ? shipAt(e.clientX, e.clientY) : null;
    if (ship) {
      takeCommand(ship);
      return;
    }
    onDismissClick();
  }

  function onOverlayPointerMove(e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = true;
    if (mode === "ambient") {
      const ship = shipAt(e.clientX, e.clientY);
      hoverId = ship ? ship.id : 0;
      overlay.style.cursor = ship ? "pointer" : "default";
    }
  }

  function onOverlayPointerLeave() {
    pointer.inside = false;
    hoverId = 0;
  }

  function onOverlayPointerDown(e) {
    if (!inPlay() || e.button !== 0 || isUiTarget(e)) return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = true;
    pointer.down = true;
    playerFire(pointer.x, pointer.y);
  }

  function onPointerUp() {
    pointer.down = false;
  }

  function onGameKey(e) {
    if (!inPlay()) return;
    const down = e.type === "keydown";
    const dir = KEY_MAP[e.code];
    if (dir) {
      keys[dir] = down;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!down) return;
    if (e.code === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      standDown();
      return;
    }
    if (run.phase === "wrecked" && (e.code === "Enter" || e.code === "Space")) {
      e.preventDefault();
      e.stopPropagation();
      sailAgain();
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      e.stopPropagation();
      const p = player();
      const target = p && combat.nearestEnemy(p, liveEnemies());
      if (target) playerFire(target.x, target.y - 16);
      return;
    }
    const m = /^(?:Digit|Numpad)([1-3])$/.exec(e.code);
    if (m && run.phase === "intermission") {
      const pick = run.upgrades[Number(m[1]) - 1];
      if (pick) {
        e.preventDefault();
        e.stopPropagation();
        pickUpgrade(pick.id);
      }
    }
  }

  function clearHeldInput() {
    keys.left = keys.right = keys.up = keys.down = false;
    pointer.down = false;
  }

  function onVisibility() {
    // Keep the pirate overlay alive across Windows visibility flaps (occlusion /
    // multi-monitor). Only pause ambient idle when the page is truly hidden and
    // the overlay is not showing.
    if (overlay.classList.contains("on")) {
      appActive = true;
      if (fleet.length && !raf && !failed && !disposed) startLoop();
      return;
    }
    appActive = !document.hidden;
    if (!appActive) {
      clearHeldInput();
      stopLoop();
      return;
    }
    if (fleet.length) startLoop();
  }

  // Keep the idle clock honest while working — but these must NOT dismiss battles.
  const softActivityEvents = [
    "mousemove",
    "mousedown",
    "mouseup",
    "wheel",
    "keydown",
    "keyup",
    "pointerdown",
    "pointermove",
    "pointerup",
    "touchstart",
    "touchmove",
    "touchend",
    "scroll",
  ];

  // Overlay dismiss: click / tap on empty water only (not hover, not mousemove, not keys).
  // Clicking a ship takes the helm instead; game clicks never reach dismiss.
  const dismissEvents = ["click", "auxclick"];

  for (const name of softActivityEvents) {
    window.addEventListener(name, onSoftActivity, { passive: true, capture: true });
  }
  for (const name of dismissEvents) {
    overlay.addEventListener(name, onOverlayClick);
  }
  overlay.addEventListener("pointermove", onOverlayPointerMove);
  overlay.addEventListener("pointerleave", onOverlayPointerLeave);
  overlay.addEventListener("pointerdown", onOverlayPointerDown);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  window.addEventListener("keydown", onGameKey, true);
  window.addEventListener("keyup", onGameKey, true);
  window.addEventListener("blur", clearHeldInput);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("resize", resize);
  el.stand.addEventListener("click", standDown);
  el.sea.addEventListener("click", standDown);
  el.again.addEventListener("click", sailAgain);

  ensureHostAttached();
  pinHostToViewport();

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
    try {
      syncFleet();
    } catch (error) {
      failIdle(error);
    }
  }, 1000);

  resize();

  return {
    launchGame,
    isOverlayVisible,
    refreshLayout,
    /** Clear a clipped/invisible overlay so a shell-level fallback can take over. */
    dismissOverlay() {
      resetIdle(true);
    },
    get disabled() {
      return failed || !ctx;
    },
    dispose() {
      disposed = true;
      window.clearInterval(tickTimer);
      stopLoop();
      for (const name of softActivityEvents) {
        window.removeEventListener(name, onSoftActivity, { capture: true });
      }
      for (const name of dismissEvents) {
        overlay.removeEventListener(name, onOverlayClick);
      }
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("keydown", onGameKey, true);
      window.removeEventListener("keyup", onGameKey, true);
      window.removeEventListener("blur", clearHeldInput);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
      host.remove();
    },
    /** @internal test helpers */
    _test: {
      syncFleet,
      step,
      get fleet() {
        return fleet;
      },
      get mode() {
        return mode;
      },
      get run() {
        return run;
      },
      setLastActivity(ts) {
        lastActivity = ts;
      },
      get overlayOn() {
        return overlay.classList.contains("on");
      },
      get failed() {
        return failed;
      },
      failIdle,
      ensureCtx,
      setAppActive(value) {
        appActive = !!value;
      },
      dismissWithClick: onDismissClick,
      softActivity: onSoftActivity,
      takeCommand,
      launchGame,
      standDown,
      playerFire,
      shipAt,
    },
  };
}

module.exports = {
  mountShellChrome,
  ROOT_ID,
};
