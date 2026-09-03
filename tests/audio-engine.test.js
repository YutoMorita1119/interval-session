import test from "node:test";
import assert from "node:assert/strict";

import { createAudioEngine } from "../src/audio-engine.js";

function createFakeAudioContext() {
  const oscillators = [];
  const gains = [];
  const compressor = {
    threshold: { value: 0 },
    knee: { value: 0 },
    ratio: { value: 0 },
    attack: { value: 0 },
    release: { value: 0 },
    connect() {},
  };

  return {
    currentTime: 10,
    state: "suspended",
    destination: {},
    resumeCalls: 0,
    oscillators,
    gains,
    compressor,
    async resume() {
      this.resumeCalls += 1;
      this.state = "running";
    },
    createDynamicsCompressor() {
      return compressor;
    },
    createGain() {
      const gain = {
        value: 1,
        calls: [],
        setValueAtTime(value, at) {
          this.calls.push(["set", value, at]);
        },
        linearRampToValueAtTime(value, at) {
          this.calls.push(["ramp", value, at]);
        },
      };
      const node = { gain, connect() {}, disconnect() {} };
      gains.push(node);
      return node;
    },
    createOscillator() {
      const oscillator = {
        type: "sine",
        frequency: { value: 0 },
        starts: [],
        stops: [],
        connect() {},
        disconnect() {},
        start(at) {
          this.starts.push(at);
        },
        stop(at) {
          this.stops.push(at);
        },
      };
      oscillators.push(oscillator);
      return oscillator;
    },
  };
}

test("play時に全声部を同じ波形とpeak gainで再生し，安全な出力段を構成する", async () => {
  const context = createFakeAudioContext();
  let factoryCalls = 0;
  const engine = createAudioEngine({
    contextFactory: () => {
      factoryCalls += 1;
      return context;
    },
    requestFrame: () => 1,
    cancelFrame: () => {},
    setTimer: () => 1,
    clearTimer: () => {},
  });

  assert.equal(factoryCalls, 0);
  await engine.play([
    { voice: "melody", frequency: 440, startSeconds: 0, durationSeconds: 1 },
    { voice: "chord", frequency: 392, startSeconds: 0, durationSeconds: 1 },
    { voice: "accompaniment", frequency: 349.23, startSeconds: 0, durationSeconds: 1 },
    { voice: "host", frequency: 329.63, startSeconds: 0, durationSeconds: 1 },
    { voice: "guest", frequency: 261.63, startSeconds: 0, durationSeconds: 1 },
    { voice: "system", frequency: 220, startSeconds: 0, durationSeconds: 1 },
  ]);

  assert.equal(factoryCalls, 1);
  assert.equal(context.resumeCalls, 1);
  assert.equal(context.compressor.ratio.value, 20);
  assert.deepEqual(
    context.oscillators.map((oscillator) => oscillator.type),
    ["triangle", "triangle", "triangle", "triangle", "triangle", "triangle"],
  );
  assert.deepEqual(
    context.gains.slice(1).map((node) => node.gain.calls[1][1]),
    [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
  );
  assert.ok(context.gains.slice(1).every((node) => node.gain.calls.at(-1)[1] === 0.0001));
});

test("stopで発音中と予約済みの音，再生ヘッド，終了通知をキャンセルする", async () => {
  const context = createFakeAudioContext();
  const frames = new Map();
  const timers = new Map();
  const cancelledFrames = [];
  const clearedTimers = [];
  let nextId = 1;
  let endedCalls = 0;
  const engine = createAudioEngine({
    contextFactory: () => context,
    requestFrame: (callback) => {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => cancelledFrames.push(id),
    setTimer: (callback) => {
      const id = nextId++;
      timers.set(id, callback);
      return id;
    },
    clearTimer: (id) => clearedTimers.push(id),
  });

  await engine.play(
    [{ voice: "melody", frequency: 440, startSeconds: 2, durationSeconds: 1 }],
    { onPlayhead: () => {}, onEnded: () => (endedCalls += 1) },
  );
  engine.stop();

  assert.equal(context.oscillators[0].stops.at(-1), undefined);
  assert.deepEqual(cancelledFrames, [1]);
  assert.deepEqual(clearedTimers, [2]);
  timers.get(2)();
  assert.equal(endedCalls, 0);
});

test("再生ヘッドの進行と自然終了を通知する", async () => {
  const context = createFakeAudioContext();
  let frameCallback;
  let timerCallback;
  const playhead = [];
  let endedCalls = 0;
  const engine = createAudioEngine({
    contextFactory: () => context,
    requestFrame: (callback) => {
      frameCallback = callback;
      return 11;
    },
    cancelFrame: () => {},
    setTimer: (callback) => {
      timerCallback = callback;
      return 12;
    },
    clearTimer: () => {},
  });

  await engine.play(
    [{ voice: "chord", frequency: 220, startSeconds: 0, durationSeconds: 2 }],
    {
      onPlayhead: (state) => playhead.push(state),
      onEnded: () => (endedCalls += 1),
    },
  );
  context.currentTime = 11;
  frameCallback();
  timerCallback();

  assert.deepEqual(playhead[0], {
    elapsedSeconds: 0,
    progress: 0,
    totalDurationSeconds: 2,
  });
  assert.deepEqual(playhead[1], {
    elapsedSeconds: 1,
    progress: 0.5,
    totalDurationSeconds: 2,
  });
  assert.equal(endedCalls, 1);
});
