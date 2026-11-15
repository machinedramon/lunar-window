import './style.css';
import { initialLanguage, language, LANGS, S, setLanguage, type Lang } from './i18n';
import { createAccuracy } from './ui/accuracy';
import { createCompare } from './ui/compare';
import { createMissions, warmMissions } from './ui/missions';
import { App, type View } from './ui/app';
import { loadSiteList } from './ui/data';
import { clear, h, reducedMotion } from './ui/dom';
import { preloadJourney, preloadTerrain } from './ui/hero3d';
import { introLift, introStage, introTyped } from './ui/intro';
import { preloadModels } from './viz/props';
import { createExplore } from './ui/explore';
import { createPlan, planRequest } from './ui/plan';
import { Planner } from './ui/planner';
import { setSound, soundEnabled, soundPreferred, tick } from './ui/sound';
import { CUSTOM_SITE, fromHash, Store, toHash, type State, type Tab } from './ui/store';

/** Flags of the three languages, drawn to one pattern: 21 by 15, simplified to what reads at that size. */
const FLAGS: Record<Lang, string> = {
  en: '<svg viewBox="0 0 21 15" aria-hidden="true"><rect width="21" height="15" fill="#fff"/><g fill="#b22234"><rect width="21" height="2.15"/><rect y="4.29" width="21" height="2.14"/><rect y="8.57" width="21" height="2.14"/><rect y="12.86" width="21" height="2.14"/></g><rect width="9.4" height="8.57" fill="#3c3b6e"/><g fill="#fff"><circle cx="2.2" cy="2.2" r="0.62"/><circle cx="4.7" cy="2.2" r="0.62"/><circle cx="7.2" cy="2.2" r="0.62"/><circle cx="3.45" cy="4.3" r="0.62"/><circle cx="5.95" cy="4.3" r="0.62"/><circle cx="2.2" cy="6.4" r="0.62"/><circle cx="4.7" cy="6.4" r="0.62"/><circle cx="7.2" cy="6.4" r="0.62"/></g></svg>',
  pt: '<svg viewBox="0 0 21 15" aria-hidden="true"><rect width="21" height="15" fill="#009739"/><path d="M10.5 1.9 L19 7.5 L10.5 13.1 L2 7.5 Z" fill="#fedd00"/><circle cx="10.5" cy="7.5" r="3.35" fill="#012169"/><path d="M7.3 6.6 Q10.6 5.6 13.7 8.2" fill="none" stroke="#fff" stroke-width="0.7"/></svg>',
  es: '<svg viewBox="0 0 21 15" aria-hidden="true"><rect width="21" height="15" fill="#aa151b"/><rect y="3.75" width="21" height="7.5" fill="#f1bf00"/></svg>',
};

const LOGO = `<svg viewBox="0 0 40 40" aria-hidden="true"><defs><clipPath id="lw-c"><circle cx="20" cy="20" r="17"/></clipPath></defs><circle cx="20" cy="20" r="17" fill="#000" stroke="#fff" stroke-width="1.6"/><g clip-path="url(#lw-c)"><circle cx="24.5" cy="22" r="4.6" fill="#fff"/><path d="M0 27 L7 23.5 L12 25.5 L17 21 L22 24.5 L28 22 L33 25 L40 23 L40 40 L0 40 Z" fill="#8f8f96"/><path d="M0 31 L9 28 L15 30 L23 27.5 L31 30 L40 28 L40 40 L0 40 Z" fill="#2a2a2d"/></g></svg>`;

const main = h('main', { id: 'main' });
/** What rewrites the words of the frame when the language changes. */
const relabel: (() => void)[] = [];
/** Set by the app once it runs: changes the language without reloading anything. */
let changeLanguage: (code: Lang) => void = () => undefined;

/** Lifts the opening screen, once: from then on the bar and the view come in, one piece at a time. */
function uncover(): void {
  introLift(() => document.body.classList.add('ready'));
}

/** The blocks of a view arrive one after the other, in reading order. */
function stagger(root: HTMLElement): void {
  if (reducedMotion()) return;
  const blocks = [...root.querySelectorAll<HTMLElement>(':scope > *, .plan-main > *, .plan-top > *, .plan-lead > *, .mission-grid > *, .mission-run > *, .cmp-panel > *')].filter(
    (b) => !b.matches('.plan-main, .plan-top, .plan-lead, .mission-grid, .mission-run') && b.offsetParent !== null,
  );
  blocks.forEach((b, i) => {
    b.style.setProperty('--i', String(Math.min(i, 10)));
    b.classList.remove('enter');
    void b.offsetWidth;
    b.classList.add('enter');
    b.addEventListener('animationend', () => b.classList.remove('enter'), { once: true });
  });
}
const tabsEl = h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Sections' });

/** Sound is off until asked for; the choice belongs to the whole app, so it lives in the top bar. */
function soundButton(): HTMLElement {
  const T = S.explore.three;
  // One small button: three bars when the sound is on, three dots when it is off. Its name is read out, not written.
  const button = h('button', { class: 'btn icon sound-btn', type: 'button', 'aria-pressed': 'false' }, h('i', { 'aria-hidden': 'true' }, h('b'), h('b'), h('b'), h('b')));
  const sync = () => {
    button.setAttribute('aria-pressed', String(soundEnabled()));
    const name = soundEnabled() ? T.soundOn : T.soundOff;
    button.setAttribute('aria-label', name);
    button.title = `${name}. ${T.soundTip}`;
  };
  button.addEventListener('click', () => {
    setSound(!soundEnabled());
    sync();
    tick();
  });
  sync();
  relabel.push(sync);
  // A returning visitor who had sound on gets it back at the first click anywhere (browsers need a gesture).
  if (soundPreferred()) {
    const resume = () => {
      setSound(true);
      sync();
      window.removeEventListener('pointerdown', resume);
    };
    window.addEventListener('pointerdown', resume);
  }
  return button;
}

function shell(): void {
  const brand = h('a', { class: 'brand', href: '#explore' });
  brand.innerHTML = LOGO;
  const tag = h('span', { class: 'brand-tag' }, S.tagline);
  brand.append(h('span', { class: 'brand-name' }, S.appName), tag);
  const skip = h('a', { class: 'skip', href: '#main' }, S.skip);
  // The language: the flag of the one in use; a click opens the three. Nothing reloads; the picture stays as it is.
  const flagNow = h('span', { class: 'flag' });
  const codeNow = h('span', { class: 'lang-code' });
  const langBtn = h('button', { class: 'btn lang-btn', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, flagNow, codeNow, h('span', { class: 'lang-caret', 'aria-hidden': 'true' }));
  const langMenu = h('div', { class: 'lang-menu', role: 'listbox', hidden: true });
  const langs = h('div', { class: 'lang' }, langBtn, langMenu);
  const openLangs = (on: boolean) => {
    langMenu.hidden = !on;
    langBtn.setAttribute('aria-expanded', String(on));
  };
  for (const l of LANGS) {
    const flag = h('span', { class: 'flag' });
    flag.innerHTML = FLAGS[l.code];
    langMenu.append(
      h(
        'button',
        {
          type: 'button',
          role: 'option',
          lang: l.tag,
          dataset: { code: l.code },
          onclick: () => {
            openLangs(false);
            changeLanguage(l.code);
            langBtn.focus();
          },
        },
        flag,
        h('span', null, l.name),
      ),
    );
  }
  langBtn.addEventListener('click', () => openLangs(langMenu.hasAttribute('hidden')));
  document.addEventListener('pointerdown', (ev) => {
    if (!langMenu.hidden && ev.target instanceof Node && !langs.contains(ev.target)) openLangs(false);
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !langMenu.hidden) openLangs(false);
  });
  const showLang = () => {
    const now = LANGS.find((l) => l.code === language())!;
    flagNow.innerHTML = FLAGS[now.code];
    codeNow.textContent = now.short;
    langBtn.title = `${S.lang.label}: ${now.name}`;
    langBtn.setAttribute('aria-label', `${S.lang.label}: ${now.name}`);
    langMenu.setAttribute('aria-label', S.lang.label);
    langMenu.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.code === now.code)));
  };
  showLang();
  relabel.push(() => {
    tag.textContent = S.tagline;
    skip.textContent = S.skip;
    showLang();
  });
  document.body.append(skip, h('header', { class: 'top' }, brand, tabsEl, h('div', { class: 'top-tools' }, langs, soundButton())), main);
  main.append(h('div', { class: 'loading' }, h('div', { class: 'spinner', role: 'status', 'aria-label': S.loading }), h('p', null, S.loading)));
}

async function boot(): Promise<void> {
  setLanguage(initialLanguage(), false);
  shell();
  let list;
  try {
    introStage(0.12);
    list = await loadSiteList();
    introStage(0.3);
  } catch (err) {
    console.error(err);
    clear(main);
    main.append(h('div', { class: 'loading' }, h('p', { role: 'alert' }, S.loadError)));
    return;
  }
  const known = (id: string) => id === CUSTOM_SITE || list.sites.some((s) => s.id === id);
  const store = new Store(fromHash(location.hash, known));
  const app = new App(store, list);

  const planner = new Planner(app);
  const factories: Partial<Record<Tab, () => View>> = {
    explore: () => createExplore(app),
    plan: () => createPlan(app, planner),
    compare: () => createCompare(app, planner),
    missions: () => createMissions(app, planner),
    accuracy: () => createAccuracy(app),
  };
  const views = new Map<Tab, View>();
  const tabs = (Object.keys(factories) as Tab[]).map((tab) => {
    const n = String(tabsEl.childElementCount + 1).padStart(2, '0');
    const button = h('button', { class: 'tab', role: 'tab', type: 'button', id: `tab-${tab}`, onclick: () => store.set({ tab }) });
    const label = () => {
      clear(button);
      button.append(h('span', { class: 'tab-n', 'aria-hidden': 'true' }, n), S.tabsShort[tab] ? h('span', { class: 'tab-long' }, S.tabs[tab]) : S.tabs[tab]);
      if (S.tabsShort[tab]) button.append(h('span', { class: 'tab-short', 'aria-hidden': 'true' }, S.tabsShort[tab]));
    };
    label();
    relabel.push(label);
    tabsEl.append(button);
    return { tab, button };
  });

  let shown: Tab | null = null;
  /** True while the views are being rebuilt in another language: they appear as they were, without an entrance. */
  let quiet = false;
  const render = (state: State, changed: Set<keyof State> | null) => {
    const tab: Tab = factories[state.tab] ? state.tab : 'explore';
    for (const t of tabs) t.button.setAttribute('aria-selected', String(t.tab === tab));
    document.body.dataset.tab = tab;
    if (shown !== tab) {
      // A field still being edited commits its value when it loses focus. Let that happen before the
      // view is taken down; if it changed the state, that change has already drawn the new screen.
      const active = document.activeElement;
      if (active instanceof HTMLElement && main.contains(active)) {
        active.blur();
        if (store.state !== state) return;
      }
      if (shown) views.get(shown)?.hide?.();
      let view = views.get(tab);
      if (!view) {
        view = factories[tab]!();
        views.set(tab, view);
      }
      clear(main);
      main.append(view.el);
      main.setAttribute('aria-labelledby', `tab-${tab}`);
      shown = tab;
      view.update(state, null);
      // Explore brings its own instruments in after the camera has arrived; the other views come in block by block.
      if (tab !== 'explore' && !quiet) stagger(view.el);
      window.scrollTo({ top: 0 });
      main.scrollTop = 0;
      return;
    }
    views.get(tab)?.update(state, changed);
  };
  store.subscribe(render);
  // Another language: the words of the frame are rewritten and the views are rebuilt with the new words, at once
  // and without an entrance. The state, the computed calendars and the 3D picture are untouched.
  changeLanguage = (code) => {
    if (code === language()) return;
    setLanguage(code);
    for (const write of relabel) write();
    for (const view of views.values()) view.dispose?.();
    views.clear();
    shown = null;
    quiet = true;
    render(store.state, null);
    quiet = false;
  };
  // Lets the development recording script drive the app.
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__lwStore = store;
  render(store.state, null);
  // The bar comes in piece by piece once the curtain lifts.
  document.querySelectorAll<HTMLElement>('.top .brand, .top .tab, .top .top-tools > *').forEach((e, i) => {
    e.classList.add('rise');
    e.style.setProperty('--i', String(i));
  });
  // The curtain lifts when the first view is whole: for Explore, when the place is loaded, compiled and drawn;
  // for the others, when the type is in. Never later than a dozen seconds.
  const typeIn = Promise.all([document.fonts.load("500 30px 'Jost Variable'"), document.fonts.load("400 10px 'B612'")])
    .catch(() => undefined)
    .then(introTyped);
  if (store.state.tab === 'explore') window.addEventListener('lw:ready', () => void typeIn.then(uncover), { once: true });
  else
    void typeIn.then(() => {
      introStage(1);
      requestAnimationFrame(uncover);
    });
  window.setTimeout(uncover, 12000);

  // Behind the first screen, everything that takes time is done ahead: the year of every site for the planner and
  // for the missions (in the worker), the terrain of the other sites and the other vehicle. After that, changing
  // screen or site waits for nothing.
  let ahead = false;
  const readAhead = () => {
    if (ahead) return;
    ahead = true;
    void planner.compute(...planRequest(store.state));
    warmMissions(planner);
    preloadModels();
    preloadJourney();
    void preloadTerrain(list.sites.map((site) => site.id));
  };
  if (store.state.tab === 'explore') window.addEventListener('lw:ready', () => window.setTimeout(readAhead, 3200), { once: true });
  else window.setTimeout(readAhead, 1800);
  window.setTimeout(readAhead, 16000);

  window.addEventListener('hashchange', () => {
    if (location.hash === toHash(store.state)) return;
    const next = fromHash(location.hash, known);
    store.set(next);
  });

  // Warm the cache of every site so that switching sites and the planner respond at once.
  void app.all().catch(() => undefined);
}

void boot();
