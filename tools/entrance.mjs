// Development helper: the first seconds of the site, as a strip of pictures.   node tools/entrance.mjs [hash] [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [hash = '', out = 'video/entrance'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const t0 = Date.now();
await page.goto(`http://localhost:5700/${hash}`, { waitUntil: 'commit' });
const marks = [300, 1200, 2300, 2900, 3600, 4800, 6000, 6600, 7200, 8200];
for (const [i, at] of marks.entries()) {
  await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
  await page.screenshot({ path: `${out}/${String(i).padStart(2, '0')}-${at}.png` });
}
await browser.close();
