// Missions: the planner as a game. Each mission is a real planning problem solved with the same
// engine and data; the score comes only from real quantities (how many nearby points still work,
// how many more days of delay the plan absorbs, how soon it lands).
import { REQUIREMENT_ORDER } from '../core/requirements';
import { PROFILES, type Requirements } from '../core/requirements';
import { STATUS_CODES, type SiteCalendar } from '../core/calendar';
import { S } from '../i18n/en';
import { calendarCell, drawCalendar, type CalendarGeometry, type CalendarRow } from '../viz/calendar';
import { COLORS, FONT, onResize, surface } from '../viz/canvas';
import type { ComputeResult } from '../worker/protocol';
import type { App, View } from './app';
import { clear, h, reducedMotion } from './dom';
import { DAY_MS, day as fmtDay, monthShort } from './format';
import type { Planner } from './planner';
import { linkTone, sunTone, tick } from './sound';

const T = S.missions;

interface Mission {
  id: string;
  req: Requirements;
  profileId: string;
  /** 00:00 UTC of the first day on the board. */
  startMs: number;
  days: number;
  /** Planned landing, as a day of the board and a site, when the mission starts from a plan. */
  planned: { day: number; siteId: string } | null;
  slip: number;
  /** Days of the board that may be chosen. */
  from: number;
  to: number;
}

const MISSIONS: Mission[] = [
  { id: 'slip', req: PROFILES[0].req, profileId: 'short', startMs: Date.UTC(2027, 0, 10), days: 100, planned: { day: 7, siteId: 'malapert' }, slip: 21, from: 28, to: 88 },
  { id: 'lunar-day', req: PROFILES[1].req, profileId: 'lunar-day', startMs: Date.UTC(2027, 7, 1), days: 92, planned: null, slip: 0, from: 0, to: 91 },
  { id: 'rover', req: PROFILES[2].req, profileId: 'rover', startMs: Date.UTC(2027, 6, 1), days: 110, planned: null, slip: 0, from: 0, to: 109 },
];

interface Pick {
  row: number;
  day: number;
}
interface Score {
  total: number;
  robust: number;
  tolerance: number;
  prompt: number;
  margin: number;
  /** Further days of delay the plan absorbs. */
  spareDays: number;
  robustCount: number;
  points: number;
}

const STORE = 'lunar-window-missions';
function stars(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

export function createMissions(app: App, planner: Planner): View {
  const { store } = app;
  const terrain = app.sites.filter((s) => s.horizon !== 'sphere');
  const el = h('div', { class: 'doc wide missions' });
  let mission: Mission | null = null;
  let step = 0;
  let result: ComputeResult | null = null;
  let pick: Pick | null = null;
  let cursor: Pick | null = null;
  let geo: CalendarGeometry | null = null;
  let slipShown = 0;
  let canvas: HTMLCanvasElement | null = null;

  /** The computed board of each mission: drawn on its card, and ready when the mission starts. */
  const boards = new Map<string, ComputeResult>();
  const board = (m: Mission): Promise<ComputeResult> => {
    const have = boards.get(m.id);
    if (have) return Promise.resolve(have);
    return planner.compute(m.startMs, m.days, m.req).then((res) => {
      boards.set(m.id, res);
      return res;
    });
  };

  /** The mission's real calendar in small: one row per site, one column per day, white where a landing works. */
  function drawBoard(cv: HTMLCanvasElement, m: Mission, res: ComputeResult | null): void {
    if (!cv.isConnected) return;
    // The board takes the room the card has left, within reason.
    const room = cv.parentElement ? cv.parentElement.clientHeight - 22 : 136;
    const { ctx, w, h: height } = surface(cv, Math.max(118, Math.min(250, room)));
    ctx.clearRect(0, 0, w, height);
    const AXIS = 18;
    const GAP = 3;
    const rowH = (height - AXIS - GAP * (terrain.length - 1)) / terrain.length;
    const cellW = w / m.days;
    // whole pixels, so that neighbouring days never leave a seam
    const xOf = (d: number) => Math.round(d * cellW);
    terrain.forEach((site, i) => {
      const top = i * (rowH + GAP);
      ctx.fillStyle = '#131315';
      ctx.fillRect(0, top, w, rowH);
      const cal = res?.calendars.find((c) => c.siteId === site.id)?.cal;
      if (!cal) return;
      for (let d = 0; d < m.days; d++) {
        const st = cal.status[d];
        if (!st) continue;
        const share = cal.points > 1 ? cal.robust[d] / cal.points : 1;
        ctx.fillStyle = `rgba(255,255,255,${(0.34 + 0.66 * share).toFixed(3)})`;
        // as on the planner's calendar: a marginal day is a short bar
        if (st === 2) ctx.fillRect(xOf(d), top, xOf(d + 1) - xOf(d), rowH);
        else ctx.fillRect(xOf(d), top + rowH * 0.55, xOf(d + 1) - xOf(d), rowH * 0.45);
      }
    });
    const bottom = height - AXIS;
    // days that may not be chosen step back
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    if (m.from > 0) ctx.fillRect(0, 0, m.from * cellW, bottom);
    if (m.to < m.days - 1) ctx.fillRect((m.to + 1) * cellW, 0, w - (m.to + 1) * cellW, bottom);
    // the planned landing, and where the slip moves it
    if (m.planned) {
      const line = (day: number, color: string, dash: number[]) => {
        const x = Math.round((day + 0.5) * cellW) + 0.5;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
      };
      line(m.planned.day, 'rgba(255,255,255,0.85)', [3, 3]);
      line(m.planned.day + m.slip, COLORS.earth, []);
    }
    // months
    ctx.font = `400 9.5px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    for (let d = 0; d < m.days; d++) {
      const date = new Date(m.startMs + d * DAY_MS);
      if (date.getUTCDate() !== 1 && d !== 0) continue;
      const x = Math.round(d * cellW) + 0.5;
      if (d > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.beginPath();
        ctx.moveTo(x, bottom + 2);
        ctx.lineTo(x, bottom + 7);
        ctx.stroke();
      }
      // the first label is skipped when the next month starts too close to it
      const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
      if (d === 0 && ((next.getTime() - m.startMs) / DAY_MS) * cellW < 46) continue;
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(monthShort(m.startMs + d * DAY_MS).toUpperCase(), x + (d > 0 ? 4 : 0), height - 3);
    }
  }

  const calOf = (id: string): SiteCalendar | null => result?.calendars.find((c) => c.siteId === id)?.cal ?? null;
  const rowOf = (id: string) => terrain.findIndex((s) => s.id === id);

  function score(m: Mission, p: Pick): Score | null {
    const cal = calOf(terrain[p.row].id);
    if (!cal || cal.status[p.day] === 0) return null;
    let spare = 0;
    while (p.day + spare + 1 < m.days && cal.status[p.day + spare + 1] > 0) spare++;
    const robust = (40 * cal.robust[p.day]) / cal.points;
    const tolerance = 30 * Math.min(1, spare / 6);
    const prompt = 20 * (1 - (p.day - m.from) / Math.max(1, m.to - m.from));
    const margin = cal.status[p.day] === 2 ? 10 : 4;
    return { total: Math.round(robust + tolerance + prompt + margin), robust, tolerance, prompt, margin, spareDays: spare, robustCount: cal.robust[p.day], points: cal.points };
  }

  function best(m: Mission): { pick: Pick; score: Score } | null {
    let top: { pick: Pick; score: Score } | null = null;
    terrain.forEach((_, row) => {
      for (let day = m.from; day <= m.to; day++) {
        const s = score(m, { row, day });
        if (s && (!top || s.total > top.score.total)) top = { pick: { row, day }, score: s };
      }
    });
    return top;
  }

  // ---------- hub
  function hub(): void {
    mission = null;
    clear(el);
    const earned = stars();
    const cards = MISSIONS.map((m, i) => {
      const t = T.list[m.id];
      const got = earned[m.id] ?? 0;
      const cv = h('canvas', { role: 'img', 'aria-label': T.boardAria(t.title) });
      const paintBoard = () => drawBoard(cv, m, boards.get(m.id) ?? null);
      void board(m).then(paintBoard);
      onResize(cv, paintBoard);
      const spec = (label: string, text: string) => h('span', { class: 'mission-spec-row' }, h('b', null, label), h('span', null, text));
      return h(
        'button',
        { class: 'mission-card', type: 'button', onclick: () => begin(m) },
        h('span', { class: 'mission-top' }, h('span', { class: 'mission-n' }, String(i + 1).padStart(2, '0')), h('span', { class: 'mission-stars', 'aria-label': T.starsLabel(got) }, '★'.repeat(got) + '☆'.repeat(3 - got))),
        h('span', { class: 'mission-title' }, t.title),
        h('span', { class: 'mission-tag' }, t.tagline),
        h('span', { class: 'mission-board' }, h('span', { class: 'mission-board-cap' }, T.boardCap(terrain.length, m.days, fmtDay(m.startMs))), cv),
        h('span', { class: 'mission-spec' }, spec(T.spec.mission, t.meta), spec(T.spec.needs, t.needs), spec(T.spec.choose, T.choose(fmtDay(m.startMs + m.from * DAY_MS).replace(/ \d{4}$/, ''), fmtDay(m.startMs + m.to * DAY_MS)))),
        h('span', { class: 'mission-go', 'aria-hidden': 'true' }, T.go, ' →'),
      );
    });
    el.append(
      h('header', { class: 'doc-head' }, h('p', { class: 'eyebrow' }, T.eyebrow), h('h1', null, T.title), h('p', { class: 'lead' }, T.lead)),
      h('div', { class: 'mission-grid' }, ...cards),
      h('p', { class: 'small muted mission-foot' }, h('span', null, T.scoring), h('span', null, T.honest)),
    );
  }

  // ---------- one mission
  function begin(m: Mission): void {
    mission = m;
    step = 0;
    pick = null;
    cursor = null;
    result = boards.get(m.id) ?? null;
    slipShown = 0;
    tick();
    paint();
    if (!result)
      void board(m).then((res) => {
        if (mission !== m) return;
        result = res;
        paint();
      });
  }

  function rows(): CalendarRow[] {
    return terrain.map((s, i) => ({ id: s.id, label: s.name, note: '', cal: calOf(s.id), heading: i === 0 ? S.plan.headingTerrain : undefined }));
  }

  function draw(): void {
    if (!mission || !canvas || !canvas.isConnected) return;
    const m = mission;
    const planned = m.planned ? m.planned.day : -1;
    geo = drawCalendar(canvas, {
      startMs: m.startMs,
      days: m.days,
      rows: rows(),
      plannedDay: planned,
      slippedDay: m.planned ? planned + Math.round(slipShown) : -1,
      cursor: step >= 2 ? cursor : null,
      selected: pick,
      allowed: step >= 2 ? { from: m.from, to: m.to } : undefined,
      labels: { planned: S.plan.plannedTag, slipped: S.plan.slippedTag(Math.round(slipShown)), days: S.plan.daysShort, month: (ms) => `${monthShort(ms)} ${String(new Date(ms).getUTCFullYear()).slice(2)}` },
    });
  }

  function verdictLine(siteId: string, day: number): HTMLElement {
    const cal = calOf(siteId);
    const site = app.siteInfo(siteId);
    if (!cal) return h('p', { class: 'muted' }, S.plan.computing);
    const st = STATUS_CODES[cal.status[day]];
    const why = st === 'fail' ? S.plan.why[REQUIREMENT_ORDER[cal.failed[day] - 1]] : st === 'marginal' ? S.plan.table.tight : S.plan.table.allMet;
    return h(
      'div',
      { class: `verdict-box ${st}` },
      h('span', { class: `mark ${st === 'ok' ? 'ok' : st === 'marginal' ? 'warn' : 'bad'}`, 'aria-hidden': 'true' }, S.statusMark[st]),
      ` ${site.name}, ${fmtDay(mission!.startMs + day * DAY_MS)}: ${S.status[st]}. ${why}.`,
      st !== 'fail' && cal.points > 1 ? h('span', { class: 'muted' }, ` ${S.plan.table.nearby}: ${S.plan.table.of9(cal.robust[day], cal.points)}.`) : null,
    );
  }

  function paint(): void {
    if (!mission) return;
    const m = mission;
    const t = T.list[m.id];
    clear(el);
    canvas = h('canvas', { class: 'cal-canvas', tabindex: '0', role: 'application', 'aria-label': S.plan.calendarTitle });
    const side = h('div', { class: 'mission-side' });
    const dots = h('div', { class: 'mission-dots', 'aria-hidden': 'true' });
    const total = m.planned ? 4 : 3;
    const at = m.planned ? step : step === 0 ? 0 : step - 1;
    for (let i = 0; i < total; i++) dots.append(h('i', { class: i === at ? 'on' : i < at ? 'done' : '' }));
    side.append(h('p', { class: 'eyebrow' }, T.missionN(MISSIONS.indexOf(m) + 1)), h('h1', { class: 'mission-h' }, t.title), dots);

    const next = (label: string, fn: () => void, primary = true) => h('button', { class: `btn ${primary ? 'primary' : ''}`, type: 'button', onclick: fn }, label);
    const para = (text: string) => h('p', { class: 'mission-text' }, text);

    if (step === 0) {
      for (const line of t.brief) side.append(para(line));
      if (m.planned && result) side.append(verdictLine(m.planned.siteId, m.planned.day));
      side.append(
        h(
          'div',
          { class: 'row' },
          next(m.planned ? T.continue : T.start, () => {
            step = m.planned ? 1 : 2;
            if (step === 1) animateSlip();
            tick();
            paint();
          }),
          next(T.back, hub, false),
        ),
      );
    } else if (step === 1 && m.planned) {
      side.append(h('p', { class: 'mission-alert' }, t.twist ?? ''));
      if (result) side.append(verdictLine(m.planned.siteId, m.planned.day + m.slip));
      side.append(para(t.after ?? ''));
      side.append(h('div', { class: 'row' }, next(T.find, () => ((step = 2), tick(), paint()))));
    } else if (step === 2) {
      side.append(para(t.ask), h('p', { class: 'small muted' }, T.howTo));
      if (pick) {
        side.append(verdictLine(terrain[pick.row].id, pick.day));
        const ok = score(m, pick) !== null;
        side.append(h('div', { class: 'row' }, ok ? next(T.commit, () => ((step = 3), sunTone(true), paint())) : h('span', { class: 'small muted' }, T.pickViable)));
      }
      side.append(h('div', { class: 'row' }, next(T.back, hub, false)));
    } else if (step === 3 && pick) {
      const sc = score(m, pick)!;
      const top = best(m);
      const ratio = top ? sc.total / Math.max(1, top.score.total) : 1;
      const got = ratio >= 0.92 ? 3 : ratio >= 0.7 ? 2 : 1;
      const earned = stars();
      if ((earned[m.id] ?? 0) < got) {
        earned[m.id] = got;
        try {
          localStorage.setItem(STORE, JSON.stringify(earned));
        } catch {
          /* not kept in private mode */
        }
      }
      const site = terrain[pick.row];
      const dayMs = m.startMs + pick.day * DAY_MS;
      const bar = (label: string, value: number, max: number, note: string) =>
        h('div', { class: 'score-row' }, h('span', null, label), h('div', { class: 'score-bar' }, h('i', { style: `width:${Math.round((value / max) * 100)}%` })), h('b', null, `${Math.round(value)}/${max}`), h('span', { class: 'small muted' }, note));
      side.append(
        h('div', { class: 'score' }, h('div', { class: 'score-n' }, String(sc.total)), h('div', null, h('div', { class: 'score-stars' }, '★'.repeat(got) + '☆'.repeat(3 - got)), h('div', { class: 'small muted' }, T.outOf))),
        para(T.debrief(site.name, fmtDay(dayMs))),
        bar(T.parts.robust, sc.robust, 40, T.notes.robust(sc.robustCount, sc.points)),
        bar(T.parts.tolerance, sc.tolerance, 30, T.notes.tolerance(sc.spareDays)),
        bar(T.parts.prompt, sc.prompt, 20, T.notes.prompt(pick.day - m.from)),
        bar(T.parts.margin, sc.margin, 10, sc.margin >= 10 ? T.notes.marginOk : T.notes.marginTight),
      );
      if (top) side.append(h('p', { class: 'small muted' }, top.score.total > sc.total ? T.bestWas(top.score.total, terrain[top.pick.row].name, fmtDay(m.startMs + top.pick.day * DAY_MS)) : T.bestYou));
      side.append(para(t.lesson));
      side.append(
        h(
          'div',
          { class: 'row' },
          next(T.see3d, () => store.set({ tab: 'explore', siteId: site.id, timeMs: dayMs, hero: '3d' })),
          next(T.openPlanner, () => store.set({ tab: 'plan', req: { ...m.req }, profileId: m.profileId, plannedMs: m.planned ? m.startMs + m.planned.day * DAY_MS : dayMs, slipDays: m.planned ? pick!.day - m.planned.day : 0, detail: { siteId: site.id, dayMs } }), false),
          next(T.again, () => begin(m), false),
          next(T.others, hub, false),
        ),
      );
    }

    const board = h(
      'section',
      { class: 'panel cal', 'aria-label': S.plan.calendarTitle },
      h('div', { class: 'cap' }, T.board(PROFILES.find((p) => p.id === m.profileId)!.label), h('span', { class: 'muted small' }, PROFILES.find((p) => p.id === m.profileId)!.blurb)),
      h('div', { class: 'cal-wrap' }, canvas),
      h('div', { class: 'cal-foot' }, h('span', { class: 'small muted' }, result ? S.plan.legendRobust : S.plan.computing)),
    );
    el.append(h('div', { class: 'mission-run' }, side, board));

    canvas.addEventListener('mousemove', (ev) => {
      if (!geo || step !== 2) return;
      const box = canvas!.getBoundingClientRect();
      cursor = calendarCell(geo, ev.clientX - box.left, ev.clientY - box.top);
      canvas!.style.cursor = cursor && cursor.day >= m.from && cursor.day <= m.to ? 'pointer' : 'default';
      draw();
    });
    canvas.addEventListener('mouseleave', () => {
      cursor = null;
      draw();
    });
    const choose = (cell: Pick | null) => {
      if (!cell || step !== 2 || cell.day < m.from || cell.day > m.to) return;
      pick = cell;
      const ok = score(m, cell) !== null;
      if (ok) tick();
      else linkTone(false);
      paint();
    };
    canvas.addEventListener('click', (ev) => {
      if (!geo) return;
      const box = canvas!.getBoundingClientRect();
      choose(calendarCell(geo, ev.clientX - box.left, ev.clientY - box.top));
    });
    canvas.addEventListener('keydown', (ev) => {
      if (step !== 2) return;
      const c = cursor ?? pick ?? { row: 0, day: m.from };
      if (ev.key === 'ArrowRight') c.day = Math.min(m.to, c.day + 1);
      else if (ev.key === 'ArrowLeft') c.day = Math.max(m.from, c.day - 1);
      else if (ev.key === 'ArrowDown') c.row = Math.min(terrain.length - 1, c.row + 1);
      else if (ev.key === 'ArrowUp') c.row = Math.max(0, c.row - 1);
      else if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        choose({ ...c });
        return;
      } else return;
      ev.preventDefault();
      cursor = { ...c };
      draw();
    });
    draw();
  }

  /** The launch date slides to its new place, so the delay is seen happening. */
  function animateSlip(): void {
    if (!mission) return;
    const m = mission;
    linkTone(false);
    if (reducedMotion()) {
      slipShown = m.slip;
      return;
    }
    const t0 = performance.now();
    const run = (now: number) => {
      const k = Math.min(1, (now - t0) / 1400);
      slipShown = m.slip * (1 - Math.pow(1 - k, 3));
      draw();
      if (k < 1 && mission === m) requestAnimationFrame(run);
    };
    requestAnimationFrame(run);
  }

  onResize(el, draw);
  hub();
  void rowOf;
  return {
    el,
    update(_state, changed) {
      if (changed === null && !mission) hub();
    },
  };
}
