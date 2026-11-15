// Development helper: the screens in another language, switched with one click.   node tools/lang.mjs <pt|es> [outDir] [width] [height]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [code = 'pt', out = 'video/lang', width = '1440', height = '900'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +width, height: +height }, deviceScaleFactor: 1 });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`);
});
await page.goto('http://localhost:5700/#explore?site=malapert&t=2027-01-17T00:00', { waitUntil: 'networkidle' });
await page.waitForTimeout(10500);
const index = { en: 1, pt: 2, es: 3 }[code];
const before = await page.evaluate(() => window.__lwScene().clock);
await page.click(`.seg.lang button:nth-child(${index})`);
await page.waitForTimeout(700);
const after = await page.evaluate(() => [window.__lwScene().clock, document.documentElement.lang, document.title, document.querySelector('.explore')?.className]);
console.log('the 3D scene kept running:', after[0] > before, '| lang', after[1], '|', after[2], '|', after[3]);
await page.screenshot({ path: `${out}/${code}-explore.png` });
for (const tab of ['plan', 'compare', 'missions', 'accuracy']) {
  await page.click(`#tab-${tab}`);
  await page.waitForTimeout(tab === 'plan' ? 3500 : 2200);
  await page.screenshot({ path: `${out}/${code}-${tab}.png` });
}
console.log(problems.length ? problems.join('\n') : 'no errors');
await browser.close();
