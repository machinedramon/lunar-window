// Development helper: a point of the visitor's own, on real terrain.
// Clicks the map of the planner to place a point, waits for its terrain, then opens the same point in Explore.
//   node tools/own.mjs [lang]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const lang = process.argv[2] ?? 'en';
mkdirSync('video/own', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 200)}`);
});
await page.goto(`http://localhost:5700/?lang=${lang}#plan?site=malapert&t=2027-01-17T00:00&plan=2027-01-17&slip=21`, { waitUntil: 'networkidle' });
await page.waitForTimeout(9000);
const box = await page.locator('.map-canvas').boundingBox();
const t0 = Date.now();
// A point on the far side of the pole from the listed sites, inside 84°S.
await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.55);
await page.waitForFunction(() => /remove|remover|quitar/.test(document.querySelector('.map-legend')?.textContent ?? '') && !/computing|calculando/i.test(document.querySelector('.map-legend')?.textContent ?? ''), null, { timeout: 60000 });
console.log('terrain of the point ready after', Date.now() - t0, 'ms;', await page.locator('.map-legend').textContent());
await page.waitForTimeout(4000);
await page.screenshot({ path: `video/own/plan-${lang}.png` });
console.log('summary:', await page.locator('.summary-main').first().textContent());
const hash = await page.evaluate(() => location.hash);
console.log(hash);
// The same point, explored.
await page.evaluate(() => window.__lwStore.set({ tab: 'explore', siteId: 'custom', hero: '3d' }));
await page.waitForTimeout(9000);
await page.screenshot({ path: `video/own/explore-${lang}.png` });
await page.evaluate(() => window.__lwStore.set({ hero: 'panorama' }));
await page.waitForTimeout(2500);
await page.screenshot({ path: `video/own/panorama-${lang}.png` });
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
