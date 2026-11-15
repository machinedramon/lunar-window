// Development helper: runs a snippet in the page after some clicks and prints what it returns.
//   node tools/probe.mjs <hash> <width> <height> "<selector to click, ...>" "<expression>"
import { chromium } from 'playwright-core';

const [hash = '', width = '1440', height = '900', clicks = '', expr = 'document.title'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +width, height: +height }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://localhost:5700/${hash}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
for (const sel of clicks.split(',').filter(Boolean)) {
  await page.click(sel.trim());
  await page.waitForTimeout(1500);
}
console.log(JSON.stringify(await page.evaluate(expr)));
await browser.close();
