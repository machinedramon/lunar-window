// Development helper: how the vehicle and the mast stand on the ground. Prints the distance of every contact
// of the vehicle from the terrain and saves close pictures.   node tools/wheels.mjs [site] [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [site = 'malapert', out = 'video/wheels'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://localhost:5700/#explore?site=${site}&t=2027-01-17T00:00`, { waitUntil: 'networkidle' });
await page.waitForTimeout(11000);
const info = await page.evaluate(() => {
  const s = window.__lwScene();
  const p = s.props;
  return { gaps: p.vehicleGaps.map((g) => Math.round(g * 1000) / 1000), stands: p.stands };
});
const gaps = info.gaps;
console.log(`${site}: ${gaps.length} contacts; deepest ${Math.min(...gaps)} m, highest ${Math.max(...gaps)} m`);
console.log('gaps (m):', gaps.join(' '));
await page.addStyleTag({ content: '.hud, .stage-note, .stage-scrim, .dock, .top, .three-label, .three-controls, .three-hint, .three-tape, .three-sky { display: none !important; } .three { position: fixed !important; inset: 0 !important; z-index: 2000; }' });
let n = 0;
for (const at of info.stands) {
  const az = (Math.atan2(at.e, at.n) * 180) / Math.PI;
  const dist = Math.hypot(at.e, at.n);
  await page.evaluate(([a, p, f]) => window.__lwLook(a, p, f), [az, (-Math.atan2(1.6, dist) * 180) / Math.PI, n === 0 ? 14 : 12]);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${site}-${n === 0 ? 'vehicle' : 'mast'}.png` });
  n++;
}
await browser.close();
