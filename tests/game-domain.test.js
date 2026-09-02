import assert from "node:assert/strict";
import test from "node:test";

import {
  commitTurn,
  createSession,
  getBidirectionalFinalGuessResults,
  getFinalGuessResult,
  getFinalTurnNumberForRole,
  getSessionView,
  hasCurrentBoardSnapshot,
  joinSession,
} from "../src/game-domain.js";

test("7ターン制の最終担当ターンを役割ごとに求める", () => {
  assert.equal(getFinalTurnNumberForRole("host", 7), 7);
  assert.equal(getFinalTurnNumberForRole("guest", 7), 6);
  assert.equal(getFinalTurnNumberForRole("guest", 1), null);
});

test("双方の最終予想を互いのお題と交差して判定する", () => {
  assert.deepEqual(getBidirectionalFinalGuessResults({
    role: "host",
    maxTurns: 7,
    myPrompt: "氷の結晶",
    opponentPrompt: "流星群",
    myReflections: [{ turnNumber: 7, guess: "流星群" }],
    opponentReflections: [{ turnNumber: 6, guess: "ガラスの破片" }],
  }), {
    mine: { guess: "流星群", isCorrect: true },
    opponent: { guess: "ガラスの破片", isCorrect: false },
  });
});

test("双方の最終予想が揃うまでは双方向の判定を返さない", () => {
  assert.equal(getBidirectionalFinalGuessResults({
    role: "guest",
    maxTurns: 7,
    myPrompt: "流星群",
    opponentPrompt: "氷の結晶",
    myReflections: [{ turnNumber: 6, guess: "氷の結晶" }],
    opponentReflections: [{ turnNumber: 5, guess: "流星群" }],
  }), null);
});

test("役割ごとの最終担当ターンの予想を相手のお題と照合できる", () => {
  assert.deepEqual(getFinalGuessResult([
    { turnNumber: 1, guess: "" },
    { turnNumber: 3, guess: "氷の結晶" },
    { turnNumber: 5, guess: "" },
    { turnNumber: 7, guess: "流星群" },
  ], "流星群", 7), {
    guess: "流星群",
    isCorrect: true,
  });

  assert.deepEqual(getFinalGuessResult([
    { turnNumber: 2, guess: "流星群" },
    { turnNumber: 4, guess: "氷の結晶" },
    { turnNumber: 6, guess: "樹齢を重ねた大木" },
  ], "流星群", 6), {
    guess: "樹齢を重ねた大木",
    isCorrect: false,
  });
});

test("最終担当ターンまたは相手のお題が未準備なら判定を返さない", () => {
  assert.equal(getFinalGuessResult([], "流星群", 7), null);
  assert.equal(getFinalGuessResult([{ turnNumber: 5, guess: "流星群" }], "流星群", 7), null);
  assert.equal(getFinalGuessResult([{ turnNumber: 7, guess: "" }], "流星群", 7), null);
  assert.equal(getFinalGuessResult([{ turnNumber: 7, guess: "流星群" }], null, 7), null);
});

test("最終予想と相手のお題は文字列を変換せず厳密一致で判定する", () => {
  assert.deepEqual(
    getFinalGuessResult([{ turnNumber: 7, guess: " 流星群 " }], "流星群", 7),
    { guess: " 流星群 ", isCorrect: false },
  );
});

test("現在の手番に対応する確定盤面が届くまで編集を待つ", () => {
  assert.equal(hasCurrentBoardSnapshot(null, 0), false);
  assert.equal(hasCurrentBoardSnapshot({ status: "waiting", turnNumber: 1, maxTurns: 7 }, 0), true);
  assert.equal(hasCurrentBoardSnapshot({ status: "active", turnNumber: 4, maxTurns: 7 }, 2), false);
  assert.equal(hasCurrentBoardSnapshot({ status: "active", turnNumber: 4, maxTurns: 7 }, 3), true);
  assert.equal(hasCurrentBoardSnapshot({ status: "active", turnNumber: 4, maxTurns: 7 }, 4), false);
  assert.equal(hasCurrentBoardSnapshot({ status: "completed", turnNumber: 7, maxTurns: 7 }, 6), false);
  assert.equal(hasCurrentBoardSnapshot({ status: "completed", turnNumber: 7, maxTurns: 7 }, 7), true);
});

test("ホストが7ターン制の待機中セッションを作成できる", () => {
  const session = createSession({
    id: "session-1",
    hostId: "host-uid",
    prompts: { host: "穏やか", guest: "緊張" },
    initialNotes: [{ pitch: "C4", bar: 0, beat: 0, duration: 4 }],
  });

  assert.equal(session.id, "session-1");
  assert.equal(session.status, "waiting");
  assert.equal(session.maxTurns, 7);
  assert.equal(session.turnNumber, 1);
  assert.equal(session.currentParticipantId, "host-uid");
  assert.deepEqual(session.participants, {
    host: "host-uid",
    guest: null,
  });
  assert.deepEqual(session.notes, [
    { pitch: "C4", bar: 0, beat: 0, duration: 4 },
  ]);
  assert.deepEqual(session.turns, []);
  assert.equal(session.revealed, false);
});

test("2人目が参加するとセッションが開始される", () => {
  const waitingSession = createSession({
    id: "session-1",
    hostId: "host-uid",
    prompts: { host: "穏やか", guest: "緊張" },
  });

  const activeSession = joinSession(waitingSession, {
    participantId: "guest-uid",
  });

  assert.equal(activeSession.status, "active");
  assert.deepEqual(activeSession.participants, {
    host: "host-uid",
    guest: "guest-uid",
  });
  assert.equal(activeSession.currentParticipantId, "host-uid");
  assert.equal(waitingSession.status, "waiting");
  assert.equal(waitingSession.participants.guest, null);
});

test("手番の参加者が盤面と振り返りを確定すると次の参加者へ進む", () => {
  const session = joinSession(
    createSession({
      id: "session-1",
      hostId: "host-uid",
      prompts: { host: "穏やか", guest: "緊張" },
    }),
    { participantId: "guest-uid" },
  );
  const notes = [{ pitch: "E4", bar: 1, beat: 2, duration: 1 }];
  const reflection = {
    hypothesis: "落ち着いた表現だと思った",
    intention: "少し明るさを加えた",
    guess: "穏やか",
  };

  const nextSession = commitTurn(session, {
    participantId: "host-uid",
    notes,
    reflection,
  });

  assert.equal(nextSession.turnNumber, 2);
  assert.equal(nextSession.currentParticipantId, "guest-uid");
  assert.deepEqual(nextSession.notes, notes);
  assert.deepEqual(nextSession.turns, [
    {
      number: 1,
      participantId: "host-uid",
      notes,
      reflection,
    },
  ]);
  assert.equal(session.turnNumber, 1);
  assert.deepEqual(session.turns, []);
});

test("手番ではない参加者はターンを確定できない", () => {
  const session = joinSession(
    createSession({
      id: "session-1",
      hostId: "host-uid",
      prompts: { host: "穏やか", guest: "緊張" },
    }),
    { participantId: "guest-uid" },
  );

  assert.throws(
    () =>
      commitTurn(session, {
        participantId: "guest-uid",
        notes: [],
        reflection: {},
      }),
    (error) => {
      assert.equal(error.name, "GameDomainError");
      assert.equal(error.code, "NOT_YOUR_TURN");
      return true;
    },
  );
  assert.equal(session.turnNumber, 1);
  assert.deepEqual(session.turns, []);
});

test("7ターン目の確定でゲームが完了し，秘密が開示可能になる", () => {
  let session = joinSession(
    createSession({
      id: "session-1",
      hostId: "host-uid",
      prompts: { host: "穏やか", guest: "緊張" },
    }),
    { participantId: "guest-uid" },
  );

  for (let number = 1; number <= 7; number += 1) {
    session = commitTurn(session, {
      participantId: number % 2 === 1 ? "host-uid" : "guest-uid",
      notes: [{ pitch: "C4", bar: 0, beat: number - 1, duration: 1 }],
      reflection: { guess: number === 7 ? "緊張" : "" },
    });
  }

  assert.equal(session.status, "completed");
  assert.equal(session.turnNumber, 7);
  assert.equal(session.currentParticipantId, null);
  assert.equal(session.turns.length, 7);
  assert.equal(session.turns.at(-1).number, 7);
  assert.equal(session.revealed, true);
});

test("相手のお題と振り返りは完了まで隠し，完了後に開示する", () => {
  let session = joinSession(
    createSession({
      id: "session-1",
      hostId: "host-uid",
      prompts: { host: "穏やか", guest: "緊張" },
    }),
    { participantId: "guest-uid" },
  );

  session = commitTurn(session, {
    participantId: "host-uid",
    notes: [],
    reflection: { intention: "安定感を加える" },
  });
  session = commitTurn(session, {
    participantId: "guest-uid",
    notes: [],
    reflection: { hypothesis: "穏やかだと思う" },
  });

  const activeHostView = getSessionView(session, {
    participantId: "host-uid",
  });
  assert.deepEqual(activeHostView.prompts, {
    mine: "穏やか",
    opponent: null,
  });
  assert.deepEqual(activeHostView.turns[1].reflection, null);

  for (let number = 3; number <= 7; number += 1) {
    session = commitTurn(session, {
      participantId: number % 2 === 1 ? "host-uid" : "guest-uid",
      notes: [],
      reflection: { guess: "" },
    });
  }

  const completedHostView = getSessionView(session, {
    participantId: "host-uid",
  });
  assert.deepEqual(completedHostView.prompts, {
    mine: "穏やか",
    opponent: "緊張",
  });
  assert.deepEqual(completedHostView.turns[1].reflection, {
    hypothesis: "穏やかだと思う",
  });
});
