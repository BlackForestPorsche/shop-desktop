"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPirateAudio } = require("../src/pirate-audio");

test("pirate audio stays silent when the desk has no audio device", () => {
  const audio = createPirateAudio();
  audio.setMuted(false);
  audio.startBed();
  audio.cue("shot");
  audio.cue("hit");
  audio.cue("sink");
  audio.cue("upgrade");
  audio.cue("prestige");
  audio.stopBed();
  audio.dispose();
  assert.equal(audio.muted, false);
});

test("pirate audio remembers a mute and still schedules combat cues", () => {
  const calls = [];
  function gain() {
    return {
      value: 0.2,
      cancelScheduledValues() {},
      setValueAtTime(_v, _t) {},
      exponentialRampToValueAtTime() {},
      setTargetAtTime() {},
    };
  }
  const ctx = {
    calls,
    currentTime: 1,
    sampleRate: 8000,
    state: "running",
    destination: {},
    resume() {
      return Promise.resolve();
    },
    close() {
      return Promise.resolve();
    },
    createGain() {
      return { gain: gain(), connect() {} };
    },
    createOscillator() {
      calls.push("osc");
      return {
        type: "sine",
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        start() {},
        stop() {},
      };
    },
    createBuffer(_ch, n) {
      return { getChannelData: () => new Float32Array(n) };
    },
    createBufferSource() {
      calls.push("noise");
      return { buffer: null, connect() {}, start() {}, stop() {} };
    },
    createBiquadFilter() {
      return {
        type: "",
        frequency: { value: 0 },
        Q: { value: 0 },
        connect() {},
      };
    },
  };
  const audio = createPirateAudio({ factory: () => ctx });
  audio.setMuted(true);
  audio.startBed();
  audio.cue("shot");
  assert.equal(calls.length, 0);
  audio.setMuted(false);
  audio.cue("shot");
  audio.cue("enemy-shot");
  audio.cue("hit");
  audio.cue("player-hit");
  audio.cue("sink");
  audio.cue("wreck");
  audio.cue("blast");
  audio.cue("upgrade");
  audio.cue("prestige");
  audio.cue("horn");
  audio.startBed();
  assert.ok(calls.includes("osc"));
  assert.ok(calls.includes("noise"));
  audio.stopBed();
  audio.dispose();
});
