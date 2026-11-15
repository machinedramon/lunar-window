// Horizon panorama: 360 degrees of skyline with the Sun and the Earth against it.
import type { View } from '../core/ephemeris';
import type { Horizon, HorizonData } from '../core/horizon';
import { COLORS, FONT, mix, surface } from './canvas';

export interface StripInput {
  horizon: Horizon;
  data: HorizonData | null;
  mast: number;
  sun: View;
  earth: View;
  sunFrac: number;
  earthClear: number;
  /** Azimuth shown at the centre of the panorama. */
  centerAz: number;
  elMin: number;
  elMax: number;
  /** Future positions as [az, el, az, el, ...] */
  sunPath: Float32Array | null;
  earthPath: Float32Array | null;
  labels: { sun: string; earth: string; behind: string; horizontal: string; sphere: string };
}

export interface StripGeometry {
  left: number;
  top: number;
  plotW: number;
  plotH: number;
  centerAz: number;
  elMin: number;
  elMax: number;
}

const PAD = { left: 46, right: 10, top: 10, bottom: 30 };

export function stripPoint(g: StripGeometry, x: number, y: number): { az: number; el: number } | null {
  if (x < g.left || x > g.left + g.plotW || y < g.top || y > g.top + g.plotH) return null;
  const az = (((x - g.left) / g.plotW - 0.5) * 360 + g.centerAz + 720) % 360;
  const el = g.elMax - ((y - g.top) / g.plotH) * (g.elMax - g.elMin);
  return { az, el };
}

export function drawStrip(canvas: HTMLCanvasElement, m: StripInput, cssHeight: number): StripGeometry {
  const { ctx, w, h } = surface(canvas, cssHeight);
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;
  const g: StripGeometry = { left: PAD.left, top: PAD.top, plotW, plotH, centerAz: m.centerAz, elMin: m.elMin, elMax: m.elMax };
  const ppdX = plotW / 360;
  const ppdY = plotH / (m.elMax - m.elMin);
  const xOf = (az: number) => PAD.left + ((((az - m.centerAz + 540) % 360) + 360) % 360) * ppdX;
  const yOf = (el: number) => PAD.top + (m.elMax - el) * ppdY;
  const polar = m.elMax - m.elMin < 40;

  // Sky
  const sky = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + plotH);
  sky.addColorStop(0, '#000000');
  sky.addColorStop(1, '#08080a');
  ctx.fillStyle = sky;
  ctx.fillRect(PAD.left, PAD.top, plotW, plotH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.left, PAD.top, plotW, plotH);
  ctx.clip();

  // Elevation grid
  const stepEl = polar ? 2 : 15;
  ctx.lineWidth = 1;
  for (let e = Math.ceil(m.elMin / stepEl) * stepEl; e <= m.elMax; e += stepEl) {
    ctx.strokeStyle = e === 0 ? COLORS.gridStrong : COLORS.grid;
    ctx.setLineDash(e === 0 ? [5, 5] : []);
    ctx.beginPath();
    ctx.moveTo(PAD.left, Math.round(yOf(e)) + 0.5);
    ctx.lineTo(PAD.left + plotW, Math.round(yOf(e)) + 0.5);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (let a = 0; a < 360; a += 30) {
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(Math.round(xOf(a)) + 0.5, PAD.top);
    ctx.lineTo(Math.round(xOf(a)) + 0.5, PAD.top + plotH);
    ctx.stroke();
  }

  // Where each body goes next
  const path = (pts: Float32Array | null, color: string) => {
    if (!pts) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    let px = NaN;
    for (let i = 0; i < pts.length; i += 2) {
      const x = xOf(pts[i]);
      const y = yOf(pts[i + 1]);
      if (Number.isNaN(px) || Math.abs(x - px) > plotW / 2) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      px = x;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  path(m.sunPath, 'rgba(255,200,87,0.6)');
  path(m.earthPath, 'rgba(125,184,255,0.6)');

  // Discs drawn round, at the vertical scale: how high each one stands over the skyline is true; their width is
  // enlarged by the stretch of the chart (drawn to both scales they would be thin vertical slivers).
  const disc = (v: View, inner: string, outer: string, glow: string, glowR: number) => {
    for (const shift of [-360, 0, 360]) {
      const x = xOf(v.az) + shift * ppdX;
      if (x < PAD.left - 40 || x > PAD.left + plotW + 40) continue;
      const y = yOf(v.el);
      const r = Math.max(2.5, v.radius * ppdY);
      const reach = Math.max(glowR, r * 1.9);
      const halo = ctx.createRadialGradient(x, y, r * 0.6, x, y, reach);
      halo.addColorStop(0, glow);
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, reach, 0, Math.PI * 2);
      ctx.fill();
      const fill = ctx.createLinearGradient(x, y - r, x, y + r);
      fill.addColorStop(0, inner);
      fill.addColorStop(1, outer);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  disc(m.earth, '#cfe4ff', COLORS.earthDeep, 'rgba(125,184,255,0.32)', 26);
  disc(m.sun, '#ffffff', '#fff1cf', 'rgba(255,200,87,0.5)', 34);

  // Terrain: lighter where the ridge that sets the skyline is far away (smoothed, so it reads as haze, not stripes)
  const near: [number, number, number] = [46, 46, 49];
  const far: [number, number, number] = [128, 128, 134];
  const dist = m.data ? m.data.distKm[m.mast] : null;
  const n = m.horizon.count;
  const cols = Math.ceil(plotW) + 1;
  const ridge = new Float32Array(cols);
  let tint = new Float32Array(cols);
  for (let x = 0; x < cols; x++) {
    const az = (x / plotW - 0.5) * 360 + m.centerAz;
    ridge[x] = yOf(m.horizon.at(az, m.mast));
    tint[x] = 0.3;
    if (dist) {
      const i = Math.round((((az % 360) + 360) % 360) / m.horizon.stepDeg) % n;
      tint[x] = Math.log10(Math.max(0.3, dist[i]) / 0.3) / Math.log10(300 / 0.3);
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    const out = new Float32Array(cols);
    const r = 14;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += tint[Math.max(0, Math.min(cols - 1, x))];
    for (let x = 0; x < cols; x++) {
      out[x] = sum / (2 * r + 1);
      sum += tint[Math.min(cols - 1, x + r + 1)] - tint[Math.max(0, x - r)];
    }
    tint = out;
  }
  for (let x = 0; x < cols; x++) {
    ctx.fillStyle = mix(near, far, tint[x]);
    ctx.fillRect(PAD.left + x, ridge[x], 1.5, PAD.top + plotH - ridge[x] + 1);
  }
  // Darken towards the bottom, inside the terrain only
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(PAD.left, PAD.top + plotH);
  for (let x = 0; x < cols; x++) ctx.lineTo(PAD.left + x, ridge[x]);
  ctx.lineTo(PAD.left + plotW, PAD.top + plotH);
  ctx.closePath();
  ctx.clip();
  let top = Infinity;
  for (let x = 0; x < cols; x++) top = Math.min(top, ridge[x]);
  const shade = ctx.createLinearGradient(0, top, 0, PAD.top + plotH);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = shade;
  ctx.fillRect(PAD.left, PAD.top, plotW, plotH);
  ctx.restore();
  ctx.strokeStyle = 'rgba(235,235,238,0.85)';
  ctx.lineWidth = 1.1;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let x = 0; x < cols; x++) {
    if (x === 0) ctx.moveTo(PAD.left, ridge[0]);
    else ctx.lineTo(PAD.left + x, ridge[x]);
  }
  ctx.stroke();

  // A body behind the terrain is outlined so it can still be found
  const outline = (v: View, hidden: boolean, color: string) => {
    if (!hidden) return;
    const x = xOf(v.az);
    const y = yOf(v.el);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(5, v.radius * ppdY), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  outline(m.sun, m.sunFrac < 0.999, 'rgba(255,255,255,0.9)');
  outline(m.earth, m.earthClear < m.earth.radius, 'rgba(125,184,255,0.9)');

  // Labels
  const label = (v: View, text: string, color: string, hidden: boolean) => {
    const x = Math.max(PAD.left + 40, Math.min(PAD.left + plotW - 40, xOf(v.az)));
    const ry = Math.max(5, v.radius * ppdY);
    let y = yOf(v.el) - ry - 9;
    if (y < PAD.top + 14) y = yOf(v.el) + ry + 17;
    y = Math.max(PAD.top + 14, Math.min(PAD.top + plotH - 8, y));
    const full = hidden ? `${text} · ${m.labels.behind}` : text;
    ctx.font = `600 12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(full, x, y);
    ctx.fillStyle = color;
    ctx.fillText(full, x, y);
  };
  if (m.earth.el > m.elMin && m.earth.el < m.elMax) label(m.earth, m.labels.earth, '#a9d0ff', m.earthClear <= 0);
  if (m.sun.el > m.elMin && m.sun.el < m.elMax) label(m.sun, m.labels.sun, COLORS.sun, m.sunFrac <= 0);

  if (m.horizon.kind === 'sphere') {
    ctx.font = `500 12px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(m.labels.sphere, PAD.left + 12, yOf(0) + 20);
  }
  ctx.restore();

  // Axes
  ctx.font = `500 11px ${FONT}`;
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let e = Math.ceil(m.elMin / stepEl) * stepEl; e <= m.elMax; e += stepEl) {
    if (yOf(e) < PAD.top + 6 || yOf(e) > PAD.top + plotH - 4) continue;
    ctx.fillStyle = e === 0 ? COLORS.text2 : COLORS.muted;
    ctx.fillText(`${e > 0 ? '+' : e < 0 ? '−' : ''}${Math.abs(e)}°`, PAD.left - 8, yOf(e));
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const names: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let a = 0; a < 360; a += 30) {
    const x = xOf(a);
    if (x < PAD.left + 12 || x > PAD.left + plotW - 12) continue;
    const cardinal = names[a];
    ctx.fillStyle = cardinal ? COLORS.text : COLORS.muted;
    ctx.font = `${cardinal ? 700 : 500} 11px ${FONT}`;
    ctx.fillText(cardinal ? `${cardinal} ${a}°` : `${a}°`, x, PAD.top + plotH + 19);
  }
  ctx.strokeStyle = COLORS.gridStrong;
  ctx.lineWidth = 1;
  ctx.strokeRect(PAD.left + 0.5, PAD.top + 0.5, plotW - 1, plotH - 1);
  return g;
}

/** One body against the skyline with no vertical stretch: one degree is the same length in both directions. */
export interface CloseupInput {
  horizon: Horizon;
  mast: number;
  body: View;
  /** Vertical extent of the window in degrees. */
  span: number;
  inner: string;
  outer: string;
  glow: string;
  scaleLabel: string;
}

export function drawCloseup(canvas: HTMLCanvasElement, m: CloseupInput, cssHeight: number): void {
  const { ctx, w, h } = surface(canvas, cssHeight);
  const ground = m.horizon.at(m.body.az, m.mast);
  const gap = Math.abs(m.body.el - ground);
  // Widen the window until both the body and the skyline under it fit; beyond 30 degrees, show the body alone.
  const span = gap > 30 ? m.span : Math.max(m.span, gap * 1.5 + m.body.radius * 5);
  const mid = gap > 30 ? m.body.el : (m.body.el + ground) / 2;
  const ppd = h / span;
  const cx = w / 2;
  const stretch = 1 / Math.max(0.05, Math.cos((m.body.el * Math.PI) / 180));
  const xOf = (az: number) => cx + ((((az - m.body.az + 540) % 360) + 360) % 360 - 180) * (ppd / stretch);
  const yOf = (el: number) => h / 2 - (el - mid) * ppd;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#000000');
  sky.addColorStop(1, '#08080a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const x = xOf(m.body.az);
  const y = yOf(m.body.el);
  const r = m.body.radius * ppd;
  const halo = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 3.2);
  halo.addColorStop(0, m.glow);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
  ctx.fill();
  const fill = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  fill.addColorStop(0, m.inner);
  fill.addColorStop(1, m.outer);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Terrain
  ctx.beginPath();
  ctx.moveTo(0, h);
  const half = (w / 2 / ppd) * stretch;
  for (let px = 0; px <= w; px += 1) {
    const az = m.body.az + (px / w - 0.5) * 2 * half;
    ctx.lineTo(px, yOf(m.horizon.at(az, m.mast)));
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  const rock = ctx.createLinearGradient(0, yOf(ground) - 20, 0, h);
  rock.addColorStop(0, '#5a5a5f');
  rock.addColorStop(1, '#0e0e10');
  ctx.fillStyle = rock;
  ctx.fill();
  ctx.strokeStyle = 'rgba(235,235,238,0.85)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (let px = 0; px <= w; px += 1) {
    const az = m.body.az + (px / w - 0.5) * 2 * half;
    const py = yOf(m.horizon.at(az, m.mast));
    if (px === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Outline of the hidden part
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Scale bar: one degree
  const bar = ppd;
  ctx.strokeStyle = COLORS.text2;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(12, h - 14);
  ctx.lineTo(12 + bar, h - 14);
  ctx.moveTo(12, h - 18);
  ctx.lineTo(12, h - 10);
  ctx.moveTo(12 + bar, h - 18);
  ctx.lineTo(12 + bar, h - 10);
  ctx.stroke();
  ctx.font = `500 11px ${FONT}`;
  ctx.fillStyle = COLORS.text2;
  ctx.textAlign = 'left';
  ctx.fillText(m.scaleLabel, 12 + bar + 8, h - 10);
}
