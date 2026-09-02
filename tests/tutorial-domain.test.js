import test from "node:test";
import assert from "node:assert/strict";

import {
  completeTutorial,
  createTutorialState,
  markBaseNoteRemoved,
  markNoteAdded,
  markPlaybackPracticed,
  moveToNextStep,
  reviewTutorialResult,
} from "../src/tutorial-domain.js";

test("全体像から始まる新しいデモ状態を作成する", () => {
  const initial = createTutorialState();

  assert.deepEqual(initial, {
    step: 1,
    baseNoteRemoved: false,
    noteAdded: false,
    playbackPracticed: false,
    resultReviewed: false,
    result: null,
    completed: false,
  });
});

test("全体像を確認すると音の編集練習へ進む", () => {
  const initial = createTutorialState();

  assert.equal(moveToNextStep(initial).step, 2);
});

test("基本音削除・空きマス追加・再生のすべてを試すと結果確認へ進む", () => {
  const stepTwo = moveToNextStep(createTutorialState());
  assert.deepEqual(moveToNextStep(stepTwo), stepTwo);

  const removed = markBaseNoteRemoved(stepTwo);
  assert.deepEqual(moveToNextStep(removed), removed);

  const added = markNoteAdded(removed);
  assert.deepEqual(moveToNextStep(added), added);

  const practiced = markPlaybackPracticed(added);
  assert.equal(moveToNextStep(practiced).step, 3);
});

test("模擬履歴の最終予想と相手のお題が一致した結果を確認する", () => {
  const stepTwo = moveToNextStep(createTutorialState());
  const stepThree = moveToNextStep(markPlaybackPracticed(
    markNoteAdded(markBaseNoteRemoved(stepTwo)),
  ));

  const reviewed = reviewTutorialResult(stepThree, {
    guess: "お題B",
    actualPrompt: "お題B",
  });

  assert.equal(reviewed.resultReviewed, true);
  assert.deepEqual(reviewed.result, {
    guess: "お題B",
    actualPrompt: "お題B",
    matches: true,
  });
});

test("結果を確認してからデモを完了し，再開始すると初期状態へ戻る", () => {
  const stepTwo = moveToNextStep(createTutorialState());
  const stepThree = moveToNextStep(markPlaybackPracticed(
    markNoteAdded(markBaseNoteRemoved(stepTwo)),
  ));

  assert.deepEqual(completeTutorial(stepThree), stepThree);

  const reviewed = reviewTutorialResult(stepThree, {
    guess: "お題B",
    actualPrompt: "お題B",
  });
  const completed = completeTutorial(reviewed);
  assert.equal(completed.completed, true);

  assert.deepEqual(createTutorialState(), {
    step: 1,
    baseNoteRemoved: false,
    noteAdded: false,
    playbackPracticed: false,
    resultReviewed: false,
    result: null,
    completed: false,
  });
});
