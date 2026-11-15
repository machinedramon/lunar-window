// Development helper: the journey between two sites (the Moon as a globe), frame by frame.
//   node tools/journey.mjs [from] [to]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [from = 'haworth', to = 'apollo-11'] = process.argv.slice(2);
mkdirSync('video/journey', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 200)}`);
});
await page.goto(`http://localhost:5700/#explore?site=${from}&t=2027-01-17T00:00`, { waitUntil: 'load' });
await page.waitForFunction(() => !document.querySelector('.explore.is-arriving') && !document.getElementById('intro'), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(9000); // everything is read ahead by now
const t0 = Date.now();
await page.evaluate((id) => window.__lwStore.set({ siteId: id }), to);
const marks = [250, 700, 1200, 1700, 2200, 2700, 3300, 4000, 5200, 7500];
for (let i = 0; i < marks.length; i++) {
  await page.waitForTimeout(Math.max(0, marks[i] - (Date.now() - t0)));
  await page.screenshot({ path: `video/journey/${String(i).padStart(2, '0')}.png` });
}
const on = await page.evaluate(() => document.querySelector('.travel')?.classList.contains('on'));
console.log('globe still on at the end:', on, '·', await page.locator('.site-meta').textContent());
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
