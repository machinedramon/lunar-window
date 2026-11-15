// The 30-second demo film, recorded frame by frame from the running development server.
//
//   node tools/film.mjs               all shots: 900 frames into video/frames
//   SHOTS=1,2 node tools/film.mjs     only some shots
//   EVERY=15 node tools/film.mjs      one frame in fifteen, for a quick look at the cut
//   TEAM="Team name" node tools/film.mjs
//   python tools/film_audio.py        the soundtrack (same time marks as below)
//
// Every picture is the real tool running. What the film adds: the black bars, the subtitles,
// a drawn pointer, slow zooms on the interface, the slate lines and the closing title.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const FPS = 30;
const W = 1536;
const H = 864;
const BAR = 111; // black bars of the 2.39:1 shots, CSS pixels
const SUB = 58; // subtitle bar under the interface shots
const TEAM = process.env.TEAM ?? '';
const only = process.env.SHOTS ? process.env.SHOTS.split(',').map(Number) : null;
const every = Number(process.env.EVERY ?? 1);
/** FILM_LANG=pt node tools/film.mjs records the film with the interface, the captions and the timing of that language. */
const LANG = process.env.FILM_LANG ?? 'en';
const out = process.env.OUT ?? (LANG === 'en' ? 'video/frames' : `video/frames-${LANG}`);
mkdirSync(out, { recursive: true });

// ---------- time marks, in seconds of film: written by tools/film_audio.py from the word timings of the narration.
// The film follows the voice: every cut falls where she starts a thought.
const MARKS = JSON.parse(readFileSync(`video/voice/${LANG}/marks.json`, 'utf8'));
/** What the film itself writes on the picture, in the three languages. */
const WORDS = {
  en: {
    months: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
    real: 'real NASA LOLA terrain',
    place: 'Malapert Massif, lunar south pole',
    lapse: 'time-lapse',
    eclipsePlace: 'Blue Ghost Mission 1, Mare Crisium',
    eclipseWhat: 'the Earth in front of the Sun, seen from the Moon',
    eclipseNote: 'the eclipse the lander recorded',
    challenge: 'NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator',
    credit1: 'Terrain: NASA LRO LOLA · Sun and Earth checked against NASA JPL Horizons · Milky Way: NASA SVS Deep Star Maps',
    credit2: 'Narration: AI-generated voice · Music: synthesised · An independent project, not endorsed by NASA',
  },
  pt: {
    months: ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'],
    real: 'terreno real NASA LOLA',
    place: 'Malapert Massif, polo sul lunar',
    lapse: 'tempo acelerado',
    eclipsePlace: 'Blue Ghost Mission 1, Mare Crisium',
    eclipseWhat: 'a Terra na frente do Sol, vista da Lua',
    eclipseNote: 'o eclipse que o módulo registrou',
    challenge: 'NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator',
    credit1: 'Terreno: NASA LRO LOLA · Sol e Terra conferidos com o NASA JPL Horizons · Via Láctea: NASA SVS Deep Star Maps',
    credit2: 'Narração: voz gerada por IA · Música: sintetizada · Projeto independente, não endossado pela NASA',
  },
  es: {
    months: ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'],
    real: 'terreno real NASA LOLA',
    place: 'Malapert Massif, polo sur lunar',
    lapse: 'tiempo acelerado',
    eclipsePlace: 'Blue Ghost Mission 1, Mare Crisium',
    eclipseWhat: 'la Tierra delante del Sol, vista desde la Luna',
    eclipseNote: 'el eclipse que registró el módulo',
    challenge: 'NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator',
    credit1: 'Terreno: NASA LRO LOLA · Sol y Tierra comprobados con NASA JPL Horizons · Vía Láctea: NASA SVS Deep Star Maps',
    credit2: 'Narración: voz generada por IA · Música: sintetizada · Proyecto independiente, no avalado por la NASA',
  },
}[LANG];
const CUT = MARKS.cuts;
/** Subtitles: what the narrator says, when she says it. */
const SUBTITLES = MARKS.subtitles;
/** When she says the name, and then the line under it. */
const CLOSING = MARKS.closing;

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
// A 1536 x 864 page drawn at 1.25 gives 1920 x 1080 frames with an interface large enough to read.
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1.25, reducedMotion: 'reduce' });
await context.addInitScript(() => {
  window.__lwPreserve = true;
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://localhost:5700/?lang=${LANG}#explore?site=malapert&t=2027-01-17T00:00`, { waitUntil: 'networkidle' });
await page.addStyleTag({
  content: `
  #f-top, #f-bot { position: fixed; left: 0; right: 0; height: 0; background: #000; z-index: 5000; pointer-events: none; }
  #f-top { top: 0; } #f-bot { bottom: 0; }
  #f-cap { position: fixed; left: 0; right: 0; bottom: 0; height: ${SUB}px; z-index: 5100; display: flex; align-items: center; justify-content: center; pointer-events: none;
    font: 400 23px/1.2 'Jost Variable', sans-serif; letter-spacing: 0.005em; color: #fff; text-align: center; }
  #f-slate { position: fixed; left: 48px; right: 48px; top: 0; height: ${BAR}px; z-index: 5100; display: none; align-items: flex-end; justify-content: space-between; padding-bottom: 17px; pointer-events: none;
    font: 500 10.5px/1 'B612', sans-serif; letter-spacing: 0.2em; text-transform: uppercase; color: rgba(255,255,255,0.56); font-variant-numeric: tabular-nums; }
  #f-slate b { font-weight: 500; color: #fff; }
  #f-fade { position: fixed; inset: 0; background: #000; opacity: 0; z-index: 6000; pointer-events: none; }
  /* The title stands on the left, over a darkened side of the picture; the Earth and the vehicle keep the right. */
  #f-title { position: fixed; inset: 0; z-index: 5200; display: none; flex-direction: column; align-items: flex-start; justify-content: center; padding: 0 0 26px 118px; color: #fff; text-align: left; pointer-events: none;
    background: linear-gradient(90deg, rgba(0,0,0,0.6), rgba(0,0,0,0.4) 34%, transparent 58%); }
  #f-title .f-name { font: 500 64px/1 'Jost Variable', sans-serif; letter-spacing: 0.26em; text-transform: uppercase; white-space: nowrap; }
  #f-title .f-rule { width: 0; height: 1px; background: rgba(255,255,255,0.7); margin-top: 28px; }
  #f-title .f-line { margin-top: 24px; font: 400 27px/1.2 'Jost Variable', sans-serif; letter-spacing: 0; white-space: nowrap; }
  #f-title .f-meta { margin-top: 30px; font: 500 11.5px/2 'B612', sans-serif; letter-spacing: 0.2em; text-transform: uppercase; color: rgba(255,255,255,0.74); white-space: nowrap; }
  #f-credit { position: fixed; left: 0; right: 0; bottom: 0; height: ${BAR}px; z-index: 5200; display: none; align-items: center; justify-content: center; pointer-events: none;
    font: 500 9.5px/1.9 'B612', sans-serif; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(255,255,255,0.5); text-align: center; }
  #f-cursor { position: fixed; left: 0; top: 0; z-index: 5500; width: 26px; height: 26px; pointer-events: none; display: none; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.7)); }
  #f-ring { position: fixed; left: 0; top: 0; z-index: 5490; width: 40px; height: 40px; margin: -20px 0 0 -20px; border: 1.5px solid #fff; border-radius: 50%; pointer-events: none; opacity: 0; }
  body.film .top, body.film .foot, body.film .dock, body.film .hud, body.film .stage-note, body.film .stage-scrim { display: none !important; }
  body.film .three { position: fixed !important; inset: 0 !important; z-index: 2000; }
  body.film .three-label, body.film .three-insets, body.film .three-tape, body.film .three-caption, body.film .three-controls, body.film .three-hint, body.film .three-title { display: none !important; }
  body.film.plain .three-sky { display: none !important; }
  `,
});
await page.evaluate(() => {
  for (const id of ['f-top', 'f-bot', 'f-cap', 'f-slate', 'f-fade', 'f-title', 'f-credit', 'f-ring', 'f-cursor']) {
    const d = document.createElement('div');
    d.id = id;
    document.documentElement.append(d);
  }
  document.getElementById('f-cursor').innerHTML =
    '<svg viewBox="0 0 26 26" width="26" height="26"><path d="M4 2 L4 20 L8.6 15.9 L11.8 23 L14.9 21.6 L11.8 14.7 L18 14.4 Z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>';
});

const raf = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const set = (patch) => page.evaluate((p) => window.__lwStore.set(p), patch);
const look = (az, pitch, fov) => page.evaluate(([a, b, c]) => window.__lwLook?.(a, b, c), [az, pitch, fov]);
/** Points the camera relative to a body: `dAz` degrees to its side and `dPitch` degrees above it. */
const lookBy = (which, dAz, dPitch, fov) =>
  page.evaluate(
    ([w, d, p, f]) => {
      window.__lwFace?.(w, f, 0);
      const s = window.__lwScene?.();
      if (s) window.__lwLook(s.look.az + d, s.look.pitch + p, f);
    },
    [which, dAz, dPitch, fov],
  );
const face = (which, fov, lift = 0) => page.evaluate(([w, f, l]) => window.__lwFace?.(w, f, l), [which, fov, lift]);
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const out3 = (t) => 1 - Math.pow(1 - t, 3);
const clamp = (t) => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => a + (b - a) * t;
const utc = (y, m, d, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);
const HOUR = 3600e3;
const DAY = 24 * HOUR;

/** The frame of the film: black bars, subtitle bar, slate, fade. */
const dress = (o) =>
  page.evaluate((o) => {
    const $ = (id) => document.getElementById(id);
    if (o.film !== undefined) {
      document.body.classList.toggle('film', o.film);
      $('f-top').style.height = `${o.film ? o.bar : 0}px`;
      $('f-bot').style.height = `${o.film ? o.bar : o.sub}px`;
      $('f-cap').style.height = `${o.film ? o.bar : o.sub}px`;
      document.body.style.height = o.film ? '' : `${innerHeight - o.sub}px`;
      $('f-slate').style.display = o.film ? 'flex' : 'none';
    }
    if (o.plain !== undefined) document.body.classList.toggle('plain', o.plain);
    if (o.caption !== undefined) $('f-cap').textContent = o.caption;
    if (o.fade !== undefined) $('f-fade').style.opacity = String(o.fade);
    if (o.slate !== undefined) $('f-slate').innerHTML = o.slate;
    if (o.zoom !== undefined) {
      document.body.style.transformOrigin = `${o.zoom[1]}% ${o.zoom[2]}%`;
      document.body.style.transform = o.zoom[0] === 1 ? '' : `scale(${o.zoom[0]})`;
    }
    if (o.cursor !== undefined) {
      const c = $('f-cursor');
      c.style.display = o.cursor ? 'block' : 'none';
      if (o.cursor) c.style.transform = `translate(${o.cursor[0] - 4}px, ${o.cursor[1] - 2}px)`;
    }
    if (o.ring !== undefined) {
      const r = $('f-ring');
      r.style.opacity = String(o.ring ? o.ring[2] : 0);
      if (o.ring) r.style.transform = `translate(${o.ring[0]}px, ${o.ring[1]}px) scale(${o.ring[3]})`;
    }
  }, { ...o, bar: BAR, sub: SUB });
/** Centre of an element on screen, after any zoom. `fx`, `fy` pick a point inside it (0 to 1). */
const point = (selector, fx = 0.5, fy = 0.5) =>
  page.evaluate(([s, x, y]) => {
    const r = document.querySelector(s)?.getBoundingClientRect();
    return r ? [r.left + r.width * x, r.top + r.height * y] : null;
  }, [selector, fx, fy]);
/** Point on screen of a cell of the planner's calendar: row of the list, day of the year shown. (Geometry of src/viz/calendar.ts.) */
const cell = (row, day) =>
  page.evaluate(([r, d]) => {
    const c = document.querySelector('.cal-canvas');
    if (!c) return null;
    const box = c.getBoundingClientRect();
    const k = box.width / c.clientWidth; // zoom of the film
    const cellW = (c.clientWidth - 196 - 58) / 365;
    const x = 196 + (d + 0.5) * cellW;
    const y = 60 + 26 + r * 30 + 13;
    // `show`: where the cell is on screen. `mouse`: where the pointer must be for the tool to read that cell,
    // because the tool measures in its own pixels and the film has zoomed the page.
    return { show: [box.left + x * k, box.top + y * k], mouse: [box.left + x, box.top + y], k };
  }, [row, day]);
const stamp = (ms) => {
  const d = new Date(ms);
  const mon = WORDS.months[d.getUTCMonth()];
  return `${String(d.getUTCDate()).padStart(2, '0')} ${mon} ${d.getUTCFullYear()} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(Math.floor(d.getUTCMinutes() / 10) * 10).padStart(2, '0')} UTC`;
};

/** Black over the picture at a moment of the film: in at the start, a dip at the first cut to the tool, out at the end. */
function fadeAt(sec) {
  if (sec < 0.9) return 1 - ease(sec / 0.9);
  if (Math.abs(sec - CUT.slip) < 0.2) return 1 - Math.abs(sec - CUT.slip) / 0.2;
  // out of the tool and into the eclipse: a breath of black, shorter going out than coming in
  if (sec > CUT.title - 0.18 && sec < CUT.title) return (sec - (CUT.title - 0.18)) / 0.18;
  if (sec >= CUT.title && sec < CUT.title + 0.7) return 1 - ease((sec - CUT.title) / 0.7);
  if (sec > CUT.end - 0.8) return ease((sec - (CUT.end - 0.8)) / 0.75);
  return 0;
}
const subtitleAt = (sec) => SUBTITLES.find(([a, b]) => sec >= a && sec < b)?.[2] ?? '';

/** One shot, from second `from` to second `to`; `each(t, sec, i)` sets the scene for a moment (t from 0 to 1). */
async function shot(n, from, to, prepare, each) {
  if (only && !only.includes(n)) return;
  const first = Math.round(from * FPS);
  const count = Math.round(to * FPS) - first;
  const t0 = Date.now();
  await dress({ caption: '', fade: 1, cursor: null, ring: null, zoom: [1, 50, 50] });
  await page.evaluate(() => {
    document.getElementById('f-title').style.display = 'none';
    document.getElementById('f-credit').style.display = 'none';
  });
  await prepare();
  // Full resolution, and no change of resolution while the frames are taken.
  await page.evaluate(() => window.__lwQuality?.(1));
  await page.waitForTimeout(400);
  for (let i = 0; i < count; i++) {
    if (every > 1 && i % every !== 0 && i !== count - 1) continue;
    const sec = (first + i) / FPS;
    await each(count > 1 ? i / (count - 1) : 0, sec, i);
    await dress({ caption: subtitleAt(sec), fade: fadeAt(sec) });
    await raf();
    // The state of this moment, drawn now; the picture stays in the canvas until the grab.
    await page.evaluate(() => window.__lwDraw?.());
    await page.screenshot({ path: `${out}/${String(first + i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 95 });
  }
  console.log(`shot ${n}: ${count} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

const SLATE = (site, right) => `<span><b>${site}</b> · ${WORDS.real}</span><span>${right}</span>`;

// ---------- 1. The pole: the Sun runs along the horizon (0 to 6.3 s)
await shot(1, 0, CUT.ridge, async () => {
  await set({ tab: 'explore', siteId: 'malapert', timeMs: utc(2027, 1, 17), hero: '3d' });
  await dress({ film: true, plain: true });
  await page.evaluate(() => window.__lwProps?.(true));
  await page.waitForTimeout(9000);
  await lookBy('sun', -11, 0.4, 37);
  await page.waitForTimeout(1500);
}, async (t) => {
  const ms = utc(2027, 1, 17) + t * 5.2 * DAY;
  await set({ timeMs: ms });
  await lookBy('sun', lerp(-11, -6, t), lerp(0.4, 1.0, t), lerp(37, 31, out3(t)));
  await dress({ slate: SLATE(WORDS.place, `${stamp(ms)} · ${WORDS.lapse}`) });
});

// ---------- 2. A ridge takes the Sun, and the night sky comes out (6.3 to 9.3 s)
await shot(2, CUT.ridge, CUT.slip, async () => {
  await set({ timeMs: utc(2027, 2, 3, 0) });
  await dress({ film: true, plain: false });
  // A long lens on the ridge and the Sun: the rocks and the vehicle (set dressing) are left out of this one shot.
  await page.evaluate(() => window.__lwProps?.(false));
  await face('sun', 9, 0.6);
  await page.waitForTimeout(2500);
}, async (t) => {
  const ms = utc(2027, 2, 3, 0) + ease(clamp(t / 0.62)) * 21 * HOUR;
  await set({ timeMs: ms });
  // A long lens on the Sun as the ridge takes it; then the lens opens and tilts up to the sky.
  const open = ease(clamp((t - 0.42) / 0.58));
  await lookBy('sun', lerp(0, -30, open), lerp(0.7, 17, open), lerp(8.5, 54, open));
  await dress({ slate: SLATE(WORDS.place, `${stamp(ms)} · ${WORDS.lapse}`) });
});

// ---------- 3. The launch slips: the planner (9.3 to 13.3 s)
await shot(3, CUT.slip, CUT.stand, async () => {
  await page.evaluate(() => window.__lwProps?.(true));
  await dress({ film: false });
  await set({ tab: 'plan', plannedMs: utc(2027, 1, 17), slipDays: 0, detail: null });
  await page.waitForTimeout(4500);
}, async (t) => {
  const k = ease(clamp((t - 0.22) / 0.5));
  await set({ slipDays: Math.round(21 * k) });
  // Close on the slider while it is dragged; then the frame opens on what the delay did to the sites.
  await dress({ zoom: [lerp(1.36, 1.03, ease(clamp((t - 0.5) / 0.5))), 40, 8] });
  const thumb = await point('#slip', 0.012 + 0.976 * ((21 * k) / 120), 0.5);
  const rest = await point('.slip-read', 0.2, 2.6);
  if (thumb && rest) {
    const arrive = out3(clamp(t / 0.2));
    const leave = ease(clamp((t - 0.78) / 0.22));
    const x = t < 0.22 ? lerp(rest[0], thumb[0], arrive) : lerp(thumb[0], thumb[0] + 46, leave);
    const y = t < 0.22 ? lerp(rest[1], thumb[1], arrive) : lerp(thumb[1], thumb[1] + 62, leave);
    await dress({ cursor: [x, y] });
  }
});

// ---------- 4. Standing on the terrain (13.3 to 16.5 s)
await shot(4, CUT.stand, CUT.days, async () => {
  await dress({ film: false });
  await set({ detail: null, slipDays: 21 });
  await set({ tab: 'explore', siteId: 'malapert', timeMs: utc(2027, 1, 17), hero: '3d' });
  await page.waitForTimeout(10000);
  await lookBy('earth', -24, -5.5, 50);
  await page.waitForTimeout(1500);
}, async (t) => {
  await set({ timeMs: utc(2027, 1, 17) + t * 5 * HOUR });
  await lookBy('earth', lerp(-24, -4, ease(t)), lerp(-5.5, -4.5, t), lerp(50, 45, ease(t)));
  // Clarity: the frame closes slowly on the two instruments, the Sun and the Earth with their figures.
  await dress({ zoom: [lerp(1.0, 1.15, ease(t)), 100, 8] });
});

// ---------- 5. Every site, every day: the calendar and the reason (16.5 to 20.3 s)
let clicked = false;
await shot(5, CUT.days, CUT.proof, async () => {
  await dress({ film: false });
  await set({ tab: 'plan', plannedMs: utc(2027, 1, 17), slipDays: 21, detail: null });
  await page.waitForTimeout(4000);
}, async (t, sec, i) => {
  // In on the calendar while the pointer travels; after the click, across to the answer that opens on the right.
  const over = ease(clamp((t - 0.64) / 0.36));
  await dress({ zoom: [lerp(1.02, 1.12, ease(clamp(t / 0.6))) + 0.06 * over, lerp(62, 100, over), lerp(74, 34, over)] });
  // The pointer crosses the calendar, stops on a day of Connecting Ridge and opens it.
  const b = await cell(0, 7 + 21);
  if (!b) return;
  const k = out3(clamp(t / 0.46));
  // The pointer comes from the right, along the row.
  const dx = lerp(330, 0, k);
  const dy = lerp(96, 0, k);
  if (t < 0.56) {
    await page.mouse.move(b.mouse[0] + dx / b.k, b.mouse[1] + dy / b.k);
    await dress({ cursor: [b.show[0] + dx, b.show[1] + dy] });
  } else if (!clicked) {
    clicked = true;
    await page.mouse.click(b.mouse[0], b.mouse[1]);
    await page.mouse.move(2, 2);
  }
  if (t >= 0.5 && t < 0.62) await dress({ ring: [b.show[0], b.show[1], 1 - (t - 0.5) / 0.12, 0.4 + (t - 0.5) / 0.1] });
  else await dress({ ring: null });
  if (t >= 0.62) await dress({ cursor: null });
});

// ---------- 6. Checked against NASA (20.3 to 22.1 s)
await shot(6, CUT.proof, CUT.title, async () => {
  await page.mouse.move(2, 2);
  await set({ detail: null });
  await dress({ film: false });
  await set({ tab: 'accuracy' });
  await page.waitForTimeout(3500);
}, async (t) => {
  await page.evaluate((y) => (document.getElementById('main').scrollTop = y), Math.round(lerp(120, 176, ease(t))));
  await dress({ zoom: [lerp(1.2, 1.28, ease(t)), 50, 40] });
});

// ---------- 7. The last picture: the eclipse Blue Ghost recorded, as the tool draws it, and the title over it
// (from the end of "Horizons" to the end). One long take: the Earth in front of the Sun, seen from the Moon,
// and the Sun coming out again as the last line is said.
const ECLIPSE_FROM = utc(2025, 3, 14, Number(process.env.ECL_H ?? 8), Number(process.env.ECL_M ?? 20));
const ECLIPSE_MIN = Number(process.env.ECL_SPAN ?? 50);
await shot(7, CUT.title, CUT.end, async () => {
  await dress({ film: true, plain: true, zoom: [1, 50, 50] });
  await set({ tab: 'explore', siteId: 'blue-ghost-1', timeMs: ECLIPSE_FROM, hero: '3d' });
  await page.waitForTimeout(10000);
  await lookBy('sun', -2.5, 0.42, 3.7);
  await page.waitForTimeout(1500);
  await page.evaluate(
    ([team, line, w]) => {
      const title = document.getElementById('f-title');
      title.innerHTML = `<div class="f-name">Lunar Window</div><div class="f-rule"></div><div class="f-line">${line}</div><div class="f-meta">machinedramon.github.io/lunar-window<br>${w.challenge}${team ? ` · ${team}` : ''}</div>`;
      title.style.display = 'flex';
      const credit = document.getElementById('f-credit');
      credit.innerHTML = `${w.credit1}<br>${w.credit2}`;
      credit.style.display = 'flex';
    },
    [TEAM, CLOSING.text, WORDS],
  );
}, async (t, sec) => {
  const ms = ECLIPSE_FROM + t * ECLIPSE_MIN * 60e3;
  await set({ timeMs: ms });
  // The Earth keeps the right of the frame; the lens closes on it very slowly.
  await lookBy('sun', lerp(-2.5, -2.2, t), lerp(0.42, 0.36, t), lerp(3.7, 3.2, ease(t)));
  await dress({ slate: `<span><b>${WORDS.eclipsePlace}</b> · ${WORDS.eclipseWhat}</span><span>${stamp(ms)} · ${WORDS.eclipseNote}</span>` });
  // The name as she says it; the line under it as she reaches it; the address once she has finished.
  await page.evaluate(([name, rule, tag, meta]) => {
    const q = (c) => document.querySelector(`#f-title .f-${c}`);
    q('name').style.opacity = String(name);
    q('name').style.letterSpacing = `${0.26 + 0.1 * (1 - name)}em`;
    q('rule').style.width = `${rule * 150}px`;
    q('line').style.opacity = String(tag);
    q('line').style.transform = `translateY(${(1 - tag) * 10}px)`;
    q('meta').style.opacity = String(meta);
    document.getElementById('f-credit').style.opacity = String(meta);
  }, [out3(clamp((sec - (CLOSING.name - 0.3)) / 0.9)), ease(clamp((sec - (CLOSING.name + 0.45)) / 0.9)), out3(clamp((sec - (CLOSING.line - 0.15)) / 0.8)), ease(clamp((sec - (CLOSING.end + 0.15)) / 0.9))]);
});

await browser.close();
console.log('frames written to', out);
// ffmpeg -y -framerate 30 -i video/frames/%05d.jpg -i video/audio.wav -c:v libx264 -pix_fmt yuv420p -crf 16 -preset slow \
//   -c:a aac -b:a 192k -shortest -movflags +faststart -metadata comment="Narration: AI-generated voice (OpenAI text-to-speech). Music synthesised by a script." video/lunar-window-demo.mp4
