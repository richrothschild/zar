// ── Web Audio API sound synthesiser ────────────────────────────────────────────
// All sounds are generated programmatically — no audio files required.

let ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) ctx = new AudioContext();
  // Resume if suspended (browsers pause AudioContext until a user gesture)
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, type: OscillatorType, duration: number, gain = 0.25, startDelay = 0) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.connect(g);
  g.connect(c.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + startDelay);
  g.gain.setValueAtTime(gain, c.currentTime + startDelay);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + startDelay + duration);
  osc.start(c.currentTime + startDelay);
  osc.stop(c.currentTime + startDelay + duration + 0.01);
}

// ── Sound enabled flag (persisted in localStorage) ─────────────────────────────
export let soundEnabled: boolean = localStorage.getItem('zar_sound') !== 'false';

export function setSoundEnabled(v: boolean) {
  soundEnabled = v;
  localStorage.setItem('zar_sound', String(v));
}

function play(fn: () => void) {
  if (soundEnabled) fn();
}

// ── Individual sounds ──────────────────────────────────────────────────────────
export function playCardPlay()   { play(() => tone(480, 'triangle', 0.12)); }
export function playDraw()       { play(() => tone(300, 'sine',     0.18, 0.18)); }
export function playMatch()      { play(() => { tone(600, 'triangle', 0.08, 0.3); tone(800, 'triangle', 0.08, 0.2, 0.08); }); }
export function playYourTurn()   { play(() => { tone(523, 'sine', 0.1, 0.2); tone(659, 'sine', 0.12, 0.2, 0.1); }); }
export function playZar()        { play(() => { tone(523, 'square', 0.1, 0.22); tone(659, 'square', 0.1, 0.22, 0.11); tone(784, 'square', 0.15, 0.22, 0.22); }); }
export function playChallenge()  { play(() => { tone(220, 'sawtooth', 0.1, 0.35); tone(165, 'sawtooth', 0.15, 0.35, 0.11); }); }
export function playRoundWin()   { play(() => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 'sine', 0.22, 0.28, i * 0.11)); }); }
export function playKicked()     { play(() => { tone(300, 'sawtooth', 0.08, 0.3); tone(220, 'sawtooth', 0.12, 0.3, 0.09); tone(165, 'sawtooth', 0.18, 0.3, 0.18); }); }
