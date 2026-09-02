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
  const participantNotesInChord = allNotesInChord.filter((note) => note.owner !== "system");
  const isDuplicate = allNotesInChord.some((note) => note.pitch === candidate.pitch);

  if (isDuplicate) {
    return { outcome: "duplicate", notes: [...notes] };
  }
  if (participantNotesInChord.length >= maxNotesPerChord) {
    return { outcome: "chord-full", notes: [...notes] };
  }

  return { outcome: "placed", notes: [...notes, { ...candidate }] };
}

export function removeParticipantNote(notes, { bar, pitch }) {
  const matchingNotes = notes.filter((note) => note.bar === bar && note.pitch === pitch);
  const hasParticipantNote = matchingNotes.some((note) => note.owner !== "system");

  if (hasParticipantNote) {
    return {
      outcome: "removed",
      notes: notes.filter(
        (note) => note.owner === "system" || note.bar !== bar || note.pitch !== pitch,
      ),
    };
  }

  return {
    outcome: matchingNotes.some((note) => note.owner === "system") ? "system-note" : "not-found",
    notes: [...notes],
  };
}
