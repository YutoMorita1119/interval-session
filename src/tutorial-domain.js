export function createTutorialState() {
  return Object.freeze({
    step: 1,
    placementPracticed: false,
    playbackPracticed: false,
    submissionPracticed: false,
    completed: false,
  });
}

export function markPlacementPracticed(state) {
  return Object.freeze({ ...state, placementPracticed: true });
}

export function markPlaybackPracticed(state) {
  return Object.freeze({ ...state, playbackPracticed: true });
}

export function markSubmissionPracticed(state) {
  return Object.freeze({ ...state, submissionPracticed: true });
}

export function moveToNextStep(state) {
  const canAdvance = state.step === 1
    || (state.step === 2 && state.placementPracticed && state.playbackPracticed);
  if (!canAdvance || state.step >= 3) return state;
  return Object.freeze({ ...state, step: state.step + 1 });
}

export function completeTutorial(state) {
  return Object.freeze({ ...state, completed: true });
}
