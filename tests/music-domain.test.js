import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyNoteRole,
  normalizeBoardNotes,
  noteToFrequency,
  noteToMidi,
  placeNote,
  removeNote,
} from "../src/music-domain.js";

test("音名をMIDI番号と周波数へ変換できる", () => {
  assert.equal(noteToMidi("C4"), 60);
  assert.equal(noteToMidi("A4"), 69);
  assert.equal(noteToFrequency("A4"), 440);
  assert.ok(Math.abs(noteToFrequency("C4") - 261.625565) < 0.000001);
});

test("同じ和音と音程の重複を防ぎ，和音ごとの音数上限を守る", () => {
  const first = placeNote([], { bar: 0, beat: 0, pitch: "C4" }, { maxNotesPerChord: 2 });
  assert.deepEqual(first, {
    outcome: "placed",
    notes: [{ bar: 0, beat: 0, pitch: "C4" }],
  });

  const duplicate = placeNote(first.notes, { bar: 0, beat: 3, pitch: "C4" }, { maxNotesPerChord: 2 });
  assert.equal(duplicate.outcome, "duplicate");
  assert.equal(duplicate.notes.length, 1);

  const second = placeNote(first.notes, { bar: 0, beat: 2, pitch: "E4" }, { maxNotesPerChord: 2 });
  const full = placeNote(second.notes, { bar: 0, beat: 0, pitch: "G4" }, { maxNotesPerChord: 2 });
  assert.equal(full.outcome, "chord-full");
  assert.equal(full.notes.length, 2);
});

test("基本和音を含むすべての音を和音ごとの上限に数える", () => {
  const systemNotes = ["G4", "B4", "D5", "F5"].map((pitch) => ({
    bar: 2, beat: 0, pitch, owner: "system",
  }));

  const participantPitches = ["A4", "C5", "E5", "G5"];
  const eightNotes = participantPitches.reduce(
    (notes, pitch) => placeNote(notes, { bar: 2, beat: 0, pitch, owner: "host" }).notes,
    systemNotes,
  );

  assert.equal(eightNotes.length, 8);
  assert.equal(
    placeNote(eightNotes, { bar: 2, beat: 0, pitch: "C#5", owner: "guest" }).outcome,
    "chord-full",
  );
});

test("通常手番の削除操作では所有者を問わず音を削除できる", () => {
  const notes = [
    { bar: 1, beat: 0, pitch: "F4", owner: "system" },
    { bar: 1, beat: 0, pitch: "A4", owner: "host" },
    { bar: 1, beat: 0, pitch: "C5", owner: "guest" },
  ];

  const withoutGuest = removeNote(notes, { bar: 1, pitch: "C5" });
  assert.deepEqual(withoutGuest, {
    outcome: "removed",
    notes: notes.slice(0, 2),
  });
  assert.deepEqual(removeNote(withoutGuest.notes, { bar: 1, pitch: "A4" }), {
    outcome: "removed",
    notes: [notes[0]],
  });
  assert.deepEqual(removeNote(notes, { bar: 1, pitch: "F4" }), {
    outcome: "removed",
    notes: notes.slice(1),
  });
});

test("保存された空の盤面を正規化しても基本和音を復元しない", () => {
  assert.deepEqual(normalizeBoardNotes([], {
    validPitches: ["C4", "E4", "G4"],
    chordCount: 4,
  }), []);
});

test("基本和音と参加者音の所有者を保ったまま盤面を正規化する", () => {
  assert.deepEqual(normalizeBoardNotes([
    { bar: 0, beat: 2, pitch: "C4", durationBeats: 1, owner: "system" },
    { bar: 1, pitch: "E4", owner: "guest" },
    { bar: 7, pitch: "G4", owner: "host" },
    { bar: 2, pitch: "X4", owner: "host" },
  ], {
    validPitches: ["C4", "E4", "G4"],
    chordCount: 4,
  }), [
    { bar: 0, beat: 0, pitch: "C4", durationBeats: 4, owner: "system" },
    { bar: 1, beat: 0, pitch: "E4", durationBeats: 4, owner: "guest" },
  ]);
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
