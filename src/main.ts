import './style.css';
import { S } from './i18n/en';
import { App, type View } from './ui/app';
import { loadSiteList } from './ui/data';
import { clear, h } from './ui/dom';
import { createExplore } from './ui/explore';
import { fromHash, Store, toHash, type State, type Tab } from './ui/store';

const LOGO = `<svg viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="lw-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9b0"/><stop offset="1" stop-color="#f5a23c"/></linearGradient><clipPath id="lw-c"><circle cx="20" cy="20" r="17"/></clipPath></defs><circle cx="20" cy="20" r="17" fill="#0d1320" stroke="#3a465e" stroke-width="1.5"/><g clip-path="url(#lw-c)"><circle cx="24.5" cy="22.5" r="5" fill="url(#lw-g)"/><path d="M0 27 L7 23.5 L12 25.5 L17 21 L22 24.5 L28 22 L33 25 L40 23 L40 40 L0 40 Z" fill="#6b7893"/><path d="M0 31 L9 28 L15 30 L23 27.5 L31 30 L40 28 L40 40 L0 40 Z" fill="#2b3447"/></g></svg>`;

const main = h('main', { id: 'main' });
const tabsEl = h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Sections' });

function shell(): void {
  const brand = h('a', { class: 'brand', href: '#explore' });
  brand.innerHTML = LOGO;
  brand.append(h('div', null, h('div', { class: 'brand-name' }, S.appName), h('div', { class: 'brand-tag' }, S.tagline)));
  document.body.append(
    h('a', { class: 'skip', href: '#main' }, S.skip),
    h('header', { class: 'top' }, h('div', { class: 'top-in' }, brand, tabsEl)),
    main,
    h(
      'footer',
      null,
      h('div', { class: 'foot-in' }, h('span', null, S.footer.data), h('span', null, S.footer.utc), h('span', null, S.footer.notNasa), h('span', null, S.footer.license)),
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
  const known = (id: string) => list.sites.some((s) => s.id === id);
  const store = new Store(fromHash(location.hash, known));
  const app = new App(store, list);

  const factories: Partial<Record<Tab, () => View>> = {
    explore: () => createExplore(app),
  };
  const views = new Map<Tab, View>();
  const tabs = (Object.keys(factories) as Tab[]).map((tab) => {
    const button = h('button', { class: 'tab', role: 'tab', type: 'button', id: `tab-${tab}`, onclick: () => store.set({ tab }) }, S.tabs[tab]);
    tabsEl.append(button);
    return { tab, button };
  });

  let shown: Tab | null = null;
  const render = (state: State, changed: Set<keyof State> | null) => {
    const tab: Tab = factories[state.tab] ? state.tab : 'explore';
    for (const t of tabs) t.button.setAttribute('aria-selected', String(t.tab === tab));
    if (shown !== tab) {
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
      window.scrollTo({ top: 0 });
      return;
    }
    views.get(tab)?.update(state, changed);
  };
  store.subscribe(render);
  render(store.state, null);

  window.addEventListener('hashchange', () => {
    if (location.hash === toHash(store.state)) return;
    const next = fromHash(location.hash, known);
    store.set(next);
  });

  // Warm the cache of every site so that switching sites and the planner respond at once.
  void app.all();
}

void boot();
