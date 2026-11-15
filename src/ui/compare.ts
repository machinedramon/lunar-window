// Compare: up to four landing options side by side, under the same mission requirements.
import { LANDING_STEPS } from '../core/calendar';
import { durationSteps, PROFILES, STATUS_RANK, type CellResult } from '../core/requirements';
import { DAY_STEPS, STEP_MS } from '../core/series';
import { S } from '../i18n/en';
import { onResize } from '../viz/canvas';
import { drawTimeline } from '../viz/timeline';
import type { WindowResult } from '../worker/protocol';
import type { App, View } from './app';
import { clear, h } from './dom';
import { DAY_MS, HOUR_MS, day as fmtDay, deg, duration, isoDate, monthShort, parseUtc, pct } from './format';
import type { Planner } from './planner';
import { CUSTOM_SITE, type CompareItem, type State } from './store';

const T = S.compare;
const DAYS = 365;
const LEAD = 7;

interface Column {
  item: CompareItem;
  win: WindowResult | null;
  /** Index of the best landing time of the day. */
  time: number;
  result: CellResult | null;
  robust: number;
  points: number;
}

const mark = (status: string) => h('span', { class: `mark ${status === 'ok' ? 'ok' : status === 'marginal' ? 'warn' : 'bad'}`, 'aria-hidden': 'true' }, S.statusMark[status]);

export function createCompare(app: App, planner: Planner): View {
  const { store } = app;
  const el = h('div', { class: 'doc wide compare-page' });
  const body = h('div');
  let key = '';
  let columns: Column[] = [];
  let canvases: HTMLCanvasElement[] = [];

  const siteSelect = h('select', { 'aria-label': S.explore.site });
  for (const s of app.sites) siteSelect.append(h('option', { value: s.id }, s.name));
  const dateIn = h('input', { type: 'date', 'aria-label': S.plan.planned });
  const addBtn = h('button', { class: 'btn primary', type: 'button' }, T.add);
  addBtn.addEventListener('click', () => {
    const t = parseUtc(dateIn.value);
    if (!Number.isFinite(t)) return;
    const list = items(store.state).filter((c) => !(c.siteId === siteSelect.value && c.dayMs === t));
    store.set({ compare: [...list, { siteId: siteSelect.value, dayMs: t }].slice(-4) });
  });
  const reqLine = h('p', { class: 'small muted' });
  const example = h('p', { class: 'small muted' });

  /** The visitor's own list, or an example so that the page is never empty. */
  function items(s: State): CompareItem[] {
    if (s.compare.length) return s.compare;
    const slipped = s.plannedMs + (s.slipDays || 21) * DAY_MS;
    // A custom point is not in the planner (it has no terrain): fall back to a curated site.
    const own = s.siteId === CUSTOM_SITE ? 'malapert' : s.siteId;
    return [
      { siteId: own, dayMs: s.plannedMs },
      { siteId: own, dayMs: slipped },
      { siteId: 'cr1', dayMs: slipped },
    ].filter((c, i, all) => all.findIndex((o) => o.siteId === c.siteId && o.dayMs === c.dayMs) === i);
  }

  function load(s: State): void {
    const list = items(s);
    const k = `${s.plannedMs}|${JSON.stringify(s.req)}|${list.map((c) => `${c.siteId}@${c.dayMs}`).join(',')}`;
    if (k === key) return;
    key = k;
    const startMs = s.plannedMs - LEAD * DAY_MS;
    columns = list.map((item) => ({ item, win: null, time: 0, result: null, robust: 0, points: 1 }));
    render();
    list.forEach((item, i) => {
      const dayIdx = Math.round((item.dayMs - startMs) / DAY_MS);
      if (dayIdx < 0 || dayIdx >= DAYS) return;
      void planner.window(startMs, DAYS, s.req, item.siteId, Math.max(0, (dayIdx - 1) * DAY_STEPS), durationSteps(s.req) + 3 * DAY_STEPS, dayIdx).then((win) => {
        if (key !== k || !win.detail) return;
        const col = columns[i];
        col.win = win;
        let best = 0;
        win.detail.times.forEach((t, j) => {
          if (STATUS_RANK[t.status] > STATUS_RANK[win.detail!.times[best].status]) best = j;
        });
        col.time = best;
        col.result = win.detail.times[best];
        col.robust = win.detail.robust[best];
        col.points = app.peek(item.siteId)?.ring ? 9 : 1;
        render();
      });
    });
  }

  function render(): void {
    const s = store.state;
    const profile = PROFILES.find((p) => p.id === s.profileId);
    reqLine.textContent = T.under(profile ? profile.label : S.plan.custom, s.req.durationDays);
    example.hidden = s.compare.length > 0;
    clear(body);
    canvases = [];
    if (!columns.length) return;

    const table = h('table', { class: 'compare' });
    // Each option opens with its verdict: the answer first, the figures after.
    const head = h('tr', null, h('td'));
    for (const c of columns) {
      const site = app.siteInfo(c.item.siteId);
      const r = c.result;
      const why = !r ? '' : r.status === 'fail' ? S.plan.why[r.failed ?? ''] : r.status === 'marginal' ? S.plan.table.tight : S.plan.table.allMet;
      head.append(
        h(
          'th',
          { scope: 'col', class: r ? `cmp-head ${r.status}` : 'cmp-head' },
          h('div', { class: 'cmp-date' }, fmtDay(c.item.dayMs), site.horizon === 'sphere' ? h('span', { class: 'tag sphere' }, S.explore.facts.sphere) : null),
          h('div', { class: 'cmp-site' }, site.name),
          h('div', { class: 'cmp-verdict' }, r ? mark(r.status) : null, r ? h('b', null, S.status[r.status]) : '…', h('span', null, why)),
        ),
      );
    }
    table.append(h('thead', null, head));
    const tb = h('tbody');

    // The picture of each option, straight under its verdict: Sun, Earth and both, over the mission.
    const lineRow = h('tr', { class: 'cmp-line-row' }, h('th', { scope: 'row' }, T.rows.timeline));
    for (const c of columns) {
      const canvas = h('canvas', { role: 'img', 'aria-label': S.plan.detail.mission });
      canvases.push(canvas);
      lineRow.append(h('td', { class: 'cmp-line' }, c.win ? canvas : '…'));
    }
    tb.append(lineRow);

    type Pick = (c: Column) => { node: Node | string; value?: number } | null;
    const group = (label: string) => tb.append(h('tr', { class: 'cmp-group' }, h('th', { scope: 'rowgroup', colspan: columns.length + 1 }, label)));
    const row = (label: string, tip: string, pick: Pick, better: 'high' | 'low' | null = null) => {
      const cells = columns.map((c) => (c.result ? pick(c) : null));
      const nums = cells.map((x) => x?.value).filter((v): v is number => v !== undefined);
      const best = better && nums.length > 1 && Math.max(...nums) !== Math.min(...nums) ? (better === 'high' ? Math.max(...nums) : Math.min(...nums)) : null;
      const tr = h('tr', null, h('th', { scope: 'row', title: tip }, label));
      for (const x of cells) tr.append(h('td', { class: x && best !== null && x.value === best ? 'best' : '' }, x ? x.node : '…'));
      tb.append(tr);
    };
    // A figure with its measure: the number, and a bar that shows how much of the whole it is.
    const meter = (text: string, share: number, kind = '') =>
      h('span', { class: 'cmp-meter' }, h('span', { class: 'cmp-num' }, text), h('span', { class: `cmp-bar ${kind}`, 'aria-hidden': 'true' }, h('i', { style: `width:${(Math.max(0, Math.min(1, share)) * 100).toFixed(1)}%` })));
    const pips = (n: number, total: number) =>
      h('span', { class: 'cmp-meter' }, h('span', { class: 'cmp-num' }, S.plan.table.of9(n, total)), h('span', { class: 'cmp-pips', 'aria-hidden': 'true' }, ...Array.from({ length: total }, (_, k) => h('i', { class: k < n ? 'on' : '' }))));
    const missionH = s.req.durationDays * 24;

    group(T.groups.landing);
    row(T.rows.time, T.tips.time, (c) => ({ node: `${String((LANDING_STEPS[c.time] * STEP_MS) / HOUR_MS).padStart(2, '0')}:00 UTC` }));
    row(T.rows.sunLanding, S.plan.sunAtLandingTip, (c) => ({ node: meter(pct(c.result!.sunAtLanding), c.result!.sunAtLanding), value: c.result!.sunAtLanding }), 'high');
    row(T.rows.earthLanding, S.plan.earthAtLandingTip, (c) => ({ node: meter(deg(c.result!.earthClearAtLanding, 1), c.result!.earthClearAtLanding / 12, 'earth'), value: c.result!.earthClearAtLanding }), 'high');
    group(T.groups.mission);
    row(T.rows.sunShare, '', (c) => ({ node: meter(pct(c.result!.sunShare), c.result!.sunShare), value: c.result!.sunShare }), 'high');
    row(T.rows.earthShare, '', (c) => ({ node: meter(pct(c.result!.earthShare), c.result!.earthShare, 'earth'), value: c.result!.earthShare }), 'high');
    row(T.rows.bothShare, '', (c) => ({ node: meter(pct(c.result!.bothShare), c.result!.bothShare, 'both'), value: c.result!.bothShare }), 'high');
    row(T.rows.contSun, S.plan.minSunTip, (c) => ({ node: meter(duration(c.result!.continuousSunH), c.result!.continuousSunH / missionH), value: c.result!.continuousSunH }), 'high');
    row(T.rows.dark, S.plan.maxDarkTip, (c) => ({ node: meter(c.result!.longestDarkH ? duration(c.result!.longestDarkH) : S.plan.detail.none, c.result!.longestDarkH / missionH, 'loss'), value: c.result!.longestDarkH }), 'low');
    row(T.rows.blackout, S.plan.maxBlackoutTip, (c) => ({ node: meter(c.result!.longestBlackoutH ? duration(c.result!.longestBlackoutH) : S.plan.detail.none, c.result!.longestBlackoutH / missionH, 'loss'), value: c.result!.longestBlackoutH }), 'low');
    row(T.rows.power, S.plan.detail.powerTip, (c) => ({ node: meter(c.result!.powerIndex.toFixed(2), c.result!.powerIndex), value: c.result!.powerIndex }), 'high');
    group(T.groups.miss);
    row(T.rows.robust, S.plan.table.nearbyTip, (c) => (c.points > 1 ? { node: pips(c.robust, c.points), value: c.robust } : { node: '—' }), 'high');

    const actions = h('tr', { class: 'cmp-actions' }, h('td'));
    for (const c of columns) {
      const landing = c.item.dayMs + LANDING_STEPS[c.time] * STEP_MS;
      actions.append(
        h(
          'td',
          null,
          h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn', type: 'button', onclick: () => store.set({ tab: 'explore', siteId: c.item.siteId, timeMs: landing }) }, T.see),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => store.set({ compare: items(store.state).filter((o) => o !== c.item) }) }, T.remove),
          ),
        ),
      );
    }
    tb.append(actions);
    table.append(tb);
    body.append(h('div', { class: 'table-wrap' }, table));
    draw();
    fit();
  }

  /** The table fills its panel: the height that is left over is shared among the rows of figures. */
  function fit(): void {
    const table = body.querySelector<HTMLTableElement>('table.compare');
    const wrap = table?.parentElement;
    if (!table || !wrap) return;
    table.style.setProperty('--row', '27px');
    const rows = table.querySelectorAll('tbody tr:not(.cmp-line-row):not(.cmp-actions)').length;
    const spare = wrap.clientHeight - table.offsetHeight;
    if (spare > 1 && rows) table.style.setProperty('--row', `${Math.min(58, 27 + spare / rows).toFixed(2)}px`);
  }

  function draw(): void {
    const s = store.state;
    columns.forEach((c, i) => {
      const canvas = canvases[i];
      if (!c.win || !canvas || !canvas.isConnected) return;
      const landing = c.item.dayMs + LANDING_STEPS[c.time] * STEP_MS;
      drawTimeline(canvas, {
        startMs: c.win.startMs,
        stepMs: c.win.stepMs,
        sunFrac: c.win.sunFrac,
        earthClear: c.win.earthClear,
        earthMarginDeg: s.req.earthMarginDeg,
        cursorMs: landing,
        span: { fromMs: landing, toMs: landing + s.req.durationDays * DAY_MS },
        events: c.win.events,
        labels: { sun: S.sun, earth: S.earth, both: S.both },
        formatDay: (ms) => `${new Date(ms).getUTCDate()} ${monthShort(ms)}`,
      });
    });
  }

  el.append(
    h('header', { class: 'doc-head' }, h('p', { class: 'eyebrow' }, T.eyebrow), h('h1', null, T.title), h('p', { class: 'lead' }, T.lead)),
    h(
      'section',
      { class: 'panel cmp-panel' },
      h(
        'div',
        { class: 'cmp-tools' },
        h('div', { class: 'field' }, h('span', null, S.explore.site), siteSelect),
        h('div', { class: 'field' }, h('span', null, T.date), dateIn),
        addBtn,
        h('div', { class: 'cmp-notes' }, reqLine, example),
        h('button', { class: 'btn', type: 'button', onclick: () => store.set({ tab: 'plan' }) }, T.edit),
      ),
      body,
    ),
  );
  example.textContent = T.example;
  onResize(el, () => {
    draw();
    fit();
  });

  return {
    el,
    update(state) {
      if (!dateIn.value) dateIn.value = isoDate(state.plannedMs + state.slipDays * DAY_MS);
      if (!siteSelect.dataset.set) {
        siteSelect.value = state.siteId === CUSTOM_SITE ? 'malapert' : state.siteId;
        siteSelect.dataset.set = '1';
      }
      load(state);
    },
  };
}
