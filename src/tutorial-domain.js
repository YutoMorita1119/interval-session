export function createTutorialState() {
  return Object.freeze({
    stage: "start",
    active: false,
    baseNoteRemoved: false,
    opponentNoteRemoved: false,
    noteAdded: false,
    playbackStarted: false,
    playbackPracticed: false,
    recordCompleted: false,
    historyPlaybackPracticed: false,
    result: null,
    completed: false,
  });
}

function moveFrom(state, expectedStage, nextStage, additions = {}) {
  if (state.stage !== expectedStage) return state;
  return Object.freeze({ ...state, ...additions, stage: nextStage });
}

export function startTutorial(state) {
  return moveFrom(state, "start", "overview", { active: true });
}

export function acknowledgeTutorialOverview(state) {
  return moveFrom(state, "overview", "prompt");
}

export function revealTutorialPrompt(state) {
  return moveFrom(state, "prompt", "edit");
}

export function markBaseNoteRemoved(state) {
  if (state.stage !== "edit") return state;
  const next = Object.freeze({ ...state, baseNoteRemoved: true });
  return finishEditingIfReady(next);
}

export function markOpponentNoteRemoved(state) {
  if (state.stage !== "edit") return state;
  const next = Object.freeze({ ...state, opponentNoteRemoved: true });
  return finishEditingIfReady(next);
}

export function markNoteAdded(state) {
  if (state.stage !== "edit") return state;
  const next = Object.freeze({ ...state, noteAdded: true });
  return finishEditingIfReady(next);
}

function finishEditingIfReady(state) {
  return state.baseNoteRemoved && state.opponentNoteRemoved && state.noteAdded
    ? Object.freeze({ ...state, stage: "playback" })
    : state;
}

export function markPlaybackStarted(state) {
  if (state.stage !== "playback") return state;
  return Object.freeze({ ...state, playbackStarted: true });
}

export function markPlaybackCompleted(state) {
  if (state.stage !== "playback" || !state.playbackStarted) return state;
  return moveFrom(state, "playback", "record", { playbackPracticed: true });
}

export function markRecordCompleted(state, { interpretation, intention, guess }) {
  if (!["record", "commit"].includes(state.stage)) return state;
  const valid = Boolean(interpretation?.trim() && intention?.trim() && guess?.trim());
  return Object.freeze({ ...state, stage: valid ? "commit" : "record", recordCompleted: valid });
}

export function commitTutorialTurn(state, record) {
  if (state.stage !== "commit") return state;
  const validated = markRecordCompleted(state, record);
  return validated.stage === "commit"
    ? moveFrom(validated, "commit", "committed")
    : validated;
}

export function beginOpponentWait(state) {
  return moveFrom(state, "committed", "waiting");
}

export function receiveOpponentResponse(state) {
  return moveFrom(state, "waiting", "response");
}

export function openTutorialHistory(state) {
  return moveFrom(state, "response", "history");
}

export function markHistoryPlaybackPracticed(state) {
  if (state.stage !== "history") return state;
  return Object.freeze({ ...state, historyPlaybackPracticed: true });
}

export function reviewTutorialResult(state, {
  myGuess,
  opponentPrompt,
  opponentGuess,
  myPrompt,
}) {
  if (state.stage !== "history" || !state.historyPlaybackPracticed) return state;
  return Object.freeze({
    ...state,
    stage: "result",
    result: Object.freeze({
      mineMatches: myGuess === opponentPrompt,
      opponentMatches: opponentGuess === myPrompt,
    }),
  });
}

export function completeTutorial(state) {
  if (state.stage !== "result") return state;
  return Object.freeze({ ...state, stage: "finished", active: false, completed: true });
}
