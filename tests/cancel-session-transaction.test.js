import test from 'node:test';
import assert from 'node:assert/strict';

import { executeCancelWaitingSessionTransaction } from '../src/cancel-session-transaction.js';

function waitingSession() {
  return {
    status: 'waiting',
    hostUid: 'host-uid',
    guestUid: null,
    currentPlayerUid: 'host-uid',
    turnNumber: 1,
  };
}

function transactionFor(session) {
  const deleted = [];
  return {
    deleted,
    transaction: {
      get: async () => ({ exists: () => session !== null, data: () => session }),
      delete: (reference) => deleted.push(reference),
    },
  };
}

test('gatewayのキャンセルtransactionは最新状態を読んで3文書を原子的に削除する', async () => {
  const fake = transactionFor(waitingSession());

  const result = await executeCancelWaitingSessionTransaction({
    transaction: fake.transaction,
    sessionId: 'ABCD12',
    actorUid: 'host-uid',
    documentReference: (path) => path,
  });

  assert.deepEqual(result, { sessionId: 'ABCD12' });
  assert.deepEqual(fake.deleted, [
    'sessions/ABCD12/private/host',
    'sessions/ABCD12/private/guest',
    'sessions/ABCD12',
  ]);
});

test('参加が先に成立した場合と削除済みの場合は何も削除しない', async () => {
  const joined = transactionFor({ ...waitingSession(), status: 'active', guestUid: 'guest-uid' });
  await assert.rejects(() => executeCancelWaitingSessionTransaction({
    transaction: joined.transaction,
    sessionId: 'ABCD12',
    actorUid: 'host-uid',
    documentReference: (path) => path,
  }), /waiting/);
  assert.deepEqual(joined.deleted, []);

  const missing = transactionFor(null);
  await assert.rejects(() => executeCancelWaitingSessionTransaction({
    transaction: missing.transaction,
    sessionId: 'ABCD12',
    actorUid: 'host-uid',
    documentReference: (path) => path,
  }), /Session not found/);
  assert.deepEqual(missing.deleted, []);
});
