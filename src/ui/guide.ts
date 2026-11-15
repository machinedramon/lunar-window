// The guided first landing. Mission Control, on the radio, talks the visitor through one real case, step by
// step: where the Sun is at a polar site, what a late launch does to it, why the site fails and what still
// works. Each step is a spoken line (also written out, for whoever has no sound), and most of them ask for one
// thing to be done in the real interface, which is ringed on screen; the story goes on once it is done. Nothing
// is staged: the buttons are the tool's own, and when the guide ends the tool is left where the story took it.
//
// It opens by itself, in the dark, when the tool is entered through its front door (the Explore screen): a
// black screen, a thin line across it with a pulse travelling along (a signal), one sentence, the languages and
// a way to skip it, small, at the foot. Space is quiet, and what is out there is not known yet. While the
// sentence is read everything is made ready (the voice, the terrain, the map of the Moon) and the line fills;
// then the dark opens along that line, like a visor, on the Moon seen from space, which turns to the south pole
// while the camera comes down on the site. The Guide button of the top bar brings all of it back, from the
// beginning, as often as wanted.
//
// A browser plays no sound before the visitor has clicked or pressed something. So the dark, which comes by
// itself, waits there for one click anywhere (a line under the sentence says so): the click starts the guide and
// lets the voice be heard. Should a sound still be refused, the guide runs with its words written out, at
// reading pace, and the first click brings the voice in.
//
// From there on the guide wears the marks of a display: a sight that closes on what is asked for, a band across
// the screen when something decisive happens (the Sun is lost, the launch is late, the Earth is in view). The
// colours keep the meaning they have everywhere in the tool: blue is the link with Earth, red is a problem.
import { PROFILES } from '../core/requirements';
import { LANGS, language, S, type Lang } from '../i18n';
import { clear, h, reducedMotion, setText } from './dom';
import { DAY_MS } from './format';
import lines from './guide.lines.json';
import { heroView, preloadJourney, preloadTerrain } from './hero3d';
import type { State, Store } from './store';

type LineId = keyof typeof lines.en;

/** The case: a lander due at Malapert Massif on 17 January 2027, and a launch that slips three weeks. */
const SITE = 'malapert';
/** The site of the story: the tool builds it at once when the guide is about to open it. */
export const GUIDE_SITE = SITE;

/**
 * Whether the guide opens the tool by itself: when it is entered on the Explore screen. A link to the planner or
 * to another screen was followed for what it shows, and a scripted browser (the recordings, the tests) is left
 * alone unless it asks; `?guide=0` turns it off, `?guide=1` on.
 */
export function guideOpens(tab: string): boolean {
  const asked = new URLSearchParams(location.search).get('guide');
  if (asked === '0') return false;
  return tab === 'explore' && (asked === '1' || !navigator.webdriver);
}
const PLANNED = Date.UTC(2027, 0, 17);
const SLIP = 21;
const SLIPPED = PLANNED + SLIP * DAY_MS;
/**
 * The ridge takes the Sun on 2 and 3 February 2027; from the evening of the 3rd nothing of its disc is left,
 * for eight days. The running clock is stopped at midnight, when the Sun is wholly behind the terrain.
 */
const DARK_FROM = Date.UTC(2027, 1, 3, 23, 20);
const DARK = Date.UTC(2027, 1, 4);
/** Where the descent starts: over the first place people landed, a quarter of the Moon away from the pole. */
const FROM = 'apollo-11';
/** The descent over the globe, in milliseconds, and the least time the dark stays while things are made ready: its three words are read. */
const DESCENT_MS = 6200;
const BRIEF_MS = 1500;
/** The tones at each end of a clip, in seconds: the words are between them. */
const TONE_S = 0.36;

interface Step {
  id: LineId;
  /**
   * Where the panel sits: under the top bar, over the sky; low on the left, clear of the planner's controls; or,
   * while only the picture and the voice are on, under the picture like a subtitle.
   */
  place: 'top' | 'low' | 'cine';
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
  /** For a line that asks for nothing: takes the tool to where the line would have left it, when it is cut short. */
  skip?: () => void;
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
  /** The button of the top bar: the guide again, from the beginning. */
  button: HTMLElement;
  /** Rewrites the words in the language in use. */
  relabel(): void;
  /** Starts the guide by itself, if this is how the tool was entered; called as the opening screen lifts, so that the dark is what is found under it. */
  auto(): void;
}

/** What the guide needs from the app around it. */
export interface GuideHost {
  /** A site of the list: its name in the language in use, and where it is. */
  site(id: string): { name: string; lat: number; lon: number };
  /** Changes the language of the whole tool. */
  setLanguage(code: Lang): void;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

export function createGuide(store: Store, host: GuideHost): Guide {
  const G = () => S.guide;
  const steps: Step[] = [
    {
      id: 'hail',
      place: 'cine',
      cine: true,
      enter: (s) => {
        const own = s.profileId !== PROFILES[0].id || s.req.mast !== PROFILES[0].req.mast || s.req.earthMarginDeg !== PROFILES[0].req.earthMarginDeg;
        press(PLAY, false);
        store.set({ tab: 'explore', siteId: SITE, timeMs: PLANNED, plannedMs: PLANNED, slipDays: 0, detail: null, hero: '3d', ...(own ? { req: { ...PROFILES[0].req }, profileId: PROFILES[0].id } : {}) });
        lens(LENS);
      },
      // Until the voice is done, the descent is over and the camera has arrived.
      hold: (_s, spoken) => spoken && !landing && !q('.explore.is-arriving'),
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
        if (s.timeMs >= DARK_FROM || (spoken && !pressed(PLAY))) {
          toDark();
          return spoken;
        }
        return false;
      },
      skip: () => toDark(),
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
      enter: () => {
        store.set({ tab: 'plan', slipDays: SLIP, detail: null });
        announce('bad', G().alerts.slip[0], G().alerts.slip[1]);
      },
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
      leave: () => announce('earth', G().alerts.earth[0], G().alerts.earth[1]),
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

  /** Stops the clock in the dark that follows the Sun's last light, and says so across the screen. */
  function toDark(): void {
    press(PLAY, false);
    if (store.state.timeMs === DARK) return;
    store.set({ timeMs: DARK });
    announce('bad', G().alerts.sun[0], G().alerts.sun[1]);
  }

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

  // ----- the opening, in the dark: a line with a pulse, one sentence; small, at the foot, the languages and the way out
  const callWords = h('p', { class: 'call-words', 'aria-live': 'polite' });
  const lineFill = h('i');
  const callHint = h('p', { class: 'call-hint', hidden: true });
  const langSeg = h('div', { class: 'call-lang', role: 'group' });
  for (const l of LANGS) langSeg.append(h('button', { type: 'button', lang: l.tag, title: l.name, 'aria-label': l.name, dataset: { code: l.code }, onclick: () => host.setLanguage(l.code) }, l.short));
  const skipBtn = h('button', { class: 'call-skip', type: 'button', onclick: () => finish() });
  const brief = h('div', { class: 'briefing', hidden: true, role: 'dialog', 'aria-modal': 'true' }, callWords, h('div', { class: 'call-line', 'aria-hidden': 'true' }, lineFill), callHint, langSeg, skipBtn);
  /** A band across the screen, when something decisive happens in the story. */
  const alertTitle = h('b', null);
  const alertSub = h('span', null);
  const alertBand = h('div', { class: 'guide-alert', 'aria-hidden': 'true' }, h('div', null, alertTitle, alertSub));

  const buttonLabel = h('span', null);
  const button = h('button', { class: 'btn guide-btn', type: 'button', onclick: () => void start() });
  button.innerHTML = ICON;
  button.append(buttonLabel);

  document.body.append(dim, panel, ring, alertBand, brief);

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
  /** Counts the starts: one that was called off, or started again, finds its number changed and stops. */
  let run = 0;
  /** True from the moment the guide is asked for until its first line is on air. */
  let opening = false;
  /** True while the camera comes down over the globe. */
  let landing = false;
  let closeTimer = 0;
  let audio: HTMLAudioElement | null = null;
  let silent = 0;
  /** A line shown without its sound, at reading pace: when it started and how long it stays. */
  let readFrom = 0;
  let readMs = 0;
  /** True once a sound may play: the visitor has clicked or pressed something, or the browser let one play. */
  let audible = false;
  /** While the dark waits for the click that starts the guide: what that click sets going. */
  let begin: (() => void) | null = null;
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

  /** Whether the browser will play a sound now: it does once the visitor has clicked or pressed something. */
  const soundFree = (): boolean => audible || !!(navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive;
  /** The first click or key anywhere: sound is allowed from now on, and a line that was only written out is said aloud. */
  const gesture = (ev: Event): void => {
    // On the way out or on a language: that is what was meant, not "begin".
    const aside = ev.target instanceof Element && !!ev.target.closest('.call-skip, .call-lang');
    if (begin && !aside) {
      const go = begin;
      begin = null;
      go();
    }
    if (audible) return;
    audible = true;
    if (at < 0 && !opening) return;
    unlock();
    if (at >= 0 && !spoken && readMs) speak();
  };
  for (const kind of ['pointerup', 'keydown', 'click']) window.addEventListener(kind, gesture, true);

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
    a.muted = false;
    a.currentTime = 0;
    const text = line();
    readMs = 0;
    // Without sound (not allowed yet, or a missing file) the line stays for the time it takes to read it.
    const read = () => {
      if (audio !== a) return;
      audio = null;
      readFrom = performance.now();
      readMs = Math.max(3200, text.length * 62);
      silent = window.setTimeout(() => (spoken = true), readMs);
    };
    a.onended = () => {
      if (audio === a) spoken = true;
    };
    a.onerror = read;
    void ctx?.resume();
    a.play().then(() => {
      audible = true;
    }, read);
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
    step.skip?.();
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
    else if (!spoken && readMs) share = Math.max(0, Math.min(1, (now - readFrom) / (readMs * 0.9)));
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
    // Written out only, for want of a click: the panel says how to get the voice.
    const mute = !audible && !talking && readMs > 0;
    panel.classList.toggle('mute', mute);
    setText(state, mute ? G().brief.hint : talking ? G().onAir : step.task && !taskDone ? G().standby : '');
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

  /** The words above the line change by fading out and in. */
  let wordsTimer = 0;
  function say(text: string, now = false): void {
    window.clearTimeout(wordsTimer);
    if (now) {
      callWords.textContent = text;
      callWords.classList.remove('swap');
      return;
    }
    if (callWords.textContent === text) return;
    callWords.classList.add('swap');
    wordsTimer = window.setTimeout(() => {
      callWords.textContent = text;
      callWords.classList.remove('swap');
    }, 620);
  }

  /**
   * The dark comes up, with its sentence. Under the opening screen, which is the same dark, it is there at once:
   * a fade would let the tool show through for a moment while the one goes and the other comes.
   */
  function openBrief(atOnce = false): void {
    window.clearTimeout(closeTimer);
    brief.hidden = false;
    brief.classList.remove('open');
    say(G().brief.call, true);
    callHint.hidden = true;
    if (atOnce) brief.style.transition = 'none';
    void brief.offsetWidth;
    brief.classList.add('in');
    if (atOnce) {
      void brief.offsetWidth;
      brief.style.transition = '';
    }
  }

  function closeBrief(): void {
    if (brief.hidden) return;
    // It opens like a visor, along its line.
    brief.classList.add('open');
    brief.classList.remove('in');
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      brief.hidden = true;
      brief.classList.remove('open');
    }, 1300);
  }

  /** How far the making ready is: the line fills from its middle outwards. */
  function stage(i: number): void {
    lineFill.style.transform = `scaleX(${[0.16, 0.42, 0.7, 1][i] ?? 1})`;
  }

  /** A band across the picture for a couple of seconds: red for a problem, blue for the link with Earth. */
  let alertTimer = 0;
  function announce(kind: 'bad' | 'earth', title: string, sub: string): void {
    setText(alertTitle, title);
    setText(alertSub, sub);
    alertBand.dataset.kind = kind;
    alertBand.classList.remove('on');
    void alertBand.offsetWidth;
    alertBand.classList.add('on');
    window.clearTimeout(alertTimer);
    alertTimer = window.setTimeout(() => alertBand.classList.remove('on'), 3000);
  }

  /**
   * Sound, allowed from inside the click that asks for the guide: the output is opened and every line of the
   * language in use is started silently and stopped, which also reads it ahead. Some browsers only let a sound
   * play later if it was first played from a click.
   */
  function unlock(): void {
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
    void ctx?.resume();
    for (const step of steps) {
      const a = clip(language(), step.id);
      if (a.dataset.primed || a === audio) continue;
      a.muted = true;
      a.play()
        .then(() => {
          a.dataset.primed = '1';
          if (audio !== a) {
            a.pause();
            a.currentTime = 0;
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (audio !== a) a.muted = false;
        });
    }
  }

  /** Resolves when enough of a line is read to play it through, or after `ms` at the latest. */
  const heard = (a: HTMLAudioElement, ms: number): Promise<void> =>
    new Promise((resolve) => {
      if (a.readyState >= 3) return resolve();
      const done = () => resolve();
      a.addEventListener('canplaythrough', done, { once: true });
      a.addEventListener('error', done, { once: true });
      window.setTimeout(done, ms);
    });

  /**
   * Starts the guide, from the beginning. The dark covers the screen while the first line is read ahead, the site
   * of the story is built behind it and the globe is put above the place the descent starts from; then the voice
   * comes on, the screen is uncovered on the Moon seen from space and the camera comes down.
   * @param byItself  the guide opens the tool by itself: the dark waits for one click anywhere before going on
   *                  (the click is what lets the browser play the voice), and it is there at once, under the
   *                  opening screen. Skipped before that click, the tool is left exactly as it was.
   */
  async function start(byItself = false): Promise<void> {
    if (opening) return;
    if (at >= 0) finish(true);
    const mine = ++run;
    const live = () => mine === run;
    opening = true;
    openBrief(byItself);
    stage(0);
    document.body.classList.add('guide-on', 'guide-cine');
    button.setAttribute('aria-pressed', 'true');
    if (byItself && !soundFree()) {
      // What can be made ready meanwhile, is: the lines are read ahead.
      for (const step of steps.slice(0, 3)) clip(language(), step.id);
      callHint.hidden = false;
      await new Promise<void>((resolve) => (begin = resolve));
      callHint.hidden = true;
      if (!live()) return;
    }
    unlock();
    const began = performance.now();
    // Behind the dark, the tool goes where the story starts.
    steps[0].enter?.(store.state);
    preloadJourney();
    void preloadTerrain([SITE]);
    await heard(clip(language(), steps[0].id), 6000);
    if (!live()) return;
    stage(1);
    let view = heroView();
    for (let i = 0; i < 150 && live() && view?.place() !== SITE; i++) {
      await wait(120);
      view = heroView();
    }
    if (!live()) return;
    stage(2);
    const from = host.site(FROM);
    const descent = view && view.ok() && !reducedMotion() ? await Promise.race([view.approach(from), wait(7000).then(() => null)]).catch(() => null) : null;
    if (!live()) {
      descent?.cancel();
      return;
    }
    // The briefing is read before it goes: its four lines take a little over three seconds to come in.
    await wait(Math.max(0, BRIEF_MS - (performance.now() - began)));
    if (!live()) {
      descent?.cancel();
      return;
    }
    stage(3);
    // The last word goes; the line, whole, is all there is for a moment; then the dark opens along it.
    say('');
    await wait(1150);
    if (!live()) {
      descent?.cancel();
      return;
    }
    // On air.
    opening = false;
    landing = !!descent;
    panel.hidden = false;
    void panel.offsetWidth;
    panel.classList.add('in');
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    go(0);
    closeBrief();
    if (descent) {
      await wait(1100);
      if (live()) await descent.fly(DESCENT_MS);
      else descent.cancel();
      if (live()) landing = false;
    }
  }

  /** Ends the guide where it is: the tool stays as the story left it. */
  function finish(quiet = false): void {
    // A start still on its way (the briefing is up, things are being made ready) is called off.
    run++;
    opening = false;
    landing = false;
    begin = null;
    closeBrief();
    window.clearTimeout(silent);
    audio?.pause();
    audio = null;
    at = -1;
    aimed = null;
    cancelAnimationFrame(raf);
    ring.hidden = true;
    dim.classList.remove('on');
    alertBand.classList.remove('on');
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

  function relabel(): void {
    const B = G().brief;
    setText(buttonLabel, G().button);
    button.title = G().buttonTip;
    button.setAttribute('aria-label', G().buttonTip);
    setText(skipBtn, B.skip);
    setText(callHint, B.begin);
    langSeg.setAttribute('aria-label', S.lang.label);
    langSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.code === language())));
    // The sentence of the call, in the new language.
    if (!brief.hidden && !brief.classList.contains('open') && callWords.textContent) say(B.call);
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

  function auto(): void {
    if (!guideOpens(store.state.tab) || at >= 0 || opening) return;
    void start(true);
  }

  return { button, relabel, auto };
}
