import { buildPlaybackSchedule } from "./src/audio-schedule.js";
import { createAudioEngine } from "./src/audio-engine.js";
import { firebaseConfig } from "./src/firebase-config.js";
import { createFirebaseGateway } from "./src/firebase-gateway.js?v=4";
import { getBidirectionalFinalGuessResults, hasCurrentBoardSnapshot, MAX_TURNS } from "./src/game-domain.js";
import { classifyNoteRole, normalizeBoardNotes, noteToFrequency, placeNote, removeNote } from "./src/music-domain.js";
import {
  acknowledgeTutorialOverview,
  beginOpponentWait,
  commitTutorialTurn,
  completeTutorial,
  createTutorialState,
  markBaseNoteRemoved,
  markHistoryPlaybackPracticed,
  markNoteAdded,
  markOpponentNoteRemoved,
  markPlaybackCompleted,
  markPlaybackStarted,
  markRecordCompleted,
  openTutorialHistory,
  receiveOpponentResponse,
  revealTutorialPrompt,
  reviewTutorialResult,
  startTutorial,
} from "./src/tutorial-domain.js";

const BPM = 100;
const ACTIVE_SESSION_KEY = "interval-session:active-session";
const PROMPTS = ["流星群", "氷の結晶", "樹齢を重ねた大木", "ガラスの破片", "猛獣の暴走", "不気味な地下室"];
const HARMONY = [
  { root: "C3", context: "Major", label: "C", tones: "C・E・G" },
  { root: "F3", context: "Major", label: "F", tones: "F・A・C" },
  { root: "G3", context: "Dominant", label: "G7", tones: "G・B・D・F" },
  { root: "C3", context: "Major", label: "C", tones: "C・E・G" },
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
  unsubscribers: [], sessionGeneration: 0, turnsLoaded: false, playing: false, playbackButton: null, revealed: false,
  historyOpenedFromResult: false,
  tutorialMode: false,
};
let tutorialState = createTutorialState();
const TUTORIAL_PROMPTS = ["お題A", "お題B"];
const TUTORIAL_UID = "tutorial-user";
const TUTORIAL_INITIAL_NOTES = [
  ...structuredClone(SYSTEM_NOTES),
  { pitch: "D5", bar: 1, beat: 0, durationBeats: 4, owner: "guest" },
];
let restoringSession = false;

function sanitizeNotes(notes) {
  return normalizeBoardNotes(notes, {
    validPitches: pitchesDescending(),
    chordCount: HARMONY.length,
  });
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

function rememberedSessionId() {
  try { return sessionStorage.getItem(ACTIVE_SESSION_KEY); }
  catch { return null; }
}
function rememberSession(sessionId) {
  try { sessionStorage.setItem(ACTIVE_SESSION_KEY, sessionId); }
  catch { /* Session restoration is optional when storage is unavailable. */ }
}
function forgetSession() {
  try { sessionStorage.removeItem(ACTIVE_SESSION_KEY); }
  catch { /* Session restoration is optional when storage is unavailable. */ }
}
function stopSessionListeners() {
  state.sessionGeneration += 1;
  for (const unsubscribe of state.unsubscribers.splice(0)) {
    try { unsubscribe(); }
    catch { /* A listener may already be closed. */ }
  }
}
function forSessionGeneration(generation, listener) {
  return (...args) => {
    if (generation === state.sessionGeneration) listener(...args);
  };
}
const TUTORIAL_GUIDE = Object.freeze({
  overview: { chapter: "全体", title: "2人で音を伝え合う", copy: "2人に異なるお題が本人だけへ示されます．共有する音を7ターン交互に編集し，相手のお題を予想します．", action: "自分のお題を確認する", target: "game-view" },
  prompt: { chapter: "お題", title: "自分のお題を確認する", copy: "右上の「あなたのお題」を押してください．お題と記録は，セッション終了まで相手には表示されません．", target: "theme-card" },
  edit: { chapter: "音を編集", title: "共有する音を編集する", copy: "灰色の基本和音と赤い相手の音を1音ずつ削除し，空いているマスへ青い自分の音を1音追加してください．実際の手番でも，所有者を問わず盤面の音を削除できます．", target: "piano-roll" },
  playback: { chapter: "音を編集", title: "配置した音を聴く", copy: "「全体を聴く」で再生を開始し，表示が「停止」に変わることを確認してから，もう一度押して停止してください．最後まで聴いた場合も次へ進みます．", target: "preview-btn" },
  record: { chapter: "記録", title: "このターンを記録する", copy: "相手の音の解釈，自分が表した意図，相手のお題の予想を入力してください．内容は終了まで相手に非公開です．", target: "reflection-panel" },
  commit: { chapter: "記録", title: "ターンを確定する", copy: "入力と現在の盤面を確定します．実際のセッションでは，確定後に相手の手番へ切り替わります．", target: "commit-btn" },
  waiting: { chapter: "相手の手番", title: "相手の応答を待つ", copy: "実際のセッションでは，相手が確定すると画面が自動更新されます．ここではローカルの模擬応答を表示します．", action: "相手の応答を見る", target: "turn-lock" },
  response: { chapter: "履歴", title: "相手の応答を受け取りました", copy: "赤い音が相手の追加した音です．右側の「履歴」を押して，盤面と記録の変化を確認してください．", target: "history-btn" },
  history: { chapter: "履歴", title: "ターンごとの変化を確認する", copy: "履歴を閉じました．もう一度開くと，保存時の盤面，音名，度数，記録，再生操作を確認できます．", action: "履歴を開く", target: "history-btn" },
});

function removeTutorialFocus() {
  document.querySelectorAll(".tutorial-focus").forEach((element) => element.classList.remove("tutorial-focus"));
}
function renderTutorialGuide() {
  const guide = $("tutorial-guide");
  removeTutorialFocus();
  if (!state.tutorialMode || ["result", "finished"].includes(tutorialState.stage)) {
    guide.hidden = true;
    return;
  }
  const content = TUTORIAL_GUIDE[tutorialState.stage];
  if (!content) { guide.hidden = true; return; }
  guide.hidden = false;
  guide.dataset.stage = tutorialState.stage;
  $("tutorial-chapter").textContent = content.chapter;
  $("tutorial-guide-title").textContent = content.title;
  $("tutorial-guide-copy").textContent = content.copy;
  const checklist = $("tutorial-checklist");
  checklist.replaceChildren();
  if (tutorialState.stage === "edit") {
    const items = [
      [tutorialState.baseNoteRemoved, "基本和音を1音削除"],
      [tutorialState.opponentNoteRemoved, "相手の音を1音削除"],
      [tutorialState.noteAdded, "空きマスへ自分の音を1音追加"],
    ];
    for (const [done, label] of items) {
      const item = document.createElement("li");
      item.classList.toggle("done", done); item.textContent = `${done ? "✓" : "○"} ${label}`; checklist.append(item);
    }
    checklist.hidden = false;
  } else checklist.hidden = true;
  const action = $("tutorial-guide-action");
  action.hidden = !content.action;
  action.textContent = content.action || "次へ";
  const target = $(content.target) || document.querySelector(`.${content.target}`);
  target?.classList.add("tutorial-focus");
}
function populateGuessOptions(prompts = PROMPTS) {
  const select = $("guess-select"); select.replaceChildren();
  const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "選択してください"; select.append(placeholder);
  for (const prompt of prompts) { const option = document.createElement("option"); option.value = prompt; option.textContent = prompt; select.append(option); }
}
function openTutorial() {
  stopSessionListeners(); stopPlayback(); clearInputs();
  tutorialState = startTutorial(createTutorialState());
  state.tutorialMode = true;
  document.body.classList.add("tutorial-active");
  state.role = "host"; state.sessionId = "LOCAL";
  state.session = { status: "active", turnNumber: 3, maxTurns: MAX_TURNS, hostUid: TUTORIAL_UID, guestUid: "tutorial-guest", currentPlayerUid: TUTORIAL_UID };
  state.privateData = { prompt: "お題A" }; state.opponentPrivate = null;
  state.turns = [
    { number: 1, authorUid: TUTORIAL_UID, notes: structuredClone(SYSTEM_NOTES) },
    { number: 2, authorUid: "tutorial-guest", notes: structuredClone(TUTORIAL_INITIAL_NOTES) },
  ];
  state.reflections = {
    host: [{ turnNumber: 1, interpretation: "", intention: "最初の響きを保った", guess: "" }],
    guest: [{ turnNumber: 2, interpretation: "穏やかな始まりに感じた", intention: "少し高い音で応答した", guess: "お題A" }],
  };
  state.baseNotes = structuredClone(TUTORIAL_INITIAL_NOTES); state.draftNotes = structuredClone(TUTORIAL_INITIAL_NOTES);
  state.turnsLoaded = true; state.revealed = false; state.historyOpenedFromResult = false;
  populateGuessOptions(TUTORIAL_PROMPTS);
  $("tutorial-show-result-btn").disabled = true;
  $("session-id-label").textContent = "LOCAL"; $("copy-session-btn").disabled = true;
  $("theme-card").setAttribute("aria-expanded", "false"); $("theme-text").textContent = "クリックして表示";
  $("lobby-view").hidden = true; $("game-view").hidden = false;
  updateSessionUi(); renderHistory(); renderTutorialGuide();
  $("tutorial-guide-action").focus();
}
function closeTutorial() {
  if (!state.tutorialMode) return;
  stopPlayback(); tutorialState = createTutorialState(); state.tutorialMode = false;
  document.body.classList.remove("tutorial-active");
  $("tutorial-history-note").hidden = true; removeTutorialFocus();
  returnToLobby();
  $("open-tutorial-btn").focus();
}
function tutorialOpponentResponse() {
  if (!state.tutorialMode || tutorialState.stage !== "waiting") return;
  tutorialState = receiveOpponentResponse(tutorialState);
  const responseNotes = [
    ...structuredClone(state.baseNotes),
    { pitch: "E5", bar: 3, beat: 0, durationBeats: 4, owner: "guest" },
  ];
  state.turns.push({ number: 4, authorUid: "tutorial-guest", notes: responseNotes });
  state.reflections.guest.push({ turnNumber: 4, interpretation: "明るさが加わったと感じた", intention: "高い音で応答した", guess: "お題A" });
  state.session = { ...state.session, turnNumber: 5, currentPlayerUid: TUTORIAL_UID };
  state.baseNotes = sanitizeNotes(responseNotes); state.draftNotes = structuredClone(state.baseNotes);
  state.turnsLoaded = true; updateSessionUi(); renderHistory(); renderTutorialGuide();
  $("history-btn").focus();
}
function showTutorialResult() {
  if (!state.tutorialMode || tutorialState.stage !== "history") return;
  tutorialState = reviewTutorialResult(tutorialState, { myGuess: "お題B", opponentPrompt: "お題B", opponentGuess: "お題A", myPrompt: "お題A" });
  if (tutorialState.stage !== "result") return;
  const finalNotes = structuredClone(state.baseNotes);
  for (const [number, authorUid] of [[5, TUTORIAL_UID], [6, "tutorial-guest"], [7, TUTORIAL_UID]]) {
    state.turns.push({ number, authorUid, notes: structuredClone(finalNotes) });
  }
  state.reflections.host.push(
    { turnNumber: 5, interpretation: "高い音が返ってきた", intention: "響きをまとめた", guess: "お題B" },
    { turnNumber: 7, interpretation: "応答の方向が分かった", intention: "", guess: "お題B" },
  );
  state.reflections.guest.push({ turnNumber: 6, interpretation: "まとまりを感じた", intention: "最後の応答を加えた", guess: "お題A" });
  state.session = { ...state.session, status: "completed", turnNumber: MAX_TURNS, currentPlayerUid: null };
  state.opponentPrivate = { prompt: "お題B" }; state.revealed = true;
  $("tutorial-history-note").hidden = true; $("history-dialog").close(); updateSessionUi(); renderHistory(); renderResults();
  $("result-dialog").showModal();
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
  for (let bar = 0; bar < HARMONY.length; bar += 1) {
    const head = document.createElement("div");
    head.className = "chord-head";
    const label = document.createElement("strong"); label.textContent = `${bar + 1}｜${HARMONY[bar].label}`;
    const tones = document.createElement("small"); tones.textContent = HARMONY[bar].tones;
    head.append(label, tones);
    grid.append(head);
  }
  const editable = canEditNotes();
  for (const pitch of pitchesDescending()) {
    const key = document.createElement("div");
    key.className = `key${pitch.includes("#") ? " black" : ""}`;
    key.textContent = pitch.startsWith("C") ? pitch : "";
    grid.append(key);
    for (let bar = 0; bar < HARMONY.length; bar += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `cell${pitch.includes("#") ? " black-row" : ""}`;
      cell.disabled = !editable;
      cell.setAttribute("aria-label", `${bar + 1}番目の和音 ${pitch}`);
      cell.addEventListener("click", () => toggleNote({ pitch, bar, beat: 0 }));
      const notes = state.draftNotes.filter((note) => note.pitch === pitch && note.bar === bar);
      if (notes.length) {
        const description = notes.map((note) => noteDescription(note)).join("，");
        cell.setAttribute("aria-label", `${bar + 1}番目の和音 ${description}．押すと削除`);
      }
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
  mark.title = noteDescription(note);
  mark.setAttribute("aria-label", noteDescription(note));
  return mark;
}
function ownerLabel(owner) {
  if (owner === "system") return "基本和音";
  return owner === state.role ? "あなた" : "相手";
}
function noteDescription(note) {
  const harmonic = classifyNoteRole(HARMONY[note.bar].root, note.pitch, HARMONY[note.bar].context);
  return `${note.pitch}｜${harmonic.degree}｜${ownerLabel(note.owner)}`;
}
function isMyTurn() {
  const uid = state.tutorialMode ? TUTORIAL_UID : state.uid;
  return state.session?.status === "active" && state.session.currentPlayerUid === uid;
}
function canEditNotes() {
  if (state.tutorialMode) return tutorialState.stage === "edit";
  return state.turnsLoaded && isMyTurn() && state.session.turnNumber < state.session.maxTurns;
}
function toggleNote(candidate) {
  if (!canEditNotes()) return;
  if (state.playing) stopPlayback();
  const existing = state.draftNotes.find((note) => note.bar === candidate.bar && note.pitch === candidate.pitch);
  const existingNote = Boolean(existing);
  if (existingNote) {
    state.draftNotes = removeNote(state.draftNotes, candidate).notes;
    if (state.tutorialMode && existing.owner === "system") tutorialState = markBaseNoteRemoved(tutorialState);
    if (state.tutorialMode && existing.owner !== "system" && existing.owner !== state.role) tutorialState = markOpponentNoteRemoved(tutorialState);
  } else {
    const placed = placeNote(state.draftNotes, { ...candidate, durationBeats: 4, owner: state.role });
    if (placed.outcome === "chord-full") { showToast("1つの和音には8音まで置けます．", true); return; }
    if (placed.outcome === "duplicate") { return; }
    state.draftNotes = placed.notes;
    if (state.tutorialMode) tutorialState = markNoteAdded(tutorialState);
    playSingle(candidate.pitch, state.role);
  }
  renderGrid(); renderTutorialGuide();
  if (state.tutorialMode && tutorialState.stage === "playback") $("preview-btn").focus();
}
function playSingle(pitch, voice) {
  audio.play([{ voice, frequency: noteToFrequency(pitch), startSeconds: 0, durationSeconds: .45 }]);
}
function playbackEvents(notes = state.draftNotes) {
  const melody = buildPlaybackSchedule({ melodyNotes: MELODY_NOTES, bpm: BPM }).map((event) => ({ ...event, voice: "melody" }));
  const grouped = ["system", "host", "guest"].flatMap((owner) => buildPlaybackSchedule({ accompanimentNotes: notes.filter((note) => note.owner === owner), bpm: BPM }).map((event) => ({ ...event, voice: owner })));
  return [...melody, ...grouped].sort((a, b) => a.startSeconds - b.startSeconds);
}
function setPlaybackButton(button, playing) {
  if (!button) return;
  if (button.id === "preview-btn") {
    $("preview-icon").textContent = playing ? "■" : "▶";
    $("preview-label").textContent = playing ? "停止" : "全体を聴く";
  } else {
    button.textContent = playing ? "■ 停止" : button.dataset.playLabel;
  }
}
async function togglePlayback(notes, button = $("preview-btn")) {
  if (state.playing) {
    const switchingSource = state.playbackButton !== button;
    if (!switchingSource && state.tutorialMode && button.id === "preview-btn" && tutorialState.stage === "playback") {
      tutorialState = markPlaybackCompleted(tutorialState);
    }
    stopPlayback();
    updateForm(); renderTutorialGuide();
    if (state.tutorialMode && tutorialState.stage === "record") $("interpretation-input").focus();
    if (!switchingSource) return;
  }
  state.playing = true; state.playbackButton = button; setPlaybackButton(button, true);
  try {
    await audio.play(playbackEvents(notes), {
      onPlayhead: ({ progress }) => { $("playhead").style.width = `${progress * 100}%`; },
      onEnded: () => {
        if (state.tutorialMode && button.id === "preview-btn" && tutorialState.stage === "playback") {
          tutorialState = markPlaybackCompleted(tutorialState); updateForm(); renderTutorialGuide();
          $("interpretation-input").focus();
        }
        stopPlayback();
      },
    });
    if (state.tutorialMode && button.id === "preview-btn" && tutorialState.stage === "playback") {
      tutorialState = markPlaybackStarted(tutorialState); renderTutorialGuide();
    }
    if (state.tutorialMode && button.classList.contains("history-play-button") && tutorialState.stage === "history") {
      tutorialState = markHistoryPlaybackPracticed(tutorialState);
      $("tutorial-show-result-btn").disabled = false;
    }
  } catch (error) { stopPlayback(); showToast(friendlyError(error), true); }
}
function stopPlayback() {
  audio.stop(); setPlaybackButton(state.playbackButton, false); state.playing = false; state.playbackButton = null;
  $("playhead").style.width = "0";
}

function updateForm() {
  const turn = state.session?.turnNumber ?? 1;
  $("interpretation-field").hidden = turn === 1;
  $("intention-field").hidden = turn === MAX_TURNS;
  $("guess-field").hidden = turn === 1;
  const interpretation = $("interpretation-input").value.trim();
  const intention = $("intention-input").value.trim();
  const guess = $("guess-select").value;
  const valid = turn === 1 ? Boolean(intention) : turn === MAX_TURNS ? Boolean(interpretation && guess) : Boolean(interpretation && intention && guess);
  if (state.tutorialMode && ["record", "commit"].includes(tutorialState.stage)) {
    tutorialState = markRecordCompleted(tutorialState, { interpretation, intention, guess });
  }
  $("commit-btn").disabled = state.tutorialMode
    ? tutorialState.stage !== "commit"
    : !(state.turnsLoaded && isMyTurn() && valid);
  $("requirement-text").textContent = !state.turnsLoaded ? "盤面を読み込んでいます．" : !isMyTurn() ? "あなたの手番になると記録を送れます．" : valid ? "送信できます．確定後は編集できません．" : turn === 1 ? "今回の意図を入力してください．" : turn === MAX_TURNS ? "最終ターンでは音を編集せず，解釈と相手のお題の予想を入力してください．" : "解釈，意図，相手のお題の予想を入力してください．";
  if (state.tutorialMode) renderTutorialGuide();
}
function updateSessionUi() {
  if (!state.session) return;
  $("turn-number").textContent = state.session.turnNumber;
  $("max-turn").textContent = state.session.maxTurns;
  const waiting = state.session.status === "waiting";
  const completed = state.session.status === "completed";
  const myTurn = isMyTurn();
  $("turn-badge").textContent = completed ? "完了" : waiting ? "参加待ち" : myTurn ? "あなたの手番" : "相手の手番";
  $("turn-lock").hidden = myTurn || completed;
  $("lock-title").textContent = waiting ? "もう一人の参加を待っています" : "相手の応答を待っています";
  $("lock-detail").textContent = waiting ? `セッションID「${state.sessionId}」をもう一つのタブで入力してください．` : "確定されると画面は自動で更新されます．";
  renderGrid(); updateForm();
  if (completed && !state.revealed) revealResults();
}
function applyLatestTurn() {
  const latest = state.turns.at(-1);
  state.baseNotes = sanitizeNotes(latest ? latest.notes : SYSTEM_NOTES);
  state.draftNotes = structuredClone(state.baseNotes);
  state.turnsLoaded = hasCurrentBoardSnapshot(state.session, state.turns.length);
  renderGrid(); renderHistory(); updateForm();
}

function clearInputs() {
  $("interpretation-input").value = ""; $("intention-input").value = ""; $("guess-select").value = "";
  $("interpretation-count").textContent = "0"; $("intention-count").textContent = "0";
}
async function commitTurn() {
  if (!state.turnsLoaded || !isMyTurn()) return;
  if (state.tutorialMode) {
    const reflection = { turnNumber: 3, interpretation: $("interpretation-input").value.trim(), intention: $("intention-input").value.trim(), guess: $("guess-select").value };
    tutorialState = commitTutorialTurn(tutorialState, reflection);
    if (tutorialState.stage !== "committed") { updateForm(); return; }
    state.turns.push({ number: 3, authorUid: TUTORIAL_UID, notes: structuredClone(state.draftNotes) });
    state.reflections.host.push(reflection); state.baseNotes = structuredClone(state.draftNotes);
    tutorialState = beginOpponentWait(tutorialState);
    state.session = { ...state.session, turnNumber: 4, currentPlayerUid: "tutorial-guest" };
    clearInputs(); updateSessionUi(); renderHistory(); renderTutorialGuide();
    $("tutorial-guide-action").focus();
    return;
  }
  $("commit-btn").disabled = true;
  try {
    await gateway.commitTurn({ sessionId: state.sessionId, notes: state.draftNotes, reflection: { interpretation: $("interpretation-input").value.trim(), intention: $("intention-input").value.trim(), guess: $("guess-select").value } });
    clearInputs(); showToast("ターンを送りました．");
  } catch (error) { showToast(friendlyError(error), true); updateForm(); }
}

function enterSession({ sessionId, role, uid }) {
  stopSessionListeners();
  state.sessionId = sessionId; state.role = role; state.uid = uid;
  state.session = null; state.privateData = null; state.opponentPrivate = null;
  state.turns = []; state.reflections = { host: [], guest: [] };
  state.baseNotes = structuredClone(SYSTEM_NOTES); state.draftNotes = structuredClone(SYSTEM_NOTES);
  state.turnsLoaded = false; state.revealed = false; state.historyOpenedFromResult = false;
  rememberSession(sessionId);
  $("session-id-label").textContent = sessionId;
  $("lobby-view").hidden = true; $("game-view").hidden = false;
  const generation = state.sessionGeneration;
  const onError = forSessionGeneration(generation, (error) => showToast(friendlyError(error), true));
  state.unsubscribers.push(
    gateway.listenSession(sessionId, forSessionGeneration(generation, (session) => {
      state.session = session;
      state.turnsLoaded = hasCurrentBoardSnapshot(state.session, state.turns.length);
      updateSessionUi(); renderHistory();
    }), onError),
    gateway.listenTurns(sessionId, forSessionGeneration(generation, (turns) => { state.turns = turns; applyLatestTurn(); }), onError),
    gateway.listenPrivateData(sessionId, role, forSessionGeneration(generation, (data) => {
      state.privateData = data;
      if ($("theme-card").getAttribute("aria-expanded") === "true") $("theme-text").textContent = data?.prompt || "読み込み中…";
      if (state.revealed) renderResults();
    }), onError),
    gateway.listenReflections(sessionId, role, forSessionGeneration(generation, (items) => {
      state.reflections[role] = items; renderHistory(); if (state.revealed) renderResults();
    }), onError),
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
function createHistoryPianoRoll(notes) {
  const frame = document.createElement("div");
  frame.className = "history-roll-frame";
  const roll = document.createElement("div");
  roll.className = "history-piano-roll";
  roll.setAttribute("aria-label", "このターンで確定した4和音のピアノロール");
  const pitchRows = pitchesDescending();

  const corner = document.createElement("div");
  corner.className = "history-corner";
  corner.textContent = "音名";
  roll.append(corner);
  for (let bar = 0; bar < HARMONY.length; bar += 1) {
    const head = document.createElement("div");
    head.className = "history-chord-head";
    head.innerHTML = `<strong>${bar + 1}｜${HARMONY[bar].label}</strong><small>${HARMONY[bar].tones}</small>`;
    roll.append(head);
  }
  for (const pitch of pitchRows) {
    const key = document.createElement("div");
    key.className = `history-key${pitch.includes("#") ? " black" : ""}`;
    key.textContent = pitch;
    roll.append(key);
    for (let bar = 0; bar < HARMONY.length; bar += 1) {
      const cell = document.createElement("div");
      cell.className = `history-cell${pitch.includes("#") ? " black-row" : ""}`;
      const cellNotes = notes.filter((note) => note.pitch === pitch && note.bar === bar);
      cellNotes.forEach((note, index) => cell.append(renderNote(note, index, cellNotes.length)));
      cell.setAttribute("aria-label", cellNotes.length
        ? `${bar + 1}番目の和音 ${cellNotes.map((note) => noteDescription(note)).join("，")}`
        : `${bar + 1}番目の和音 ${pitch} 音なし`);
      roll.append(cell);
    }
  }
  frame.append(roll);
  return frame;
}
function renderHistory() {
  if (state.playing && state.playbackButton?.classList.contains("history-play-button")) stopPlayback();
  const list = $("history-list"); list.replaceChildren();
  if (!state.turns.length) { list.append(textRow("履歴", "まだ確定されたターンはありません．")); return; }
  for (const turn of state.turns) {
    const role = turn.authorUid === state.session?.hostUid ? "host" : "guest";
    const mine = role === state.role;
    const reflection = state.reflections[role].find((item) => item.turnNumber === turn.number);
    const item = document.createElement("article"); item.className = "history-item";
    const header = document.createElement("header"); const title = document.createElement("strong"); title.textContent = `TURN ${turn.number}`;
    const author = document.createElement("span"); author.textContent = mine ? "あなた" : "相手"; header.append(title, author); item.append(header);
    const turnNotes = sanitizeNotes(turn.notes);
    const board = document.createElement("div"); board.className = "history-board";
    const playButton = document.createElement("button"); playButton.type = "button"; playButton.className = "button secondary history-play-button"; playButton.textContent = "▶ このターンを聴く";
    playButton.dataset.playLabel = "▶ このターンを聴く";
    playButton.addEventListener("click", () => togglePlayback(turnNotes, playButton));
    board.append(playButton, createHistoryPianoRoll(turnNotes)); item.append(board);
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
  const generation = state.sessionGeneration;
  const onError = forSessionGeneration(generation, (error) => showToast(friendlyError(error), true));
  state.unsubscribers.push(
    gateway.listenPrivateData(state.sessionId, otherRole, forSessionGeneration(generation, (data) => { state.opponentPrivate = data; renderResults(); }), onError),
    gateway.listenReflections(state.sessionId, otherRole, forSessionGeneration(generation, (items) => {
      state.reflections[otherRole] = items; renderHistory(); renderResults();
    }), onError),
  );
  renderResults(); $("result-dialog").showModal();
}
function createResultPrompt(label, value, className) {
  const card = document.createElement("section"); card.className = `result-prompt ${className}`;
  const caption = document.createElement("span"); caption.textContent = label;
  const prompt = document.createElement("strong"); prompt.textContent = value;
  card.append(caption, prompt); return card;
}
function createPredictionLane({ ownerLabel, comparisonTarget, result, className }) {
  const lane = document.createElement("section"); lane.className = `prediction-lane ${className}`;
  const arrow = document.createElement("span"); arrow.className = "prediction-arrow"; arrow.setAttribute("aria-hidden", "true");
  const content = document.createElement("div"); content.className = "prediction-content";
  const owner = document.createElement("span"); owner.className = "prediction-owner"; owner.textContent = ownerLabel;
  const detail = document.createElement("strong"); detail.className = "prediction-detail"; detail.textContent = result.guess;
  const judgement = document.createElement("span");
  judgement.className = `prediction-judgement ${result.isCorrect ? "correct" : "incorrect"}`;
  judgement.textContent = `${result.isCorrect ? "○" : "×"} ${comparisonTarget}と${result.isCorrect ? "一致" : "不一致"}`;
  content.append(owner, detail, judgement); lane.append(content, arrow); return lane;
}
function renderResults() {
  const comparison = $("result-comparison"); comparison.replaceChildren();
  const otherRole = state.role === "host" ? "guest" : "host";
  const myPrompt = state.privateData?.prompt;
  const otherPrompt = state.opponentPrivate?.prompt;
  const results = getBidirectionalFinalGuessResults({
    role: state.role,
    maxTurns: state.session?.maxTurns,
    myPrompt,
    opponentPrompt: otherPrompt,
    myReflections: state.reflections[state.role],
    opponentReflections: state.reflections[otherRole],
  });
  if (!results) {
    comparison.className = "result-comparison loading";
    comparison.textContent = "双方の最終予想を読み込んでいます．";
    return;
  }
  comparison.className = "result-comparison ready";
  comparison.append(
    createResultPrompt("あなたのお題", myPrompt, "mine"),
    createPredictionLane({ ownerLabel: "あなたの予想", comparisonTarget: "相手のお題", result: results.mine, className: "toward-other" }),
    createPredictionLane({ ownerLabel: "相手の予想", comparisonTarget: "あなたのお題", result: results.opponent, className: "toward-mine" }),
    createResultPrompt("相手のお題", otherPrompt, "other"),
  );
}

function returnToLobby() {
  stopPlayback();
  state.historyOpenedFromResult = false;
  stopSessionListeners(); forgetSession();
  for (const dialog of [$("history-dialog"), $("result-dialog")]) if (dialog.open) dialog.close();
  state.sessionId = null; state.role = null; state.session = null; state.privateData = null; state.opponentPrivate = null;
  state.turns = []; state.reflections = { host: [], guest: [] };
  state.baseNotes = structuredClone(SYSTEM_NOTES); state.draftNotes = structuredClone(SYSTEM_NOTES);
  state.turnsLoaded = false; state.revealed = false;
  state.tutorialMode = false; tutorialState = createTutorialState();
  document.body.classList.remove("tutorial-active");
  clearInputs();
  $("theme-card").setAttribute("aria-expanded", "false"); $("theme-text").textContent = "クリックして表示";
  $("session-id-label").textContent = "------"; $("session-id-input").value = ""; $("copy-session-btn").disabled = false;
  $("tutorial-guide").hidden = true; $("tutorial-history-note").hidden = true; removeTutorialFocus(); populateGuessOptions();
  $("history-list").replaceChildren(); $("result-comparison").replaceChildren();
  $("game-view").hidden = true; $("lobby-view").hidden = false;
  $("auth-status").textContent = state.uid ? "接続済み" : "匿名接続を準備中";
  $("create-session-btn").disabled = !state.uid; $("join-session-btn").disabled = !state.uid;
  showToast("最初の画面へ戻りました．");
}

function bindUi() {
  populateGuessOptions();
  $("session-id-input").addEventListener("input", (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6); });
  $("create-session-btn").addEventListener("click", createSession); $("join-session-btn").addEventListener("click", joinSession); $("commit-btn").addEventListener("click", commitTurn);
  $("result-play-btn").dataset.playLabel = "最後の音を聴く";
  $("preview-btn").addEventListener("click", () => togglePlayback()); $("result-play-btn").addEventListener("click", () => togglePlayback(state.baseNotes, $("result-play-btn")));
  $("theme-card").addEventListener("click", () => {
    const open = $("theme-card").getAttribute("aria-expanded") !== "true";
    $("theme-card").setAttribute("aria-expanded", String(open)); $("theme-text").textContent = open ? state.privateData?.prompt || "読み込み中…" : "クリックして表示";
    if (state.tutorialMode && tutorialState.stage === "prompt" && open) { tutorialState = revealTutorialPrompt(tutorialState); renderGrid(); renderTutorialGuide(); }
  });
  $("copy-session-btn").addEventListener("click", async () => { if (state.tutorialMode) return; await navigator.clipboard.writeText(state.sessionId); showToast("セッションIDをコピーしました．"); });
  for (const [inputId, countId] of [["interpretation-input","interpretation-count"],["intention-input","intention-count"]]) $(inputId).addEventListener("input", () => { $(countId).textContent = $(inputId).value.length; updateForm(); });
  $("guess-select").addEventListener("change", updateForm);
  $("history-btn").addEventListener("click", () => {
    if (state.tutorialMode && !["response", "history"].includes(tutorialState.stage)) return;
    if (state.tutorialMode && tutorialState.stage === "response") tutorialState = openTutorialHistory(tutorialState);
    state.historyOpenedFromResult = false; renderHistory(); $("tutorial-history-note").hidden = !state.tutorialMode;
    if (state.tutorialMode) $("tutorial-show-result-btn").disabled = !tutorialState.historyPlaybackPracticed;
    renderTutorialGuide(); $("history-dialog").showModal();
  });
  $("close-history-btn").addEventListener("click", () => { stopPlayback(); $("history-dialog").close(); });
  $("history-dialog").addEventListener("close", () => {
    stopPlayback();
    if (state.historyOpenedFromResult && state.session?.status === "completed") {
      state.historyOpenedFromResult = false; renderResults(); $("result-dialog").showModal();
    } else if (state.tutorialMode) renderTutorialGuide();
  });
  $("result-history-btn").addEventListener("click", () => { stopPlayback(); state.historyOpenedFromResult = true; $("tutorial-history-note").hidden = true; $("result-dialog").close(); renderHistory(); $("history-dialog").showModal(); });
  $("result-home-btn").addEventListener("click", () => {
    const returningFromTutorial = state.tutorialMode;
    if (state.tutorialMode) tutorialState = completeTutorial(tutorialState);
    returnToLobby();
    if (returningFromTutorial) $("open-tutorial-btn").focus();
  });
  $("result-dialog").addEventListener("cancel", (event) => event.preventDefault());
  $("open-tutorial-btn").addEventListener("click", openTutorial);
  $("skip-tutorial-btn").addEventListener("click", closeTutorial);
  $("tutorial-guide-action").addEventListener("click", () => {
    if (tutorialState.stage === "overview") {
      tutorialState = acknowledgeTutorialOverview(tutorialState); renderTutorialGuide(); $("theme-card").focus();
    } else if (tutorialState.stage === "waiting") tutorialOpponentResponse();
    else if (tutorialState.stage === "history") $("history-btn").click();
  });
  $("tutorial-show-result-btn").addEventListener("click", showTutorialResult);
}

bindUi(); renderGrid();
gateway.listenToAuthentication((user) => {
  state.uid = user?.uid ?? null;
  $("auth-dot").classList.toggle("online", Boolean(user));
  const sessionId = user && !state.sessionId && !restoringSession ? rememberedSessionId() : null;
  $("auth-status").textContent = sessionId ? "セッションへ復帰中" : user ? "接続済み" : "匿名接続を準備中";
  $("create-session-btn").disabled = !user || Boolean(sessionId);
  $("join-session-btn").disabled = !user || Boolean(sessionId);
  if (sessionId) {
    restoringSession = true;
    gateway.resumeSession({ sessionId })
      .then(enterSession)
      .catch(() => forgetSession())
      .finally(() => {
        restoringSession = false;
        if (!state.sessionId) {
          $("auth-status").textContent = "接続済み";
          $("create-session-btn").disabled = false;
          $("join-session-btn").disabled = false;
        }
      });
  }
});
gateway.authenticateAnonymously().catch((error) => showToast(friendlyError(error), true));
