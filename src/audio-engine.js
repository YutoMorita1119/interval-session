const UNIFORM_VOICE_PROFILE = Object.freeze({ oscillator: "triangle", gain: 0.1 });
const VOICE_PROFILES = Object.freeze({
  melody: UNIFORM_VOICE_PROFILE,
  chord: UNIFORM_VOICE_PROFILE,
  accompaniment: UNIFORM_VOICE_PROFILE,
  host: UNIFORM_VOICE_PROFILE,
  guest: UNIFORM_VOICE_PROFILE,
  system: UNIFORM_VOICE_PROFILE,
});

function browserAudioContextFactory() {
  const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContext) {
    throw new Error("Web Audio API is not available in this browser");
  }
  return new AudioContext();
}

export function createAudioEngine({
  contextFactory = browserAudioContextFactory,
  requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
  cancelFrame = (id) => globalThis.cancelAnimationFrame(id),
  setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer = (id) => globalThis.clearTimeout(id),
} = {}) {
  let context;
  let masterGain;
  let activeOscillators = [];
  let frameId;
  let endTimerId;
  let playbackId = 0;

  function ensureContext() {
    if (context) return context;

    context = contextFactory();
    masterGain = context.createGain();
    masterGain.gain.value = 0.65;

    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;

    masterGain.connect(limiter);
    limiter.connect(context.destination);
    return context;
  }

  function stop() {
    playbackId += 1;
    if (frameId !== undefined) {
      cancelFrame(frameId);
      frameId = undefined;
    }
    if (endTimerId !== undefined) {
      clearTimer(endTimerId);
      endTimerId = undefined;
    }
    for (const oscillator of activeOscillators) {
      try {
        oscillator.stop();
        oscillator.disconnect();
      } catch {
        // A naturally ended oscillator is already stopped.
      }
    }
    activeOscillators = [];
  }

  async function play(events, { onPlayhead, onEnded } = {}) {
    const audioContext = ensureContext();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    stop();
    const currentPlaybackId = playbackId;

    const playbackStart = audioContext.currentTime;
    for (const event of events) {
      const profile = VOICE_PROFILES[event.voice];
      if (!profile) {
        throw new TypeError(`Unsupported audio voice: ${event.voice}`);
      }

      const start = playbackStart + event.startSeconds;
      const end = start + event.durationSeconds;
      const attackEnd = Math.min(start + 0.015, end);
      const releaseStart = Math.max(attackEnd, end - 0.06);
      const oscillator = audioContext.createOscillator();
      const envelope = audioContext.createGain();

      oscillator.type = profile.oscillator;
      oscillator.frequency.value = event.frequency;
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.linearRampToValueAtTime(profile.gain, attackEnd);
      envelope.gain.setValueAtTime(profile.gain, releaseStart);
      envelope.gain.linearRampToValueAtTime(0.0001, end);

      oscillator.connect(envelope);
      envelope.connect(masterGain);
      oscillator.start(start);
      oscillator.stop(end + 0.01);
      oscillator.onended = () => {
        activeOscillators = activeOscillators.filter((node) => node !== oscillator);
        oscillator.disconnect();
        envelope.disconnect();
      };
      activeOscillators.push(oscillator);
    }

    const totalDurationSeconds = events.reduce(
      (duration, event) => Math.max(duration, event.startSeconds + event.durationSeconds),
      0,
    );

    if (onPlayhead) {
      onPlayhead({ elapsedSeconds: 0, progress: 0, totalDurationSeconds });
      const updatePlayhead = () => {
        if (currentPlaybackId !== playbackId) return;
        const elapsedSeconds = Math.min(
          totalDurationSeconds,
          Math.max(0, audioContext.currentTime - playbackStart),
        );
        const progress = totalDurationSeconds === 0 ? 1 : elapsedSeconds / totalDurationSeconds;
        onPlayhead({ elapsedSeconds, progress, totalDurationSeconds });
        if (progress < 1) {
          frameId = requestFrame(updatePlayhead);
        }
      };
      frameId = requestFrame(updatePlayhead);
    }

    if (onEnded) {
      endTimerId = setTimer(() => {
        if (currentPlaybackId !== playbackId) return;
        if (frameId !== undefined) {
          cancelFrame(frameId);
          frameId = undefined;
        }
        endTimerId = undefined;
        onEnded();
      }, totalDurationSeconds * 1000 + 20);
    }
  }

  return Object.freeze({ play, stop });
}
