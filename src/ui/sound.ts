// Sound, synthesised in the browser: no audio files. Off until the visitor turns it on.
// The tones for gaining and losing contact with Earth are the "Quindar tones" of the Apollo
// radio links (2525 Hz to open the line, 2475 Hz to close it, a quarter of a second each).

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambient: { stop(): void } | null = null;
let enabled = false;
let lastTone = 0;

const KEY = 'lunar-window-sound';

export function soundEnabled(): boolean {
  return enabled;
}

export function soundPreferred(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

function startAmbient(c: AudioContext, out: AudioNode): { stop(): void } {
  // A very low, slowly breathing hum: the inside of a lander, not the vacuum outside.
  const length = c.sampleRate * 4;
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < length; i++) {
    brown = (brown + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = brown * 3.2;
  }
  const noise = c.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const low = c.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 140;
  const gain = c.createGain();
  gain.gain.value = 0.0;
  gain.gain.linearRampToValueAtTime(0.05, c.currentTime + 2.5);
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.07;
  const depth = c.createGain();
  depth.gain.value = 0.014;
  lfo.connect(depth).connect(gain.gain);
  noise.connect(low).connect(gain).connect(out);
  noise.start();
  lfo.start();
  return {
    stop() {
      gain.gain.cancelScheduledValues(c.currentTime);
      gain.gain.linearRampToValueAtTime(0, c.currentTime + 0.4);
      window.setTimeout(() => {
        noise.stop();
        lfo.stop();
      }, 500);
    },
  };
}

/** Must be called from a click or key press: browsers only start audio on a gesture. */
export function setSound(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: the preference is simply not kept */
  }
  if (on) {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        enabled = false;
        return;
      }
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    void ctx.resume();
    if (!ambient && master) ambient = startAmbient(ctx, master);
  } else {
    ambient?.stop();
    ambient = null;
  }
}

function beep(freq: number, seconds: number, level: number, when = 0, type: OscillatorType = 'sine'): void {
  if (!enabled || !ctx || !master) return;
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.012);
  g.gain.setValueAtTime(level, t + seconds - 0.03);
  g.gain.linearRampToValueAtTime(0, t + seconds);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + seconds + 0.02);
}

function spaced(): boolean {
  const now = performance.now();
  if (now - lastTone < 380) return false;
  lastTone = now;
  return true;
}

/** Direct radio contact with Earth gained (true) or lost (false). */
export function linkTone(acquired: boolean): void {
  if (spaced()) beep(acquired ? 2525 : 2475, 0.25, 0.05);
}

/** The Sun came up over the terrain (true) or went behind it (false): two soft notes, rising or falling. */
export function sunTone(up: boolean): void {
  if (!spaced()) return;
  beep(up ? 392 : 523.25, 0.22, 0.035);
  beep(up ? 523.25 : 392, 0.34, 0.035, 0.16);
}

/** A faint tick for controls. */
export function tick(): void {
  beep(1800, 0.03, 0.012, 0, 'triangle');
}
