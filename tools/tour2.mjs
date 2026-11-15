// Development helper: pictures of the states the tour does not reach.   node tools/tour2.mjs <dir> [width] [height]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [dir = 'video/tour2', width = '1440', height = '900'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +width, height: +height }, deviceScaleFactor: 1 });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await page.goto('http://localhost:5700/#missions', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.click('.mission-card');
await page.waitForTimeout(1800);
await page.screenshot({ path: `${dir}/mission-1.png` });
for (let i = 0; i < 2; i++) {
  await page.click('.mission-side .btn.primary');
  await page.waitForTimeout(3200);
}
await page.screenshot({ path: `${dir}/mission-3.png` });
await page.goto('http://localhost:5700/#plan?slip=21', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const tab = await page.$$('.plan-data .seg button');
if (tab[1]) await tab[1].click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${dir}/plan-table.png` });
console.log(problems.length ? problems.join(' | ') : 'no errors');
await browser.close();
