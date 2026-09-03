import { getApp, getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  browserSessionPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import {
  buildCreateSessionWrites,
  buildJoinSessionWrites,
  buildTurnCommitWrites,
  privateDocumentPath,
  reflectionsCollectionPath,
  sessionDocumentPath,
} from './firestore-contract.js';

function applyWrites(transaction, database, writes) {
  for (const write of writes) {
    const reference = doc(database, write.path);
    if (write.merge) {
      transaction.set(reference, write.data, { merge: true });
    } else {
      transaction.set(reference, write.data);
    }
  }
}

function requireUser(auth) {
  if (!auth.currentUser) {
    throw new Error('Anonymous authentication is required');
  }

  return auth.currentUser;
}

function snapshotData(snapshot) {
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export function createFirebaseGateway(firebaseConfig) {
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  const auth = getAuth(app);
  const database = getFirestore(app);

  async function authenticateAnonymously() {
    await setPersistence(auth, browserSessionPersistence);

    if (auth.currentUser) {
      return auth.currentUser;
    }

    const credential = await signInAnonymously(auth);
    return credential.user;
  }

  function listenToAuthentication(listener) {
    return onAuthStateChanged(auth, listener);
  }

  async function createSession({ sessionId, hostPrompt, guestPrompt, maxTurns = 7 }) {
    const user = requireUser(auth);

    return runTransaction(database, async (transaction) => {
      const sessionRef = doc(database, sessionDocumentPath(sessionId));
      const existing = await transaction.get(sessionRef);

      if (existing.exists()) {
        throw new Error('Session already exists');
      }

      applyWrites(transaction, database, buildCreateSessionWrites({
        sessionId,
        hostUid: user.uid,
        hostPrompt,
        guestPrompt,
        maxTurns,
        createdAt: serverTimestamp(),
      }));

      return { sessionId, role: 'host', uid: user.uid };
    });
  }

  async function joinSession({ sessionId }) {
    const user = requireUser(auth);

    return runTransaction(database, async (transaction) => {
      const sessionRef = doc(database, sessionDocumentPath(sessionId));
      const snapshot = await transaction.get(sessionRef);

      if (!snapshot.exists()) {
        throw new Error('Session not found');
      }

      const session = snapshot.data();
      if (session.status !== 'waiting' || session.guestUid !== null) {
        throw new Error('Session is not accepting participants');
      }

      applyWrites(transaction, database, buildJoinSessionWrites({
        sessionId,
        hostUid: session.hostUid,
        guestUid: user.uid,
        updatedAt: serverTimestamp(),
      }));

      return { sessionId, role: 'guest', uid: user.uid };
    });
  }

  function listenSession(sessionId, listener, onError) {
    requireUser(auth);
    return onSnapshot(
      doc(database, sessionDocumentPath(sessionId)),
      (snapshot) => listener(snapshotData(snapshot)),
      onError,
    );
  }

  function listenTurns(sessionId, listener, onError) {
    requireUser(auth);
    const turns = query(
      collection(database, `${sessionDocumentPath(sessionId)}/turns`),
      orderBy('number'),
    );

    return onSnapshot(
      turns,
      (snapshot) => listener(snapshot.docs.map(snapshotData)),
      onError,
    );
  }

  function listenPrivateData(sessionId, role, listener, onError) {
    requireUser(auth);
    return onSnapshot(
      doc(database, privateDocumentPath(sessionId, role)),
      (snapshot) => listener(snapshotData(snapshot)),
      onError,
    );
  }

  function listenReflections(sessionId, role, listener, onError) {
    requireUser(auth);
    const reflections = query(
      collection(database, reflectionsCollectionPath(sessionId, role)),
      orderBy('turnNumber'),
    );

    return onSnapshot(
      reflections,
      (snapshot) => listener(snapshot.docs.map(snapshotData)),
      onError,
    );
  }

  async function commitTurn({ sessionId, notes, reflection }) {
    const user = requireUser(auth);

    return runTransaction(database, async (transaction) => {
      const sessionRef = doc(database, sessionDocumentPath(sessionId));
      const snapshot = await transaction.get(sessionRef);

      if (!snapshot.exists()) {
        throw new Error('Session not found');
      }

      const session = snapshot.data();
      const writes = buildTurnCommitWrites({
        sessionId,
        session,
        actorUid: user.uid,
        notes,
        reflection,
        committedAt: serverTimestamp(),
      });
      const turnRef = doc(database, writes[0].path);
      const existingTurn = await transaction.get(turnRef);

      if (existingTurn.exists()) {
        throw new Error('Turn has already been committed');
      }

      applyWrites(transaction, database, writes);
      return { sessionId, turnNumber: session.turnNumber };
    });
  }

  return {
    authenticateAnonymously,
    listenToAuthentication,
    createSession,
    joinSession,
    listenSession,
    listenTurns,
    listenPrivateData,
    listenReflections,
    commitTurn,
  };
}
