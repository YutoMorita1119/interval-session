import test from "node:test";
import assert from "node:assert/strict";

import {
  acknowledgeTutorialOverview,
  beginOpponentWait,
  commitTutorialTurn,
  completeTutorial,
  createTutorialState,
  markBaseNoteRemoved,
  markHistoryPlaybackPracticed,
  markNoteAdded,
  markOpponentNoteRemoved,
  markPlaybackCompleted,
  markPlaybackStarted,
  markRecordCompleted,
  openTutorialHistory,
  receiveOpponentResponse,
  revealTutorialPrompt,
  reviewTutorialResult,
  startTutorial,
} from "../src/tutorial-domain.js";

test("チュートリアルを開始すると実ゲームの全体説明を表示する", () => {
  const state = startTutorial(createTutorialState());
  assert.equal(state.stage, "overview");
  assert.equal(state.active, true);
  assert.equal(state.completed, false);
});

test("全体説明の後は自分のお題を確認する", () => {
  const overview = startTutorial(createTutorialState());
  const prompt = acknowledgeTutorialOverview(overview);
  assert.equal(prompt.stage, "prompt");
  assert.equal(revealTutorialPrompt(prompt).stage, "edit");
});

function reachPlayback() {
  return markNoteAdded(markOpponentNoteRemoved(markBaseNoteRemoved(
    revealTutorialPrompt(acknowledgeTutorialOverview(startTutorial(createTutorialState()))),
  )));
}

const validRecord = Object.freeze({
  interpretation: "落ち着いた響きに感じた",
  intention: "少し明るい音を加えた",
  guess: "お題B",
});

test("基本和音と相手音の削除，自分音の追加をすべて行うまで編集を完了しない", () => {
  const edit = revealTutorialPrompt(acknowledgeTutorialOverview(startTutorial(createTutorialState())));
  assert.equal(markBaseNoteRemoved(edit).stage, "edit");
  assert.equal(markNoteAdded(edit).stage, "edit");
  assert.equal(markOpponentNoteRemoved(markBaseNoteRemoved(edit)).stage, "edit");
  assert.equal(reachPlayback().stage, "playback");
});

test("全体再生は開始だけでは完了せず，停止または自然終了してから記録へ進む", () => {
  const playback = reachPlayback();
  const playing = markPlaybackStarted(playback);

  assert.equal(playing.stage, "playback");
  assert.equal(playing.playbackStarted, true);
  assert.equal(markPlaybackCompleted(playback).stage, "playback");
  assert.equal(markPlaybackCompleted(playing).stage, "record");
});

test("記録をすべて入力すると確定可能になり，消すと確定不能へ戻る", () => {
  const record = markPlaybackCompleted(markPlaybackStarted(reachPlayback()));
  assert.equal(record.stage, "record");
  const ready = markRecordCompleted(record, validRecord);
  assert.equal(ready.stage, "commit");
  assert.equal(markRecordCompleted(ready, {
    interpretation: "",
    intention: "少し明るい音を加えた",
    guess: "お題B",
  }).stage, "record");
});

test("ターン確定時にも三項目を再検証する", () => {
  const ready = markRecordCompleted(markPlaybackCompleted(markPlaybackStarted(reachPlayback())), validRecord);

  assert.equal(commitTutorialTurn(ready, validRecord).stage, "committed");
  assert.equal(commitTutorialTurn(ready, { ...validRecord, guess: "" }).stage, "record");
});

test("確定後に待機し，相手の応答を受けて履歴確認へ進む", () => {
  const commit = markRecordCompleted(markPlaybackCompleted(markPlaybackStarted(reachPlayback())), validRecord);
  const waiting = beginOpponentWait(commitTutorialTurn(commit, validRecord));
  assert.equal(waiting.stage, "waiting");
  assert.equal(receiveOpponentResponse(waiting).stage, "response");
  assert.equal(openTutorialHistory(receiveOpponentResponse(waiting)).stage, "history");
});

test("履歴の音を再生するまで結果へ進めない", () => {
  const history = { ...createTutorialState(), active: true, stage: "history" };
  const resultData = {
    myGuess: "お題B",
    opponentPrompt: "お題B",
    opponentGuess: "お題A",
    myPrompt: "お題A",
  };

  assert.equal(reviewTutorialResult(history, resultData), history);
  const practiced = markHistoryPlaybackPracticed(history);
  assert.equal(practiced.historyPlaybackPracticed, true);
  assert.equal(reviewTutorialResult(practiced, resultData).stage, "result");
});

test("履歴再生後に結果を確認し，終了すると初期画面へ戻れる", () => {
  const history = markHistoryPlaybackPracticed({ ...createTutorialState(), active: true, stage: "history" });
  const result = reviewTutorialResult(history, {
    myGuess: "お題B", opponentPrompt: "お題B", opponentGuess: "お題A", myPrompt: "お題A",
  });
  assert.equal(result.stage, "result");
  assert.deepEqual(result.result, { mineMatches: true, opponentMatches: true });
  assert.deepEqual(completeTutorial(result), {
    ...result,
    stage: "finished",
    active: false,
    completed: true,
  });
});

test("想定外の段階から先へ進む操作は状態を変えない", () => {
  const initial = createTutorialState();
  assert.equal(revealTutorialPrompt(initial), initial);
  assert.equal(commitTutorialTurn(initial), initial);
  assert.equal(receiveOpponentResponse(initial), initial);
  assert.equal(completeTutorial(initial), initial);
});
