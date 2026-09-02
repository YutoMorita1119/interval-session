import test from "node:test";
import assert from "node:assert/strict";

import { buildPlaybackSchedule } from "../src/audio-schedule.js";

test("メロディと伴奏をBPMに基づく決定的な再生予定へ変換する", () => {
  const schedule = buildPlaybackSchedule({
    bpm: 120,
    beatsPerBar: 4,
    melodyNotes: [
      { bar: 0, beat: 2, pitch: "G4", durationBeats: 1 },
      { bar: 0, beat: 0, pitch: "C4", durationBeats: 1 },
    ],
    accompanimentNotes: [
      { bar: 1, beat: 2, pitch: "E3", durationBeats: 2 },
      { bar: 0, beat: 0, pitch: "C3", durationBeats: 4 },
    ],
  });

  assert.deepEqual(schedule, [
    {
      voice: "melody",
      pitch: "C4",
      frequency: 261.6255653005986,
      startSeconds: 0,
      durationSeconds: 0.5,
    },
    {
      voice: "accompaniment",
      pitch: "C3",
      frequency: 130.8127826502993,
      startSeconds: 0,
      durationSeconds: 2,
    },
    {
      voice: "melody",
      pitch: "G4",
      frequency: 391.99543598174927,
      startSeconds: 1,
      durationSeconds: 0.5,
    },
    {
      voice: "accompaniment",
      pitch: "E3",
      frequency: 164.81377845643496,
      startSeconds: 3,
      durationSeconds: 1,
    },
  ]);
});

test("4和音の伴奏音を各和音の先頭から4拍分再生する", () => {
  const schedule = buildPlaybackSchedule({
    bpm: 120,
    accompanimentNotes: [
      { bar: 0, pitch: "C4" },
      { bar: 3, pitch: "E4" },
    ],
  });

  assert.deepEqual(schedule.map(({ startSeconds, durationSeconds }) => ({ startSeconds, durationSeconds })), [
    { startSeconds: 0, durationSeconds: 2 },
    { startSeconds: 6, durationSeconds: 2 },
  ]);
});
