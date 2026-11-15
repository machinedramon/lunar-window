// Development helper: stills of the 3D view, dressed as the demo film dresses it (black bars, no interface),
// to choose a camera.
//   node tools/film_look.mjs <name> <site> <iso time> <look> [<look> ...]
// A look is  az:<azimuth>:<pitch>:<fov>  or  sun:<fov>:<degrees to its side>:<degrees above>  (or earth:...).
// Writes video/look5/<name>-<n>.jpg and a sheet video/look5/_<name>.jpg is left to the caller.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [name = 'look', site = 'apollo-17', when = '1972-12-11T19:55', ...looks] = process.argv.slice(2);
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
  body.film .three-label, body.film .three-insets, body.film .three-tape, body.film .three-caption, body.film .three-controls, body.film .three-hint, body.film .three-title, body.film .three-sky { display: none !important; }
  .f-bar { position: fixed; left: 0; right: 0; height: 111px; background: #000; z-index: 5000; }`,
});
await page.evaluate(() => {
  document.body.classList.add('film');
  for (const side of ['top', 'bottom']) {
    const d = document.createElement('div');
    d.className = 'f-bar';
    d.style[side] = '0';
    document.documentElement.append(d);
  }
});
await page.waitForTimeout(7000);
await page.evaluate(() => window.__lwQuality?.(1));
// PROPS=0 leaves the rocks and the vehicles out.
if (process.env.PROPS === '0') await page.evaluate(() => window.__lwProps?.(false));
for (let i = 0; i < looks.length; i++) {
  const [kind, a, b = '0', c = '0'] = looks[i].split(':');
  if (kind === 'az') await page.evaluate(([x, y, z]) => window.__lwLook?.(x, y, z), [Number(a), Number(b), Number(c)]);
  else
    await page.evaluate(([w, fov, dAz, dPitch]) => {
      window.__lwFace?.(w, fov, 0);
      const s = window.__lwScene?.();
      if (s) window.__lwLook(s.look.az + dAz, s.look.pitch + dPitch, fov);
    }, [kind, Number(a), Number(b), Number(c)]);
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__lwDraw?.());
  await page.screenshot({ path: `${out}/${name}-${i}.jpg`, type: 'jpeg', quality: 86 });
}
await browser.close();
