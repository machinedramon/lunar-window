// Development helper: the lines of the opening, and how long a change of screen takes once everything is read ahead.
//   node tools/opening.mjs [lang]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const lang = process.argv[2] ?? 'en';
mkdirSync('video/opening', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});
const t0 = Date.now();
await page.goto(`http://localhost:5700/?lang=${lang}`, { waitUntil: 'commit' });
const seen = [];
let last = '';
for (let i = 0; i < 160; i++) {
  const text = await page.evaluate(() => (document.getElementById('intro') ? (document.querySelector('.intro-stage')?.textContent ?? '') : null)).catch(() => '');
  if (text === null) break;
  if (text && text !== last) {
    seen.push(`${((Date.now() - t0) / 1000).toFixed(1)} s  ${text}`);
    last = text;
    await page.waitForTimeout(450);
    await page.screenshot({ path: `video/opening/${lang}-${seen.length}.png`, clip: { x: 320, y: 300, width: 800, height: 300 } });
  }
  await page.waitForTimeout(100);
}
console.log(seen.join('\n'));
console.log('opening gone after', ((Date.now() - t0) / 1000).toFixed(1), 's');
await page.waitForFunction(() => !document.querySelector('.explore.is-arriving'), null, { timeout: 60000 }).catch(() => {});
// Everything is read ahead a few seconds after the arrival; then the planner must be there at once.
await page.waitForTimeout(14000);
const t1 = Date.now();
await page.evaluate(() => window.__lwStore.set({ tab: 'plan' }));
await page.waitForFunction(() => document.querySelector('.summary-main') && !document.querySelector('.summary-main.muted'), null, { timeout: 30000 });
console.log('planner answer on screen after', Date.now() - t1, 'ms');
const t2 = Date.now();
await page.evaluate(() => window.__lwStore.set({ tab: 'missions' }));
await page.waitForTimeout(600);
await page.screenshot({ path: `video/opening/${lang}-missions.png` });
console.log('missions shown,', Date.now() - t2, 'ms');
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
