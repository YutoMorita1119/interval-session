import { buildPlaybackSchedule } from "./src/audio-schedule.js";
import { createAudioEngine } from "./src/audio-engine.js";
import { firebaseConfig } from "./src/firebase-config.js";
import { createFirebaseGateway } from "./src/firebase-gateway.js";
import { MAX_TURNS } from "./src/game-domain.js";
import { classifyNoteRole, noteToFrequency, placeNote } from "./src/music-domain.js";
import {
  completeTutorial,
  createTutorialState,
  markPlacementPracticed,
  markPlaybackPracticed,
  markSubmissionPracticed,
  moveToNextStep,
} from "./src/tutorial-domain.js";

const BPM = 100;
const PROMPTS = ["流星群", "氷の結晶", "大樹", "ガラスの破片", "駆ける獣", "不思議な地下室"];
const HARMONY = [
  { root: "C3", context: "Major", label: "C" },
  { root: "F3", context: "Major", label: "F" },
  { root: "G3", context: "Dominant", label: "G7" },
  { root: "C3", context: "Major", label: "C" },
];
const SYSTEM_NOTES = [
  ["C4", "E4", "G4"], ["F4", "A4", "C5"], ["G4", "B4", "D5", "F5"], ["C4", "E4", "G4"],
].flatMap((pitches, bar) => pitches.map((pitch) => ({ pitch, bar, beat: 0, durationBeats: 4, owner: "system" })));
const MELODY_NOTES = [
  [0,0,"C4",1],[0,1,"C4",1],[0,2,"G4",1],[0,3,"G4",1],
  [1,0,"A4",1],[1,1,"A4",1],[1,2,"G4",2],
  [2,0,"F4",1],[2,1,"F4",1],[2,2,"E4",1],[2,3,"E4",1],
  [3,0,"D4",1],[3,1,"D4",1],[3,2,"C4",2],
].map(([bar, beat, pitch, durationBeats]) => ({ bar, beat, pitch, durationBeats }));

const gateway = createFirebaseGateway(firebaseConfig);
const audio = createAudioEngine();
const $ = (id) => document.getElementById(id);
const state = {
  uid: null, role: null, sessionId: null, session: null, privateData: null,
  turns: [], reflections: { host: [], guest: [] }, opponentPrivate: null,
  baseNotes: structuredClone(SYSTEM_NOTES), draftNotes: structuredClone(SYSTEM_NOTES),
  addedKeys: new Set(), unsubscribers: [], playing: false, revealed: false,
};
let tutorialState = createTutorialState();
const tutorialNotes = new Set();

function noteKey(note) { return `${note.pitch}:${note.bar}:${note.beat}`; }
function sanitizeNotes(notes) {
  if (!Array.isArray(notes)) return structuredClone(SYSTEM_NOTES);
  const allowedOwners = new Set(["system", "host", "guest"]);
  return notes.filter((note) => note && typeof note.pitch === "string"
    && /^[A-G]#?[3-6]$/.test(note.pitch)
    && Number.isInteger(note.bar) && note.bar >= 0 && note.bar < 4
    && Number.isInteger(note.beat) && note.beat >= 0 && note.beat < 4
    && Number.isFinite(note.durationBeats) && note.durationBeats > 0 && note.durationBeats <= 4
    && allowedOwners.has(note.owner)).slice(0, 128);
}
function sessionCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
function promptPair() {
  const first = Math.floor(Math.random() * PROMPTS.length);
  let second = Math.floor(Math.random() * (PROMPTS.length - 1));
  if (second >= first) second += 1;
  return [PROMPTS[first], PROMPTS[second]];
}

function tutorialWasSeen() {
  try { return localStorage.getItem("interval-session:tutorial-seen") === "1"; }
  catch { return false; }
}
function rememberTutorial() {
  try { localStorage.setItem("interval-session:tutorial-seen", "1"); }
  catch { /* Storage may be unavailable in a restricted browser. */ }
}
function renderTutorial() {
  for (let step = 1; step <= 3; step += 1) $(`tutorial-step-${step}`).hidden = tutorialState.step !== step;
  $("tutorial-progress").textContent = `${tutorialState.step} / 3`;
  $("tutorial-next-2").disabled = !(tutorialState.placementPracticed && tutorialState.playbackPracticed);
  $("finish-tutorial-btn").disabled = !tutorialState.submissionPracticed;
}
function buildTutorialGrid() {
  const grid = $("tutorial-grid"); grid.replaceChildren();
  const corner = document.createElement("span"); corner.textContent = ""; grid.append(corner);
  for (let beat = 1; beat <= 4; beat += 1) { const head = document.createElement("span"); head.textContent = `${beat}拍`; grid.append(head); }
  for (const pitch of ["C5", "A4", "G4"]) {
    const label = document.createElement("span"); label.textContent = pitch; grid.append(label);
    for (let beat = 0; beat < 4; beat += 1) {
      const key = `${pitch}:${beat}`; const cell = document.createElement("button"); cell.type = "button";
      cell.setAttribute("aria-label", `${pitch} ${beat + 1}拍`);
      cell.addEventListener("click", () => {
        if (tutorialNotes.has(key)) tutorialNotes.delete(key); else tutorialNotes.add(key);
        tutorialState = markPlacementPracticed(tutorialState);
        cell.classList.toggle("selected", tutorialNotes.has(key));
        renderTutorial();
      });
      grid.append(cell);
    }
  }
}
function openTutorial() {
  tutorialState = createTutorialState(); tutorialNotes.clear(); buildTutorialGrid(); renderTutorial();
  $("tutorial-intention-input").value = ""; $("tutorial-submit-btn").disabled = true; $("tutorial-submit-status").hidden = true;
  if (!$("tutorial-dialog").open) $("tutorial-dialog").showModal();
}
function finishTutorial() {
  tutorialState = completeTutorial(tutorialState); rememberTutorial(); audio.stop(); $("tutorial-dialog").close();
}
async function playTutorialNotes() {
  if (!tutorialNotes.size) { showToast("先にマスを押して音を置いてください．", true); return; }
  const events = [...tutorialNotes].map((key) => {
    const [pitch, beatText] = key.split(":");
    return { voice: "host", frequency: noteToFrequency(pitch), startSeconds: Number(beatText) * .45, durationSeconds: .38 };
  });
  tutorialState = markPlaybackPracticed(tutorialState); renderTutorial();
  await audio.play(events);
}
function showToast(message, error = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 3600);
}
function friendlyError(error) {
  const message = String(error?.message ?? error);
  if (message.includes("Session not found")) return "そのセッションは見つかりませんでした．";
  if (message.includes("accepting")) return "このセッションにはすでに2人が参加しています．";
  if (message.includes("already exists")) return "IDが重複しました．もう一度作成してください．";
  if (message.includes("permission")) return "通信権限を確認できませんでした．Firebase Rulesの反映状態を確認してください．";
  return `処理を完了できませんでした：${message}`;
}

function pitchesDescending() {
  const names = ["B","A#","A","G#","G","F#","F","E","D#","D","C#","C"];
  const result = [];
  for (let octave = 5; octave >= 3; octave -= 1) for (const name of names) result.push(`${name}${octave}`);
  result.unshift("C6");
  return result;
}
function renderGrid() {
  const grid = $("piano-roll");
  grid.replaceChildren();
  const corner = document.createElement("div"); corner.className = "corner"; grid.append(corner);
  for (let slot = 0; slot < 16; slot += 1) {
    const head = document.createElement("div");
    const bar = Math.floor(slot / 4); const beat = slot % 4;
    head.className = `bar-head${beat === 3 ? " bar-end" : ""}`;
    head.textContent = beat === 0 ? `${bar + 1}｜${HARMONY[bar].label}` : `${beat + 1}`;
    grid.append(head);
  }
  const editable = canEdit();
  for (const pitch of pitchesDescending()) {
    const key = document.createElement("div");
    key.className = `key${pitch.includes("#") ? " black" : ""}`;
    key.textContent = pitch.startsWith("C") ? pitch : "";
    grid.append(key);
    for (let slot = 0; slot < 16; slot += 1) {
      const bar = Math.floor(slot / 4); const beat = slot % 4;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `cell${pitch.includes("#") ? " black-row" : ""}${beat === 0 ? " beat-start" : ""}${beat === 3 ? " bar-end" : ""}`;
      cell.disabled = !editable;
      cell.setAttribute("aria-label", `${bar + 1}小節 ${beat + 1}拍 ${pitch}`);
      cell.addEventListener("click", () => toggleNote({ pitch, bar, beat }));
      const notes = state.draftNotes.filter((note) => note.pitch === pitch && note.bar === bar && note.beat === beat);
      notes.forEach((note, index) => cell.append(renderNote(note, index, notes.length)));
      grid.append(cell);
    }
  }
}
function renderNote(note, index, count) {
  const mark = document.createElement("span");
  const harmonic = classifyNoteRole(HARMONY[note.bar].root, note.pitch, HARMONY[note.bar].context);
  const ownership = note.owner === "system" ? "system" : note.owner === state.role ? "mine" : "other";
  mark.className = `note-mark note-${ownership} role-${harmonic.role}`;
  mark.textContent = harmonic.degree;
  if (count > 1) { mark.style.inset = `${2 + index * 2}px ${2 + (count - index - 1) * 2}px`; }
  mark.title = `${note.pitch}｜${harmonic.degree}`;
  return mark;
}
function canEdit() { return state.session?.status === "active" && state.session.currentPlayerUid === state.uid; }
function toggleNote(candidate) {
  if (!canEdit()) return;
  if (state.playing) stopPlayback();
  const key = noteKey(candidate);
  if (state.addedKeys.has(key)) {
    state.draftNotes = state.draftNotes.filter((note) => noteKey(note) !== key);
    state.addedKeys.delete(key);
  } else {
    const placed = placeNote(state.draftNotes, { ...candidate, durationBeats: 1, owner: state.role });
    if (placed.outcome === "beat-full") { showToast("1拍には4音まで置けます．", true); return; }
    if (placed.outcome === "duplicate") { showToast("同じ場所にその音はすでにあります．", true); return; }
    state.draftNotes = placed.notes;
    state.addedKeys.add(key);
    playSingle(candidate.pitch, state.role);
  }
  renderGrid();
}
function playSingle(pitch, voice) {
  audio.play([{ voice, frequency: noteToFrequency(pitch), startSeconds: 0, durationSeconds: .45 }]);
}
function playbackEvents(notes = state.draftNotes) {
  const melody = buildPlaybackSchedule({ melodyNotes: MELODY_NOTES, bpm: BPM }).map((event) => ({ ...event, voice: "melody" }));
  const grouped = ["system", "host", "guest"].flatMap((owner) => buildPlaybackSchedule({ accompanimentNotes: notes.filter((note) => note.owner === owner), bpm: BPM }).map((event) => ({ ...event, voice: owner })));
  return [...melody, ...grouped].sort((a, b) => a.startSeconds - b.startSeconds);
}
async function togglePlayback(notes) {
  if (state.playing) { stopPlayback(); return; }
  state.playing = true; $("preview-icon").textContent = "■"; $("preview-label").textContent = "停止";
  try {
    await audio.play(playbackEvents(notes), {
      onPlayhead: ({ progress }) => { $("playhead").style.width = `${progress * 100}%`; },
      onEnded: stopPlayback,
    });
  } catch (error) { stopPlayback(); showToast(friendlyError(error), true); }
}
function stopPlayback() { audio.stop(); state.playing = false; $("preview-icon").textContent = "▶"; $("preview-label").textContent = "全体を聴く"; $("playhead").style.width = "0"; }

function updateForm() {
  const turn = state.session?.turnNumber ?? 1;
  $("interpretation-field").hidden = turn === 1;
  $("intention-field").hidden = turn === MAX_TURNS;
  $("guess-field").hidden = turn === 1;
  const interpretation = $("interpretation-input").value.trim();
  const intention = $("intention-input").value.trim();
  const guess = $("guess-select").value;
  const valid = turn === 1 ? Boolean(intention) : turn === MAX_TURNS ? Boolean(interpretation && guess) : Boolean(interpretation && intention && guess);
  $("commit-btn").disabled = !(canEdit() && valid);
  $("requirement-text").textContent = !canEdit() ? "あなたの手番になると記録を送れます．" : valid ? "送信できます．確定後は編集できません．" : turn === 1 ? "今回の意図を入力してください．" : turn === MAX_TURNS ? "解釈と相手のお題の予想を入力してください．" : "解釈，意図，相手のお題の予想を入力してください．";
}
function updateSessionUi() {
  if (!state.session) return;
  $("turn-number").textContent = state.session.turnNumber;
  $("max-turn").textContent = state.session.maxTurns;
  const waiting = state.session.status === "waiting";
  const completed = state.session.status === "completed";
  const myTurn = canEdit();
  $("turn-badge").textContent = completed ? "完了" : waiting ? "参加待ち" : myTurn ? "あなたの手番" : "相手の手番";
  $("turn-lock").hidden = myTurn || completed;
  $("lock-title").textContent = waiting ? "もう一人の参加を待っています" : "相手の応答を待っています";
  $("lock-detail").textContent = waiting ? `セッションID「${state.sessionId}」をもう一つのタブで入力してください．` : "確定されると画面は自動で更新されます．";
  renderGrid(); updateForm();
  if (completed && !state.revealed) revealResults();
}
function applyLatestTurn() {
  const latest = state.turns.at(-1);
  state.baseNotes = sanitizeNotes(latest?.notes?.length ? latest.notes : SYSTEM_NOTES);
  state.draftNotes = structuredClone(state.baseNotes);
  state.addedKeys.clear();
  renderGrid(); renderHistory();
}

function clearInputs() {
  $("interpretation-input").value = ""; $("intention-input").value = ""; $("guess-select").value = "";
  $("interpretation-count").textContent = "0"; $("intention-count").textContent = "0";
}
async function commitTurn() {
  if (!canEdit()) return;
  $("commit-btn").disabled = true;
  try {
    await gateway.commitTurn({ sessionId: state.sessionId, notes: state.draftNotes, reflection: { interpretation: $("interpretation-input").value.trim(), intention: $("intention-input").value.trim(), guess: $("guess-select").value } });
    clearInputs(); showToast("ターンを送りました．");
  } catch (error) { showToast(friendlyError(error), true); updateForm(); }
}

function enterSession({ sessionId, role, uid }) {
  state.sessionId = sessionId; state.role = role; state.uid = uid;
  $("session-id-label").textContent = sessionId;
  $("lobby-view").hidden = true; $("game-view").hidden = false;
  state.unsubscribers.push(
    gateway.listenSession(sessionId, (session) => { state.session = session; updateSessionUi(); }, (error) => showToast(friendlyError(error), true)),
    gateway.listenTurns(sessionId, (turns) => { state.turns = turns; applyLatestTurn(); }, (error) => showToast(friendlyError(error), true)),
    gateway.listenPrivateData(sessionId, role, (data) => {
      state.privateData = data;
      if ($("theme-card").getAttribute("aria-expanded") === "true") $("theme-text").textContent = data?.prompt || "読み込み中…";
      if (state.revealed) renderResults();
    }, (error) => showToast(friendlyError(error), true)),
    gateway.listenReflections(sessionId, role, (items) => { state.reflections[role] = items; renderHistory(); }, (error) => showToast(friendlyError(error), true)),
  );
}
async function createSession() {
  const button = $("create-session-btn"); button.disabled = true;
  try {
    const [hostPrompt, guestPrompt] = promptPair(); const id = sessionCode();
    const result = await gateway.createSession({ sessionId: id, hostPrompt, guestPrompt, maxTurns: MAX_TURNS });
    enterSession(result); showToast(`セッション ${id} を作成しました．`);
  } catch (error) { showToast(friendlyError(error), true); button.disabled = false; }
}
async function joinSession() {
  const id = $("session-id-input").value.trim().toUpperCase();
  if (id.length !== 6) { showToast("6文字のセッションIDを入力してください．", true); return; }
  $("join-session-btn").disabled = true;
  try { enterSession(await gateway.joinSession({ sessionId: id })); showToast(`セッション ${id} に参加しました．`); }
  catch (error) { showToast(friendlyError(error), true); $("join-session-btn").disabled = false; }
}

function textRow(label, text, secret = false) {
  const p = document.createElement("p");
  const strong = document.createElement("strong"); strong.textContent = `${label}：`;
  p.append(strong, document.createTextNode(text || "—"));
  if (secret) p.className = "history-secret";
  return p;
}
function renderHistory() {
  const list = $("history-list"); list.replaceChildren();
  if (!state.turns.length) { list.append(textRow("履歴", "まだ確定されたターンはありません．")); return; }
  for (const turn of state.turns) {
    const role = turn.authorUid === state.session?.hostUid ? "host" : "guest";
    const mine = role === state.role;
    const reflection = state.reflections[role].find((item) => item.turnNumber === turn.number);
    const item = document.createElement("article"); item.className = "history-item";
    const header = document.createElement("header"); const title = document.createElement("strong"); title.textContent = `TURN ${turn.number}`;
    const author = document.createElement("span"); author.textContent = mine ? "あなた" : "相手"; header.append(title, author); item.append(header);
    if (reflection) {
      item.append(textRow("解釈", reflection.interpretation), textRow("意図", reflection.intention), textRow("予想", reflection.guess));
    } else {
      item.append(textRow("記録", state.session?.status === "completed" ? "読み込み中…" : "ゲーム終了まで非公開", true));
    }
    list.append(item);
  }
}
function revealResults() {
  state.revealed = true;
  const otherRole = state.role === "host" ? "guest" : "host";
  state.unsubscribers.push(
    gateway.listenPrivateData(state.sessionId, otherRole, (data) => { state.opponentPrivate = data; renderResults(); }, (error) => showToast(friendlyError(error), true)),
    gateway.listenReflections(state.sessionId, otherRole, (items) => { state.reflections[otherRole] = items; renderHistory(); }, (error) => showToast(friendlyError(error), true)),
  );
  renderResults(); $("result-dialog").showModal();
}
function renderResults() {
  const box = $("result-prompts"); box.replaceChildren();
  const entries = [["あなたのお題", state.privateData?.prompt], ["相手のお題", state.opponentPrivate?.prompt]];
  for (const [label, value] of entries) {
    const card = document.createElement("div"); card.className = "result-prompt";
    const caption = document.createElement("span"); caption.textContent = label;
    const prompt = document.createElement("strong"); prompt.textContent = value || "読み込み中…";
    card.append(caption, prompt); box.append(card);
  }
}

function bindUi() {
  for (const prompt of PROMPTS) { const option = document.createElement("option"); option.value = prompt; option.textContent = prompt; $("guess-select").append(option); }
  $("session-id-input").addEventListener("input", (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6); });
  $("create-session-btn").addEventListener("click", createSession); $("join-session-btn").addEventListener("click", joinSession); $("commit-btn").addEventListener("click", commitTurn);
  $("preview-btn").addEventListener("click", () => togglePlayback()); $("result-play-btn").addEventListener("click", () => togglePlayback(state.baseNotes));
  $("theme-card").addEventListener("click", () => { const open = $("theme-card").getAttribute("aria-expanded") !== "true"; $("theme-card").setAttribute("aria-expanded", String(open)); $("theme-text").textContent = open ? state.privateData?.prompt || "読み込み中…" : "クリックして表示"; });
  $("copy-session-btn").addEventListener("click", async () => { await navigator.clipboard.writeText(state.sessionId); showToast("セッションIDをコピーしました．"); });
  for (const [inputId, countId] of [["interpretation-input","interpretation-count"],["intention-input","intention-count"]]) $(inputId).addEventListener("input", () => { $(countId).textContent = $(inputId).value.length; updateForm(); });
  $("guess-select").addEventListener("change", updateForm);
  $("history-btn").addEventListener("click", () => { renderHistory(); $("history-dialog").showModal(); }); $("close-history-btn").addEventListener("click", () => $("history-dialog").close());
  $("result-history-btn").addEventListener("click", () => { $("result-dialog").close(); renderHistory(); $("history-dialog").showModal(); });
  $("open-tutorial-btn").addEventListener("click", openTutorial);
  $("skip-tutorial-btn").addEventListener("click", finishTutorial);
  $("finish-tutorial-btn").addEventListener("click", finishTutorial);
  $("tutorial-next-1").addEventListener("click", () => { tutorialState = moveToNextStep(tutorialState); renderTutorial(); });
  $("tutorial-next-2").addEventListener("click", () => { tutorialState = moveToNextStep(tutorialState); renderTutorial(); });
  $("tutorial-play-btn").addEventListener("click", () => playTutorialNotes().catch((error) => showToast(friendlyError(error), true)));
  $("tutorial-intention-input").addEventListener("input", () => { $("tutorial-submit-btn").disabled = !$("tutorial-intention-input").value.trim(); });
  $("tutorial-submit-btn").addEventListener("click", () => {
    tutorialState = markSubmissionPracticed(tutorialState);
    $("tutorial-submit-status").hidden = false;
    $("tutorial-submit-btn").disabled = true;
    renderTutorial();
  });
}

bindUi(); renderGrid();
if (!tutorialWasSeen()) openTutorial();
gateway.listenToAuthentication((user) => {
  state.uid = user?.uid ?? null;
  $("auth-dot").classList.toggle("online", Boolean(user));
  $("auth-status").textContent = user ? "Firebaseへ匿名接続済み" : "匿名接続を準備中";
  $("create-session-btn").disabled = !user; $("join-session-btn").disabled = !user;
});
gateway.authenticateAnonymously().catch((error) => showToast(friendlyError(error), true));
