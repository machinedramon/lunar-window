// Records the 30-second demo, frame by frame, from the running development server.
//
//   node tools/record.mjs            all shots, 900 frames into video/frames
//   SHOTS=2,4 node tools/record.mjs  only some shots (numbered from 1)
//   TEAM="Team name" node tools/record.mjs
//
// Then ffmpeg joins the frames (command at the end of this file).
// Every picture is the real tool; the only things added are the captions and the two title cards.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const FPS = 30;
const TEAM = process.env.TEAM ?? 'Shell';
const only = process.env.SHOTS ? process.env.SHOTS.split(',').map(Number) : null;
const out = 'video/frames';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
// A 1440 x 810 page drawn at 4/3 scale gives 1920 x 1080 frames with an interface large enough to read.
const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3, reducedMotion: 'reduce' });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5700/#explore?site=malapert&t=2027-01-17T00:00', { waitUntil: 'networkidle' });
await page.addStyleTag({
  content: `
  #rec-cap { position: fixed; left: 0; right: 0; bottom: 0; z-index: 3000; text-align: center; pointer-events: none;
    font: 600 27px/1.25 'Space Grotesk Variable', sans-serif; letter-spacing: -0.01em; color: #fff; text-shadow: 0 2px 16px #000, 0 0 3px #000; padding: 90px 10% 44px;
    background: linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.86) 62%); }
  #rec-cap:empty { display: none; }
  body.clean .three-label, body.clean .three-insets, body.clean .three-tape { display: none !important; }
  #rec-card { position: fixed; inset: 0; z-index: 4000; background: #000; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 18px; color: #fff; text-align: center; }
  #rec-card.on { display: flex; }
  #rec-card .big { font: 600 92px/0.95 'Space Grotesk Variable', sans-serif; letter-spacing: -0.04em; }
  #rec-card .mid { font: 500 29px/1.2 'Space Grotesk Variable', sans-serif; color: #e6e6e6; }
  #rec-card .small { font: 500 16px/1.3 'Inter Variable', sans-serif; letter-spacing: 0.2em; text-transform: uppercase; color: #a9a9ae; }
  #rec-title { position: fixed; left: 0; right: 0; top: 24%; z-index: 3000; text-align: center; pointer-events: none; color: #fff; text-shadow: 0 2px 30px #000; display: none; }
  #rec-title.on { display: block; }
  #rec-title .big { font: 600 116px/0.95 'Space Grotesk Variable', sans-serif; letter-spacing: -0.045em; }
  #rec-title .mid { margin-top: 14px; font: 500 30px/1.2 'Space Grotesk Variable', sans-serif; }
  body.cinema .three { position: fixed !important; inset: 0 !important; height: 100vh !important; z-index: 2000; }
  body.cinema .three-hint, body.cinema .three-controls, body.cinema .three-caption { display: none !important; }
  body.cinema .three-insets { bottom: 112px; left: 30px; }
  body.tele .three-insets { display: none !important; }
  `,
});
await page.evaluate(() => {
  for (const id of ['rec-cap', 'rec-card', 'rec-title']) {
    const d = document.createElement('div');
    d.id = id;
    document.body.append(d);
  }
});

const raf = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const set = (patch) => page.evaluate((p) => window.__lwStore.set(p), patch);
const look = (az, pitch, fov) => page.evaluate(([a, b, c]) => window.__lwLook?.(a, b, c), [az, pitch, fov]);
const face = (which, fov, lift = 0) => page.evaluate(([w, f, l]) => window.__lwFace?.(w, f, l), [which, fov, lift]);
const caption = (text) => page.evaluate((t) => (document.getElementById('rec-cap').textContent = t), text);
const card = (html) => page.evaluate((h) => {
  const c = document.getElementById('rec-card');
  c.innerHTML = h ?? '';
  c.classList.toggle('on', !!h);
}, html);
const title = (html) => page.evaluate((h) => {
  const c = document.getElementById('rec-title');
  c.innerHTML = h ?? '';
  c.classList.toggle('on', !!h);
}, html);
const mode = (cinema, tele = false) => page.evaluate(([c, t]) => {
  document.body.classList.toggle('cinema', c);
  document.body.classList.toggle('tele', t);
}, [cinema, tele]);
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const utc = (y, m, d, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);

async function shoot(index) {
  await raf();
  await page.screenshot({ path: `${out}/${String(index).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 95 });
}

/** One shot: `seconds` long, starting at second `at`; `each(t, i)` sets the scene for a moment from 0 to 1. */
async function shot(n, at, seconds, prepare, each) {
  const count = Math.round(seconds * FPS);
  if (only && !only.includes(n)) return;
  const t0 = Date.now();
  // Start every shot from a clean frame: no card, no title, no caption left over from another shot.
  await card(null);
  await title(null);
  await caption('');
  await prepare();
  for (let i = 0; i < count; i++) {
    await each(count > 1 ? i / (count - 1) : 0, i);
    await shoot(Math.round(at * FPS) + i);
  }
  console.log(`shot ${n}: ${count} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// 1. Who (0:00 to 0:02)
await shot(1, 0, 2, async () => {
  await card(`<div class="small">NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator</div><div class="big">${TEAM}</div><div class="mid">Diego Ferreira · São Paulo, Brazil</div>`);
}, async () => {});

// 2. The problem (0:02 to 0:05.5): through a long lens, a ridge takes the Sun away
await shot(2, 2, 3.5, async () => {
  await set({ tab: 'explore', siteId: 'malapert', timeMs: utc(2027, 2, 2, 2, 0), hero: '3d' });
  await mode(true, true);
  await page.waitForTimeout(9000);
  await face('sun', 5.2, 0.35);
  await page.waitForTimeout(1500);
  await caption("At the Moon's south pole, one ridge decides if a lander has power and radio.");
}, async (t) => {
  await set({ timeMs: utc(2027, 2, 2, 2, 0) + Math.round(t * 9.5 * 3600000) });
  await face('sun', 5.2, 0.35);
});

// 3. The name (0:05.5 to 0:10): arriving at Malapert Massif
await shot(3, 5.5, 4.5, async () => {
  await set({ timeMs: utc(2027, 1, 17) });
  await mode(true, false);
  // The title plays over a clean picture, as the arrival shot of the tool itself does.
  await page.evaluate(() => document.body.classList.add('clean'));
  await look(338, -13, 58);
  await page.waitForTimeout(2500);
}, async (t, i) => {
  const k = ease(Math.min(1, t * 1.2));
  await look(lerp(338, 3, k), lerp(-13, 5.5, k), lerp(58, 44, k));
  if (i === Math.round(1.2 * FPS)) await title('<div class="big">Lunar Window</div><div class="mid">When the launch slips, see what still works.</div>');
});
await page.evaluate(() => document.body.classList.remove('clean'));

// 4. The planner and the slip (0:10 to 0:16)
await shot(4, 10, 6, async () => {
  await mode(false);
  await set({ tab: 'plan', plannedMs: utc(2027, 1, 17), slipDays: 0, detail: null });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(3500);
  await caption('State what the mission needs. Slip the launch. See what survives.');
}, async (t) => {
  const k = ease(Math.max(0, Math.min(1, (t - 0.2) / 0.5)));
  await set({ slipDays: Math.round(21 * k) });
});

// 5. The reason (0:16 to 0:18)
await shot(5, 16, 2, async () => {
  await set({ tab: 'plan', slipDays: 21, detail: { siteId: 'malapert', dayMs: utc(2027, 2, 7) } });
  await page.waitForTimeout(2500);
  await caption('Every answer comes with the reason.');
}, async () => {});

// 6. Standing at the site that survived (0:18 to 0:21)
await shot(6, 18, 3, async () => {
  await set({ detail: null });
  await set({ tab: 'explore', siteId: 'cr1', timeMs: utc(2027, 2, 7), hero: '3d' });
  await mode(true, false);
  await page.waitForTimeout(9000);
  await face('earth', 46, 3);
  await page.waitForTimeout(1200);
  await caption('And you can stand there.');
}, async (t) => {
  await face('earth', lerp(48, 42, ease(t)), lerp(4, 2.5, t));
});

// 7. Validation (0:21 to 0:24)
await shot(7, 21, 3, async () => {
  await mode(false);
  await set({ tab: 'accuracy' });
  await page.waitForTimeout(3000);
  await caption("Real NASA terrain. Checked against JPL Horizons and NASA's illumination maps.");
}, async (t) => {
  await page.evaluate((y) => window.scrollTo(0, y), Math.round(lerp(0, 620, ease(t))));
});

// 8. A real landing replayed (0:24 to 0:27)
await shot(8, 24, 3, async () => {
  await set({ tab: 'explore', siteId: 'blue-ghost-1', timeMs: utc(2025, 3, 2, 8, 34), hero: 'panorama' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2500);
  await caption('It predicts the eclipse and the sunset that Blue Ghost recorded in March 2025.');
}, async (t) => {
  await page.evaluate((y) => window.scrollTo(0, y), Math.round(lerp(0, 560, ease(t))));
});

// 9. End card (0:27 to 0:30)
await shot(9, 27, 3, async () => {
  await card('<div class="big">Lunar Window</div><div class="mid">Plan the landing. Replan in seconds.</div><div class="small">machinedramon.github.io/lunar-window</div>');
}, async () => {});

await browser.close();
console.log('frames written to', out);
// ffmpeg -y -framerate 30 -i video/frames/%05d.jpg -i video/audio.wav -c:v libx264 -pix_fmt yuv420p -crf 17 -preset slow \
//   -c:a aac -b:a 160k -shortest -movflags +faststart video/lunar-window-demo.mp4
