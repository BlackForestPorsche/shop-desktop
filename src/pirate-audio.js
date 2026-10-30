"use strict";

/**
 * Procedural combat audio for the pirate helm. No samples, no network.
 * The screensaver never calls this: idle broadsides stay silent.
 * A music bed and cues start only after someone takes the helm.
 */

const BED = Object.freeze([
  [146.83, 0.36],
  [174.61, 0.2],
  [196.0, 0.2],
  [220.0, 0.36],
  [174.61, 0.2],
  [146.83, 0.36],
  [130.81, 0.2],
  [164.81, 0.36],
]);

function createPirateAudio(options = {}) {
  const factory = options && typeof options.factory === "function" ? options.factory : null;
  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let bedOn = false;
  let muted = false;
  let timer = null;
  let nextNote = 0;
  let stepIndex = 0;
  const lastCue = Object.create(null);

  function wire(c) {
    master = c.createGain();
    master.gain.value = muted ? 0.0001 : 0.18;
    master.connect(c.destination);
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 880;
    musicGain = c.createGain();
    musicGain.gain.value = 0.4;
    musicGain.connect(filter);
    filter.connect(master);
    sfxGain = c.createGain();
    sfxGain.gain.value = 0.85;
    sfxGain.connect(master);
  }

  function context() {
    if (ctx) return ctx;
    if (factory) {
      ctx = factory();
      if (ctx) wire(ctx);
      return ctx;
    }
    const root = typeof window !== "undefined" ? window : null;
    const AC = root && (root.AudioContext || root.webkitAudioContext);
    if (!AC) return null;
    try {
      ctx = new AC();
      wire(ctx);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function resume() {
    const c = context();
    if (c && c.state === "suspended" && typeof c.resume === "function") {
      c.resume().catch(() => {});
    }
    return c;
  }

  function glide(param, value, t) {
    if (!param) return;
    const now = typeof param.value === "number" ? param.value : value;
    param.cancelScheduledValues(t);
    param.setValueAtTime(Math.max(0.0001, now), t);
    param.setTargetAtTime(Math.max(0.0001, value), t, 0.04);
  }

  function tone(freq, t, dur, type, gain, dest) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, dur));
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  function slide(from, to, t, dur, type, gain, dest) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  function noise(t, dur, gain, dest, band) {
    const n = Math.max(1, Math.ceil(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = band;
    filter.Q.value = 0.65;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function allow(name, gap) {
    const t = ctx.currentTime;
    const prev = lastCue[name] || 0;
    if (t - prev < gap) return false;
    lastCue[name] = t;
    return true;
  }

  function pumpBed() {
    if (!bedOn || muted) return;
    const c = resume();
    if (!c || !musicGain) return;
    if (nextNote < c.currentTime) nextNote = c.currentTime + 0.04;
    const horizon = c.currentTime + 0.7;
    while (nextNote < horizon) {
      const note = BED[stepIndex % BED.length];
      tone(note[0], nextNote, note[1] * 0.92, "triangle", 0.07, musicGain);
      if (stepIndex % 8 === 0) tone(73.42, nextNote, 1.15, "sine", 0.045, musicGain);
      nextNote += note[1];
      stepIndex += 1;
    }
  }

  function startBed() {
    const c = resume();
    if (!c) return;
    bedOn = true;
    if (musicGain) glide(musicGain.gain, 0.4, c.currentTime);
    if (nextNote < c.currentTime) nextNote = c.currentTime + 0.05;
    pumpBed();
    if (timer) clearInterval(timer);
    timer = setInterval(pumpBed, 250);
  }

  function stopBed() {
    bedOn = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (ctx && musicGain) glide(musicGain.gain, 0.0001, ctx.currentTime);
  }

  function cue(name) {
    if (muted) return;
    const c = resume();
    if (!c || !sfxGain) return;
    const t = c.currentTime;
    if (name === "shot") {
      if (!allow("shot", 0.045)) return;
      noise(t, 0.11, 0.32, sfxGain, 170);
      tone(98, t, 0.09, "sine", 0.08, sfxGain);
    } else if (name === "enemy-shot") {
      if (!allow("enemy-shot", 0.08)) return;
      noise(t, 0.08, 0.14, sfxGain, 240);
    } else if (name === "hit") {
      if (!allow("hit", 0.04)) return;
      noise(t, 0.07, 0.22, sfxGain, 740);
      tone(320, t, 0.06, "square", 0.04, sfxGain);
    } else if (name === "player-hit") {
      if (!allow("player-hit", 0.07)) return;
      noise(t, 0.12, 0.28, sfxGain, 220);
      slide(180, 70, t, 0.16, "sine", 0.1, sfxGain);
    } else if (name === "sink") {
      if (!allow("sink", 0.08)) return;
      noise(t, 0.32, 0.3, sfxGain, 140);
      slide(220, 55, t, 0.34, "triangle", 0.1, sfxGain);
    } else if (name === "wreck") {
      if (!allow("wreck", 0.2)) return;
      noise(t, 0.55, 0.4, sfxGain, 90);
      slide(130, 40, t, 0.6, "sine", 0.16, sfxGain);
    } else if (name === "blast") {
      if (!allow("blast", 0.12)) return;
      noise(t, 0.28, 0.34, sfxGain, 110);
      tone(62, t, 0.22, "sine", 0.1, sfxGain);
    } else if (name === "upgrade") {
      tone(659.25, t, 0.12, "triangle", 0.08, sfxGain);
      tone(880, t + 0.09, 0.16, "triangle", 0.07, sfxGain);
    } else if (name === "prestige") {
      tone(293.66, t, 0.16, "triangle", 0.09, sfxGain);
      tone(369.99, t + 0.14, 0.16, "triangle", 0.08, sfxGain);
      tone(440, t + 0.28, 0.18, "triangle", 0.08, sfxGain);
      tone(587.33, t + 0.44, 0.32, "triangle", 0.09, sfxGain);
    } else if (name === "horn") {
      if (!allow("horn", 0.4)) return;
      slide(110, 164.81, t, 0.45, "sawtooth", 0.05, sfxGain);
      tone(82.41, t, 0.5, "sine", 0.06, sfxGain);
    }
  }

  function setMuted(value) {
    muted = !!value;
    const c = ctx;
    if (c && master) glide(master.gain, muted ? 0.0001 : 0.18, c.currentTime);
  }

  function dispose() {
    stopBed();
    const c = ctx;
    ctx = null;
    master = null;
    musicGain = null;
    sfxGain = null;
    if (c && typeof c.close === "function") c.close().catch(() => {});
  }

  return {
    startBed,
    stopBed,
    cue,
    setMuted,
    dispose,
    get muted() {
      return muted;
    },
  };
}

module.exports = { createPirateAudio };
