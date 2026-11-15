// Development helper: the night sky of the 3D view, wide and close.   node tools/nightsky.mjs [outDir] [waitMs]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [out = 'video/night', wait = '13000'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(m.type(), m.text().slice(0, 300));
});
await page.goto('http://localhost:5700/#explore?site=malapert&t=2027-02-04T12:00', { waitUntil: 'networkidle' });
await page.waitForTimeout(+wait);
await page.addStyleTag({ content: '.hud, .stage-note, .stage-scrim, .dock, .top, .three-label, .three-controls, .three-hint, .three-tape { display: none !important; } .three { position: fixed !important; inset: 0 !important; z-index: 2000; }' });
const info = await page.evaluate(() => {
  const s = window.__lwScene();
  return { stars: s.starLevel, fine: s.galaxyMat.uniforms.uFineOn.value };
});
console.log(JSON.stringify(info));
let n = 0;
for (const [az, pitch, fov] of [
  [158, 24, 46],
  [160, 20, 18],
]) {
  await page.evaluate(([a, p, f]) => window.__lwLook(a, p, f), [az, pitch, fov]);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/sky-${n++}.png` });
}
await browser.close();
