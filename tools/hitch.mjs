// Development helper: where the picture stalls. Records the time between drawn frames from the first moment of
// the page, then while the antenna height is changed, and prints every gap longer than 50 ms.
//   node tools/hitch.mjs [hash]
import { chromium } from 'playwright-core';

const hash = process.argv[2] ?? '';
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript(() => {
  const gaps = (window.__gaps = []);
  let last = performance.now();
  const step = (now) => {
    // what stalls behind the opening screen is not seen; what stalls after it lifts is
    const phase = window.__phase ?? (document.body?.classList.contains('ready') ? 'shown' : 'covered');
    if (now - last > 50) gaps.push([Math.round(last), Math.round(now - last), phase]);
    if (!window.__readyAt && document.body?.classList.contains('ready')) window.__readyAt = Math.round(now);
    last = now;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});
await page.goto(`http://localhost:5700/${hash}`, { waitUntil: 'load' });
await page.waitForTimeout(14000);
const report = async (title, phase) => {
  const gaps = await page.evaluate((p) => window.__gaps.filter((g) => g[2] === p), phase);
  const total = gaps.reduce((s, g) => s + g[1], 0);
  console.log(`${title}: ${gaps.length} stalls over 50 ms, ${total} ms in all; longest ${Math.max(0, ...gaps.map((g) => g[1]))} ms`);
  console.log('  ' + gaps.map((g) => `${(g[0] / 1000).toFixed(1)}s:${g[1]}`).join('  '));
};
console.log('opening screen lifted at', await page.evaluate(() => window.__readyAt), 'ms');
await report('behind the opening screen', 'covered');
await report('after it lifted (what is seen)', 'shown');
for (const [i, name] of [
  [2, '10 m'],
  [0, '0 m'],
  [1, '2 m'],
]) {
  await page.evaluate((n) => (window.__phase = n), name);
  await page.locator('.hud-site .seg button').nth(i).click();
  await page.waitForTimeout(3500);
  await report(`antenna height to ${name}`, name);
}
await page.evaluate(() => (window.__phase = 'tab'));
await page.click('#tab-plan');
await page.waitForTimeout(3000);
await page.click('#tab-explore');
await page.waitForTimeout(3000);
await report('to the planner and back', 'tab');
await browser.close();
