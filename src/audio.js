// 효과음. 음원 파일 없이 Web Audio 발진기로 만든다.
// 브라우저 정책상 첫 입력 이후에만 소리가 나므로 unlock()을 입력 처리에서 부른다.

const PENTATONIC = [0, 2, 4, 7, 9]; // 어떤 순서로 울려도 어울리는 5음 음계
const note = (n) => 523.25 * 2 ** ((PENTATONIC[n % 5] + 12 * Math.floor(n / 5)) / 12);

export function createAudio({ muted = false } = {}) {
  let ctx = null;
  let master = null;

  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }
    const AudioCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtor) return;
    try {
      ctx = new AudioCtor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.6;
      master.connect(ctx.destination);
    } catch {
      ctx = null; // 소리를 못 내는 환경에서는 조용히 넘어간다
    }
  }

  function tone({ type = 'sine', from, to = from, dur = 0.12, gain = 0.2, delay = 0 }) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp);
    amp.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  return {
    unlock,
    get muted() {
      return muted;
    },
    setMuted(value) {
      muted = value;
      if (master) master.gain.value = muted ? 0 : 0.6;
    },
    start() {
      tone({ type: 'triangle', from: note(0), dur: 0.1, gain: 0.16 });
      tone({ type: 'triangle', from: note(2), dur: 0.16, gain: 0.16, delay: 0.09 });
    },
    release() {
      tone({ from: 420, to: 760, dur: 0.09, gain: 0.1 });
    },
    // 연속 횟수가 늘수록 음이 한 칸씩 올라간다.
    capture(streak, skipped) {
      const n = Math.min(streak, 8);
      tone({ type: 'triangle', from: note(n), dur: 0.24, gain: 0.2 });
      tone({ from: note(n) * 2, dur: 0.32, gain: 0.06 });
      if (skipped) tone({ type: 'triangle', from: note(n + 2), dur: 0.22, gain: 0.16, delay: 0.09 });
    },
    over(reason) {
      tone({ type: 'sawtooth', from: reason === 'burn' ? 230 : 330, to: 52, dur: 0.55, gain: 0.15 });
    },
  };
}
