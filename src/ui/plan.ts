// Plan a mission: state what the mission needs, see every site and day that works,
// then slip the launch and watch what survives.
import { LANDING_STEPS, nextViableDay, STATUS_CODES, type SiteCalendar } from '../core/calendar';
import { MAST_HEIGHTS_M } from '../core/horizon';
import { durationSteps, PROFILES, REQUIREMENT_ORDER, type CellResult, type Requirements, type RequirementKey } from '../core/requirements';
import { DAY_STEPS, STEP_MS } from '../core/series';
import { S } from '../i18n/en';
import { onResize } from '../viz/canvas';
import { calendarCell, drawCalendar, type CalendarGeometry, type CalendarRow } from '../viz/calendar';
import { drawTimeline } from '../viz/timeline';
import type { ComputeResult, WindowResult } from '../worker/protocol';
import type { App, View } from './app';
import { clear, h, setText } from './dom';
import { DAY_MS, HOUR_MS, day as fmtDay, dayTime, deg, duration, isoDate, monthShort, parseUtc, pct } from './format';
import type { Planner } from './planner';
import { MAX_SLIP, type State } from './store';

const T = S.plan;
const DAYS = 365;
/** Days shown before the planned date, so that its marker never sits on the edge. */
const LEAD = 7;

const mark = (status: string) => h('span', { class: `mark ${status === 'ok' ? 'ok' : status === 'marginal' ? 'warn' : 'bad'}`, 'aria-hidden': 'true' }, S.statusMark[status]);

export function createPlan(app: App, planner: Planner): View {
  const { store } = app;
  const sites = [...app.sites].sort((a, b) => Number(a.horizon === 'sphere') - Number(b.horizon === 'sphere'));
  const terrain = sites.filter((s) => s.horizon !== 'sphere');
  let result: ComputeResult | null = null;
  let key = '';
  let timer = 0;
  let geo: CalendarGeometry | null = null;
  let cursor: { row: number; day: number } | null = null;
  let win: WindowResult | null = null;
  let winKey = '';
  let timeIdx = 0;

  const startMs = () => store.state.plannedMs - LEAD * DAY_MS;
  const slippedDay = () => LEAD + store.state.slipDays;
  const calOf = (id: string): SiteCalendar | null => result?.calendars.find((c) => c.siteId === id)?.cal ?? null;

  // ---------- requirements
  const setReq = (patch: Partial<Requirements>) => {
    const req = { ...store.state.req, ...patch };
    const same = PROFILES.find((p) => JSON.stringify(p.req) === JSON.stringify(req));
    store.set({ req, profileId: same ? same.id : 'custom' });
  };
  const profileButtons = PROFILES.map((p) =>
    h('button', { class: 'profile', type: 'button', onclick: () => store.set({ req: { ...p.req, mast: store.state.req.mast }, profileId: p.id }) }, h('b', null, p.label), h('span', null, p.blurb)),
  );
  const number = (min: number, max: number, onValue: (v: number) => void, label: string) => {
    const input = h('input', { type: 'number', min: String(min), max: String(max), step: '1', 'aria-label': label });
    input.addEventListener('change', () => {
      const v = Math.max(min, Math.min(max, Number(input.value)));
      if (Number.isFinite(v)) onValue(v);
    });
    return input;
  };
  const toggle = (label: string, tip: string, onValue: (v: boolean) => void) => {
    const input = h('input', { type: 'checkbox' });
    input.addEventListener('change', () => onValue(input.checked));
    return { input, el: h('label', { class: 'switch', title: tip }, input, h('span', { class: 'track', 'aria-hidden': 'true' }), h('span', null, label)) };
  };
  const seg = (values: { label: string; value: number }[], label: string, tip: string, onValue: (v: number) => void) => {
    const el = h('div', { class: 'seg', role: 'group', 'aria-label': label, title: tip });
    for (const v of values) el.append(h('button', { type: 'button', dataset: { v: String(v.value) }, onclick: () => onValue(v.value) }, v.label));
    return el;
  };

  const durationIn = number(1, 120, (v) => setReq({ durationDays: v }), T.duration);
  const sunLanding = toggle(T.sunAtLanding, T.sunAtLandingTip, (v) => setReq({ sunAtLanding: v }));
  const darkOn = toggle(T.maxDark, T.maxDarkTip, (v) => setReq({ maxDarknessH: v ? 6 : null }));
  const darkIn = number(0, 2880, (v) => setReq({ maxDarknessH: v }), T.maxDark);
  const minSunIn = number(0, 2880, (v) => setReq({ minContinuousSunH: v }), T.minSun);
  const earthLanding = toggle(T.earthAtLanding, T.earthAtLandingTip, (v) => setReq({ earthAtLanding: v }));
  const blackOn = toggle(T.maxBlackout, T.maxBlackoutTip, (v) => setReq({ maxBlackoutH: v ? 24 : null }));
  const blackIn = number(0, 2880, (v) => setReq({ maxBlackoutH: v }), T.maxBlackout);
  const marginSeg = seg([0, 2, 5].map((v) => ({ label: `${v}°`, value: v })), T.margin, T.marginTip, (v) => setReq({ earthMarginDeg: v }));
  const heightSeg = seg(MAST_HEIGHTS_M.map((m, i) => ({ label: `${m} m`, value: i })), T.height, S.explore.heightTip, (v) => setReq({ mast: v }));
  const customTag = h('span', { class: 'tag', hidden: true }, T.custom);
  const copyBtn = h('button', { class: 'btn', type: 'button' }, T.copy);
  copyBtn.addEventListener('click', () => {
    const done = () => {
      setText(copyBtn, T.copied);
      window.setTimeout(() => setText(copyBtn, T.copy), 1600);
    };
    if (navigator.clipboard) void navigator.clipboard.writeText(store.link()).then(done, done);
    else done();
  });
  const unit = (text: string) => h('span', { class: 'unit' }, text);
  const line = (...nodes: (Node | string)[]) => h('div', { class: 'req-line' }, ...nodes);
  const form = h(
    'aside',
    { class: 'panel reqs', 'aria-label': T.reqTitle },
    h('div', { class: 'reqs-head' }, h('h2', null, T.reqTitle), customTag),
    h('div', { class: 'eyebrow' }, T.profiles),
    h('div', { class: 'profiles' }, ...profileButtons),
    h('p', { class: 'small muted' }, T.profileNote),
    h('div', { class: 'req-group' }, h('div', { class: 'eyebrow' }, T.duration), line(durationIn, unit(T.days))),
    h(
      'div',
      { class: 'req-group' },
      h('div', { class: 'eyebrow' }, h('span', { class: 'dot sun' }), ' ', T.power),
      sunLanding.el,
      darkOn.el,
      line(darkIn, unit(T.hours)),
      h('label', { class: 'req-label', title: T.minSunTip }, T.minSun),
      line(minSunIn, unit(T.hours)),
    ),
    h(
      'div',
      { class: 'req-group' },
      h('div', { class: 'eyebrow' }, h('span', { class: 'dot earth' }), ' ', T.comms),
      earthLanding.el,
      blackOn.el,
      line(blackIn, unit(T.hours)),
      h('span', { class: 'req-label', title: T.marginTip }, T.margin),
      marginSeg,
    ),
    h('div', { class: 'req-group' }, h('div', { class: 'eyebrow' }, T.hardware), h('span', { class: 'req-label', title: S.explore.heightTip }, T.height), heightSeg),
    copyBtn,
  );

  // ---------- planned date and slip
  const dateIn = h('input', { id: 'planned', type: 'date', min: '2024-01-01', max: '2034-12-31' });
  dateIn.addEventListener('change', () => {
    const t = parseUtc(dateIn.value);
    if (Number.isFinite(t)) store.set({ plannedMs: t, detail: null });
  });
  const slipIn = h('input', { id: 'slip', type: 'range', min: '0', max: String(MAX_SLIP), step: '1', title: T.slipTip });
  slipIn.addEventListener('input', () => store.set({ slipDays: Number(slipIn.value) }));
  const slipValue = h('output', { class: 'slip-value', for: 'slip' });
  const slipDate = h('span', { class: 'slip-date' });
  const nudge = (label: string, delta: number, tip: string) =>
    h('button', { class: 'btn icon', type: 'button', title: tip, onclick: () => store.set({ slipDays: Math.max(0, Math.min(MAX_SLIP, store.state.slipDays + delta)) }) }, label);
  const slipBar = h(
    'div',
    { class: 'panel slipbar' },
    h('div', { class: 'field' }, h('label', { for: 'planned' }, T.planned), dateIn),
    h(
      'div',
      { class: 'field grow' },
      h('label', { for: 'slip' }, T.slip),
      h('div', { class: 'slip-row' }, nudge('−1 d', -1, 'One day less'), slipIn, nudge('+1 d', 1, 'One day more'), h('button', { class: 'btn', type: 'button', onclick: () => store.set({ slipDays: 0 }) }, T.reset)),
    ),
    h('div', { class: 'slip-read' }, slipValue, slipDate),
  );
  const summary = h('div', { class: 'summary', 'aria-live': 'polite' });

  // ---------- calendar
  const calCanvas = h('canvas', { class: 'cal-canvas', tabindex: '0', role: 'application', 'aria-label': `${T.calendarTitle}. ${T.calendarHelp}` });
  const tip = h('div', { class: 'readout', hidden: true });
  const stamp = h('span', { class: 'small muted' });
  const legend = h(
    'div',
    { class: 'legend' },
    h('span', null, h('i', { class: 'sw ok' }), `${S.statusMark.ok} ${T.legendOk}`),
    h('span', null, h('i', { class: 'sw warn' }), `${S.statusMark.marginal} ${T.legendMarginal}`),
    h('span', null, h('i', { class: 'sw off' }), `${S.statusMark.fail} ${T.legendFail}`),
    h('span', { class: 'muted' }, T.legendRobust),
  );
  const calPanel = h(
    'section',
    { class: 'panel cal', 'aria-label': T.calendarTitle },
    h('div', { class: 'cap' }, T.calendarTitle, h('span', { class: 'muted small' }, T.calendarHelp)),
    h('div', { class: 'cal-wrap' }, calCanvas, tip),
    h('div', { class: 'cal-foot' }, legend, stamp),
  );
  const rows = (): CalendarRow[] =>
    sites.map((s, i) => ({
      id: s.id,
      label: s.name,
      note: '',
      cal: calOf(s.id),
      heading: i === 0 ? T.headingTerrain : s.horizon === 'sphere' && sites[i - 1].horizon !== 'sphere' ? T.headingSphere : undefined,
    }));

  const whyOf = (cal: SiteCalendar, d: number): string => {
    if (cal.status[d] === 2) return T.table.allMet;
    if (cal.status[d] === 1) return T.table.tight;
    return T.why[REQUIREMENT_ORDER[cal.failed[d] - 1]] ?? '';
  };

  function showTip(cell: { row: number; day: number } | null, x: number, y: number): void {
    const cal = cell ? calOf(sites[cell.row].id) : null;
    if (!cell || !cal) {
      tip.hidden = true;
      return;
    }
    const status = STATUS_CODES[cal.status[cell.day]];
    clear(tip);
    tip.append(h('b', null, sites[cell.row].name), ` · ${fmtDay(startMs() + cell.day * DAY_MS)}`, h('br'), mark(status), ` ${S.status[status]} · ${whyOf(cal, cell.day)}`);
    if (cal.points > 1 && cal.status[cell.day] > 0) tip.append(h('br'), `${T.table.nearby}: ${T.table.of9(cal.robust[cell.day], cal.points)}`);
    tip.style.left = `${Math.max(120, Math.min(calCanvas.clientWidth - 120, x))}px`;
    tip.style.top = `${y}px`;
    tip.hidden = false;
  }
  const openCell = (cell: { row: number; day: number }) => store.set({ detail: { siteId: sites[cell.row].id, dayMs: startMs() + cell.day * DAY_MS } });
  calCanvas.addEventListener('mousemove', (ev) => {
    if (!geo) return;
    const box = calCanvas.getBoundingClientRect();
    cursor = calendarCell(geo, ev.clientX - box.left, ev.clientY - box.top);
    showTip(cursor, ev.clientX - box.left, cursor ? geo.rowTop[cursor.row] : 0);
    calCanvas.style.cursor = cursor ? 'pointer' : 'default';
    draw();
  });
  calCanvas.addEventListener('mouseleave', () => {
    cursor = null;
    tip.hidden = true;
    draw();
  });
  calCanvas.addEventListener('click', (ev) => {
    if (!geo) return;
    const box = calCanvas.getBoundingClientRect();
    const cell = calendarCell(geo, ev.clientX - box.left, ev.clientY - box.top);
    if (cell) openCell(cell);
  });
  calCanvas.addEventListener('keydown', (ev) => {
    if (!geo) return;
    const c = cursor ?? { row: 0, day: slippedDay() };
    const big = ev.shiftKey ? 7 : 1;
    if (ev.key === 'ArrowRight') c.day = Math.min(DAYS - 1, c.day + big);
    else if (ev.key === 'ArrowLeft') c.day = Math.max(0, c.day - big);
    else if (ev.key === 'ArrowDown') c.row = Math.min(sites.length - 1, c.row + 1);
    else if (ev.key === 'ArrowUp') c.row = Math.max(0, c.row - 1);
    else if (ev.key === 'Enter' || ev.key === ' ') {
      openCell(c);
      ev.preventDefault();
      return;
    } else return;
    ev.preventDefault();
    cursor = c;
    showTip(c, geo.left + (c.day + 0.5) * geo.cellW, geo.rowTop[c.row]);
    draw();
  });

  // ---------- table
  const table = h('table', { class: 'sites' });
  const tablePanel = h('section', { class: 'panel', 'aria-label': 'Sites' }, h('div', { class: 'table-wrap' }, table));

  // ---------- detail drawer
  const drawer = h('aside', { class: 'drawer', hidden: true, 'aria-label': T.table.details });
  const drawerBody = h('div', { class: 'drawer-body' });
  const drawerTitle = h('h2');
  const drawerSub = h('p', { class: 'muted' });
  const closeBtn = h('button', { class: 'btn icon', type: 'button', 'aria-label': T.detail.close, title: T.detail.close, onclick: () => store.set({ detail: null }) }, '✕');
  drawer.append(h('div', { class: 'drawer-head' }, h('div', null, drawerTitle, drawerSub), closeBtn), drawerBody);
  const drawerCanvas = h('canvas', { role: 'img', 'aria-label': T.detail.mission });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && store.state.detail && store.state.tab === 'plan') store.set({ detail: null });
  });

  const el = h('div', { class: 'plan' }, form, h('div', { class: 'plan-main' }, slipBar, summary, calPanel, tablePanel), drawer);

  // ---------- rendering
  function syncForm(s: State): void {
    const r = s.req;
    profileButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(s.profileId === PROFILES[i].id)));
    customTag.hidden = s.profileId !== 'custom';
    if (document.activeElement !== durationIn) durationIn.value = String(r.durationDays);
    sunLanding.input.checked = r.sunAtLanding;
    darkOn.input.checked = r.maxDarknessH !== null;
    darkIn.disabled = r.maxDarknessH === null;
    if (document.activeElement !== darkIn) darkIn.value = r.maxDarknessH === null ? '' : String(r.maxDarknessH);
    if (document.activeElement !== minSunIn) minSunIn.value = String(r.minContinuousSunH);
    earthLanding.input.checked = r.earthAtLanding;
    blackOn.input.checked = r.maxBlackoutH !== null;
    blackIn.disabled = r.maxBlackoutH === null;
    if (document.activeElement !== blackIn) blackIn.value = r.maxBlackoutH === null ? '' : String(r.maxBlackoutH);
    marginSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === r.earthMarginDeg)));
    heightSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === r.mast)));
    if (document.activeElement !== dateIn) dateIn.value = isoDate(s.plannedMs);
    slipIn.value = String(s.slipDays);
    slipIn.style.setProperty('--fill', `${(s.slipDays / MAX_SLIP) * 100}%`);
    setText(slipValue, s.slipDays ? T.slipValue(s.slipDays) : T.noSlip);
    setText(slipDate, T.landing(fmtDay(s.plannedMs + s.slipDays * DAY_MS)));
  }

  function renderSummary(): void {
    clear(summary);
    const s = store.state;
    if (!result) {
      summary.append(h('p', { class: 'summary-main muted' }, T.computing));
      return;
    }
    const d0 = LEAD;
    const d1 = slippedDay();
    const ok = (id: string, d: number) => (calOf(id)?.status[d] ?? 0) > 0;
    const before = terrain.filter((t) => ok(t.id, d0));
    const after = terrain.filter((t) => ok(t.id, d1));
    const names = (list: typeof terrain) => (list.length <= 3 ? list.map((t) => t.name).join(', ') : `${list.slice(0, 3).map((t) => t.name).join(', ')} ${T.andMore(list.length - 3)}`);
    if (!s.slipDays) {
      summary.append(h('p', { class: 'summary-main' }, T.summaryOnTime(fmtDay(s.plannedMs), before.length, terrain.length)), h('p', { class: 'muted' }, T.summaryOnTimeHint));
      return;
    }
    const lost = before.filter((t) => !after.includes(t)).length;
    const gained = after.filter((t) => !before.includes(t)).length;
    summary.append(h('p', { class: 'summary-main' }, `${T.summarySlip(s.slipDays, fmtDay(s.plannedMs + s.slipDays * DAY_MS))} ${T.summaryStill(after.length, terrain.length, names(after))}`));
    const more: string[] = [];
    if (lost) more.push(T.summaryLost(lost));
    if (gained) more.push(T.summaryGained(gained));
    if (!after.length) {
      let best: { day: number; name: string } | null = null;
      for (const t of terrain) {
        const cal = calOf(t.id);
        const n = cal ? nextViableDay(cal, d1) : -1;
        if (n >= 0 && (!best || n < best.day)) best = { day: n, name: t.name };
      }
      if (best) more.push(T.summaryNext(fmtDay(startMs() + best.day * DAY_MS), best.name));
    }
    if (more.length) summary.append(h('p', { class: 'muted' }, more.join(' ')));
  }

  function renderTable(): void {
    clear(table);
    const slip = store.state.slipDays > 0;
    const head = h('tr', null, h('th', { scope: 'col' }, T.table.site), h('th', { scope: 'col' }, T.table.planned));
    if (slip) head.append(h('th', { scope: 'col' }, T.table.slipped));
    head.append(h('th', { scope: 'col' }, T.table.why), h('th', { scope: 'col', title: T.table.nearbyTip }, T.table.nearby), h('th', { scope: 'col' }, T.table.next), h('th', { scope: 'col', class: 'num' }, T.table.total));
    table.append(h('thead', null, head));
    const body = h('tbody');
    const d0 = LEAD;
    const d1 = slippedDay();
    for (const site of sites) {
      const cal = calOf(site.id);
      const verdict = (d: number) => {
        if (!cal) return h('td', { class: 'muted' }, '…');
        const st = STATUS_CODES[cal.status[d]];
        return h('td', null, mark(st), ' ', S.status[st]);
      };
      const tr = h('tr', { tabindex: '0', class: store.state.detail?.siteId === site.id ? 'on' : '' });
      const open = () => store.set({ detail: { siteId: site.id, dayMs: startMs() + d1 * DAY_MS } });
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          open();
        }
      });
      tr.append(h('th', { scope: 'row' }, site.name, site.horizon === 'sphere' ? h('span', { class: 'tag sphere' }, S.explore.facts.sphere) : null), verdict(d0));
      if (slip) tr.append(verdict(d1));
      if (cal) {
        const next = cal.status[d1] > 0 ? d1 : nextViableDay(cal, d1);
        const total = Array.from(cal.status).filter((x) => x > 0).length;
        tr.append(
          h('td', null, whyOf(cal, d1)),
          h('td', null, cal.points > 1 ? T.table.of9(cal.robust[d1], cal.points) : '—'),
          h('td', null, next === d1 ? T.table.now : next < 0 ? T.table.none : `${fmtDay(startMs() + next * DAY_MS)} (+${next - d1} d)`),
          h('td', { class: 'num' }, T.daysShort(total)),
        );
      } else tr.append(h('td'), h('td'), h('td'), h('td'));
      body.append(tr);
    }
    table.append(body);
  }

  function draw(): void {
    if (!el.isConnected) return;
    const d = store.state.detail;
    const selected = d ? { row: sites.findIndex((s) => s.id === d.siteId), day: Math.round((d.dayMs - startMs()) / DAY_MS) } : null;
    geo = drawCalendar(calCanvas, {
      startMs: startMs(),
      days: DAYS,
      rows: rows(),
      plannedDay: LEAD,
      slippedDay: slippedDay(),
      cursor,
      selected,
      labels: { planned: T.plannedTag, slipped: T.slippedTag(store.state.slipDays), days: T.daysShort, month: (ms) => `${monthShort(ms)} ${new Date(ms).getUTCFullYear() % 100 < 10 ? '0' : ''}${new Date(ms).getUTCFullYear() % 100}` },
    });
  }

  // ---------- detail
  function requirementRows(r: CellResult, req: Requirements): HTMLElement {
    const D = T.detail;
    const body = h('tbody');
    const row = (key: RequirementKey, label: string, need: string, got: string, pass: boolean) => {
      const tight = r.tight === key;
      body.append(h('tr', { class: pass ? '' : 'failed' }, h('th', { scope: 'row' }, mark(pass ? (tight ? 'marginal' : 'ok') : 'fail'), ' ', label), h('td', null, need), h('td', null, got)));
    };
    const dur = (hours: number) => (hours <= 0 ? D.none : duration(hours));
    if (req.sunAtLanding) row('sunAtLanding', T.sunAtLanding, D.sunAtLandingNeed, D.sunAtLandingGot(pct(r.sunAtLanding)), r.sunAtLanding >= 0.5);
    if (req.earthAtLanding)
      row('earthAtLanding', T.earthAtLanding, D.earthNeed(deg(req.earthMarginDeg, 0)), r.earthClearAtLanding >= 0 ? D.earthGotUp(deg(r.earthClearAtLanding, 1)) : D.earthGotDown(deg(-r.earthClearAtLanding, 1)), r.earthClearAtLanding > req.earthMarginDeg);
    if (req.minContinuousSunH > 0) row('continuousSun', T.minSun, D.atLeast(duration(req.minContinuousSunH)), dur(r.continuousSunH), r.continuousSunH >= req.minContinuousSunH);
    if (req.maxDarknessH !== null) row('maxDarkness', T.maxDark, req.maxDarknessH > 0 ? D.atMost(duration(req.maxDarknessH)) : D.noneAllowed, dur(r.longestDarkH), r.longestDarkH <= req.maxDarknessH);
    if (req.maxBlackoutH !== null) row('maxBlackout', T.maxBlackout, req.maxBlackoutH > 0 ? D.atMost(duration(req.maxBlackoutH)) : D.noneAllowed, dur(r.longestBlackoutH), r.longestBlackoutH <= req.maxBlackoutH);
    return h('table', { class: 'reqtable' }, h('thead', null, h('tr', null, h('th', { scope: 'col' }, D.requirements), h('th', { scope: 'col' }, D.need), h('th', { scope: 'col' }, D.got))), body);
  }

  function ring(mask: number, points: number): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 72 72');
    svg.setAttribute('class', 'ring');
    svg.setAttribute('aria-hidden', 'true');
    const dot = (x: number, y: number, on: boolean, r: number) => {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', String(x));
      c.setAttribute('cy', String(y));
      c.setAttribute('r', String(r));
      c.setAttribute('class', on ? 'on' : 'off');
      svg.append(c);
    };
    const guide = document.createElementNS(ns, 'circle');
    guide.setAttribute('cx', '36');
    guide.setAttribute('cy', '36');
    guide.setAttribute('r', '25');
    guide.setAttribute('class', 'guide');
    svg.append(guide);
    dot(36, 36, (mask & 1) === 1, 6.5);
    for (let i = 1; i < points; i++) {
      const b = ((i - 1) * 45 * Math.PI) / 180;
      dot(36 + 25 * Math.sin(b), 36 - 25 * Math.cos(b), ((mask >> i) & 1) === 1, 4.6);
    }
    return svg;
  }

  function renderDetail(): void {
    const d = store.state.detail;
    drawer.hidden = !d;
    el.classList.toggle('with-drawer', !!d);
    if (!d) return;
    const site = app.siteInfo(d.siteId);
    const dayIdx = Math.round((d.dayMs - startMs()) / DAY_MS);
    setText(drawerTitle, site.name);
    setText(drawerSub, T.detail.landingDay(fmtDay(d.dayMs)));
    const cal = calOf(d.siteId);
    if (!result || !cal || dayIdx < 0 || dayIdx >= DAYS) {
      clear(drawerBody);
      drawerBody.append(h('p', { class: 'muted' }, T.computing));
      return;
    }
    const req = store.state.req;
    const k = `${key}|${d.siteId}|${dayIdx}`;
    if (k !== winKey) {
      winKey = k;
      win = null;
      timeIdx = cal.bestTime[dayIdx];
      const steps = durationSteps(req) + 3 * DAY_STEPS;
      void planner.window(d.siteId, Math.max(0, (dayIdx - 1) * DAY_STEPS), steps, dayIdx).then((res) => {
        if (winKey !== k) return;
        win = res;
        renderDetail();
      });
    }
    clear(drawerBody);
    if (!win || !win.detail) {
      drawerBody.append(h('div', { class: 'loading' }, h('div', { class: 'spinner' })));
      return;
    }
    const D = T.detail;
    const detail = win.detail;
    const r = detail.times[timeIdx];
    const landingMs = d.dayMs + LANDING_STEPS[timeIdx] * STEP_MS;

    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': D.times });
    detail.times.forEach((t, i) => {
      chips.append(
        h('button', { class: 'chip', type: 'button', 'aria-pressed': String(i === timeIdx), onclick: () => ((timeIdx = i), renderDetail()) }, mark(t.status), ` ${String((LANDING_STEPS[i] * STEP_MS) / HOUR_MS).padStart(2, '0')}:00`),
      );
    });

    const verdict = h('div', { class: `verdict-box ${r.status}` }, mark(r.status), ' ', r.status === 'ok' ? D.verdictOk : r.status === 'marginal' ? D.verdictMarginal : `${D.verdictFail} ${T.why[r.failed ?? ''] ?? ''}.`);

    const robust = detail.robust[timeIdx];
    const robustBox =
      cal.points > 1
        ? h(
            'div',
            { class: 'robust' },
            ring(detail.robustMask[timeIdx], cal.points),
            h('div', null, h('b', null, D.robust(robust, cal.points, String(app.list.ring.radiusM))), h('p', { class: 'small muted' }, robust > 0 && robust < 5 ? D.robustLow : D.robustNote)),
          )
        : h('p', { class: 'small muted' }, D.sphere);

    const metric = (label: string, value: string, tipText?: string) => h('div', { class: 'metric', title: tipText ?? '' }, h('span', null, label), h('b', null, value));
    const metrics = h('div', { class: 'metrics' }, metric(D.sunShare, pct(r.sunShare)), metric(D.earthShare, pct(r.earthShare)), metric(D.bothShare, pct(r.bothShare)), metric(D.power, r.powerIndex.toFixed(2), D.powerTip));

    const actions = h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => store.set({ tab: 'explore', siteId: d.siteId, timeMs: landingMs }) }, D.openExplore),
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: (ev: Event) => {
            const list = store.state.compare;
            const btn = ev.currentTarget as HTMLElement;
            if (list.length >= 4) return setText(btn, D.compareFull);
            if (!list.some((c) => c.siteId === d.siteId && c.dayMs === d.dayMs)) store.set({ compare: [...list, { siteId: d.siteId, dayMs: d.dayMs }] });
            setText(btn, D.added);
          },
        },
        D.addCompare,
      ),
    );

    drawerBody.append(
      h('div', { class: 'eyebrow' }, D.times),
      chips,
      verdict,
      robustBox,
      requirementRows(r, req),
      h('div', { class: 'eyebrow' }, `${D.mission} · ${dayTime(landingMs)}`),
      drawerCanvas,
      h('div', { class: 'eyebrow' }, D.numbers),
      metrics,
      actions,
    );
    drawTimeline(drawerCanvas, {
      startMs: win.startMs,
      stepMs: win.stepMs,
      sunFrac: win.sunFrac,
      earthClear: win.earthClear,
      earthMarginDeg: req.earthMarginDeg,
      cursorMs: landingMs,
      span: { fromMs: landingMs, toMs: landingMs + req.durationDays * DAY_MS },
      events: win.events,
      labels: { sun: S.sun, earth: S.earth, both: S.both },
      formatDay: (ms) => `${new Date(ms).getUTCDate()} ${monthShort(ms)}`,
    });
  }

  function renderAll(): void {
    renderSummary();
    renderTable();
    draw();
    renderDetail();
    if (result) setText(stamp, T.computed((result.elapsedMs / 1000).toFixed(1), sites.length, sites.reduce((n, s) => n + ((calOf(s.id)?.points ?? 1) - 1), 0)));
  }

  function ensure(): void {
    const s = store.state;
    const k = `${s.plannedMs}|${JSON.stringify(s.req)}`;
    if (k === key) return;
    key = k;
    // A calendar computed for another start date cannot be shown against the new dates.
    if (result && result.startMs !== s.plannedMs - LEAD * DAY_MS) result = null;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void planner.compute(s.plannedMs - LEAD * DAY_MS, DAYS, s.req).then((res) => {
        if (key !== k) return;
        result = res;
        renderAll();
      });
    }, 40);
  }

  onResize(el, () => {
    draw();
    if (store.state.detail && win) renderDetail();
  });

  return {
    el,
    update(state, changed) {
      syncForm(state);
      ensure();
      if (!changed || changed.has('slipDays') || changed.has('tab')) renderAll();
      else if (changed.has('detail')) {
        renderTable();
        draw();
        renderDetail();
      } else if (changed.has('req') || changed.has('plannedMs')) {
        renderSummary();
        draw();
      }
    },
  };
}
