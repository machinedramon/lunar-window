// Development helper: one direction of view at the three antenna heights.   node tools/look.mjs <az> <pitch> <fov> [outDir] [site] [time]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [az = '215', pitch = '-4', fov = '62', out = 'video/look', site = 'malapert', time = '2027-01-17T00:00'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('error', m.text().slice(0, 300));
});
await page.goto(`http://localhost:5700/#explore?site=${site}&t=${time}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(11000);
for (const [i, name] of [
  [1, '2m'],
  [0, '0m'],
  [2, '10m'],
]) {
  await page.locator('.hud-site .seg button').nth(i).click();
  await page.evaluate(([a, p, f]) => window.__lwLook(a, p, f), [+az, +pitch, +fov]);
  await page.waitForTimeout(4200);
  await page.screenshot({ path: `${out}/${name}.png` });
}
await browser.close();
