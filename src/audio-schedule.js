import { noteToFrequency } from "./music-domain.js";

const VOICE_ORDER = Object.freeze({ melody: 0, accompaniment: 1 });

export function buildPlaybackSchedule({
  melodyNotes = [],
  accompanimentNotes = [],
  bpm,
  beatsPerBar = 4,
}) {
  const secondsPerBeat = 60 / bpm;
  const toEvent = (voice) => (note) => ({
    voice,
    pitch: note.pitch,
    frequency: noteToFrequency(note.pitch),
    startSeconds: (note.bar * beatsPerBar + note.beat) * secondsPerBeat,
    durationSeconds: note.durationBeats * secondsPerBeat,
  });

  return [
    ...melodyNotes.map(toEvent("melody")),
    ...accompanimentNotes.map(toEvent("accompaniment")),
  ].sort(
    (left, right) =>
      left.startSeconds - right.startSeconds ||
      VOICE_ORDER[left.voice] - VOICE_ORDER[right.voice] ||
      left.frequency - right.frequency,
  );
}
