// Timeline bars: when the Sun is up, when the Earth is in view, and when both are.
import type { SkyEvent } from '../core/events';
import { SUN_PRESENT } from '../core/requirements';
import { COLORS, FONT, mix, surface } from './canvas';

export interface TimelineInput {
  startMs: number;
  stepMs: number;
  sunFrac: Float32Array;
  earthClear: Float32Array;
  earthMarginDeg: number;
  /** Vertical marker for "now" or the landing time. */
  cursorMs: number | null;
  /** Shaded span, for example the mission. */
  span: { fromMs: number; toMs: number } | null;
  events: SkyEvent[];
  labels: { sun: string; earth: string; both: string };
  formatDay: (ms: number) => string;
}

export interface TimelineGeometry {
  left: number;
  plotW: number;
  startMs: number;
  endMs: number;
}

const LEFT = 62;
const RIGHT = 10;
const ROW = 20;
const GAP = 7;
const TOP = 10;

export const TIMELINE_HEIGHT = TOP + 3 * ROW + 2 * GAP + 30;

export function timelineTime(g: TimelineGeometry, x: number): number {
  const t = Math.max(0, Math.min(1, (x - g.left) / g.plotW));
  return g.startMs + t * (g.endMs - g.startMs);
}

export function drawTimeline(canvas: HTMLCanvasElement, m: TimelineInput): TimelineGeometry {
  const { ctx, w, h } = surface(canvas, TIMELINE_HEIGHT);
  const plotW = w - LEFT - RIGHT;
  const n = m.sunFrac.length;
  const endMs = m.startMs + n * m.stepMs;
  const xOf = (ms: number) => LEFT + ((ms - m.startMs) / (endMs - m.startMs)) * plotW;
  const rowY = (r: number) => TOP + r * (ROW + GAP);
  const off: [number, number, number] = [36, 44, 60];

  if (m.span) {
    const a = Math.max(LEFT, xOf(m.span.fromMs));
    const b = Math.min(LEFT + plotW, xOf(m.span.toMs));
    ctx.fillStyle = 'rgba(255,255,255,0.055)';
    ctx.fillRect(a, TOP - 5, Math.max(0, b - a), 3 * ROW + 2 * GAP + 10);
  }

  for (let px = 0; px < plotW; px++) {
    const i0 = Math.floor((px / plotW) * n);
    const i1 = Math.max(i0 + 1, Math.floor(((px + 1) / plotW) * n));
    let sun = 0;
    let earth = 0;
    let both = 0;
    for (let i = i0; i < i1 && i < n; i++) {
      const s = m.sunFrac[i];
      const e = m.earthClear[i] > m.earthMarginDeg ? 1 : 0;
      sun += s;
      earth += e;
      both += s >= SUN_PRESENT && e ? 1 : 0;
    }
    const k = Math.max(1, Math.min(i1, n) - i0);
    ctx.fillStyle = mix(off, [255, 207, 102], sun / k);
    ctx.fillRect(LEFT + px, rowY(0), 1.5, ROW);
    ctx.fillStyle = mix(off, [111, 180, 255], earth / k);
    ctx.fillRect(LEFT + px, rowY(1), 1.5, ROW);
    ctx.fillStyle = mix(off, [159, 232, 201], both / k);
    ctx.fillRect(LEFT + px, rowY(2), 1.5, ROW);
  }

  // Row labels
  ctx.font = `600 11.5px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  [m.labels.sun, m.labels.earth, m.labels.both].forEach((text, r) => {
    ctx.fillStyle = [COLORS.sun, COLORS.earth, COLORS.both][r];
    ctx.fillText(text, 12, rowY(r) + ROW / 2 + 0.5);
  });

  // Day ticks
  const days = (endMs - m.startMs) / 86400000;
  const every = days > 200 ? 30 : days > 70 ? 14 : days > 24 ? 5 : days > 10 ? 2 : 1;
  const axisY = rowY(2) + ROW + 6;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  ctx.font = `500 11px ${FONT}`;
  const firstDay = Math.ceil(m.startMs / 86400000) * 86400000;
  for (let t = firstDay, d = 0; t <= endMs; t += 86400000, d++) {
    const x = Math.round(xOf(t)) + 0.5;
    const major = d % every === 0;
    ctx.strokeStyle = major ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(x, axisY - 4);
    ctx.lineTo(x, axisY + (major ? 4 : 1));
    ctx.stroke();
    if (major && x > LEFT + 22 && x < LEFT + plotW - 22) {
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(m.formatDay(t), x, axisY + 17);
    }
  }

  if (m.cursorMs !== null && m.cursorMs >= m.startMs && m.cursorMs <= endMs) {
    const x = Math.round(xOf(m.cursorMs)) + 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, TOP - 6);
    ctx.lineTo(x, rowY(2) + ROW + 5);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x - 5, TOP - 8);
    ctx.lineTo(x + 5, TOP - 8);
    ctx.lineTo(x, TOP - 1);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1;
  }
  void h;
  return { left: LEFT, plotW, startMs: m.startMs, endMs };
}
