// Development helper: stills of a place in the 3D view, dressed as the demo film dresses it, looking around.
//   node tools/film_look.mjs <site> <iso time> [fov] [pitch]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [site = 'apollo-17', when = '1972-12-11T19:55', fov = '50', pitch = '5'] = process.argv.slice(2);
const out = 'video/look5';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await context.addInitScript(() => {
  window.__lwPreserve = true;
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://localhost:5700/?lang=en#explore?site=${site}&t=${when}`, { waitUntil: 'load' });
await page.waitForFunction(() => !document.querySelector('.explore.is-arriving') && !document.getElementById('intro'), null, { timeout: 90000 }).catch(() => {});
await page.addStyleTag({
  content: `body.film .top, body.film .foot, body.film .dock, body.film .hud, body.film .stage-note, body.film .stage-scrim { display: none !important; }
  body.film .three { position: fixed !important; inset: 0 !important; z-index: 2000; }
  body.film .three-label, body.film .three-insets, body.film .three-tape, body.film .three-caption, body.film .three-controls, body.film .three-hint, body.film .three-title, body.film .three-sky { display: none !important; }`,
});
await page.evaluate(() => document.body.classList.add('film'));
await page.waitForTimeout(6000);
await page.evaluate(() => window.__lwQuality?.(1));
const m = await page.evaluate(() => {
  const s = window.__lwScene?.();
  return s ? { az: s.look.az, pitch: s.look.pitch, fov: s.look.fov } : null;
});
console.log('look on arrival', JSON.stringify(m));
for (let az = 0; az < 360; az += 45) {
  await page.evaluate(([a, b, c]) => window.__lwLook?.(a, b, c), [az, Number(pitch), Number(fov)]);
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__lwDraw?.());
  await page.screenshot({ path: `${out}/${site}-az${String(az).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 85 });
}
await browser.close();
