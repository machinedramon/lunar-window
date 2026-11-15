import './style.css';
import { S } from './i18n/en';
import { createAccuracy } from './ui/accuracy';
import { createCompare } from './ui/compare';
import { createMissions } from './ui/missions';
import { App, type View } from './ui/app';
import { loadSiteList } from './ui/data';
import { clear, h, reducedMotion } from './ui/dom';
import { introLift, introStage, introTyped } from './ui/intro';
import { createExplore } from './ui/explore';
import { createPlan } from './ui/plan';
import { Planner } from './ui/planner';
import { setSound, soundEnabled, soundPreferred, tick } from './ui/sound';
import { CUSTOM_SITE, fromHash, Store, toHash, type State, type Tab } from './ui/store';

const LOGO = `<svg viewBox="0 0 40 40" aria-hidden="true"><defs><clipPath id="lw-c"><circle cx="20" cy="20" r="17"/></clipPath></defs><circle cx="20" cy="20" r="17" fill="#000" stroke="#fff" stroke-width="1.6"/><g clip-path="url(#lw-c)"><circle cx="24.5" cy="22" r="4.6" fill="#fff"/><path d="M0 27 L7 23.5 L12 25.5 L17 21 L22 24.5 L28 22 L33 25 L40 23 L40 40 L0 40 Z" fill="#8f8f96"/><path d="M0 31 L9 28 L15 30 L23 27.5 L31 30 L40 28 L40 40 L0 40 Z" fill="#2a2a2d"/></g></svg>`;

const main = h('main', { id: 'main' });

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
  const label = h('span');
  const button = h('button', { class: 'btn sound-btn', type: 'button', title: T.soundTip, 'aria-pressed': 'false' }, h('i', { 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), label);
  const sync = () => {
    button.setAttribute('aria-pressed', String(soundEnabled()));
    label.textContent = soundEnabled() ? T.soundOn : T.soundOff;
  };
  button.addEventListener('click', () => {
    setSound(!soundEnabled());
    sync();
    tick();
  });
  sync();
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
  brand.append(h('span', { class: 'brand-name' }, S.appName), h('span', { class: 'brand-tag' }, S.tagline));
  document.body.append(
    h('a', { class: 'skip', href: '#main' }, S.skip),
    h('header', { class: 'top' }, brand, tabsEl, h('div', { class: 'top-tools' }, soundButton())),
    main,
  );
  main.append(h('div', { class: 'loading' }, h('div', { class: 'spinner', role: 'status', 'aria-label': S.loading }), h('p', null, S.loading)));
}

async function boot(): Promise<void> {
  shell();
  let list;
  try {
    introStage(S.stages.sites, 0.12);
    list = await loadSiteList();
    introStage(S.stages.terrain, 0.3);
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
    const button = h('button', { class: 'tab', role: 'tab', type: 'button', id: `tab-${tab}`, onclick: () => store.set({ tab }) }, h('span', { class: 'tab-n', 'aria-hidden': 'true' }, n), S.tabsShort[tab] ? h('span', { class: 'tab-long' }, S.tabs[tab]) : S.tabs[tab], S.tabsShort[tab] ? h('span', { class: 'tab-short', 'aria-hidden': 'true' }, S.tabsShort[tab]) : null);
    tabsEl.append(button);
    return { tab, button };
  });

  let shown: Tab | null = null;
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
      if (tab !== 'explore') stagger(view.el);
      window.scrollTo({ top: 0 });
      main.scrollTop = 0;
      return;
    }
    views.get(tab)?.update(state, changed);
  };
  store.subscribe(render);
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
      introStage(S.stages.ready, 1);
      requestAnimationFrame(uncover);
    });
  window.setTimeout(uncover, 12000);

  window.addEventListener('hashchange', () => {
    if (location.hash === toHash(store.state)) return;
    const next = fromHash(location.hash, known);
    store.set(next);
  });

  // Warm the cache of every site so that switching sites and the planner respond at once.
  void app.all().catch(() => undefined);
}

void boot();
