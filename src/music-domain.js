const PITCH_CLASS_TO_SEMITONE = Object.freeze({
  C: 0,
  "C#": 1,
  D: 2,
  "D#": 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
  A: 9,
  "A#": 10,
  B: 11,
});

const DEGREE_BY_SEMITONE = Object.freeze([
  "R",
  "b9",
  "9",
  "m3",
  "M3",
  "11",
  "#11",
  "5",
  "b13",
  "13",
  "m7",
  "M7",
]);

const ROLE_BY_CONTEXT = Object.freeze({
  Major: Object.freeze({
    chord: Object.freeze(["R", "M3", "5", "M7"]),
    tension: Object.freeze(["9", "13"]),
  }),
  Dominant: Object.freeze({
    chord: Object.freeze(["R", "M3", "5", "m7"]),
    tension: Object.freeze(["b9", "9", "#11", "b13", "13"]),
  }),
});

export function noteToMidi(noteName) {
  const match = /^([A-G](?:#)?)(-?\d+)$/.exec(noteName);
  if (!match) {
    throw new TypeError(`Invalid note name: ${noteName}`);
  }

  const [, pitchClass, octaveText] = match;
  return (Number(octaveText) + 1) * 12 + PITCH_CLASS_TO_SEMITONE[pitchClass];
}

export function noteToFrequency(noteName) {
  return 440 * 2 ** ((noteToMidi(noteName) - 69) / 12);
}

export function classifyNoteRole(rootNote, targetNote, context) {
  const roleDefinition = ROLE_BY_CONTEXT[context];
  if (!roleDefinition) {
    throw new TypeError(`Unsupported harmonic context: ${context}`);
  }

  const semitones = ((noteToMidi(targetNote) - noteToMidi(rootNote)) % 12 + 12) % 12;
  const degree = DEGREE_BY_SEMITONE[semitones];
  const role = roleDefinition.chord.includes(degree)
    ? "chord"
    : roleDefinition.tension.includes(degree)
      ? "tension"
      : "avoid";

  return { degree, role };
}

export function placeNote(notes, candidate, { maxNotesPerChord = 8 } = {}) {
  const allNotesInChord = notes.filter((note) => note.bar === candidate.bar);
  const isDuplicate = allNotesInChord.some((note) => note.pitch === candidate.pitch);

  if (isDuplicate) {
    return { outcome: "duplicate", notes: [...notes] };
  }
  if (allNotesInChord.length >= maxNotesPerChord) {
    return { outcome: "chord-full", notes: [...notes] };
  }

  return { outcome: "placed", notes: [...notes, { ...candidate }] };
}

export function removeNote(notes, { bar, pitch }) {
  const matchingNotes = notes.filter((note) => note.bar === bar && note.pitch === pitch);

  if (matchingNotes.length) {
    return {
      outcome: "removed",
      notes: notes.filter(
        (note) => note.bar !== bar || note.pitch !== pitch,
      ),
    };
  }

  return {
    outcome: "not-found",
    notes: [...notes],
  };
}

export function normalizeBoardNotes(notes, {
  validPitches,
  chordCount,
  maxNotesPerChord = 8,
}) {
  const allowedPitches = new Set(validPitches);
  let normalizedNotes = [];

  for (const note of Array.isArray(notes) ? notes : []) {
    if (!note || !allowedPitches.has(note.pitch)
      || !["system", "host", "guest"].includes(note.owner)
      || !Number.isInteger(note.bar) || note.bar < 0 || note.bar >= chordCount) continue;

    const placed = placeNote(normalizedNotes, {
      pitch: note.pitch,
      bar: note.bar,
      beat: 0,
      durationBeats: 4,
      owner: note.owner,
    }, { maxNotesPerChord });
    normalizedNotes = placed.notes;
  }

  return normalizedNotes;
}
