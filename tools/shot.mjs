// Development helper: opens the running app in a headless browser, saves a screenshot and
// prints console errors.  Usage: node tools/shot.mjs <hash> <output.png> [width] [height] [full]
import { chromium } from 'playwright-core';

const [hash = '', out = 'shot.png', width = '1440', height = '900', full = 'full'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +width, height: +height }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
const t0 = Date.now();
await page.goto(`http://localhost:5700/${hash}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(Number(process.env.WAIT ?? 900));
console.log(`loaded in ${Date.now() - t0} ms`);
await page.screenshot({ path: out, fullPage: full === 'full' });
console.log(problems.length ? problems.join('\n') : 'no console errors');
await browser.close();
