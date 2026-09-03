import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCreateSessionWrites,
  buildJoinSessionWrites,
  buildTurnCommitWrites,
  privateDocumentPath,
  reflectionsCollectionPath,
  reflectionDocumentPath,
  sessionDocumentPath,
  turnDocumentPath,
  visiblePrivateRoles,
} from '../src/firestore-contract.js';

test('公開セッション，確定ターン，非公開データの保存先を分離する', () => {
  assert.equal(sessionDocumentPath('ABCD12'), 'sessions/ABCD12');
  assert.equal(turnDocumentPath('ABCD12', 3), 'sessions/ABCD12/turns/3');
  assert.equal(privateDocumentPath('ABCD12', 'host'), 'sessions/ABCD12/private/host');
  assert.equal(reflectionsCollectionPath('ABCD12', 'guest'), 'sessions/ABCD12/private/guest/reflections');
  assert.equal(reflectionDocumentPath('ABCD12', 'host', 3), 'sessions/ABCD12/private/host/reflections/3');
});

test('秘密データは進行中は自分のroleだけ，完了後は参加者へ両roleを開示する', () => {
  const activeSession = {
    status: 'active',
    hostUid: 'host-uid',
    guestUid: 'guest-uid',
  };

  assert.deepEqual(visiblePrivateRoles(activeSession, 'host-uid'), ['host']);
  assert.deepEqual(visiblePrivateRoles(activeSession, 'guest-uid'), ['guest']);
  assert.deepEqual(visiblePrivateRoles(
    { ...activeSession, status: 'completed' },
    'host-uid',
  ), ['host', 'guest']);
  assert.deepEqual(visiblePrivateRoles(
    { ...activeSession, status: 'completed' },
    'outsider-uid',
  ), []);
});

test('手番確定は公開ノート，書き手だけの振り返り，次の手番を一つの書き込み計画にする', () => {
  const committedAt = { seconds: 30 };
  const notes = [{ pitch: 'C4', startBeat: 0, durationBeats: 1 }];
  const reflection = { intention: '落ち着きを表した', interpretation: '' };

  assert.deepEqual(buildTurnCommitWrites({
    sessionId: 'ABCD12',
    session: {
      status: 'active',
      hostUid: 'host-uid',
      guestUid: 'guest-uid',
      currentPlayerUid: 'host-uid',
      turnNumber: 3,
      maxTurns: 7,
    },
    actorUid: 'host-uid',
    notes,
    reflection,
    committedAt,
  }), [
    {
      path: 'sessions/ABCD12/turns/3',
      data: {
        number: 3,
        authorUid: 'host-uid',
        notes,
        committedAt,
      },
    },
    {
      path: 'sessions/ABCD12/private/host/reflections/3',
      data: {
        role: 'host',
        turnNumber: 3,
        ...reflection,
        guess: '',
        createdAt: committedAt,
      },
    },
    {
      path: 'sessions/ABCD12',
      merge: true,
      data: {
        turnNumber: 4,
        currentPlayerUid: 'guest-uid',
        status: 'active',
        updatedAt: committedAt,
      },
    },
  ]);
});

test('最終手番はセッションを完了し，手番外の確定は拒否する', () => {
  const session = {
    status: 'active',
    hostUid: 'host-uid',
    guestUid: 'guest-uid',
    currentPlayerUid: 'host-uid',
    turnNumber: 7,
    maxTurns: 7,
  };
  const committedAt = { seconds: 40 };

  const writes = buildTurnCommitWrites({
    sessionId: 'ABCD12',
    session,
    actorUid: 'host-uid',
    notes: [],
    reflection: { intention: '', interpretation: '明るく感じた' },
    committedAt,
  });

  assert.deepEqual(writes[2].data, {
    turnNumber: 7,
    currentPlayerUid: null,
    status: 'completed',
    updatedAt: committedAt,
    completedAt: committedAt,
  });
  assert.throws(() => buildTurnCommitWrites({
    sessionId: 'ABCD12',
    session,
    actorUid: 'guest-uid',
    notes: [],
    reflection: {},
    committedAt,
  }), /current player/);
});

test('セッション作成時に公開状態と重複しない2役分のお題を割り当てる', () => {
  const createdAt = { seconds: 10 };

  assert.deepEqual(buildCreateSessionWrites({
    sessionId: 'ABCD12',
    hostUid: 'host-uid',
    hostPrompt: '穏やかな朝',
    guestPrompt: '予期せぬ知らせ',
    createdAt,
  }), [
    {
      path: 'sessions/ABCD12',
      data: {
        schemaVersion: 1,
        status: 'waiting',
        hostUid: 'host-uid',
        guestUid: null,
        participantUids: ['host-uid'],
        currentPlayerUid: 'host-uid',
        turnNumber: 1,
        maxTurns: 7,
        createdAt,
        updatedAt: createdAt,
      },
    },
    {
      path: 'sessions/ABCD12/private/host',
      data: {
        role: 'host',
        prompt: '穏やかな朝',
        createdAt,
        updatedAt: createdAt,
      },
    },
    {
      path: 'sessions/ABCD12/private/guest',
      data: {
        role: 'guest',
        prompt: '予期せぬ知らせ',
        createdAt,
        updatedAt: createdAt,
      },
    },
  ]);

  assert.throws(() => buildCreateSessionWrites({
    sessionId: 'ABCD12',
    hostUid: 'host-uid',
    hostPrompt: '同じお題',
    guestPrompt: '同じお題',
    createdAt,
  }), /different prompts/);
});

test('参加時は作成済みのお題を変更せず，公開参加者だけを確定する', () => {
  const updatedAt = { seconds: 20 };

  assert.deepEqual(buildJoinSessionWrites({
    sessionId: 'ABCD12',
    hostUid: 'host-uid',
    guestUid: 'guest-uid',
    updatedAt,
  }), [
    {
      path: 'sessions/ABCD12',
      merge: true,
      data: {
        status: 'active',
        guestUid: 'guest-uid',
        participantUids: ['host-uid', 'guest-uid'],
        updatedAt,
      },
    },
  ]);
});
