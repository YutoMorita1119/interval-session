import {
  buildCancelWaitingSessionWrites,
  SessionCancellationError,
  sessionDocumentPath,
} from './firestore-contract.js';

export async function executeCancelWaitingSessionTransaction({
  transaction,
  sessionId,
  actorUid,
  documentReference,
}) {
  const snapshot = await transaction.get(documentReference(sessionDocumentPath(sessionId)));

  if (!snapshot.exists()) {
    throw new SessionCancellationError('session-not-found', 'Session not found');
  }

  const writes = buildCancelWaitingSessionWrites({
    sessionId,
    session: snapshot.data(),
    actorUid,
  });

  for (const write of writes) {
    transaction.delete(documentReference(write.path));
  }

  return { sessionId };
}
