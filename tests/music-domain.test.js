import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyNoteRole,
  noteToFrequency,
  noteToMidi,
  placeNote,
} from "../src/music-domain.js";

test("音名をMIDI番号と周波数へ変換できる", () => {
  assert.equal(noteToMidi("C4"), 60);
  assert.equal(noteToMidi("A4"), 69);
  assert.equal(noteToFrequency("A4"), 440);
  assert.ok(Math.abs(noteToFrequency("C4") - 261.625565) < 0.000001);
});

test("同じ拍と音程の重複を防ぎ，拍ごとの音数上限を守る", () => {
  const first = placeNote([], { bar: 0, beat: 1, pitch: "C4" }, { maxNotesPerBeat: 2 });
  assert.deepEqual(first, {
    outcome: "placed",
    notes: [{ bar: 0, beat: 1, pitch: "C4" }],
  });

  const duplicate = placeNote(first.notes, { bar: 0, beat: 1, pitch: "C4" }, { maxNotesPerBeat: 2 });
  assert.equal(duplicate.outcome, "duplicate");
  assert.equal(duplicate.notes.length, 1);

  const second = placeNote(first.notes, { bar: 0, beat: 1, pitch: "E4" }, { maxNotesPerBeat: 2 });
  const full = placeNote(second.notes, { bar: 0, beat: 1, pitch: "G4" }, { maxNotesPerBeat: 2 });
  assert.equal(full.outcome, "beat-full");
  assert.equal(full.notes.length, 2);
});

test("基本伴奏は参加者が追加できる音数の上限に含めない", () => {
  const systemNotes = ["G4", "B4", "D5", "F5"].map((pitch) => ({
    bar: 2, beat: 0, pitch, owner: "system",
  }));

  const result = placeNote(systemNotes, {
    bar: 2, beat: 0, pitch: "A4", owner: "host",
  });

  assert.equal(result.outcome, "placed");
  assert.equal(result.notes.length, 5);
});

test("MajorとDominantのコード文脈に応じて度数の役割を分類できる", () => {
  assert.deepEqual(classifyNoteRole("C3", "E4", "Major"), {
    degree: "M3",
    role: "chord",
  });
  assert.deepEqual(classifyNoteRole("C3", "F4", "Major"), {
    degree: "11",
    role: "avoid",
  });
  assert.deepEqual(classifyNoteRole("G3", "F4", "Dominant"), {
    degree: "m7",
    role: "chord",
  });
  assert.deepEqual(classifyNoteRole("G3", "A4", "Dominant"), {
    degree: "9",
    role: "tension",
  });
});
