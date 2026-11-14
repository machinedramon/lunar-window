// Development helper: screenshot of the 3D view only.  node tools/shot3d.mjs <hash> <out.png> [width] [height]
import { chromium } from 'playwright-core';
const [hash = '', out = 'shot3d.png', width = '1440', height = '900'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +width, height: +height }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await page.goto(`http://localhost:5700/${hash}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(Number(process.env.WAIT ?? 5000));
if (process.env.LOOK) {
  const [az, pitch, fov] = process.env.LOOK.split(',').map(Number);
  await page.evaluate(([a, b, c]) => window.__lwLook(a, b, c), [az, pitch, fov]);
  await page.waitForTimeout(2500);
}
const el = await page.$('.three');
await el.screenshot({ path: out });
console.log(problems.filter((p) => !p.includes('GPU stall')).slice(0, 8).join('\n') || 'no console errors');
await browser.close();
