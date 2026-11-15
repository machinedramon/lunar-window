import './style.css';
import { S } from './i18n/en';
import { createAccuracy } from './ui/accuracy';
import { createCompare } from './ui/compare';
import { createMissions } from './ui/missions';
import { App, type View } from './ui/app';
import { loadSiteList } from './ui/data';
import { clear, h } from './ui/dom';
import { createExplore } from './ui/explore';
import { createPlan } from './ui/plan';
import { Planner } from './ui/planner';
import { setSound, soundEnabled, soundPreferred, tick } from './ui/sound';
import { CUSTOM_SITE, fromHash, Store, toHash, type State, type Tab } from './ui/store';

const LOGO = `<svg viewBox="0 0 40 40" aria-hidden="true"><defs><clipPath id="lw-c"><circle cx="20" cy="20" r="17"/></clipPath></defs><circle cx="20" cy="20" r="17" fill="#000" stroke="#fff" stroke-width="1.6"/><g clip-path="url(#lw-c)"><circle cx="24.5" cy="22" r="4.6" fill="#fff"/><path d="M0 27 L7 23.5 L12 25.5 L17 21 L22 24.5 L28 22 L33 25 L40 23 L40 40 L0 40 Z" fill="#8f8f96"/><path d="M0 31 L9 28 L15 30 L23 27.5 L31 30 L40 28 L40 40 L0 40 Z" fill="#2a2a2d"/></g></svg>`;

const main = h('main', { id: 'main' });
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
    h(
      'footer',
      { class: 'foot' },
      h('span', { class: 'foot-long' }, S.footer.notNasa),
      h('span', { class: 'foot-long' }, S.footer.data),
      h('span', { class: 'foot-long' }, S.footer.utc),
      h('span', { class: 'foot-long' }, S.footer.license),
      h('span', { class: 'foot-long' }, S.footer.ai),
      h('span', { class: 'foot-short' }, S.footer.short),
      h('a', { href: 'https://github.com/machinedramon/lunar-window', target: '_blank', rel: 'noopener' }, 'GitHub'),
    ),
  );
  main.append(h('div', { class: 'loading' }, h('div', { class: 'spinner', role: 'status', 'aria-label': S.loading }), h('p', null, S.loading)));
}

async function boot(): Promise<void> {
  shell();
  let list;
  try {
    list = await loadSiteList();
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
      view.el.classList.remove('view-in');
      main.append(view.el);
      void view.el.offsetWidth;
      view.el.classList.add('view-in');
      main.setAttribute('aria-labelledby', `tab-${tab}`);
      shown = tab;
      view.update(state, null);
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

  window.addEventListener('hashchange', () => {
    if (location.hash === toHash(store.state)) return;
    const next = fromHash(location.hash, known);
    store.set(next);
  });

  // Warm the cache of every site so that switching sites and the planner respond at once.
  void app.all().catch(() => undefined);
}

void boot();
