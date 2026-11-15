// The guided first landing. Mission Control, on the radio, talks the visitor through one real case, step by
// step: where the Sun is at a polar site, what a late launch does to it, why the site fails and what still
// works. Each step is a spoken line (also written out, for whoever has no sound), and most of them ask for one
// thing to be done in the real interface, which is ringed on screen; the story goes on once it is done. Nothing
// is staged: the buttons are the tool's own, and when the guide ends the tool is left where the story took it.
// At the moment the voice asks for something, the rest of the screen dims and only that control stays lit;
// while it explains something that has to be seen (the Sun, the calendar), nothing is dimmed.
//
// The voice is AI-generated (OpenAI text-to-speech) reading src/ui/guide.lines.json; tools/guide_voice.py adds
// the sound of a radio link and writes the clips to public/audio/guide. The Accuracy page says so.
import { PROFILES } from '../core/requirements';
import { language, S, type Lang } from '../i18n';
import { clear, h, setText } from './dom';
import { DAY_MS } from './format';
import lines from './guide.lines.json';
import type { State, Store } from './store';

type LineId = keyof typeof lines.en;

const KEY = 'lunar-window-guide';
/** The case: a lander due at Malapert Massif on 17 January 2027, and a launch that slips three weeks. */
const SITE = 'malapert';
const PLANNED = Date.UTC(2027, 0, 17);
const SLIP = 21;
const SLIPPED = PLANNED + SLIP * DAY_MS;
/** The Sun goes behind the ridge on 2 February 2027 at 06:37 UTC: the running clock is stopped a little after. */
const DARK_FROM = Date.UTC(2027, 1, 2, 6, 50);
const DARK = Date.UTC(2027, 1, 2, 7, 10);
/** The tones at each end of a clip, in seconds: the words are between them. */
const TONE_S = 0.36;

interface Step {
  id: LineId;
  /** Where the panel sits: under the top bar, over the sky; or low on the left, clear of the planner's controls. */
  place: 'top' | 'low';
  /** The instruments are hidden while the line is spoken: only the picture and the voice. */
  cine?: boolean;
  /** Puts the tool where the line needs it. */
  enter?: (s: State) => void;
  /** The control the visitor is asked to use. */
  target?: string;
  /** The request, in words: a verb, the name of the control as it is written on it, and what follows. */
  task?: () => [string, string, string?];
  /** True once the visitor has done it. */
  done?: (s: State) => boolean;
  /** Does it for the visitor. */
  act?: () => void;
  /** After it is done, whoever did it. */
  leave?: () => void;
  /** The screen stops being dimmed before the request is met: what happens meanwhile has to be seen. */
  lit?: (s: State) => boolean;
  /** For a line that asks for nothing: called on every frame; true when the story may go on. */
  hold?: (s: State, spoken: boolean) => boolean;
}

const q = (selector: string): HTMLElement | null => document.querySelector<HTMLElement>(selector);
const pressed = (selector: string): boolean => q(selector)?.getAttribute('aria-pressed') === 'true';
const press = (selector: string, on: boolean): void => {
  if (pressed(selector) !== on) q(selector)?.click();
};
const FOLLOW_SUN = '[data-guide="follow-sun"]';
const FOLLOW_EARTH = '[data-guide="follow-earth"]';
const PLAY = '[data-guide="play"]';
/** The lens of the 3D view, in degrees: the one a place is reached with, and the long one of the last picture. */
const LENS = 46;
const LENS_LONG = 17;
const lens = (fov: number): boolean => window.dispatchEvent(new CustomEvent('lw:lens', { detail: fov }));

/** Mission Control, as a picture on a link: a controller with a headset, drawn, lit from the left. */
const PORTRAIT = `<svg viewBox="0 0 96 108" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="gd-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101a2a"/><stop offset="1" stop-color="#04070c"/></linearGradient>
<linearGradient id="gd-skin" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f4f6f9"/><stop offset="0.55" stop-color="#c3c9d3"/><stop offset="1" stop-color="#737b88"/></linearGradient>
<linearGradient id="gd-neck" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b4bbc6"/><stop offset="1" stop-color="#5d6470"/></linearGradient>
<linearGradient id="gd-suit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#36425a"/><stop offset="1" stop-color="#0c1119"/></linearGradient>
<linearGradient id="gd-hair" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a414d"/><stop offset="1" stop-color="#14171d"/></linearGradient>
</defs>
<rect width="96" height="108" fill="url(#gd-bg)"/>
<rect x="5" y="18" width="23" height="15" rx="1" fill="#7db8ff" opacity="0.13"/>
<rect x="8" y="21" width="12" height="1.2" fill="#7db8ff" opacity="0.3"/><rect x="8" y="24.5" width="16" height="1.2" fill="#7db8ff" opacity="0.2"/><rect x="8" y="28" width="9" height="1.2" fill="#7db8ff" opacity="0.2"/>
<rect x="69" y="12" width="24" height="17" rx="1" fill="#7db8ff" opacity="0.09"/>
<path d="M71 25 L76 21 L80 23 L85 17 L91 20" fill="none" stroke="#7db8ff" stroke-width="1" opacity="0.35"/>
<rect x="73" y="36" width="18" height="11" rx="1" fill="#fff" opacity="0.045"/>
<path d="M29.5 50 C26 70 30 82 37 88 L59 88 C66 82 70 70 66.5 50 Z" fill="#161a21"/>
<path d="M1 108 C3 93 17 87 35 83 L42 80.5 L54 80.5 L61 83 C79 87 93 93 95 108 Z" fill="url(#gd-suit)"/>
<path d="M39.5 82 L48 93 L56.5 82" fill="none" stroke="#6a7790" stroke-width="1.1" stroke-linejoin="round"/>
<path d="M22 108 L24 96" stroke="#5b6880" stroke-width="0.9" opacity="0.7"/><rect x="62" y="94" width="11" height="6.5" rx="0.8" fill="#7db8ff" opacity="0.5"/>
<path d="M41 64 L41 82 Q48 89.5 55 82 L55 64 Z" fill="url(#gd-neck)"/>
<path d="M41 70 Q48 77 55 70 L55 64 L41 64 Z" fill="#000" opacity="0.28"/>
<path d="M33.4 48 C33.4 35.5 40 28.5 48 28.5 C56 28.5 62.6 35.5 62.6 48 C62.6 60.5 55.6 70.5 48 70.5 C40.4 70.5 33.4 60.5 33.4 48 Z" fill="url(#gd-skin)"/>
<path d="M31.2 53 C28.6 34 38 23.5 49 23.5 C60.5 23.5 68.6 33 65.4 53 C65 44.5 61.4 38.4 55.4 35.2 C50 41.4 41.4 43.6 35.2 42.4 C33 45.4 31.8 49 31.2 53 Z" fill="url(#gd-hair)"/>
<path d="M36 30.5 C41 26 50 25 57 28" fill="none" stroke="#69717e" stroke-width="0.8" opacity="0.8" stroke-linecap="round"/>
<path d="M30.8 49 C29.6 27.5 66.4 27.5 65.2 49" fill="none" stroke="#b8c0cc" stroke-width="2.3" stroke-linecap="round"/>
<rect x="27.2" y="44.6" width="7.2" height="13.4" rx="3.3" fill="#eef1f5"/><rect x="29.2" y="47.6" width="3.2" height="7.4" rx="1.6" fill="#8d96a3"/>
<rect x="61.6" y="44.6" width="6.2" height="13.4" rx="3" fill="#525a67"/>
<path d="M30.8 58 C30.6 68.5 37 71.6 43 68.4" fill="none" stroke="#eef1f5" stroke-width="1.5" stroke-linecap="round"/>
<circle class="guide-mic" cx="44.6" cy="67.5" r="2.4" fill="#7db8ff"/>
</svg>`;

const ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="1.6" fill="currentColor"/><path d="M4.6 4.6a4.8 4.8 0 0 0 0 6.8M11.4 4.6a4.8 4.8 0 0 1 0 6.8M2.5 2.5a7.8 7.8 0 0 0 0 11M13.5 2.5a7.8 7.8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

export interface Guide {
  /** The button of the top bar: takes the call again. */
  button: HTMLElement;
  /** Rewrites the words in the language in use. */
  relabel(): void;
  /** Offers the guide to a first-time visitor, once the first screen is whole. */
  offerWhenReady(): void;
}

export function createGuide(store: Store): Guide {
  const G = () => S.guide;
  const steps: Step[] = [
    {
      id: 'hail',
      place: 'top',
      cine: true,
      enter: (s) => {
        const own = s.profileId !== PROFILES[0].id || s.req.mast !== PROFILES[0].req.mast || s.req.earthMarginDeg !== PROFILES[0].req.earthMarginDeg;
        press(PLAY, false);
        store.set({ tab: 'explore', siteId: SITE, timeMs: PLANNED, plannedMs: PLANNED, slipDays: 0, detail: null, hero: '3d', ...(own ? { req: { ...PROFILES[0].req }, profileId: PROFILES[0].id } : {}) });
        lens(LENS);
      },
      hold: (_s, spoken) => spoken && !q('.explore.is-arriving'),
    },
    {
      id: 'sun',
      place: 'top',
      enter: () => {
        store.set({ tab: 'explore', siteId: SITE, hero: '3d' });
        press(FOLLOW_SUN, false);
      },
      target: FOLLOW_SUN,
      task: () => [G().verbs.press, S.explore.three.faceSun],
      done: () => pressed(FOLLOW_SUN),
      act: () => press(FOLLOW_SUN, true),
    },
    {
      id: 'play',
      place: 'top',
      enter: () => {
        press(PLAY, false);
        store.set({ tab: 'explore', siteId: SITE, timeMs: PLANNED });
      },
      target: PLAY,
      task: () => [G().verbs.press, S.explore.play],
      done: () => pressed(PLAY),
      act: () => press(PLAY, true),
    },
    {
      id: 'circle',
      place: 'top',
      hold: (s, spoken) => {
        // The clock stops by itself once the ridge has hidden the Sun; if it was stopped by hand, it is taken there.
        if (s.timeMs >= DARK_FROM || spoken) {
          press(PLAY, false);
          if (s.timeMs !== DARK) store.set({ timeMs: DARK });
          return spoken;
        }
        return false;
      },
    },
    {
      id: 'question',
      place: 'top',
      enter: () => press(PLAY, false),
      target: '#tab-plan',
      task: () => [G().verbs.open, S.tabs.plan],
      done: (s) => s.tab === 'plan',
      act: () => store.set({ tab: 'plan' }),
    },
    {
      id: 'slip',
      place: 'low',
      enter: () => store.set({ tab: 'plan', plannedMs: PLANNED, slipDays: 0, detail: null }),
      target: '#slip',
      task: () => [G().verbs.drag, S.plan.slip, G().slipTo],
      // Once the slider is let go near the mark, it is set on it: the story is about twenty-one days exactly.
      done: (s) => !sliding && s.slipDays >= 15 && s.slipDays <= 35,
      // While the slider is dragged, the calendar and the count of sites are what there is to watch.
      lit: (s) => sliding || s.slipDays > 0,
      act: () => store.set({ slipDays: SLIP }),
      leave: () => store.set({ slipDays: SLIP }),
    },
    {
      id: 'why',
      place: 'low',
      enter: () => store.set({ tab: 'plan', slipDays: SLIP, detail: null }),
      target: `.site-chip[data-site="${SITE}"]`,
      task: () => [G().verbs.click, S.siteNames[SITE] ?? 'Malapert Massif'],
      done: (s) => s.detail?.siteId === SITE,
      act: () => store.set({ detail: { siteId: SITE, dayMs: SLIPPED } }),
    },
    {
      id: 'reason',
      place: 'low',
      enter: () => store.set({ tab: 'plan', slipDays: SLIP, detail: { siteId: SITE, dayMs: SLIPPED } }),
      target: '[data-guide="open-explore"]',
      task: () => [G().verbs.press, S.plan.detail.openExplore],
      done: (s) => s.tab === 'explore',
      act: () => store.set({ tab: 'explore', siteId: SITE, timeMs: SLIPPED }),
    },
    {
      id: 'earth',
      place: 'top',
      enter: () => {
        store.set({ tab: 'explore', siteId: SITE, timeMs: SLIPPED, hero: '3d' });
        press(FOLLOW_EARTH, false);
      },
      target: FOLLOW_EARTH,
      task: () => [G().verbs.press, S.explore.three.faceEarth],
      done: () => pressed(FOLLOW_EARTH),
      act: () => press(FOLLOW_EARTH, true),
    },
    {
      id: 'out',
      place: 'top',
      // The last picture: the lens closes slowly on the Earth over the ridge, and stays there.
      hold: (_s, spoken) => {
        const u = Math.min(1, (performance.now() - enteredAt) / 9000);
        lens(LENS + (LENS_LONG - LENS) * u * u * (3 - 2 * u));
        return spoken;
      },
    },
  ];

  // ----- the panel: the picture of the link, the words, the request
  const portrait = h('div', { class: 'guide-face' });
  portrait.innerHTML = PORTRAIT;
  const wave = h('canvas', { class: 'guide-wave', width: '192', height: '36', 'aria-hidden': 'true' });
  const who = h('b', { class: 'guide-who' });
  const where = h('span', { class: 'guide-where' });
  const state = h('span', { class: 'guide-state' });
  const count = h('span', { class: 'guide-count' });
  const said = h('span', { class: 'guide-said' });
  const rest = h('span', { class: 'guide-rest' });
  const words = h('p', { class: 'guide-words', 'aria-live': 'polite' }, said, rest);
  const task = h('div', { class: 'guide-task' });
  const assist = h('button', { class: 'btn guide-assist', type: 'button', onclick: () => assistNow() });
  const again = h('button', { class: 'btn ghost guide-again', type: 'button', onclick: () => speak() });
  const end = h('button', { class: 'btn ghost guide-end', type: 'button', onclick: () => finish() });
  const panel = h(
    'aside',
    { class: 'comm', hidden: true, 'aria-label': 'Mission Control' },
    h('div', { class: 'guide-link' }, portrait, wave),
    h('div', { class: 'guide-body' }, h('header', { class: 'guide-head' }, h('span', { class: 'guide-id' }, h('i', { class: 'dot earth' }), who, where), state, count), words, task, h('div', { class: 'guide-actions' }, assist, again, end)),
  );
  const ring = h('div', { class: 'guide-ring', hidden: true, 'aria-hidden': 'true' });
  /** Everything but the control that is asked for, darkened: a hole over the control, the dark around it. */
  const dim = h('div', { class: 'guide-dim', 'aria-hidden': 'true' });

  // ----- the call: offered once, to a first-time visitor
  const offerTitle = h('h2', null);
  const offerText = h('p', null);
  const offerEyebrow = h('span', { class: 'eyebrow' });
  const offerNote = h('p', { class: 'small muted' });
  const answer = h('button', { class: 'btn primary', type: 'button', onclick: () => start() });
  const skip = h('button', { class: 'btn', type: 'button', onclick: () => dismiss() });
  const signal = h('span', { class: 'guide-signal', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
  const offer = h('div', { class: 'guide-offer', role: 'dialog', hidden: true }, h('div', { class: 'guide-offer-head' }, signal, offerEyebrow), offerTitle, offerText, h('div', { class: 'guide-offer-actions' }, answer, skip), offerNote);

  const buttonLabel = h('span', null);
  const button = h('button', { class: 'btn guide-btn', type: 'button', onclick: () => start() });
  button.innerHTML = ICON;
  button.append(buttonLabel);

  document.body.append(dim, panel, ring, offer);

  // ----- state
  let at = -1;
  /** When the step on screen started. */
  let enteredAt = 0;
  let spoken = false;
  let taskDone = false;
  /** Where in the line the request starts (its last sentence): the screen dims from there. */
  let askFrom = 0;
  let nextAt = 0;
  let raf = 0;
  let sliding = false;
  let audio: HTMLAudioElement | null = null;
  let silent = 0;
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let level = 0;
  const clips = new Map<string, HTMLAudioElement>();
  const spectrum = new Uint8Array(64);
  const paint = wave.getContext('2d');

  window.addEventListener('pointerdown', (ev) => (sliding = ev.target instanceof Element && ev.target.id === 'slip'), true);
  const letGo = () => (sliding = false);
  window.addEventListener('pointerup', letGo, true);
  window.addEventListener('pointercancel', letGo, true);

  const seen = (): boolean => {
    try {
      return localStorage.getItem(KEY) === 'done';
    } catch {
      return true;
    }
  };
  const remember = (): void => {
    try {
      localStorage.setItem(KEY, 'done');
    } catch {
      // private mode: the call is offered again next time
    }
  };

  function clip(lang: Lang, id: LineId): HTMLAudioElement {
    const key = `${lang}/${id}`;
    let a = clips.get(key);
    if (!a) {
      a = new Audio(`${import.meta.env.BASE_URL}audio/guide/${key}.mp3`);
      a.preload = 'auto';
      clips.set(key, a);
      // Through an analyser, so that the picture of the link moves with the voice. Without one, it plays all the same.
      if (ctx && analyser) {
        try {
          ctx.createMediaElementSource(a).connect(analyser);
        } catch {
          // plays directly
        }
      }
    }
    return a;
  }

  function line(): string {
    return lines[language()][steps[at].id];
  }

  function speak(): void {
    if (at < 0) return;
    window.clearTimeout(silent);
    audio?.pause();
    spoken = false;
    const a = clip(language(), steps[at].id);
    audio = a;
    a.currentTime = 0;
    const text = line();
    // Without sound (a blocked or missing file) the line stays for the time it takes to read it.
    const read = () => {
      if (audio !== a) return;
      audio = null;
      silent = window.setTimeout(() => (spoken = true), Math.max(3200, text.length * 62));
    };
    a.onended = () => {
      if (audio === a) spoken = true;
    };
    a.onerror = read;
    void ctx?.resume();
    a.play().catch(read);
    // the lines that follow are read ahead
    for (const next of steps.slice(at + 1, at + 3)) clip(language(), next.id);
  }

  function write(): void {
    if (at < 0) return;
    const step = steps[at];
    setText(who, G().who);
    setText(where, G().where);
    setText(count, `${String(at + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}`);
    setText(again, G().again);
    setText(end, G().end);
    again.title = G().again;
    clear(task);
    if (step.task) {
      const [verb, name, tail] = step.task();
      task.append(h('span', { class: 'guide-mark', 'aria-hidden': 'true' }, taskDone ? '✓' : '▸'), h('span', null, verb), h('b', null, name));
      if (tail) task.append(h('span', null, tail));
    } else task.append(h('span', { class: 'guide-mark', 'aria-hidden': 'true' }, '·'), h('span', null, step.id === 'circle' ? G().watch : G().listen));
    task.classList.toggle('done', taskDone);
    setText(assist, step.task && !taskDone ? G().assist : G().next);
    said.textContent = '';
    rest.textContent = line();
    const body = line().replace(/[.!?]\s*$/, '');
    const cut = Math.max(body.lastIndexOf('. '), body.lastIndexOf('? '), body.lastIndexOf('! '));
    askFrom = cut < 0 ? 0 : cut + 2;
  }

  function go(i: number): void {
    at = i;
    const step = steps[i];
    spoken = false;
    taskDone = false;
    nextAt = 0;
    enteredAt = performance.now();
    step.enter?.(store.state);
    document.body.classList.toggle('guide-cine', !!step.cine);
    panel.dataset.place = step.place;
    panel.dataset.step = step.id;
    write();
    speak();
  }

  /** The button of the panel: does what is asked, or, when nothing is asked, goes on to the next line. */
  function assistNow(): void {
    if (at < 0) return;
    const step = steps[at];
    if (step.task && !taskDone) {
      // Elsewhere in the tool (another screen was opened meanwhile): back to where the step is, then the step.
      if (step.target && !q(step.target)) {
        step.enter?.(store.state);
        requestAnimationFrame(() => step.act?.());
      } else step.act?.();
      return;
    }
    if (step.hold) step.hold(store.state, true);
    advance();
  }

  function advance(): void {
    if (at + 1 >= steps.length) finish();
    else go(at + 1);
  }

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (at < 0) return;
    const step = steps[at];
    const s = store.state;

    // the words light up as they are said
    const text = rest.textContent !== null ? said.textContent! + rest.textContent : '';
    let share = spoken ? 1 : 0;
    if (!spoken && audio && audio.duration > 0) share = Math.max(0, Math.min(1, (audio.currentTime - TONE_S) / Math.max(0.5, audio.duration - 2 * TONE_S)));
    let cut = Math.round(share * text.length);
    if (cut < text.length) {
      const space = text.indexOf(' ', cut);
      cut = space < 0 ? text.length : space;
    }
    if (said.textContent!.length !== cut) {
      said.textContent = text.slice(0, cut);
      rest.textContent = text.slice(cut);
    }

    // the picture of the link moves with the voice
    let loud = 0;
    if (analyser && audio && !audio.paused) {
      analyser.getByteFrequencyData(spectrum);
      for (let i = 2; i < 40; i++) loud += spectrum[i];
      loud = Math.min(1, loud / (38 * 150));
    } else if (audio && !audio.paused) loud = 0.35 + 0.25 * Math.sin(now / 90);
    level += (loud - level) * 0.35;
    const talking = !!audio && !audio.paused && !spoken;
    panel.classList.toggle('talking', talking);
    panel.style.setProperty('--lvl', level.toFixed(3));
    setText(state, talking ? G().onAir : step.task && !taskDone ? G().standby : '');
    if (paint) {
      const w = wave.width;
      const ht = wave.height;
      paint.clearRect(0, 0, w, ht);
      const bars = 24;
      for (let i = 0; i < bars; i++) {
        const v = analyser && talking ? spectrum[3 + i] / 255 : talking ? 0.3 + 0.3 * Math.sin(now / 120 + i) : 0;
        const bar = Math.max(2, v * v * ht);
        paint.fillStyle = talking ? '#7db8ff' : 'rgba(125,184,255,0.35)';
        paint.fillRect(i * (w / bars) + 1, (ht - bar) / 2, w / bars - 3, bar);
      }
    }

    // what is asked for, ringed
    const target = step.target && !taskDone ? q(step.target) : null;
    const box = target && target.offsetParent !== null ? target.getBoundingClientRect() : null;
    const shown = !!box && box.width > 2 && !step.cine;
    // The rest of the screen dims from the moment the request is spoken until it is met.
    dim.classList.toggle('on', shown && (spoken || cut >= askFrom) && !step.lit?.(s));
    if (box && shown) {
      ring.hidden = false;
      for (const e of [ring, dim]) {
        e.style.transform = `translate(${Math.round(box.left - 6)}px, ${Math.round(box.top - 6)}px)`;
        e.style.width = `${Math.round(box.width + 12)}px`;
        e.style.height = `${Math.round(box.height + 12)}px`;
      }
      if (target && target !== aimed) {
        aimed = target;
        if (box.top < 60 || box.bottom > window.innerHeight - 8) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    } else ring.hidden = true;

    // the story goes on
    if (step.done) {
      if (!taskDone && step.done(s)) {
        taskDone = true;
        step.leave?.();
        write();
        // what was said so far stays lit
        nextAt = 0;
      }
      if (taskDone && spoken && !nextAt) nextAt = now + 500;
    } else if ((step.hold ? step.hold(s, spoken) : spoken) && !nextAt) nextAt = now + (step.id === 'out' ? 900 : 350);
    if (nextAt && now >= nextAt) {
      nextAt = 0;
      advance();
    }
  }
  let aimed: HTMLElement | null = null;

  function start(): void {
    offer.hidden = true;
    remember();
    if (at >= 0) finish(true);
    if (!ctx) {
      try {
        ctx = new AudioContext();
        analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.7;
        analyser.connect(ctx.destination);
      } catch {
        ctx = null;
        analyser = null;
      }
    }
    panel.hidden = false;
    document.body.classList.add('guide-on');
    button.setAttribute('aria-pressed', 'true');
    void panel.offsetWidth;
    panel.classList.add('in');
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    go(0);
  }

  /** Ends the guide where it is: the tool stays as the story left it. */
  function finish(quiet = false): void {
    window.clearTimeout(silent);
    audio?.pause();
    audio = null;
    at = -1;
    aimed = null;
    cancelAnimationFrame(raf);
    ring.hidden = true;
    dim.classList.remove('on');
    document.body.classList.remove('guide-cine', 'guide-on');
    button.setAttribute('aria-pressed', 'false');
    panel.classList.remove('in', 'talking');
    if (quiet) panel.hidden = true;
    else {
      window.setTimeout(() => {
        if (at < 0) panel.hidden = true;
      }, 450);
      // where to find it again
      button.classList.remove('nudge');
      void button.offsetWidth;
      button.classList.add('nudge');
    }
  }

  function dismiss(): void {
    offer.hidden = true;
    remember();
    button.classList.remove('nudge');
    void button.offsetWidth;
    button.classList.add('nudge');
  }

  function relabel(): void {
    setText(buttonLabel, G().button);
    button.title = G().buttonTip;
    button.setAttribute('aria-label', G().buttonTip);
    setText(offerEyebrow, G().offer.eyebrow);
    setText(offerTitle, G().offer.title);
    setText(offerText, G().offer.text);
    setText(answer, G().offer.answer);
    setText(skip, G().offer.skip);
    setText(offerNote, G().offer.note);
    if (at >= 0) {
      const share = said.textContent!.length;
      write();
      // the line goes on in the language it started in; its words are shown whole
      said.textContent = line().slice(0, spoken ? line().length : share);
      rest.textContent = line().slice(said.textContent.length);
    }
  }
  relabel();
  button.setAttribute('aria-pressed', 'false');

  function offerWhenReady(): void {
    const asked = new URLSearchParams(location.search).get('guide');
    // A scripted browser (the recordings, the tests) is not offered the call unless it asks for it.
    if (asked === '0' || (asked !== '1' && (seen() || navigator.webdriver))) return;
    let tries = 0;
    const look = () => {
      if (at >= 0) return;
      const whole = document.body.classList.contains('ready') && !document.getElementById('intro') && !q('.explore.is-arriving');
      if (whole && store.state.tab === 'explore') {
        window.setTimeout(() => {
          if (at >= 0 || store.state.tab !== 'explore') return;
          offer.hidden = false;
          void offer.offsetWidth;
          offer.classList.add('in');
        }, 1400);
      } else if (++tries < 150 && (store.state.tab === 'explore' || tries < 40)) window.setTimeout(look, 400);
    };
    look();
  }

  return { button, relabel, offerWhenReady };
}
