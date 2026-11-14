// "How accurate is this?" — the measured errors, the method and the limits, whatever they are.
import { lookAt, siteFrame, sky } from '../core/ephemeris';
import { S } from '../i18n/en';
import { COLORS, FONT, onResize, surface } from '../viz/canvas';
import type { App, View } from './app';
import { clear, h } from './dom';
import { pct } from './format';

const T = S.accuracy;

interface Stats {
  n: number;
  meanAbsError: number;
  bias: number;
  rms: number;
  correlation: number;
  within5pp: number;
  within10pp: number;
}
interface Validation {
  generated: string;
  regional: { description: string; sun: Stats; earth: Stats; pointsSun: [number, number][]; pointsEarth: [number, number][] };
  fine: { description: string; sunPixel: Stats; sunArea: Stats };
  sites: { id: string; sun: number; earth: number; sunVisibility: number; sunVisibility3x3: number; earthVisibility: number; earthVisibility3x3: number; model: string; sunByHeight: number[] }[];
}
type Row = [string, number, number, number];
interface Golden {
  site: { lat: number; lonE: number };
  sun: Row[];
  earth: Row[];
}

const pp = (v: number) => `${(v * 100).toFixed(1)}`;

function scatter(canvas: HTMLCanvasElement, sun: [number, number][], earth: [number, number][]): void {
  const size = Math.min(420, canvas.parentElement?.clientWidth ?? 420);
  const { ctx, w, h: ht } = surface(canvas, size);
  const pad = 46;
  const x = (v: number) => pad + v * (w - pad - 14);
  const y = (v: number) => ht - pad - v * (ht - pad - 14);
  ctx.strokeStyle = COLORS.grid;
  ctx.fillStyle = COLORS.muted;
  ctx.font = `500 11px ${FONT}`;
  ctx.textAlign = 'center';
  for (let t = 0; t <= 1.0001; t += 0.2) {
    ctx.beginPath();
    ctx.moveTo(x(t), y(0));
    ctx.lineTo(x(t), y(1));
    ctx.moveTo(x(0), y(t));
    ctx.lineTo(x(1), y(t));
    ctx.stroke();
    ctx.fillText(`${Math.round(t * 100)}%`, x(t), y(0) + 16);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(t * 100)}%`, x(0) - 8, y(t) + 4);
    ctx.textAlign = 'center';
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x(0), y(0));
  ctx.lineTo(x(1), y(1));
  ctx.stroke();
  ctx.setLineDash([]);
  const dots = (pts: [number, number][], color: string) => {
    ctx.fillStyle = color;
    for (const [nasa, ours] of pts) {
      ctx.beginPath();
      ctx.arc(x(nasa), y(ours), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  dots(earth, 'rgba(125,184,255,0.85)');
  dots(sun, 'rgba(255,255,255,0.9)');
  ctx.fillStyle = COLORS.text2;
  ctx.font = `600 11.5px ${FONT}`;
  ctx.fillText(T.axisNasa, x(0.5), ht - 8);
  ctx.save();
  ctx.translate(12, y(0.5));
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(T.axisOurs, 0, 0);
  ctx.restore();
}

export function createAccuracy(app: App): View {
  const el = h('div', { class: 'doc' });
  const base = import.meta.env.BASE_URL;
  let built = false;

  const stat = (value: string, unit: string, label: string) => h('div', { class: 'panel stat' }, h('div', { class: 'value' }, value, h('small', null, unit)), h('div', { class: 'sub' }, label));

  async function build(): Promise<void> {
    built = true;
    // ---- 1. Sun and Earth against JPL Horizons, computed now, in this browser
    const files = import.meta.glob<Golden>('../../tests/golden/*.json', { import: 'default' });
    const ephRows = h('tbody');
    let worstEl = 0;
    let worstAz = 0;
    let total = 0;
    for (const [path, load] of Object.entries(files)) {
      const g = await load();
      const frame = siteFrame(g.site.lat, g.site.lonE, 0);
      let maxEl = 0;
      let maxAz = 0;
      for (const body of ['sun', 'earth'] as const) {
        for (const [iso, az, elv] of g[body]) {
          const v = lookAt(sky(new Date(iso)), frame)[body];
          maxEl = Math.max(maxEl, Math.abs(v.el - elv));
          maxAz = Math.max(maxAz, Math.abs(((v.az - az + 540) % 360) - 180) * Math.cos((elv * Math.PI) / 180));
          total++;
        }
      }
      worstEl = Math.max(worstEl, maxEl);
      worstAz = Math.max(worstAz, maxAz);
      const name = path.split('/').pop()!.replace('.json', '');
      ephRows.append(
        h('tr', null, h('th', { scope: 'row' }, T.cases[name] ?? name), h('td', null, `${g.sun[0][0].slice(0, 10)} → ${g.sun[g.sun.length - 1][0].slice(0, 10)}`), h('td', { class: 'num' }, String(g.sun.length * 2)), h('td', { class: 'num' }, `${maxEl.toFixed(4)}°`), h('td', { class: 'num' }, `${maxAz.toFixed(4)}°`)),
      );
    }

    // ---- 2. Terrain horizon against NASA's illumination maps
    const v = (await (await fetch(`${base}data/validation.json`)).json()) as Validation;
    const canvas = h('canvas', { role: 'img', 'aria-label': T.scatterAria });
    const siteRows = h('tbody');
    for (const s of v.sites) {
      const info = app.siteInfo(s.id);
      siteRows.append(
        h(
          'tr',
          null,
          h('th', { scope: 'row' }, info.name),
          h('td', { class: 'num' }, pct(s.sun)),
          h('td', { class: 'num' }, pct(s.sunVisibility)),
          h('td', { class: 'num' }, pct(s.sunVisibility3x3)),
          h('td', { class: 'num' }, pct(s.earth)),
          h('td', { class: 'num' }, pct(s.earthVisibility)),
          h('td', { class: 'num' }, s.sunByHeight.map((x) => pct(x)).join(' / ')),
          h('td', null, s.model === 'lola-5m-80m-240m' ? '5 m' : '80 m'),
        ),
      );
    }
    const list = (items: string[]) => h('ul', { class: 'bullets' }, ...items.map((i) => h('li', null, i)));

    clear(el);
    el.append(
      h('header', { class: 'doc-head' }, h('p', { class: 'eyebrow' }, T.eyebrow), h('h1', null, T.title), h('p', { class: 'lead' }, T.lead)),

      h(
        'section',
        { class: 'panel doc-section' },
        h('h2', null, T.eph.title),
        h('p', null, T.eph.text),
        h('div', { class: 'stats cols-3' }, stat(worstEl.toFixed(4), '°', T.eph.worstEl), stat(worstAz.toFixed(4), '°', T.eph.worstAz), stat(String(total), '', T.eph.count)),
        h('p', { class: 'small muted' }, T.eph.live),
        h(
          'div',
          { class: 'table-wrap' },
          h('table', { class: 'sites plain' }, h('thead', null, h('tr', null, h('th', null, T.eph.colCase), h('th', null, T.eph.colPeriod), h('th', { class: 'num' }, T.eph.colRows), h('th', { class: 'num' }, T.eph.colEl), h('th', { class: 'num' }, T.eph.colAz))), ephRows),
        ),
      ),

      h(
        'section',
        { class: 'panel doc-section' },
        h('h2', null, T.terrain.title),
        h('p', null, T.terrain.text),
        h(
          'div',
          { class: 'split' },
          h(
            'div',
            null,
            h('div', { class: 'stats cols-2' }, stat(pp(v.regional.sun.meanAbsError), T.points, T.terrain.sunMae), stat(pp(v.regional.earth.meanAbsError), T.points, T.terrain.earthMae), stat(v.regional.sun.correlation.toFixed(2), '', T.terrain.sunCorr), stat(v.regional.earth.correlation.toFixed(2), '', T.terrain.earthCorr)),
            h('p', { class: 'small muted' }, T.terrain.regionalNote(v.regional.sun.n, pct(v.regional.sun.within5pp), pct(v.regional.earth.within5pp))),
          ),
          h('figure', { class: 'scatter' }, canvas, h('figcaption', { class: 'small muted' }, T.scatterCaption)),
        ),
        h('h3', null, T.terrain.fineTitle),
        h('p', null, T.terrain.fineText(v.fine.sunPixel.correlation.toFixed(2), v.fine.sunArea.correlation.toFixed(2), pp(v.fine.sunArea.rms))),
        h('h3', null, T.terrain.sitesTitle),
        h('p', { class: 'small muted' }, T.terrain.sitesNote),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'sites plain' },
            h('thead', null, h('tr', null, h('th', null, S.plan.table.site), h('th', { class: 'num' }, T.terrain.colOurs), h('th', { class: 'num' }, T.terrain.colNasa), h('th', { class: 'num' }, T.terrain.colNasa3), h('th', { class: 'num' }, T.terrain.colOursEarth), h('th', { class: 'num' }, T.terrain.colNasaEarth), h('th', { class: 'num' }, T.terrain.colHeights), h('th', null, T.terrain.colModel))),
            siteRows,
          ),
        ),
        h('p', { class: 'small muted' }, T.terrain.heightNote),
      ),

      h('section', { class: 'panel doc-section' }, h('h2', null, T.includes.title), list(T.includes.items)),
      h('section', { class: 'panel doc-section' }, h('h2', null, T.limits.title), list(T.limits.items)),
      h('section', { class: 'panel doc-section' }, h('h2', null, T.three.title), h('p', null, T.three.text), list(T.three.items)),
      h(
        'section',
        { class: 'panel doc-section' },
        h('h2', null, T.sources.title),
        h('p', null, T.sources.text, ' ', h('a', { href: 'https://github.com/machinedramon/lunar-window/blob/main/docs/REFERENCES.md', target: '_blank', rel: 'noopener' }, T.sources.link), '.'),
      ),
    );
    const draw = () => scatter(canvas, v.regional.pointsSun, v.regional.pointsEarth);
    draw();
    onResize(el, draw);
  }

  el.append(h('div', { class: 'loading' }, h('div', { class: 'spinner' })));
  return {
    el,
    update() {
      if (!built) void build().catch((err) => console.error(err));
    },
  };
}
