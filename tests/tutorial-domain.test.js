import test from "node:test";
import assert from "node:assert/strict";

import {
  completeTutorial,
  createTutorialState,
  markPlacementPracticed,
  markPlaybackPracticed,
  markSubmissionPracticed,
  moveToNextStep,
} from "../src/tutorial-domain.js";

test("参加方法を確認すると配置練習へ進む", () => {
  const initial = createTutorialState();

  assert.deepEqual(initial, {
    step: 1,
    placementPracticed: false,
    playbackPracticed: false,
    submissionPracticed: false,
    completed: false,
  });
  assert.equal(moveToNextStep(initial).step, 2);
});

test("配置と再生の両方を試すまで記録説明へ進めない", () => {
  const stepTwo = moveToNextStep(createTutorialState());
  assert.deepEqual(moveToNextStep(stepTwo), stepTwo);

  const onlyPlaced = markPlacementPracticed(stepTwo);
  assert.deepEqual(moveToNextStep(onlyPlaced), onlyPlaced);

  const practiced = markPlaybackPracticed(onlyPlaced);
  assert.equal(moveToNextStep(practiced).step, 3);
});

test("最後まで進むかスキップすると完了する", () => {
  const initial = createTutorialState();
  const finalStep = moveToNextStep(markPlaybackPracticed(markPlacementPracticed(
    moveToNextStep(initial),
  )));

  assert.equal(completeTutorial(finalStep).completed, true);
  assert.equal(completeTutorial(initial).completed, true);
});

test("記録の模擬送信を完了として記録する", () => {
  const initial = createTutorialState();
  const submitted = markSubmissionPracticed(initial);

  assert.equal(submitted.submissionPracticed, true);
  assert.equal(submitted.completed, false);
});
