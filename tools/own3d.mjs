// Development helper: the 3D view of a point of the visitor's own.   node tools/own3d.mjs <lat> <lon> [name]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [lat = '-85.992', lon = '2.056', name = 'own3d'] = process.argv.slice(2);
mkdirSync('video/own', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 200)}`);
});
const t0 = Date.now();
await page.goto(`http://localhost:5700/#explore?site=custom&ll=${lat},${lon}&t=2027-01-17T00:00`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !document.querySelector('.explore.is-arriving') && !document.getElementById('intro'), null, { timeout: 90000 }).catch(() => console.log('arrival did not finish'));
console.log('arrived after', Date.now() - t0, 'ms');
await page.waitForTimeout(2500);
await page.screenshot({ path: `video/own/${name}.png` });
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
