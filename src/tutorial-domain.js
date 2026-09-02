export function createTutorialState() {
  return Object.freeze({
    step: 1,
    baseNoteRemoved: false,
    noteAdded: false,
    playbackPracticed: false,
    resultReviewed: false,
    result: null,
    completed: false,
  });
}

export function markBaseNoteRemoved(state) {
  return Object.freeze({ ...state, baseNoteRemoved: true });
}

export function markNoteAdded(state) {
  return Object.freeze({ ...state, noteAdded: true });
}

export function markPlaybackPracticed(state) {
  return Object.freeze({ ...state, playbackPracticed: true });
}

export function moveToNextStep(state) {
  const canAdvance = state.step === 1
    || (state.step === 2
      && state.baseNoteRemoved
      && state.noteAdded
      && state.playbackPracticed);
  if (!canAdvance || state.step >= 3) return state;
  return Object.freeze({ ...state, step: state.step + 1 });
}

export function reviewTutorialResult(state, { guess, actualPrompt }) {
  if (state.step !== 3) return state;

  const result = Object.freeze({
    guess,
    actualPrompt,
    matches: guess === actualPrompt,
  });
  return Object.freeze({ ...state, resultReviewed: true, result });
}

export function completeTutorial(state) {
  if (state.step !== 3 || !state.resultReviewed) return state;
  return Object.freeze({ ...state, completed: true });
}
