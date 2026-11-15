// Explore: pick a site and a moment, see the Sun and the Earth against the real skyline.
import { earthAxes, localAxesJ2000, siteFrame } from '../core/ephemeris';
import { MAST_HEIGHTS_M } from '../core/horizon';
import { SUN_PRESENT } from '../core/requirements';
import { S } from '../i18n/en';
import { COLORS, onResize } from '../viz/canvas';
import { drawCloseup, drawStrip, stripPoint, type StripGeometry } from '../viz/strip';
import { drawTimeline, timelineTime, type TimelineGeometry } from '../viz/timeline';
import type { App, View } from './app';
import { CATEGORY_LABEL, type LoadedSite, type Site } from './data';
import { clear, h, reducedMotion, setText } from './dom';
import { EXPLORE_DAYS, elevationRange, momentAt, outlookFor, type Moment, type Outlook, warmOutlooks } from './exploreModel';
import { createHero3D } from './hero3d';
import { DAY_MS, HOUR_MS, compass, dayTime, deg, duration, isoMinute, latLon, monthShort, num, parseUtc, pct } from './format';
import { REPLAYS } from './replays';
import { linkTone, sunTone } from './sound';
import { CUSTOM_SITE, MAX_MS, MIN_MS, type State } from './store';

const T = S.explore;
const STRIP_H = 330;
/** Side of the lens of an instrument, inside its border, CSS pixels. */
const LENS = 102;
/** Rows of the list of coming events: always the same number, so that the dock never changes height. */
const EVENT_ROWS = 4;

export function createExplore(app: App): View {
  const { store } = app;
  let loaded: LoadedSite | null = null;
  let moment: Moment | null = null;
  let outlook: Outlook | null = null;
  let stripGeo: StripGeometry | null = null;
  let timeGeo: TimelineGeometry | null = null;
  let playing = false;
  /** Moment the 3D view is showing: it runs to the chosen time instead of jumping there. */
  let shownMs = NaN;
  let shownSite = '';
  let flowFrame = 0;
  let wasLinked: boolean | null = null;
  let wasSunUp: boolean | null = null;
  let frame = 0;
  let lastTick = 0;
  let centerAz = 180;
  let centerFor = '';

  // ----- controls
  const siteSelect = h('select', { id: 'site', onchange: () => store.set({ siteId: siteSelect.value }) });
  const groups = new Map<Site['category'], HTMLOptGroupElement>();
  for (const s of app.sites) {
    let g = groups.get(s.category);
    if (!g) {
      g = h('optgroup', { label: CATEGORY_LABEL[s.category] });
      groups.set(s.category, g);
      siteSelect.appendChild(g);
    }
    g.appendChild(h('option', { value: s.id, text: s.name }));
  }
  siteSelect.appendChild(h('optgroup', { label: T.custom.group }, h('option', { value: CUSTOM_SITE, text: T.custom.option })));
  const coord = (label: string, min: number, max: number, key: 'lat' | 'lon') => {
    const input = h('input', { type: 'number', min: String(min), max: String(max), step: '0.01', 'aria-label': label, title: label });
    input.addEventListener('change', () => {
      const v = Math.max(min, Math.min(max, Number(input.value)));
      if (Number.isFinite(v) && v !== store.state.custom[key]) store.set({ custom: { ...store.state.custom, [key]: v } });
    });
    return input;
  };
  const latIn = coord(T.custom.lat, -90, 90, 'lat');
  const lonIn = coord(T.custom.lon, -180, 180, 'lon');
  const customField = h('div', { class: 'field custom-ll', hidden: true }, h('span', null, T.custom.label), h('div', { class: 'row' }, latIn, lonIn));
  const timeInput = h('input', {
    id: 'time',
    type: 'datetime-local',
    min: isoMinute(MIN_MS),
    max: isoMinute(MAX_MS),
    onchange: () => {
      const t = parseUtc(timeInput.value);
      if (Number.isFinite(t)) setTime(t);
    },
  });
  const setTime = (t: number) => store.set({ timeMs: Math.max(MIN_MS, Math.min(MAX_MS, t)) });
  const step = (label: string, delta: number, tip: string) =>
    h('button', { class: 'btn icon', type: 'button', title: tip, onclick: () => setTime(store.state.timeMs + delta) }, label);
  const playBtn = h('button', { class: 'btn primary', type: 'button', title: T.playTip, onclick: () => togglePlay() }, T.play);
  const heightSeg = h('div', { class: 'seg units', role: 'group', 'aria-label': T.height, title: T.heightTip });
  MAST_HEIGHTS_M.forEach((m, i) => {
    heightSeg.appendChild(
      h('button', { type: 'button', title: T.heights[i], onclick: () => store.set({ req: { ...store.state.req, mast: i } }), dataset: { mast: String(i) } }, `${m} m`),
    );
  });

  // ----- real landings to replay
  const replayList = h('div', { class: 'replay-list', role: 'group', 'aria-label': T.replay.title });
  for (const r of REPLAYS) {
    replayList.append(
      h(
        'button',
        {
          class: 'replay-item',
          type: 'button',
          dataset: { replay: r.id },
          onclick: () => {
            noteClosed = '';
            store.set({ siteId: r.siteId, timeMs: r.timeMs });
            openSheet(null);
          },
        },
        h('b', null, r.label),
        h('i', null, r.year),
        h('span', null, r.when),
      ),
    );
  }
  const replayNote = h('div', { class: 'replay-note', hidden: true });
  /** Replay whose note the visitor closed: it stays closed until another landing is chosen. */
  let noteClosed = '';

  // ----- the site block: where we are, and two sheets that open beside it
  const facts = h('dl', { class: 'facts' });
  const siteMeta = h('div', { class: 'site-meta' });
  const sheet = (title: string, body: HTMLElement) =>
    h(
      'div',
      { class: 'sheet', hidden: true },
      h('div', { class: 'sheet-head' }, h('span', { class: 'eyebrow' }, title), h('button', { class: 'btn icon', type: 'button', 'aria-label': T.close, title: T.close, onclick: () => openSheet(null) }, '✕')),
      body,
    );
  const factsSheet = sheet(T.facts.about, facts);
  const replaySheet = sheet(T.replay.title, replayList);
  const factsBtn = h('button', { class: 'btn', type: 'button', 'aria-expanded': 'false', onclick: () => openSheet(factsSheet.hidden ? 'facts' : null) }, T.siteFile);
  const replayBtn = h('button', { class: 'btn', type: 'button', 'aria-expanded': 'false', title: T.replay.title, onclick: () => openSheet(replaySheet.hidden ? 'replay' : null) }, T.replay.button);
  function openSheet(which: 'facts' | 'replay' | null): void {
    factsSheet.hidden = which !== 'facts';
    replaySheet.hidden = which !== 'replay';
    factsBtn.setAttribute('aria-expanded', String(which === 'facts'));
    replayBtn.setAttribute('aria-expanded', String(which === 'replay'));
  }
  const hudSite = h(
    'div',
    { class: 'hud hud-site' },
    h('div', { class: 'field site-field' }, h('label', { for: 'site' }, T.site), siteSelect),
    siteMeta,
    customField,
    h('div', { class: 'field' }, h('span', { title: T.heightTip }, T.height), heightSeg),
    h('div', { class: 'hud-actions' }, factsBtn, replayBtn),
    factsSheet,
    replaySheet,
  );
  document.addEventListener('pointerdown', (ev) => {
    if ((!factsSheet.hidden || !replaySheet.hidden) && ev.target instanceof Node && !hudSite.contains(ev.target)) openSheet(null);
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') openSheet(null);
  });

  // ----- verdict
  const where = h('p', { class: 'where' });
  const headline = h('h1', { 'aria-live': 'polite' });
  // The next step of the story, for a first visit: from one moment at one site to every landing day of the year.
  const nextStep = h('button', { class: 'next-step', type: 'button', onclick: () => store.set({ tab: 'plan' }) }, T.nextStep, h('span', { 'aria-hidden': 'true' }, ' →'));
  const hudVerdict = h('div', { class: 'hud hud-verdict' }, replayNote, where, headline, nextStep);

  // ----- hero: panorama
  const stripCanvas = h('canvas', { role: 'img', 'aria-label': T.panorama });
  const readout = h('div', { class: 'readout', hidden: true });
  // Two short lines over the sky; each is one piece and is never broken inside.
  const noteA = h('span');
  const noteB = h('span');
  const heroNote = h('p', { class: 'stage-note' }, noteA, noteB);
  const three = createHero3D();
  const viewSeg = h('div', { class: 'seg', role: 'group', 'aria-label': T.three.viewTip, title: T.three.viewTip });
  const view3dBtn = h('button', { type: 'button', onclick: () => store.set({ hero: '3d' }) }, T.three.view3d);
  const viewPanBtn = h('button', { type: 'button', onclick: () => store.set({ hero: 'panorama' }) }, T.panorama);
  viewSeg.append(view3dBtn, viewPanBtn);
  const stripWrap = h('div', { class: 'pano' }, stripCanvas, readout);
  three.onFail = () => {
    settle();
    view3dBtn.disabled = true;
    view3dBtn.title = T.three.unavailable;
    showHero();
    draw();
  };
  const use3d = () => store.state.hero === '3d' && three.ok();
  function showHero(): void {
    const on = use3d();
    three.el.hidden = !on;
    stripWrap.hidden = on;
    stage.classList.toggle('is-pano', !on);
    // Without the 3D view there is no arrival to wait for.
    if (!on && el.classList.contains('is-entering')) {
      settle();
      window.dispatchEvent(new Event('lw:ready'));
    }
    view3dBtn.setAttribute('aria-pressed', String(on));
    viewPanBtn.setAttribute('aria-pressed', String(!on));
  }
  stripCanvas.addEventListener('mousemove', (ev) => {
    if (!stripGeo || !loaded) return;
    const box = stripCanvas.getBoundingClientRect();
    const p = stripPoint(stripGeo, ev.clientX - box.left, ev.clientY - box.top);
    if (!p) {
      readout.hidden = true;
      return;
    }
    const mast = store.state.req.mast;
    const sky = loaded.horizon.at(p.az, mast);
    clear(readout);
    readout.append(T.readout(`${p.az.toFixed(0)}°`, compass(p.az), deg(sky)));
    if (loaded.data) {
      const i = Math.round(p.az / loaded.data.stepDeg) % loaded.horizon.count;
      const km = loaded.data.distKm[mast][i];
      readout.append(h('br'), T.readoutDist(km < 10 ? `${km.toFixed(1)} km` : `${km.toFixed(0)} km`));
    }
    readout.style.left = `${ev.clientX - box.left}px`;
    readout.style.top = `${ev.clientY - box.top}px`;
    readout.hidden = false;
  });
  stripCanvas.addEventListener('mouseleave', () => (readout.hidden = true));

  // ----- one instrument per body: its state, its lens and its three figures. Each fact is said once.
  const instrument = (kind: 'sun' | 'earth', name: string, aria: string, rows: [string, string][]) => {
    const state = h('span', { class: 'inst-state' });
    // In the 3D view the lens is a window onto the picture below (the telephoto view is drawn through it);
    // in the panorama it holds the 2D close-up, at true scale.
    const canvas = h('canvas', { role: 'img', 'aria-label': aria });
    const lensNote = h('span', { class: 'inst-lens-note' });
    const lens = h('div', { class: `inst-lens ${kind}` }, canvas, lensNote);
    const cells = rows.map(([title, tip]) => {
      const label = h('dt', null, title);
      const value = h('dd');
      const sub = h('small');
      return { el: h('div', { class: 'inst-row', title: tip }, label, value, sub), label, value, sub };
    });
    const el = h(
      'section',
      { class: `inst ${kind}`, 'aria-label': name },
      h('header', { class: 'inst-head' }, h('span', { class: `dot ${kind}` }), h('b', null, name), state),
      h('div', { class: 'inst-body' }, lens, h('dl', { class: 'inst-nums' }, ...cells.map((c) => c.el))),
    );
    return { el, state, lens, lensNote, canvas, rows: cells };
  };
  const sunInst = instrument('sun', S.sun, T.closeSun, [
    [T.stat.sunEl, T.stat.sunElTip],
    [T.stat.sunVisible, T.stat.sunVisibleTip],
    [T.stat.nextSun, T.stat.sunNextTip],
  ]);
  const earthInst = instrument('earth', S.earth, T.closeEarth, [
    [T.stat.earthAlt, T.stat.earthAltTip],
    [T.stat.earthEl, T.stat.earthElTip],
    [T.stat.nextEarth, T.stat.earthNextTip],
  ]);
  three.lenses(sunInst.lens, earthInst.lens);
  const hudData = h('div', { class: 'hud hud-data' }, sunInst.el, earthInst.el, h('div', { class: 'hud-row' }, h('span', { class: 'eyebrow' }, T.view), viewSeg));

  // ----- timeline
  const timeCanvas = h('canvas', { role: 'img', 'aria-label': T.timelineTitle(EXPLORE_DAYS) });
  const eventList = h('ul', { class: 'events' });
  const dock = h(
    'div',
    { class: 'dock' },
    h(
      'div',
      { class: 'dock-cell dock-transport' },
      h('div', { class: 'field' }, h('label', { for: 'time' }, T.time), timeInput),
      h(
        'div',
        { class: 'transport-row' },
        playBtn,
        h('div', { class: 'stepper' }, step(T.back1d, -DAY_MS, 'One day earlier'), step(T.back1h, -HOUR_MS, 'One hour earlier'), step(T.fwd1h, HOUR_MS, 'One hour later'), step(T.fwd1d, DAY_MS, 'One day later')),
      ),
    ),
    h('div', { class: 'dock-cell dock-time' }, h('div', { class: 'dock-cap' }, h('span', { class: 'eyebrow' }, T.timelineTitle(EXPLORE_DAYS)), h('span', { class: 'muted small' }, T.timelineHint)), timeCanvas),
    h('div', { class: 'dock-cell dock-events' }, h('div', { class: 'dock-cap' }, h('span', { class: 'eyebrow' }, T.nextEvents)), eventList),
  );
  const pickTime = (ev: MouseEvent) => {
    if (!timeGeo) return;
    const box = timeCanvas.getBoundingClientRect();
    setTime(Math.round(timelineTime(timeGeo, ev.clientX - box.left) / (30 * 60000)) * 30 * 60000);
  };
  timeCanvas.addEventListener('mousedown', (ev) => {
    pickTime(ev);
    const move = (e: MouseEvent) => pickTime(e);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  const stage = h('section', { class: 'stage', 'aria-label': T.panorama }, three.el, stripWrap, h('div', { class: 'stage-scrim' }), heroNote, hudSite, hudData, hudVerdict);
  // On the first visit nothing is on the picture yet: the place arrives, then each instrument comes in, one by one.
  const el = h('div', { class: 'explore is-entering is-arriving' }, stage, dock);
  const settle = () => el.classList.remove('is-entering', 'is-arriving');
  let settleLater = 0;
  three.onArriving = (on) => {
    window.clearTimeout(settleLater);
    if (on) {
      el.classList.add('is-arriving');
      // whatever happens to the picture, the instruments are back within a few seconds
      settleLater = window.setTimeout(settle, 6500);
    } else settle();
  };
  three.onReady = () => window.dispatchEvent(new Event('lw:ready'));

  // ----- behaviour
  function togglePlay(force?: boolean): void {
    playing = force ?? !playing;
    setText(playBtn, playing ? T.pause : T.play);
    playBtn.setAttribute('aria-pressed', String(playing));
    cancelAnimationFrame(frame);
    if (playing) {
      lastTick = performance.now();
      const tick = (now: number) => {
        const dt = Math.min(100, now - lastTick);
        lastTick = now;
        const next = store.state.timeMs + dt * 36 * HOUR_MS / 1000; // 36 hours of Moon time per second
        if (next >= MAX_MS) togglePlay(false);
        else setTime(next);
        if (playing) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
  }

  function renderFacts(site: Site): void {
    clear(facts);
    const terrain = site.horizon !== 'sphere';
    const own = site.id === CUSTOM_SITE;
    const about: (Node | string)[] = [own ? `${site.mission}. ${T.custom.warning}` : `${site.mission}. ${T.status[site.status]}${site.date ? ` (${site.date})` : ''}.`];
    if (site.note) about.push(' ', site.note);
    if (site.published) about.push(' ', T.facts.moved(deg(site.published.lat, 2), deg(site.published.lon, 2)));
    if (site.nasa) about.push(' ', T.facts.nasa(pct(site.nasa.sunVisibility3x3), pct(site.nasa.earthVisibility3x3)));
    clear(siteMeta);
    siteMeta.append(h('span', null, latLon(site.lat, site.lon)), h('span', { class: 'muted' }, `${num(site.elevationM, 0)} m`), h('span', { class: `tag ${terrain ? 'terrain' : 'sphere'}` }, terrain ? T.facts.terrain : T.facts.sphere));
    facts.append(
      h('div', null, h('dt', null, T.facts.coords), h('dd', null, latLon(site.lat, site.lon))),
      h('div', null, h('dt', null, T.facts.elevation), h('dd', null, T.facts.elevationValue(num(site.elevationM, 0)))),
      h(
        'div',
        null,
        h('dt', null, T.facts.horizon),
        h('dd', null, h('span', { class: `tag ${terrain ? 'terrain' : 'sphere'}` }, terrain ? T.facts.terrain : T.facts.sphere), ' ', site.horizon === 'lola-5m-80m-240m' ? T.facts.terrainFineText : terrain ? T.facts.terrainText : T.facts.sphereText),
      ),
      h('div', null, h('dt', null, T.facts.about), h('dd', null, ...about, ...(own ? [] : [' ', h('a', { href: site.source, target: '_blank', rel: 'noopener' }, T.facts.source)]))),
      h('div', null, h('dt', null, T.facts.real), h('dd', null, terrain ? T.three.note : T.three.noteSphere)),
    );
  }

  /** Shows one instant in the 3D view, and sounds the changes of sunlight and Earth contact. */
  function showInThree(ms: number): void {
    if (!loaded) return;
    const site = loaded.site;
    const mast = store.state.req.mast;
    const m = momentAt(loaded, mast, ms);
    // Earth's pole and Greenwich meridian in the local east-north-up frame of the site.
    const axes = earthAxes(new Date(ms));
    const f = siteFrame(site.lat, site.lon, 0);
    const local = (v: readonly [number, number, number]): [number, number, number] => [
      v[0] * f.east[0] + v[1] * f.east[1] + v[2] * f.east[2],
      v[0] * f.north[0] + v[1] * f.north[1] + v[2] * f.north[2],
      v[0] * f.up[0] + v[1] * f.up[1] + v[2] * f.up[2],
    ];
    three.setSite(loaded, mast);
    three.setMoment(m, { north: local(axes.north), greenwich: local(axes.greenwich) }, localAxesJ2000(new Date(ms), site.lat, site.lon), dayTime(ms));
    const linked = m.earthClear > 0;
    const sunUp = m.sunFrac >= SUN_PRESENT;
    if (shownSite === site.id) {
      if (wasLinked !== null && linked !== wasLinked) linkTone(linked);
      if (wasSunUp !== null && sunUp !== wasSunUp) sunTone(sunUp);
    }
    wasLinked = linked;
    wasSunUp = sunUp;
    shownSite = site.id;
    shownMs = ms;
  }

  /** Time flows to the new moment: the Sun runs along the horizon and the shadows sweep, in about a second. */
  function flowTo(targetMs: number): void {
    cancelAnimationFrame(flowFrame);
    const from = shownMs;
    const sameSite = loaded !== null && shownSite === loaded.site.id;
    if (!sameSite || !Number.isFinite(from) || playing || reducedMotion() || Math.abs(targetMs - from) < 20 * 60000) {
      showInThree(targetMs);
      return;
    }
    const t0 = performance.now();
    const length = Math.min(1500, 520 + (Math.abs(targetMs - from) / DAY_MS) * 110);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / length);
      const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      showInThree(from + (targetMs - from) * eased);
      if (k < 1) flowFrame = requestAnimationFrame(step);
    };
    flowFrame = requestAnimationFrame(step);
  }

  function nextEvent(kinds: string[], fromMs: number) {
    return outlook?.events.find((e) => e.timeMs > fromMs && kinds.includes(e.kind));
  }

  function render(): void {
    if (!loaded) return;
    const state = store.state;
    const mast = state.req.mast;
    const site = loaded.site;
    moment = momentAt(loaded, mast, state.timeMs);
    outlook = outlookFor(loaded, mast, state.timeMs);
    warmOutlooks(
      loaded,
      [0, 1, 2].filter((other) => other !== mast),
      state.timeMs,
    );
    if (centerFor !== site.id) {
      centerFor = site.id;
      centerAz = loaded.horizon.kind === 'sphere' ? 180 : Math.round(outlook.earthAz / 10) * 10;
    }
    const m = moment;
    showHero();
    if (use3d()) flowTo(state.timeMs);
    const sunUp = m.sunFrac >= SUN_PRESENT;
    const earthUp = m.earthClear > 0;

    // Controls
    if (siteSelect.value !== site.id) siteSelect.value = site.id;
    customField.hidden = site.id !== CUSTOM_SITE;
    if (document.activeElement !== latIn) latIn.value = String(state.custom.lat);
    if (document.activeElement !== lonIn) lonIn.value = String(state.custom.lon);
    if (document.activeElement !== timeInput) timeInput.value = isoMinute(state.timeMs);
    heightSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mast === String(mast))));

    // A real landing being replayed: what happened, next to what the tool says. The note stays while
    // the visitor moves through the three weeks after the landing.
    const replay = REPLAYS.find((r) => r.siteId === site.id && state.timeMs >= r.timeMs - HOUR_MS && state.timeMs <= r.timeMs + 21 * DAY_MS);
    replayList.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(!!replay && b.dataset.replay === replay.id)));
    replayNote.hidden = !replay || noteClosed === replay.id;
    if (replay && replayNote.dataset.id !== replay.id) {
      replayNote.dataset.id = replay.id;
      clear(replayNote);
      replayNote.append(
        h(
          'button',
          {
            class: 'btn icon',
            type: 'button',
            'aria-label': T.close,
            title: T.close,
            onclick: () => {
              noteClosed = replay.id;
              replayNote.hidden = true;
            },
          },
          '✕',
        ),
        h('div', null, h('span', { class: 'eyebrow' }, T.replay.happened), h('p', null, replay.happened, ' ', h('a', { href: replay.source.url, target: '_blank', rel: 'noopener' }, replay.source.label))),
        h('div', null, h('span', { class: 'eyebrow' }, T.replay.look), h('p', null, replay.look)),
      );
    }

    // Verdict
    setText(where, T.at(site.name, dayTime(state.timeMs)));
    setText(headline, m.eclipse > 0.5 ? T.headline.eclipse : sunUp && earthUp ? T.headline.both : sunUp ? T.headline.sunOnly : earthUp ? T.headline.earthOnly : T.headline.none);
// Instruments
    const big = (node: HTMLElement, value: string) => {
      // A changed number announces itself with a short rise, unless time is running.
      if (!playing && node.textContent && node.textContent !== value) {
        node.classList.remove('pop');
        void node.offsetWidth;
        node.classList.add('pop');
      }
      setText(node, value);
    };
    const status = (inst: typeof sunInst, ok: boolean, text: string) => {
      inst.el.classList.toggle('no', !ok);
      clear(inst.state);
      inst.state.append(h('span', { class: `mark ${ok ? 'ok' : 'bad'}`, 'aria-hidden': 'true' }, ok ? '✓' : '✕'), text);
      setText(inst.lensNote, use3d() ? T.inst.lens : T.inst.lensFlat);
    };
    status(sunInst, sunUp, m.eclipse > 0.5 ? T.inst.sunEclipsed : sunUp ? T.inst.sunUp : m.sunFrac > 0 ? T.inst.sunPartial : T.inst.sunDown);
    status(earthInst, earthUp, earthUp ? T.inst.earthUp : T.inst.earthDown);
    const [sunEl, sunVis, sunNext] = sunInst.rows;
    big(sunEl.value, deg(m.sun.el));
    big(sunVis.value, pct(m.sunFrac));
    const sunEv = nextEvent(['sunrise', 'sunset'], state.timeMs);
    setText(sunNext.label, sunEv ? (sunEv.kind === 'sunset' ? T.stat.sunset : T.stat.sunrise) : T.stat.nextSun);
    big(sunNext.value, sunEv ? duration((sunEv.timeMs - state.timeMs) / HOUR_MS) : T.stat.never);
    setText(sunNext.sub, sunEv ? dayTime(sunEv.timeMs) : T.stat.noSunEvent(EXPLORE_DAYS));
    const [earthAlt, earthSky, earthNext] = earthInst.rows;
    big(earthAlt.value, deg(m.earth.el));
    big(earthSky.value, deg(m.earthClear));
    const earthEv = nextEvent(['earthrise', 'earthset'], state.timeMs);
    setText(earthNext.label, earthEv ? (earthEv.kind === 'earthset' ? T.stat.earthset : T.stat.earthrise) : T.stat.nextEarth);
    big(earthNext.value, earthEv ? duration((earthEv.timeMs - state.timeMs) / HOUR_MS) : T.stat.never);
    setText(earthNext.sub, earthEv ? dayTime(earthEv.timeMs) : T.stat.noEarthEvent(EXPLORE_DAYS));

    // Events list
    clear(eventList);
    const upcoming = outlook.events.filter((e) => e.timeMs > state.timeMs).slice(0, EVENT_ROWS);
    if (!upcoming.length) eventList.append(h('li', { class: 'muted' }, h('span'), h('span', null, T.noEvents)));
    for (const e of upcoming) {
      const kind = e.kind.startsWith('earth') ? 'earth' : 'sun';
      eventList.append(
        h('li', null, h('span', { class: `dot ${kind}` }), h('span', null, T.events[e.kind]), h('span', null, T.inTime(duration((e.timeMs - state.timeMs) / HOUR_MS))), h('span', { class: 'when' }, dayTime(e.timeMs))),
      );
    }
    for (let i = Math.max(1, upcoming.length); i < EVENT_ROWS; i++) eventList.append(h('li', { 'aria-hidden': 'true' }));
    draw();
  }

  function draw(): void {
    if (!loaded || !moment || !outlook || !el.isConnected) return;
    const mast = store.state.req.mast;
    const [elMin, elMax] = elevationRange(loaded, mast);
    if (use3d()) {
      const kind = loaded.site.horizon;
      const sphere = kind === 'sphere';
      setText(noteA, sphere ? T.three.realSphere : kind === 'lola-5m-80m-240m' ? T.three.realFine : T.three.realCoarse);
      setText(noteB, sphere ? T.three.illustrativeSphere : T.three.illustrative);
      heroNote.title = sphere ? T.three.noteSphere : T.three.note;
      three.redraw();
    } else stripGeo = drawStrip(
      stripCanvas,
      {
        horizon: loaded.horizon,
        data: loaded.data,
        mast,
        sun: moment.sun,
        earth: moment.earth,
        sunFrac: moment.sunFrac,
        earthClear: moment.earthClear,
        centerAz,
        elMin,
        elMax,
        sunPath: outlook.sunPath,
        earthPath: outlook.earthPath,
        labels: { sun: S.sun, earth: S.earth, behind: T.behind, horizontal: T.horizontal, sphere: T.sphereNote },
      },
      stripWrap.clientHeight > 160 ? stripWrap.clientHeight : STRIP_H,
    );
    if (!use3d() && stripGeo) {
      const stretch = stripGeo.plotH / (elMax - elMin) / (stripGeo.plotW / 360);
      setText(noteA, stretch > 1.5 ? T.panoramaNote(stretch.toFixed(0)) : T.panoramaNoteFlat);
      setText(noteB, stretch > 1.5 ? T.panoramaNote2 : '');
      heroNote.title = '';
    }
    if (!use3d()) drawCloseup(sunInst.canvas, { horizon: loaded.horizon, mast, body: moment.sun, span: 3.2, inner: '#ffffff', outer: '#ececee', glow: 'rgba(255,255,255,0.4)', scaleLabel: T.oneDegree }, LENS);
    if (!use3d()) drawCloseup(earthInst.canvas, { horizon: loaded.horizon, mast, body: moment.earth, span: 7.5, inner: '#dcecff', outer: COLORS.earthDeep, glow: 'rgba(125,184,255,0.24)', scaleLabel: T.oneDegree }, LENS);
    timeGeo = drawTimeline(timeCanvas, {
      startMs: outlook.grid.startMs,
      stepMs: outlook.grid.stepMs,
      sunFrac: outlook.series.sunFrac,
      earthClear: outlook.series.earthClear,
      earthMarginDeg: 0,
      cursorMs: store.state.timeMs,
      span: null,
      events: outlook.events,
      labels: { sun: S.sun, earth: S.earth, both: S.both },
      formatDay: (ms) => `${new Date(ms).getUTCDate()} ${monthShort(ms)}`,
    });
  }

  onResize(el, draw);

  return {
    el,
    update(state: State, changed) {
      if (!changed || changed.has('siteId') || !loaded || loaded.site.id !== state.siteId || (state.siteId === CUSTOM_SITE && changed.has('custom'))) {
        const id = state.siteId;
        const ready = app.peek(id);
        const apply = (l: LoadedSite) => {
          if (store.state.siteId !== id) return;
          loaded = l;
          renderFacts(l.site);
          render();
        };
        if (ready) apply(ready);
        else void app.site(id).then(apply);
        return;
      }
      if (changed.has('timeMs') || changed.has('req') || changed.has('tab') || changed.has('hero')) render();
    },
    hide() {
      if (playing) togglePlay(false);
    },
  };
}

export const exploreMotionAllowed = (): boolean => !reducedMotion();
