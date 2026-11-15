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
//
// The order is the order of the story: the problem (1, 2), what a delay does (3), the answer and the reason (4),
// how (5: any point of the Moon, on real terrain), the proof (6, 7), the name (8: the Earth rises).
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
    homePlace: 'Haworth, lunar south pole',
    rise: 'the Earth rises · time-lapse',
    apollo: 'Apollo 17, Taurus–Littrow',
    landing: 'the hour of the landing',
    globe: 'the Moon as NASA’s LRO camera mapped it',
    challenge: 'NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator',
  },
  pt: {
    months: ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'],
    real: 'terreno real NASA LOLA',
    place: 'Malapert Massif, polo sul lunar',
    lapse: 'tempo acelerado',
    homePlace: 'Haworth, polo sul lunar',
    rise: 'a Terra nasce · tempo acelerado',
    apollo: 'Apollo 17, Taurus–Littrow',
    landing: 'a hora do pouso',
    globe: 'a Lua como a câmera da LRO, da NASA, a mapeou',
    challenge: 'NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator',
  },
  es: {
    months: ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'],
    real: 'terreno real NASA LOLA',
    place: 'Malapert Massif, polo sur lunar',
    lapse: 'tiempo acelerado',
    homePlace: 'Haworth, polo sur lunar',
    rise: 'sale la Tierra · tiempo acelerado',
    apollo: 'Apollo 17, Taurus–Littrow',
    landing: 'la hora del alunizaje',
    globe: 'la Luna tal como la cartografió la cámara LRO de la NASA',
    challenge: 'NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator',
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
  /* The title stands on the left, over a darkened side of the picture; the Earth keeps the right. */
  #f-title { position: fixed; inset: 0; z-index: 5200; display: none; flex-direction: column; align-items: flex-start; justify-content: center; padding: 0 0 26px 118px; color: #fff; text-align: left; pointer-events: none;
    background: linear-gradient(90deg, rgba(0,0,0,0.6), rgba(0,0,0,0.4) 34%, transparent 58%); }
  #f-title .f-name { font: 500 64px/1 'Jost Variable', sans-serif; letter-spacing: 0.26em; text-transform: uppercase; white-space: nowrap; }
  #f-title .f-rule { width: 0; height: 1px; background: rgba(255,255,255,0.7); margin-top: 28px; }
  #f-title .f-line { margin-top: 24px; font: 400 27px/1.2 'Jost Variable', sans-serif; letter-spacing: 0; white-space: nowrap; }
  #f-title .f-meta { margin-top: 30px; font: 500 11.5px/2 'B612', sans-serif; letter-spacing: 0.2em; text-transform: uppercase; color: rgba(255,255,255,0.74); white-space: nowrap; }
  #f-cursor { position: fixed; left: 0; top: 0; z-index: 5500; width: 26px; height: 26px; pointer-events: none; display: none; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.7)); }
  #f-ring { position: fixed; left: 0; top: 0; z-index: 5490; width: 40px; height: 40px; margin: -20px 0 0 -20px; border: 1.5px solid #fff; border-radius: 50%; pointer-events: none; opacity: 0; }
  body.film .top, body.film .foot, body.film .dock, body.film .hud, body.film .stage-note, body.film .stage-scrim { display: none !important; }
  body.film .three { position: fixed !important; inset: 0 !important; z-index: 2000; }
  body.film .three-label, body.film .three-insets, body.film .three-tape, body.film .three-caption, body.film .three-controls, body.film .three-hint, body.film .three-title { display: none !important; }
  body.film.plain .three-sky { display: none !important; }
  body.film .travel-route, body.film .travel-km { display: none !important; }
  `,
});
await page.evaluate(() => {
  for (const id of ['f-top', 'f-bot', 'f-cap', 'f-slate', 'f-fade', 'f-title', 'f-ring', 'f-cursor']) {
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
      // (The page asks for the whole window at least; under the subtitle bar it must be allowed less.)
      document.body.style.minHeight = o.film ? '' : '0';
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
  // from the tool out to the Moon: the globe comes up out of black
  if (sec >= CUT.any && sec < CUT.any + 0.3) return 1 - ease((sec - CUT.any) / 0.3);
  // out of the tool and into the last picture: a breath of black, shorter going out than coming in
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

// ---------- 1. The problem. The pole: the Sun runs along the horizon and never climbs
await shot(1, 0, CUT.ridge, async () => {
  await set({ tab: 'explore', siteId: 'malapert', timeMs: utc(2027, 1, 17), hero: '3d' });
  await dress({ film: true, plain: true });
  await page.evaluate(() => window.__lwProps?.(true));
  await page.waitForTimeout(9000);
  await lookBy('sun', -11, 0.4, 37);
  await page.waitForTimeout(1500);
}, async (t) => {
  // (Stops before the Sun goes behind the mast.)
  const ms = utc(2027, 1, 17) + t * 3.4 * DAY;
  await set({ timeMs: ms });
  await lookBy('sun', lerp(-11, -6, t), lerp(0.4, 1.0, t), lerp(37, 31, out3(t)));
  await dress({ slate: SLATE(WORDS.place, `${stamp(ms)} · ${WORDS.lapse}`) });
});

// ---------- 2. One hill can hide it: a long lens on the Sun as the ridge takes it
await shot(2, CUT.ridge, CUT.slip, async () => {
  await set({ tab: 'explore', siteId: 'malapert', timeMs: utc(2027, 2, 3, 1), hero: '3d' });
  await dress({ film: true, plain: false });
  // The rocks and the vehicle (set dressing) are left out of this one shot.
  await page.evaluate(() => window.__lwProps?.(false));
  await page.waitForTimeout(only ? 9000 : 2500);
  await face('sun', 9, 0.6);
  await page.waitForTimeout(1500);
}, async (t) => {
  const ms = utc(2027, 2, 3, 1) + ease(clamp(t / 0.8)) * 17 * HOUR;
  await set({ timeMs: ms });
  // Once the Sun is gone the lens opens and tilts up, on the dark ground and the night sky.
  const open = ease(clamp((t - 0.56) / 0.44));
  await lookBy('sun', lerp(0, -16, open), lerp(0.7, 8.5, open), lerp(8.5, 34, open));
  await dress({ slate: SLATE(WORDS.place, `${stamp(ms)} · ${WORDS.lapse}`) });
});

// ---------- 3. What a delay does: the launch slips, and the sites that worked no longer do
await shot(3, CUT.slip, CUT.days, async () => {
  await page.evaluate(() => window.__lwProps?.(true));
  await dress({ film: false });
  await set({ tab: 'plan', plannedMs: utc(2027, 1, 17), slipDays: 0, detail: null });
  await page.waitForTimeout(4500);
}, async (t) => {
  const k = ease(clamp((t - 0.2) / 0.46));
  await set({ slipDays: Math.round(21 * k) });
  // Close on the slider while it is dragged; then the frame opens on what the delay did to the sites.
  await dress({ zoom: [lerp(1.36, 1, ease(clamp((t - 0.52) / 0.48))), 40, 8] });
  const thumb = await point('#slip', 0.012 + 0.976 * ((21 * k) / 120), 0.5);
  const rest = await point('.slip-read', 0.2, 2.6);
  if (thumb && rest) {
    const arrive = out3(clamp(t / 0.18));
    const leave = ease(clamp((t - 0.72) / 0.22));
    const x = t < 0.2 ? lerp(rest[0], thumb[0], arrive) : lerp(thumb[0], thumb[0] + 46, leave);
    const y = t < 0.2 ? lerp(rest[1], thumb[1], arrive) : lerp(thumb[1], thumb[1] + 62, leave);
    // The pointer lets go and leaves; it does not stay over the answer.
    await dress({ cursor: t < 0.9 ? [x, y] : null });
  }
});

// ---------- 4. The answer: every site, every day; and, on a day that fails, the reason
let clicked = false;
/** Haworth is the fourth row of the calendar; the calendar starts seven days before the planned date. */
const WHY_ROW = 3;
const WHY_DAY = 7 + 21;
await shot(4, CUT.days, CUT.any, async () => {
  await dress({ film: false });
  await set({ tab: 'plan', plannedMs: utc(2027, 1, 17), slipDays: 21, detail: null });
  await page.waitForTimeout(4000);
}, async (t, sec) => {
  const length = CUT.any - CUT.days;
  const click = (CUT.why - CUT.days) / length;
  // In on the calendar while the pointer travels; after the click, across to the reason that opens on the right.
  const over = ease(clamp((sec - CUT.why - 0.08) / 0.75));
  await dress({ zoom: [lerp(1, 1.15, ease(clamp(t / click))) + 0.27 * over, lerp(60, 100, over), lerp(78, 30, over)] });
  const b = await cell(WHY_ROW, WHY_DAY);
  if (!b) return;
  // The pointer comes from the right, along the rows, and stops on a day of Haworth that no longer works.
  const k = out3(clamp(t / (click - 0.1)));
  const dx = lerp(360, 0, k);
  const dy = lerp(-74, 0, k);
  if (t < click) {
    await page.mouse.move(b.mouse[0] + dx / b.k, b.mouse[1] + dy / b.k);
    await dress({ cursor: [b.show[0] + dx, b.show[1] + dy] });
  } else if (!clicked) {
    clicked = true;
    await page.mouse.click(b.mouse[0], b.mouse[1]);
    await page.mouse.move(2, 2);
  }
  const since = sec - CUT.why;
  if (since >= -0.1 && since < 0.3) await dress({ ring: [b.show[0], b.show[1], 1 - (since + 0.1) / 0.4, 0.4 + (since + 0.1) / 0.3] });
  else await dress({ ring: null });
  if (since >= 0.12) await dress({ cursor: null });
});

// ---------- 5. How: any point of the Moon, on NASA's terrain. Over the globe from the pole to Taurus-Littrow,
// and down on it at the hour Apollo 17 landed.
const APOLLO = utc(1972, 12, 11, 19, 55);
const FROM = { lat: -87.05, lon: -24.24, name: 'Haworth' };
const TO = { lat: 20.1911, lon: 30.7723, name: WORDS.apollo };
let way = '';
await shot(5, CUT.any, CUT.proof, async () => {
  await page.mouse.move(2, 2);
  await set({ detail: null });
  await dress({ film: true, plain: true, zoom: [1, 50, 50] });
  await set({ tab: 'explore', siteId: 'apollo-17', timeMs: APOLLO, hero: '3d' });
  await page.evaluate(() => window.__lwProps?.(true));
  await page.waitForTimeout(10000);
  await look(222, 5, 50);
  await page.evaluate(([from, to]) => window.__lwJourney.show(from, to, to), [FROM, TO]);
  way = await page.evaluate(() => document.querySelector('.travel-route')?.textContent.replace(/\s+/g, ' ').trim() ?? '');
  await page.waitForTimeout(800);
}, async (t, sec) => {
  // The globe: already on its way up from the pole, across the Moon, and down.
  const g = clamp((sec - CUT.any) / (CUT.land + 0.12 - CUT.any));
  const gone = ease(clamp((sec - (CUT.land - 0.22)) / 0.42));
  await page.evaluate(([p, o]) => {
    // (Further back than in the tool: between the black bars the whole Moon must fit.)
    window.__lwJourney.pose(p, 2.3);
    const el = document.querySelector('.travel');
    el.style.opacity = String(o);
    el.style.visibility = o > 0 ? 'visible' : 'hidden';
  }, [lerp(0.3, 1, 1 - Math.pow(1 - g, 1.7)), 1 - gone]);
  // Standing there: the frame settles on the Lunar Module, with the South Massif behind it.
  const settle = out3(clamp((sec - (CUT.land - 0.25)) / (CUT.proof - CUT.land + 0.25)));
  await look(lerp(223, 210, settle), lerp(5.5, 4.5, settle), lerp(51, 46, settle));
  await dress({ slate: gone < 0.5 ? `<span><b>${way}</b></span><span>${WORDS.globe}</span>` : SLATE(WORDS.apollo, `${stamp(APOLLO)} · ${WORDS.landing}`) });
});

// ---------- 6. The proof, first half: every number. The first screen of the tool, as it opens: the place in 3D
// and, beside it, the Sun and the Earth with their figures, which run with the clock.
let first = null;
await shot(6, CUT.proof, CUT.check, async () => {
  await page.evaluate(() => {
    window.__lwJourney?.hide();
    const el = document.querySelector('.travel');
    if (el) el.style.opacity = el.style.visibility = '';
  });
  await page.mouse.move(2, 2);
  await dress({ film: false, zoom: [1, 50, 50] });
  await page.evaluate(() => window.__lwProps?.(true));
  await set({ detail: null, tab: 'explore', siteId: 'haworth', timeMs: utc(2027, 1, 17), hero: '3d' });
  await page.waitForTimeout(11000);
  first = await page.evaluate(() => {
    const s = window.__lwScene?.();
    return s ? { az: s.look.az, pitch: s.look.pitch, fov: s.look.fov } : null;
  });
}, async (t) => {
  await set({ timeMs: utc(2027, 1, 17) + t * 5 * HOUR });
  // The whole screen, uncut: the view drifts a little behind the instruments while their figures run.
  if (first) await look(first.az + lerp(-1.6, 1.6, t), first.pitch, first.fov - 1.5 * ease(t));
});

// ---------- 7. The proof, second half: checked against NASA's JPL Horizons. The Accuracy page.
await shot(7, CUT.check, CUT.title, async () => {
  await page.mouse.move(2, 2);
  await dress({ film: false });
  await set({ detail: null, tab: 'accuracy' });
  await page.waitForTimeout(3500);
}, async (t) => {
  // The question, the three figures and the first places of the table, whole, while the frame closes slowly.
  await page.evaluate(() => (document.getElementById('main').scrollTop = 0));
  await dress({ zoom: [lerp(1.13, 1.2, ease(t)), 50, 56] });
});

// ---------- 8. The last picture: the Earth clears the ridge at Haworth, on the days of the slipped landing,
// through a long lens, and the title stands beside it. The camera does not move: it waits where the Earth will be.
// Six and a half hours pass: slow enough for the Earth to turn like a planet, not like a toy, from Africa to
// South America, while it lifts off the ridge by a fifth of its width.
const RISE_FROM = utc(2027, 2, 7) + Number(process.env.RISE_H ?? 9.5) * HOUR;
const RISE_HOURS = Number(process.env.RISE_SPAN ?? 6.5);
let home = null;
await shot(8, CUT.title, CUT.end, async () => {
  await dress({ film: true, plain: true, zoom: [1, 50, 50] });
  await set({ tab: 'explore', siteId: 'haworth', timeMs: RISE_FROM + RISE_HOURS * HOUR, hero: '3d' });
  // Through this lens the rocks and the vehicle next to the camera would only be in the way.
  await page.evaluate(() => window.__lwProps?.(false));
  await page.waitForTimeout(11000);
  // Again once the place has loaded: when this shot is recorded alone, the place is built after the first call.
  await page.evaluate(() => window.__lwProps?.(false));
  await face('earth', 8, 0);
  await page.waitForTimeout(800);
  home = await page.evaluate(() => {
    const s = window.__lwScene?.();
    return s ? { az: s.look.az, pitch: s.look.pitch } : null;
  });
  await page.evaluate(
    ([team, line, w]) => {
      const title = document.getElementById('f-title');
      title.innerHTML = `<div class="f-name">Lunar Window</div><div class="f-rule"></div><div class="f-line">${line}</div><div class="f-meta">machinedramon.github.io/lunar-window<br>${w.challenge}${team ? ` · ${team}` : ''}</div>`;
      title.style.display = 'flex';
    },
    [TEAM, CLOSING.text, WORDS],
  );
}, async (t, sec) => {
  // Almost steady, a little slower as the Earth comes free of the ridge.
  const ms = RISE_FROM + (1 - Math.pow(1 - t, 1.25)) * RISE_HOURS * HOUR;
  await set({ timeMs: ms });
  // The Earth keeps the right of the frame; the lens closes on it very slowly.
  if (home) await look(home.az - 1.3, home.pitch - 0.15, lerp(4.2, 3.7, ease(t)));
  await dress({ slate: SLATE(WORDS.homePlace, `${stamp(ms)} · ${WORDS.rise}`) });
  // The name as she says it; the line under it as she reaches it; the address once she has finished.
  await page.evaluate(([name, rule, tag, meta]) => {
    const q = (c) => document.querySelector(`#f-title .f-${c}`);
    q('name').style.opacity = String(name);
    q('name').style.letterSpacing = `${0.26 + 0.1 * (1 - name)}em`;
    q('rule').style.width = `${rule * 150}px`;
    q('line').style.opacity = String(tag);
    q('line').style.transform = `translateY(${(1 - tag) * 10}px)`;
    q('meta').style.opacity = String(meta);
  }, [out3(clamp((sec - (CLOSING.name - 0.3)) / 0.9)), ease(clamp((sec - (CLOSING.name + 0.45)) / 0.9)), out3(clamp((sec - (CLOSING.line - 0.15)) / 0.8)), ease(clamp((sec - (CLOSING.end + 0.15)) / 0.9))]);
});

await browser.close();
console.log('frames written to', out);
// ffmpeg -y -framerate 30 -i video/frames/%05d.jpg -i video/audio.wav -c:v libx264 -pix_fmt yuv420p -crf 16 -preset slow \
//   -c:a aac -b:a 192k -shortest -movflags +faststart -metadata comment="Narration: AI-generated voice (OpenAI text-to-speech). Music synthesised by a script." video/lunar-window-demo.mp4
