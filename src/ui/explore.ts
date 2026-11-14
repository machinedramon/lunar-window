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
import { EXPLORE_DAYS, elevationRange, momentAt, outlookFor, type Moment, type Outlook } from './exploreModel';
import { createHero3D } from './hero3d';
import { DAY_MS, HOUR_MS, compass, dayTime, deg, duration, isoMinute, latLon, monthShort, num, parseUtc, pct } from './format';
import { REPLAYS } from './replays';
import { linkTone, setSound, soundEnabled, soundPreferred, sunTone, tick } from './sound';
import { CUSTOM_SITE, MAX_MS, MIN_MS, type State } from './store';

const T = S.explore;
const STRIP_H = 330;
const CLOSE_H = 210;

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
  const heightSeg = h('div', { class: 'seg', role: 'group', 'aria-label': T.height, title: T.heightTip });
  MAST_HEIGHTS_M.forEach((m, i) => {
    heightSeg.appendChild(
      h('button', { type: 'button', title: T.heights[i], onclick: () => store.set({ req: { ...store.state.req, mast: i } }), dataset: { mast: String(i) } }, `${m} m`),
    );
  });

  const controls = h(
    'div',
    { class: 'controls' },
    h('div', { class: 'field' }, h('label', { for: 'site' }, T.site), siteSelect),
    customField,
    h('div', { class: 'field' }, h('label', { for: 'time' }, T.time), timeInput),
    h(
      'div',
      { class: 'stepper' },
      step(T.back1d, -DAY_MS, 'One day earlier'),
      step(T.back1h, -HOUR_MS, 'One hour earlier'),
      step(T.fwd1h, HOUR_MS, 'One hour later'),
      step(T.fwd1d, DAY_MS, 'One day later'),
    ),
    playBtn,
    h('div', { class: 'grow' }),
    h('div', { class: 'field' }, h('span', null, T.height), heightSeg),
  );

  // ----- real landings to replay
  const replayRow = h('div', { class: 'replays', role: 'group', 'aria-label': T.replay.title }, h('span', { class: 'eyebrow' }, T.replay.title));
  for (const r of REPLAYS) {
    replayRow.append(
      h('button', { class: 'chip', type: 'button', dataset: { replay: r.id }, title: r.when, onclick: () => store.set({ siteId: r.siteId, timeMs: r.timeMs }) }, r.label, h('span', { class: 'muted' }, ` ${r.year}`)),
    );
  }
  const replayNote = h('div', { class: 'replay-note', hidden: true });

  // ----- verdict
  const where = h('p', { class: 'where' });
  const headline = h('h1', { 'aria-live': 'polite' });
  const sunPill = h('span', { class: 'pill' });
  const earthPill = h('span', { class: 'pill' });
  const verdict = h('div', { class: 'verdict' }, h('div', null, where, headline), h('div', { class: 'pills' }, sunPill, earthPill));

  // ----- hero: panorama
  const stripCanvas = h('canvas', { role: 'img', 'aria-label': T.panorama });
  const readout = h('div', { class: 'readout', hidden: true });
  const heroNote = h('span', { class: 'hero-note' });
  const three = createHero3D();
  const viewSeg = h('div', { class: 'seg', role: 'group', 'aria-label': T.three.viewTip, title: T.three.viewTip });
  const view3dBtn = h('button', { type: 'button', onclick: () => store.set({ hero: '3d' }) }, T.three.view3d);
  const viewPanBtn = h('button', { type: 'button', onclick: () => store.set({ hero: 'panorama' }) }, T.panorama);
  viewSeg.append(view3dBtn, viewPanBtn);
  const soundBtn = h('button', { class: 'btn ghost sound-btn', type: 'button', title: T.three.soundTip, 'aria-pressed': 'false' });
  const syncSound = () => {
    soundBtn.setAttribute('aria-pressed', String(soundEnabled()));
    setText(soundBtn, soundEnabled() ? T.three.soundOn : T.three.soundOff);
  };
  soundBtn.addEventListener('click', () => {
    setSound(!soundEnabled());
    syncSound();
    tick();
  });
  syncSound();
  // A returning visitor who had sound on gets it back at the first click anywhere (browsers need a gesture).
  if (soundPreferred()) {
    const resume = () => {
      setSound(true);
      syncSound();
      window.removeEventListener('pointerdown', resume);
    };
    window.addEventListener('pointerdown', resume);
  }
  const stripWrap = h('div', { style: 'position:relative' }, stripCanvas, readout);
  const hero = h('section', { class: 'panel hero', 'aria-label': T.panorama }, h('div', { class: 'hero-bar' }, viewSeg, heroNote, h('div', { class: 'grow' }), soundBtn), three.el, stripWrap);
  three.onFail = () => {
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

  // ----- stat cards
  const stat = (title: string, tip: string, lead = false, dot?: 'sun' | 'earth') => {
    const value = h('div', { class: 'value' });
    const sub = h('div', { class: 'sub' });
    const label = h('span', null, title);
    const el = h('div', { class: `panel stat${lead ? ' lead' : ''}`, title: tip }, h('div', { class: 'eyebrow' }, dot ? h('span', { class: `dot ${dot}` }) : null, label), value, sub);
    return { el, value, sub, label };
  };
  const stSunEl = stat(T.stat.sunEl, T.stat.sunElTip, true, 'sun');
  const stSunVis = stat(T.stat.sunVisible, T.stat.sunVisibleTip, false, 'sun');
  const stSunNext = stat(T.stat.nextSun, T.stat.sunVisibleTip, false, 'sun');
  const stEarth = stat(T.stat.earthEl, T.stat.earthElTip, false, 'earth');
  const stEarthNext = stat(T.stat.nextEarth, T.stat.earthElTip, false, 'earth');
  const stats = h('div', { class: 'stats' }, stSunEl.el, stSunVis.el, stSunNext.el, stEarth.el, stEarthNext.el);

  // ----- close-ups and timeline
  const sunCanvas = h('canvas', { role: 'img', 'aria-label': T.closeSun });
  const earthCanvas = h('canvas', { role: 'img', 'aria-label': T.closeEarth });
  const closeups = h(
    'div',
    { class: 'closeups' },
    h('div', { class: 'panel closeup' }, h('div', { class: 'cap' }, h('span', { class: 'dot sun' }), T.closeSun, h('span', { class: 'muted small' }, T.trueScale)), sunCanvas),
    h('div', { class: 'panel closeup' }, h('div', { class: 'cap' }, h('span', { class: 'dot earth' }), T.closeEarth, h('span', { class: 'muted small' }, T.trueScale)), earthCanvas),
  );
  const timeCanvas = h('canvas', { role: 'img', 'aria-label': T.timelineTitle(EXPLORE_DAYS) });
  const eventList = h('ul', { class: 'events' });
  const timeline = h(
    'div',
    { class: 'panel timeline' },
    h('div', { class: 'cap' }, T.timelineTitle(EXPLORE_DAYS), h('span', { class: 'muted small' }, T.timelineHint)),
    timeCanvas,
    eventList,
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

  const facts = h('dl', { class: 'panel facts' });
  const el = h('div', { class: 'explore' }, h('div', { class: 'panel panel-pad' }, controls, replayRow, verdict, replayNote), hero, stats, h('div', { class: 'lower' }, closeups, timeline), facts);

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
    replayRow.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(!!replay && b.dataset.replay === replay.id)));
    replayNote.hidden = !replay;
    if (replay && replayNote.dataset.id !== replay.id) {
      replayNote.dataset.id = replay.id;
      clear(replayNote);
      replayNote.append(
        h('div', null, h('span', { class: 'eyebrow' }, T.replay.happened), h('p', null, replay.happened, ' ', h('a', { href: replay.source.url, target: '_blank', rel: 'noopener' }, replay.source.label))),
        h('div', null, h('span', { class: 'eyebrow' }, T.replay.look), h('p', null, replay.look)),
      );
    }

    // Verdict
    setText(where, T.at(site.name, dayTime(state.timeMs)));
    setText(headline, m.eclipse > 0.5 ? T.headline.eclipse : sunUp && earthUp ? T.headline.both : sunUp ? T.headline.sunOnly : earthUp ? T.headline.earthOnly : T.headline.none);
    const pill = (el: HTMLElement, kind: 'sun' | 'earth', ok: boolean, name: string, text: string) => {
      el.className = `pill ${ok ? 'yes' : 'no'}`;
      clear(el);
      el.append(h('span', { class: `dot ${kind}` }), h('span', { class: `mark ${ok ? 'ok' : 'bad'}`, 'aria-hidden': 'true' }, ok ? '✓' : '✕'), h('b', null, name), text);
    };
    const share = pct(m.sunFrac);
    pill(sunPill, 'sun', sunUp, S.sun, m.eclipse > 0.5 ? T.sunEclipsed : sunUp ? T.sunUp(share) : m.sunFrac > 0 ? T.sunPartial(share) : T.sunDown);
    pill(earthPill, 'earth', earthUp, S.earth, earthUp ? T.earthUp(deg(m.earthClear)) : T.earthDown(deg(-m.earthClear)));

    // Cards
    const big = (node: HTMLElement, value: string, unit?: string) => {
      // A changed number announces itself with a short rise, unless time is running.
      if (!playing && node.textContent && node.textContent !== value + (unit ?? '')) {
        node.classList.remove('pop');
        void node.offsetWidth;
        node.classList.add('pop');
      }
      clear(node);
      node.append(value);
      if (unit) node.append(h('small', null, unit));
    };
    big(stSunEl.value, deg(m.sun.el));
    setText(stSunEl.sub, T.stat.sunElSub);
    big(stSunVis.value, pct(m.sunFrac));
    setText(stSunVis.sub, m.eclipse > 0 ? T.stat.sunVisibleEclipse : T.stat.sunVisibleSub);
    const sunEv = nextEvent(['sunrise', 'sunset'], state.timeMs);
    setText(stSunNext.label, sunEv ? (sunEv.kind === 'sunset' ? T.stat.sunset : T.stat.sunrise) : T.stat.nextSun);
    big(stSunNext.value, sunEv ? duration((sunEv.timeMs - state.timeMs) / HOUR_MS) : T.stat.never);
    setText(stSunNext.sub, sunEv ? dayTime(sunEv.timeMs) : T.stat.noSunEvent(EXPLORE_DAYS));
    big(stEarth.value, deg(m.earthClear));
    setText(stEarth.sub, T.stat.earthElSub);
    const earthEv = nextEvent(['earthrise', 'earthset'], state.timeMs);
    setText(stEarthNext.label, earthEv ? (earthEv.kind === 'earthset' ? T.stat.earthset : T.stat.earthrise) : T.stat.nextEarth);
    big(stEarthNext.value, earthEv ? duration((earthEv.timeMs - state.timeMs) / HOUR_MS) : T.stat.never);
    setText(stEarthNext.sub, earthEv ? dayTime(earthEv.timeMs) : T.stat.noEarthEvent(EXPLORE_DAYS));

    // Events list
    clear(eventList);
    const upcoming = outlook.events.filter((e) => e.timeMs > state.timeMs).slice(0, 6);
    if (!upcoming.length) eventList.append(h('li', { class: 'muted' }, T.noEvents));
    for (const e of upcoming) {
      const kind = e.kind.startsWith('earth') ? 'earth' : 'sun';
      eventList.append(
        h('li', null, h('span', { class: `dot ${kind}` }), h('span', null, T.events[e.kind]), h('span', { class: 'muted' }, T.inTime(duration((e.timeMs - state.timeMs) / HOUR_MS))), h('span', { class: 'when' }, dayTime(e.timeMs))),
      );
    }
    draw();
  }

  function draw(): void {
    if (!loaded || !moment || !outlook || !el.isConnected) return;
    const mast = store.state.req.mast;
    const [elMin, elMax] = elevationRange(loaded, mast);
    if (use3d()) {
      setText(heroNote, loaded.site.horizon === 'sphere' ? T.three.noteSphere : T.three.note);
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
      STRIP_H,
    );
    if (!use3d() && stripGeo) {
      const stretch = stripGeo.plotH / (elMax - elMin) / (stripGeo.plotW / 360);
      setText(heroNote, stretch > 1.5 ? T.panoramaNote(stretch.toFixed(0)) : T.panoramaNoteFlat);
    }
    drawCloseup(sunCanvas, { horizon: loaded.horizon, mast, body: moment.sun, span: 3.2, inner: '#ffffff', outer: '#ececee', glow: 'rgba(255,255,255,0.4)', scaleLabel: T.oneDegree }, CLOSE_H);
    drawCloseup(earthCanvas, { horizon: loaded.horizon, mast, body: moment.earth, span: 7.5, inner: '#dcecff', outer: COLORS.earthDeep, glow: 'rgba(125,184,255,0.24)', scaleLabel: T.oneDegree }, CLOSE_H);
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
