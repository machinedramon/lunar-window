// Development helper: the shadows of the objects at a low Sun, from the three eye heights.
//   node tools/shadow.mjs [site] [time]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [site = 'apollo-11', time = '2024-06-12T21:18'] = process.argv.slice(2);
mkdirSync('video/shadow', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});
await page.goto(`http://localhost:5700/#explore?site=${site}&t=${time}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !document.querySelector('.explore.is-arriving') && !document.getElementById('intro'), null, { timeout: 90000 }).catch(() => console.log('no arrival'));
await page.addStyleTag({ content: '.hud, .stage-note, .stage-scrim, .dock, .three-label, .three-controls, .three-hint, .three-tape { display: none !important; }' });
for (const [mast, name] of [[2, '10m'], [1, '2m'], [0, '0m']]) {
  await page.evaluate((m) => window.__lwStore.set({ req: { ...window.__lwStore.state.req, mast: m } }), mast);
  await page.waitForTimeout(2600);
  await page.evaluate(() => window.__lwLook?.(200, -16, 62));
  await page.waitForTimeout(900);
  await page.screenshot({ path: `video/shadow/${site}-${name}.png` });
}
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
