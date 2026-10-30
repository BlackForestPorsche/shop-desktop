"use strict";

/**
 * Electron-shell chrome injected into the BrowserWindow (not the hosted shop site).
 * - Pirate idle overlay after 5 minutes without input; more ships every +5 minutes
 * - Ships sail, fire, collide, and sink; sunk hulls respawn toward the idle target.
 *   Idle-only people get this forever: no prompts, no pressure to play.
 * - Pirate combat (opt-in): click a ship to take the helm. W sails ahead,
 *   A turns the nose left, D turns it right, click fires. Waves escalate,
 *   bosses every 5th wave, hazards, and separate sea events (fog, squall,
 *   broadside, kraken, supply, boarding). Doubloons buy desk upgrades.
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
const pirateAudio = require("./pirate-audio");

const ROOT_ID = "bf-tools-shell-root";

/** Hulls on the water when the game is launched from Settings (one yours, the rest hostile). */
const LAUNCH_FLEET = 3;

const MAX_CANVAS_PIXELS = 8_500_000;

const HINT_AMBIENT = "Click to return to the shop";
const HINT_PLAY = "W sails ahead \u00b7 A turns left \u00b7 D turns right \u00b7 Click to fire \u00b7 Space nearest \u00b7 Esc stands down";
