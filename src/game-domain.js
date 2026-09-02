export const MAX_TURNS = 7;

export class GameDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GameDomainError";
    this.code = code;
  }
}

export function hasCurrentBoardSnapshot(session, committedTurnCount) {
  if (!session) return false;
  const requiredTurnCount = session.status === "completed"
    ? session.maxTurns
    : Math.max(0, session.turnNumber - 1);
  return committedTurnCount === requiredTurnCount;
}

export function createSession({ id, hostId, prompts, initialNotes = [] }) {
  return {
    id,
    status: "waiting",
    maxTurns: MAX_TURNS,
    turnNumber: 1,
    currentParticipantId: hostId,
    participants: {
      host: hostId,
      guest: null,
    },
    prompts: {
      host: prompts.host,
      guest: prompts.guest,
    },
    notes: structuredClone(initialNotes),
    turns: [],
    revealed: false,
  };
}

export function joinSession(session, { participantId }) {
  return {
    ...structuredClone(session),
    status: "active",
    participants: {
      ...session.participants,
      guest: participantId,
    },
  };
}

export function commitTurn(
  session,
  { participantId, notes, reflection },
) {
  if (participantId !== session.currentParticipantId) {
    throw new GameDomainError(
      "NOT_YOUR_TURN",
      "Only the current participant can commit this turn.",
    );
  }

  const nextParticipantId =
    participantId === session.participants.host
      ? session.participants.guest
      : session.participants.host;
  const completesGame = session.turnNumber === session.maxTurns;
  const committedNotes = structuredClone(notes);
  const committedReflection = structuredClone(reflection);

  return {
    ...structuredClone(session),
    status: completesGame ? "completed" : session.status,
    turnNumber: completesGame
      ? session.maxTurns
      : session.turnNumber + 1,
    currentParticipantId: completesGame ? null : nextParticipantId,
    notes: committedNotes,
    turns: [
      ...structuredClone(session.turns),
      {
        number: session.turnNumber,
        participantId,
        notes: committedNotes,
        reflection: committedReflection,
      },
    ],
    revealed: completesGame,
  };
}

export function getSessionView(session, { participantId }) {
  const role =
    participantId === session.participants.host ? "host" : "guest";
  const opponentRole = role === "host" ? "guest" : "host";
  const { prompts, ...publicSession } = structuredClone(session);

  return {
    ...publicSession,
    prompts: {
      mine: prompts[role],
      opponent: session.revealed ? prompts[opponentRole] : null,
    },
    turns: publicSession.turns.map((turn) => ({
      ...turn,
      reflection:
        session.revealed || turn.participantId === participantId
          ? turn.reflection
          : null,
    })),
  };
}
