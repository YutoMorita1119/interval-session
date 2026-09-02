function requireSegment(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('/')) {
    throw new TypeError(`${label} must be a non-empty Firestore path segment`);
  }

  return value;
}

export function sessionDocumentPath(sessionId) {
  return `sessions/${requireSegment(sessionId, 'sessionId')}`;
}

export function turnDocumentPath(sessionId, turnNumber) {
  if (!Number.isInteger(turnNumber) || turnNumber < 1) {
    throw new TypeError('turnNumber must be a positive integer');
  }

  return `${sessionDocumentPath(sessionId)}/turns/${turnNumber}`;
}

function requireRole(role) {
  if (role !== 'host' && role !== 'guest') {
    throw new TypeError('role must be host or guest');
  }

  return role;
}

export function privateDocumentPath(sessionId, role) {
  return `${sessionDocumentPath(sessionId)}/private/${requireRole(role)}`;
}

export function reflectionDocumentPath(sessionId, role, turnNumber) {
  return `${reflectionsCollectionPath(sessionId, role)}/${validateTurnNumber(turnNumber)}`;
}

export function reflectionsCollectionPath(sessionId, role) {
  return `${privateDocumentPath(sessionId, role)}/reflections`;
}

export function visiblePrivateRoles(session, uid) {
  const role = participantRole(session, uid);
  if (!role) return [];
  return session.status === 'completed' ? ['host', 'guest'] : [role];
}

export function participantRole(session, uid) {
  if (uid === session.hostUid) return 'host';
  if (uid === session.guestUid) return 'guest';
  return null;
}

function validateTurnNumber(turnNumber) {
  if (!Number.isInteger(turnNumber) || turnNumber < 1) {
    throw new TypeError('turnNumber must be a positive integer');
  }

  return turnNumber;
}

function requirePrompt(prompt, label) {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`);
  }

  return prompt.trim();
}

function privateData(role, prompt, timestamp) {
  return {
    role: requireRole(role),
    prompt,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function buildCreateSessionWrites({
  sessionId,
  hostUid,
  hostPrompt,
  guestPrompt,
  createdAt,
  maxTurns = 7,
}) {
  requireSegment(hostUid, 'hostUid');
  const normalizedHostPrompt = requirePrompt(hostPrompt, 'hostPrompt');
  const normalizedGuestPrompt = requirePrompt(guestPrompt, 'guestPrompt');

  if (normalizedHostPrompt === normalizedGuestPrompt) {
    throw new Error('host and guest must receive different prompts');
  }

  return [
    {
      path: sessionDocumentPath(sessionId),
      data: {
        schemaVersion: 1,
        status: 'waiting',
        hostUid,
        guestUid: null,
        participantUids: [hostUid],
        currentPlayerUid: hostUid,
        turnNumber: 1,
        maxTurns,
        createdAt,
        updatedAt: createdAt,
      },
    },
    {
      path: privateDocumentPath(sessionId, 'host'),
      data: privateData('host', normalizedHostPrompt, createdAt),
    },
    {
      path: privateDocumentPath(sessionId, 'guest'),
      data: privateData('guest', normalizedGuestPrompt, createdAt),
    },
  ];
}

export function buildJoinSessionWrites({
  sessionId,
  hostUid,
  guestUid,
  updatedAt,
}) {
  requireSegment(hostUid, 'hostUid');
  requireSegment(guestUid, 'guestUid');

  if (hostUid === guestUid) {
    throw new Error('host and guest must be different users');
  }

  return [
    {
      path: sessionDocumentPath(sessionId),
      merge: true,
      data: {
        status: 'active',
        guestUid,
        participantUids: [hostUid, guestUid],
        updatedAt,
      },
    },
  ];
}

export function buildTurnCommitWrites({
  sessionId,
  session,
  actorUid,
  notes,
  reflection,
  committedAt,
}) {
  requireSegment(actorUid, 'actorUid');

  if (session.status !== 'active') {
    throw new Error('session must be active');
  }

  if (session.currentPlayerUid !== actorUid) {
    throw new Error('actor must be the current player');
  }

  const turnNumber = validateTurnNumber(session.turnNumber);
  const actorRole = actorUid === session.hostUid
    ? 'host'
    : actorUid === session.guestUid
      ? 'guest'
      : null;

  if (!actorRole) {
    throw new Error('actor must be a participant');
  }

  const isFinalTurn = turnNumber >= session.maxTurns;
  const opponentUid = actorUid === session.hostUid ? session.guestUid : session.hostUid;

  if (!isFinalTurn && !opponentUid) {
    throw new Error('opponent must have joined');
  }

  const nextSessionData = {
    turnNumber: isFinalTurn ? turnNumber : turnNumber + 1,
    currentPlayerUid: isFinalTurn ? null : opponentUid,
    status: isFinalTurn ? 'completed' : 'active',
    updatedAt: committedAt,
  };

  if (isFinalTurn) {
    nextSessionData.completedAt = committedAt;
  }

  return [
    {
      path: turnDocumentPath(sessionId, turnNumber),
      data: {
        number: turnNumber,
        authorUid: actorUid,
        notes,
        committedAt,
      },
    },
    {
      path: reflectionDocumentPath(sessionId, actorRole, turnNumber),
      data: {
        intention: reflection.intention ?? '',
        interpretation: reflection.interpretation ?? '',
        guess: reflection.guess ?? '',
        role: actorRole,
        turnNumber,
        createdAt: committedAt,
      },
    },
    {
      path: sessionDocumentPath(sessionId),
      merge: true,
      data: nextSessionData,
    },
  ];
}
