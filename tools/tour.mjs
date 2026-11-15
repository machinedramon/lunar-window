// Development helper: one picture of every screen.   node tools/tour.mjs <dir> [width] [height] [only,names]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [dir = 'video/tour', width = '1440', height = '900', only = ''] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const VIEWS = [
  ['explore', '#explore?site=malapert&t=2027-01-17T00:00', 8000],
  ['plan', '#plan?slip=21', 3500],
  ['plan-detail', '#plan?slip=21&cell=cr1@2027-02-07', 3500],
  ['compare', '#compare', 3500],
  ['missions', '#missions', 3500],
  ['accuracy', '#accuracy', 3500],
].filter((v) => !only || only.split(',').includes(v[0]));
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +width, height: +height }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
for (const [name, hash, wait] of VIEWS) {
  await page.goto(`http://localhost:5700/${hash}`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: +width < 1100 });
}
console.log(problems.length ? problems.join('\n') : 'no console errors');
await browser.close();
