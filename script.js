
// 曲の構成定義 (きらきら星: C -> F -> G -> C)
const SONG_STRUCTURE = [
    { bar: 0, chordRoot: 'C3', scale: 'Major' },    // 1小節目: C
    { bar: 1, chordRoot: 'F3', scale: 'Major' },    // 2小節目: F
    { bar: 2, chordRoot: 'G3', scale: 'Dominant' }, // 3小節目: G
    { bar: 3, chordRoot: 'C3', scale: 'Major' }     // 4小節目: C
];

// メロディ定義 (きらきら星: ドドソソララソ...)
// time: 小節内のタイミング(0.0~1.0), note: 音程, duration: 長さ
const MELODY_DATA = [
    // Bar 1 (C)
    { bar: 0, time: 0.0, note: 'C4', duration: 0.25 }, // 煌
    { bar: 0, time: 0.25, note: 'C4', duration: 0.25 }, // 煌
    { bar: 0, time: 0.5, note: 'G4', duration: 0.25 }, // 光
    { bar: 0, time: 0.75, note: 'G4', duration: 0.25 }, // る

    // Bar 2 (F)
    { bar: 1, time: 0.0, note: 'A4', duration: 0.25 }, // お
    { bar: 1, time: 0.25, note: 'A4', duration: 0.25 }, // 空
    { bar: 1, time: 0.5, note: 'G4', duration: 0.5 },  // の

    // Bar 3 (G)
    { bar: 2, time: 0.0, note: 'F4', duration: 0.25 }, // 星
    { bar: 2, time: 0.25, note: 'F4', duration: 0.25 }, // よ
    { bar: 2, time: 0.5, note: 'E4', duration: 0.25 }, // (以下略)
    { bar: 2, time: 0.75, note: 'E4', duration: 0.25 },

    // Bar 4 (C)
    { bar: 3, time: 0.0, note: 'D4', duration: 0.25 },
    { bar: 3, time: 0.25, note: 'D4', duration: 0.25 },
    { bar: 3, time: 0.5, note: 'C4', duration: 0.5 },
];

// -------------------------------------------------
// 1. 音響エンジン (SoundEngine) クラス
// -------------------------------------------------
class SoundEngine {
    constructor() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();

        // 鳴っている音（予約含む）を管理するリスト
        this.activeOscillators = [];

        // マスターボリューム
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.3;
        this.masterGain.connect(this.ctx.destination);

        // メロディ用マスター
        this.melodyGain = this.ctx.createGain();
        this.melodyGain.gain.value = 0.4;
        this.melodyGain.connect(this.ctx.destination);
    }

    // 音源を登録・再生する共通処理
    _scheduleOscillator(osc, duration) {
        // リストに追加
        this.activeOscillators.push(osc);

        // 再生が終わったらリストから削除（メモリ節約）
        osc.onended = () => {
            this.activeOscillators = this.activeOscillators.filter(o => o !== osc);
        };
    }

    // 強制停止メソッド（ここが重要！）
    stopAll() {
        this.activeOscillators.forEach(osc => {
            try {
                osc.stop();       // 音を止める
                osc.disconnect(); // 回路から外す
            } catch (e) {
                // 既に止まっている場合のエラーは無視
            }
        });
        // リストを空にする
        this.activeOscillators = [];
    }

    playTone(frequency, duration = 0.5, startTime = 0) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const now = startTime || this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.value = frequency;

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(1, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(now);
        osc.stop(now + duration);

        this._scheduleOscillator(osc, duration); // 管理リストへ登録
    }

    playMelodyTone(frequency, duration = 0.5, startTime = 0) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const now = startTime || this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'square';
        osc.frequency.value = frequency;

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.5, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

        osc.connect(gain);
        gain.connect(this.melodyGain);

        osc.start(now);
        osc.stop(now + duration);

        this._scheduleOscillator(osc, duration); // 管理リストへ登録
    }

    getFreq(noteName) {
        // ... (以前と同じコード) ...
        const regex = /([A-G]#?)(\d+)/;
        const match = noteName.match(regex);
        if (!match) return 440;
        const key = match[1];
        const oct = parseInt(match[2], 10);
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const a4Index = 9 + (4 * 12);
        const targetIndex = notes.indexOf(key) + (oct * 12);
        return 440 * Math.pow(2, (targetIndex - a4Index) / 12);
    }
}

// グローバル変数として準備
const soundEngine = new SoundEngine();

// -------------------------------------------------
// 2. UI描画・インタラクション
// -------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    initPianoRoll();
    setupInteraction();
});

// 定数
const OCTAVES = 4; // C2 ~ C6
const START_OCTAVE = 6; // C6から描き始める
const NOTES = ['B', 'A#', 'A', 'G#', 'G', 'F#', 'F', 'E', 'D#', 'D', 'C#', 'C'];

// ノート音名から MIDI番号的な数値を取得する関数
function getNoteNumber(noteName) {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const regex = /([A-G]#?)(\d+)/;
    const match = noteName.match(regex);
    if (!match) return 0;

    const key = match[1];
    const oct = parseInt(match[2], 10);
    return (oct + 1) * 12 + notes.indexOf(key);
}

// ルート音とターゲット音から「度数」を計算する関数
function calculateDegree(rootNote, targetNote) {
    const rootNum = getNoteNumber(rootNote);
    const targetNum = getNoteNumber(targetNote);

    // 差分（半音数）
    let diff = (targetNum - rootNum) % 12;
    if (diff < 0) diff += 12;

    const degreeMap = {
        0: 'R', 1: 'b9', 2: '9', 3: 'm3', 4: 'M3', 5: '11',
        6: '#11', 7: '5', 8: 'b13', 9: '13', 10: 'm7', 11: 'M7'
    };

    return degreeMap[diff] || '?';
}
/**
 * 度数ラベルから音楽的な役割(クラス名)を判定する
 * @param {string} degree - 度数 (例: "M3", "9", "11")
 * @return {string} CSSクラス名部分 (role-chord, role-tension, role-avoid)
 */
function getDegreeRole(degree) {
    // 1. 構成音 (Chord Tones)
    // R(Root), 5(Fifth), M3/m3(Thirds), M7/m7(Sevenths)
    const chordTones = ['R', '5', 'M3', 'm3', 'M7', 'm7'];
    if (chordTones.includes(degree)) {
        return 'role-chord';
    }

    // 2. アヴォイドノート (Avoid Notes)
    // 今回のきらきら星(Major/Dominant)では、主に「11 (Perfect 4th)」がアヴォイド
    // ※b9やb13も文脈によりますが、Cメジャーキーでは濁りやすいのでAvoid扱いでもOK
    const avoidNotes = ['11', 'b9', 'b13'];
    if (avoidNotes.includes(degree)) {
        return 'role-avoid';
    }

    // 3. テンション (Tensions)
    // 上記以外 (9, 13, #11 など)
    return 'role-tension';
}

// ピアノロールの初期化
function initPianoRoll() {
    const keysLayer = document.getElementById('piano-keys-layer');
    const gridLayer = document.getElementById('grid-layer');

    keysLayer.innerHTML = '';
    gridLayer.innerHTML = '';

    // C6 -> C2 の順に描画
    for (let oct = START_OCTAVE; oct > START_OCTAVE - OCTAVES; oct--) {
        NOTES.forEach(note => {
            const noteName = `${note}${oct}`;
            const isBlack = note.includes('#');

            // --- 左側：鍵盤 ---
            const keyEl = document.createElement('div');
            keyEl.className = isBlack ? 'key-black' : 'key-white';

            // ★重要: 高さ固定・縮小禁止を設定
            keyEl.style.height = '24px';
            keyEl.style.flexShrink = '0';

            if (note === 'C') {
                keyEl.classList.add('has-label');
                keyEl.textContent = `C${oct}`;
                keyEl.style.borderBottom = "1px solid #9ca3af";
            }
            keysLayer.appendChild(keyEl);

            // --- 右側：グリッド行 ---
            const rowEl = document.createElement('div');
            rowEl.className = 'w-full flex relative';

            // ★重要: 高さ固定・縮小禁止を設定
            rowEl.style.height = '24px';
            rowEl.style.flexShrink = '0';

            rowEl.style.borderBottom = note === 'C' ? '1px solid #d1d5db' : '1px solid #f3f4f6';

            // クリックイベント
            rowEl.addEventListener('click', (e) => {
                handleGridClick(e, noteName, rowEl);
            });

            gridLayer.appendChild(rowEl);

            rowEl.dataset.pitch = noteName;
        });
    }
}

// グリッドクリック時の処理
function handleGridClick(e, pitch, rowEl) {
    // 誤動作防止
    if (e.target !== rowEl) return;

    const rect = rowEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;

    // 1. 小節判定 (全体を4等分)
    const barWidth = width / 4;
    const barIndex = Math.floor(x / barWidth); // 0 ~ 3

    if (barIndex < 0 || barIndex >= 4) return;

    // 2. コード情報の取得
    const currentChord = SONG_STRUCTURE[barIndex];

    // 3. 度数計算
    const degreeLabel = calculateDegree(currentChord.chordRoot, pitch);

    // 4. 音を鳴らす
    const freq = soundEngine.getFreq(pitch);
    soundEngine.playTone(freq, 0.4);

    // 5. ブロック生成
    const block = document.createElement('div');

    // 役割判定
    const roleClass = getDegreeRole(degreeLabel);

    // クラス適用: note-mine(青背景) + roleClass(文字色と枠線)
    block.className = `note-block note-mine ${roleClass}`;

    block.textContent = degreeLabel;

    // 1小節 = 25% の幅。
    // 左端の位置は barIndex * 25% で決まる。
    block.style.left = `${barIndex * 25}%`;
    block.style.width = `25%`;

    // ※視覚的な隙間（隣の小節との境界線）はCSSのborderで表現するのが安全です。
    //  style.css側で .note-block に border-right: 1px solid white; などを入れると綺麗です。

    // 削除機能
    block.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        block.remove();
        updateNoteCount(-1);
    });

    rowEl.appendChild(block);
    updateNoteCount(1);

    console.log(`Placed ${pitch} in Bar ${barIndex + 1} (${currentChord.chordRoot}) -> ${degreeLabel}`);
}

// 音数表示の更新
let currentNotes = 0;
function updateNoteCount(diff) {
    currentNotes += diff;
    const display = document.getElementById('note-count-display');
    if (display) display.textContent = currentNotes;
}

// 画面遷移などのモック
function setupInteraction() {
    const joinBtn = document.getElementById('join-session-btn');
    const createBtn = document.getElementById('create-session-btn');

    const action = () => {
        document.getElementById('session-container').classList.add('hidden');
        document.getElementById('game-container').classList.remove('hidden');
        document.getElementById('game-container').classList.add('flex');

        // ブラウザによってはここで一度resumeしておくと確実
        if (soundEngine.ctx.state === 'suspended') {
            soundEngine.ctx.resume();
        }

        initPianoRoll();
    };

    if (joinBtn) joinBtn.addEventListener('click', action);
    if (createBtn) createBtn.addEventListener('click', action);

    // ログ入力によるボタン活性化
    const logHypothesis = document.getElementById('log-hypothesis');
    const logIntention = document.getElementById('log-intention');
    const commitBtn = document.getElementById('commit-btn');

    const checkLogs = () => {
        if (logHypothesis.value.length > 0 && logIntention.value.length > 0) {
            commitBtn.disabled = false;
            commitBtn.classList.remove('opacity-30', 'cursor-not-allowed');
        } else {
            commitBtn.disabled = true;
            commitBtn.classList.add('opacity-30', 'cursor-not-allowed');
        }
    };

    if (logHypothesis) logHypothesis.addEventListener('input', checkLogs);
    if (logIntention) logIntention.addEventListener('input', checkLogs);
}

// =========================================
// 再生機能 (Sequencer) - 修正版
// =========================================

let isPlaying = false;
let animationFrameId = null; // アニメーション停止用
let stopTimeoutId = null;    // 強制停止タイマー用

const BPM = 100; // テンポ
const SECONDS_PER_BAR = (60 / BPM) * 4; // 1小節の秒数

function setupSequencer() {
    const previewBtn = document.getElementById('preview-btn');
    if (!previewBtn) return;

    previewBtn.addEventListener('click', () => {
        if (isPlaying) {
            // 再生中なら停止する
            stopSequence();
        } else {
            // 停止中なら再生する
            playSequence();
        }
    });
}

function playSequence() {
    // AudioContextを確実に起こす
    if (soundEngine.ctx.state === 'suspended') {
        soundEngine.ctx.resume();
    }

    isPlaying = true;
    updatePreviewButtonState(true); // ボタンの見た目を変える（後述）

    const now = soundEngine.ctx.currentTime;
    const totalDuration = SECONDS_PER_BAR * 4;

    // 1. メロディのスケジューリング
    MELODY_DATA.forEach(data => {
        const freq = soundEngine.getFreq(data.note);
        const time = now + (data.bar * SECONDS_PER_BAR) + (data.time * SECONDS_PER_BAR);
        const duration = data.duration * SECONDS_PER_BAR;
        soundEngine.playMelodyTone(freq, duration, time);
    });

    // 2. コード(ブロック)のスケジューリング
    const blocks = document.querySelectorAll('.note-block');
    blocks.forEach(block => {
        const rowEl = block.parentElement;
        const pitch = rowEl.dataset.pitch;

        // style.leftの%値から小節を判定
        // ※正確にはDOMではなく内部データを持つべきですが、簡易実装として維持
        const leftPercent = parseFloat(block.style.left);
        const barIndex = Math.round(leftPercent / 25);

        // 再生時刻
        const time = now + (barIndex * SECONDS_PER_BAR);
        const duration = SECONDS_PER_BAR; // 1小節分

        const freq = soundEngine.getFreq(pitch);
        soundEngine.playTone(freq, duration, time);
    });

    // 3. アニメーション開始
    animatePlayhead(now, totalDuration);

    // 4. 安全策: 曲が終わる時間に強制的に停止処理を呼ぶ
    // (アニメーションが裏で止まってもフラグを戻すため)
    stopTimeoutId = setTimeout(() => {
        if (isPlaying) stopSequence();
    }, totalDuration * 1000 + 100); // ミリ秒変換 + 予備時間
}

function stopSequence() {
    isPlaying = false;
    updatePreviewButtonState(false);

    // アニメーション停止
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (stopTimeoutId) clearTimeout(stopTimeoutId);

    // 再生ヘッドを戻す
    const playheadTop = document.getElementById('playhead-top');
    const playheadBody = document.getElementById('playhead-body');
    if (playheadTop) playheadTop.style.left = '0%';
    if (playheadBody) playheadBody.style.left = '0%';
    soundEngine.stopAll();
    // 音を止める (Web Audio APIの仕様上、スケジュールされた音を一括キャンセルするのは難しいが、
    // 次回の再生のためにAudioContextの状態は正常なので、自然に鳴り止むのを待つ形になります)
    // ※厳密に止めるならOscillatorNodeを管理する必要がありますが、今回は簡易的にフラグ制御のみとします。
}

function animatePlayhead(startTime, totalDuration) {
    const playheadTop = document.getElementById('playhead-top');
    const playheadBody = document.getElementById('playhead-body');

    function step() {
        if (!isPlaying) return; // 停止されたらループを抜ける

        const current = soundEngine.ctx.currentTime;
        const elapsed = current - startTime;
        const progress = elapsed / totalDuration; // 0.0 ~ 1.0

        if (progress < 1.0) {
            const percent = progress * 100;
            playheadTop.style.left = `${percent}%`;
            playheadBody.style.left = `${percent}%`;
            animationFrameId = requestAnimationFrame(step);
        } else {
            // 終了時
            stopSequence();
        }
    }
    animationFrameId = requestAnimationFrame(step);
}

// ボタンの見た目を切り替える関数 (オプション)
function updatePreviewButtonState(playing) {
    const btn = document.getElementById('preview-btn');
    if (!btn) return;

    // 中のテキストやアイコンを変えると分かりやすい
    const textSpan = btn.querySelector('span.font-bold');
    if (textSpan) {
        textSpan.textContent = playing ? "Stop" : "Preview";
    }

    // アイコンの色などを変えても良い
    if (playing) {
        btn.classList.add('text-red-600');
    } else {
        btn.classList.remove('text-red-600');
    }
}

// 初期化関数に追加
document.addEventListener('DOMContentLoaded', () => {
    initPianoRoll();
    setupSequencer();
});