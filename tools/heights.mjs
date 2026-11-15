// Development helper: the same view at the three antenna heights, and the frames in between.
//   node tools/heights.mjs [hash] [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [hash = '#explore?site=malapert&t=2027-01-17T00:00', out = 'video/heights'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://localhost:5700/${hash}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(12000);
const read = () =>
  page.evaluate(() => {
    const s = window.__lwScene();
    const num = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent).join(' | ');
    return { eye: +s.camera.position.y.toFixed(2), exposure: +s.renderer.toneMappingExposure.toFixed(2), stars: +s.starLevel.toFixed(2), sun: num('.inst.sun dd'), earth: num('.inst.earth dd') };
  });
await page.screenshot({ path: `${out}/2m.png` });
console.log('2 m ', JSON.stringify(await read()));
for (const [i, name] of [
  [0, '0m'],
  [2, '10m'],
]) {
  await page.locator('.hud-site .seg button').nth(i).click();
  for (const ms of [120, 400, 900]) {
    await page.waitForTimeout(ms === 120 ? 120 : ms - (ms === 400 ? 120 : 400));
    await page.screenshot({ path: `${out}/${name}-${ms}.png` });
  }
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name.padEnd(4), JSON.stringify(await read()));
}
await browser.close();
