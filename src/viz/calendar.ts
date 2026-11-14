// Landing-window calendar: sites down, days across.
import type { SiteCalendar } from '../core/calendar';
import { COLORS, FONT, surface } from './canvas';

export interface CalendarRow {
  id: string;
  label: string;
  /** Small note after the name, for example "smooth sphere". */
  note: string;
  cal: SiteCalendar | null;
  /** Heading drawn above this row, starting a group. */
  heading?: string;
}

export interface CalendarInput {
  startMs: number;
  days: number;
  rows: CalendarRow[];
  plannedDay: number;
  slippedDay: number;
  /** Keyboard / hover cursor. */
  cursor: { row: number; day: number } | null;
  /** Cell open in the detail panel. */
  selected: { row: number; day: number } | null;
  labels: { planned: string; slipped: string; days: (n: number) => string; month: (ms: number) => string };
}

export interface CalendarGeometry {
  left: number;
  cellW: number;
  days: number;
  rowTop: number[];
  rowH: number;
  height: number;
}

const LEFT = 196;
const RIGHT = 58;
const AXIS = 44;
const ROW = 26;
const GAP = 4;
const HEADING = 26;
const BOTTOM = 10;

export function calendarHeight(rows: CalendarRow[]): number {
  return AXIS + rows.reduce((h, r) => h + ROW + GAP + (r.heading ? HEADING : 0), 0) + BOTTOM;
}

export function calendarCell(g: CalendarGeometry, x: number, y: number): { row: number; day: number } | null {
  const day = Math.floor((x - g.left) / g.cellW);
  if (day < 0 || day >= g.days) return null;
  const row = g.rowTop.findIndex((top) => y >= top && y < top + g.rowH);
  return row < 0 ? null : { row, day };
}

const OK = [255, 255, 255];
const WARN = [150, 150, 156];

export function drawCalendar(canvas: HTMLCanvasElement, m: CalendarInput): CalendarGeometry {
  const height = calendarHeight(m.rows);
  const { ctx, w } = surface(canvas, height);
  const plotW = w - LEFT - RIGHT;
  const cellW = plotW / m.days;
  const rowTop: number[] = [];
  let y = AXIS;
  for (const r of m.rows) {
    if (r.heading) y += HEADING;
    rowTop.push(y);
    y += ROW + GAP;
  }
  const bottom = y - GAP;
  const xOf = (day: number) => LEFT + day * cellW;

  // Months
  ctx.font = `600 11px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  for (let d = 0; d < m.days; d++) {
    const date = new Date(m.startMs + d * 86400000);
    if (date.getUTCDate() !== 1 && d !== 0) continue;
    const x = Math.round(xOf(d)) + 0.5;
    if (date.getUTCDate() === 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.beginPath();
      ctx.moveTo(x, AXIS - 8);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    const nextFirst = (() => {
      for (let k = d + 1; k < m.days; k++) if (new Date(m.startMs + k * 86400000).getUTCDate() === 1) return k;
      return m.days;
    })();
    if ((nextFirst - d) * cellW > 44) {
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'left';
      ctx.fillText(m.labels.month(m.startMs + d * 86400000), x + 5, AXIS - 10);
    }
  }

  // Rows
  m.rows.forEach((r, i) => {
    const top = rowTop[i];
    if (r.heading) {
      ctx.font = `600 10.5px ${FONT}`;
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'left';
      ctx.fillText(r.heading.toUpperCase(), 0, top - 9);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(ctx.measureText(r.heading.toUpperCase()).width + 10, top - 12.5);
      ctx.lineTo(w, top - 12.5);
      ctx.stroke();
    }
    ctx.fillStyle = '#0f0f11';
    ctx.fillRect(LEFT, top, plotW, ROW);
    let viable = 0;
    if (r.cal) {
      const gap = cellW > 3.4 ? 0.6 : 0;
      for (let d = 0; d < m.days; d++) {
        const s = r.cal.status[d];
        if (!s) continue;
        viable++;
        const c = s === 2 ? OK : WARN;
        const share = r.cal.points > 1 ? r.cal.robust[d] / r.cal.points : 1;
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.38 + 0.62 * share).toFixed(3)})`;
        ctx.fillRect(xOf(d), top, cellW - gap + 0.35, ROW);
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(LEFT, top, plotW, ROW);
    }
    ctx.font = `500 13px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.text;
    let name = r.label;
    const max = LEFT - 14 - (r.note ? ctx.measureText('  ').width : 0);
    while (ctx.measureText(name).width > max && name.length > 4) name = `${name.slice(0, -2).trimEnd()}…`;
    ctx.fillText(name, 0, top + ROW / 2 + 0.5);
    ctx.font = `600 12.5px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = viable ? COLORS.text : COLORS.muted;
    ctx.fillText(r.cal ? m.labels.days(viable) : '…', w, top + ROW / 2 + 0.5);
    ctx.textBaseline = 'alphabetic';
  });

  // Planned and slipped dates
  const marker = (day: number, color: string, text: string, dashed: boolean, level: number) => {
    if (day < 0 || day >= m.days) return;
    const x = Math.round(xOf(day + 0.5)) + 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dashed ? [4, 4] : []);
    ctx.beginPath();
    ctx.moveTo(x, AXIS - 6);
    ctx.lineTo(x, bottom + 4);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.font = `700 10.5px ${FONT}`;
    const tw = ctx.measureText(text).width + 12;
    const bx = Math.max(LEFT, Math.min(w - RIGHT - tw, x - tw / 2));
    const by = level ? 1 : 15;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(bx, by, tw, 15, 4);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.fillText(text, bx + tw / 2, by + 11);
  };
  const clash = Math.abs(m.plannedDay - m.slippedDay) * cellW < 70;
  marker(m.plannedDay, '#b9b9be', m.labels.planned, true, 0);
  if (m.slippedDay !== m.plannedDay) marker(m.slippedDay, COLORS.earth, m.labels.slipped, false, clash ? 1 : 0);

  const box = (cell: { row: number; day: number } | null, color: string, width: number) => {
    if (!cell || cell.row < 0 || cell.row >= m.rows.length) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    const cw = Math.max(cellW, 5);
    ctx.strokeRect(xOf(cell.day) - (cw - cellW) / 2 - 1, rowTop[cell.row] - 2, cw + 2, ROW + 4);
    ctx.lineWidth = 1;
  };
  box(m.selected, '#ffffff', 2);
  box(m.cursor, 'rgba(125,184,255,0.95)', 1.5);

  return { left: LEFT, cellW, days: m.days, rowTop, rowH: ROW, height };
}
